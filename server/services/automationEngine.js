import { AutomationFlow, AutomationRun, Contact, Conversation, Message, WhatsAppAccount } from "../models/index.js";
import { executorFor } from "./automationExecutors.js";
import { getWorkspaceIntegrations } from "./integrations.js";
import { enqueueJob } from "./jobs.js";
import { logger } from "./logger.js";

const AUTOMATION_QUEUE = "automations";
const RESUME_JOB = "automation.resume-run";

// The "loop" node kind (automationExecutors.js's execLoop) wires its body back to itself via a
// real cycle in the graph - each revisit reads its own prior step state to advance to the next
// item, so a run with a loop over N items genuinely needs ~N revisits of the loop node (and of
// its body nodes) before hitting "done". Both limits were raised together from their Phase-1
// values (200 / 5) specifically to make that usable: STEP_LIMIT is the real backstop against a
// runaway/infinite loop (bounds the whole run regardless of how visits are distributed);
// VISIT_LIMIT stays a separate, cheaper per-node guard for a genuinely stuck single node, kept
// high enough that a legitimate loop won't trip it before STEP_LIMIT would anyway.
const STEP_LIMIT = 1000;
const VISIT_LIMIT = 300;

// Builds a node map + outgoing-edges-by-source index for one flow. Backward-compat is the
// important part: today's flat scan runs every node in flow.nodes regardless of wiring (edges
// are never read), so a pure "only traverse what's connected to the trigger" engine would be a
// real regression for old flows with disconnected/orphaned nodes. Fix: any node with no incoming
// edge (other than the trigger) gets auto-appended to the end of the main chain, so fully-wired
// new flows traverse exactly as drawn, and old/loosely-wired flows keep running everything - just
// in deterministic wired order instead of the old hardcoded type-priority order.
export function normalizeFlowGraph(flow) {
  const nodes = Array.isArray(flow.nodes) ? flow.nodes : [];
  const edges = Array.isArray(flow.edges) ? flow.edges : [];
  const nodeMap = new Map(nodes.map((node) => [node.id, node]));
  const outgoing = new Map();
  const hasIncoming = new Set();

  function addEdge(edge) {
    if (!nodeMap.has(edge.source) || !nodeMap.has(edge.target)) return;
    if (!outgoing.has(edge.source)) outgoing.set(edge.source, []);
    outgoing.get(edge.source).push(edge);
    hasIncoming.add(edge.target);
  }

  for (const edge of edges) addEdge(edge);

  const triggerNode = nodes.find((node) => node.type === "trigger") || nodes[0] || null;
  const triggerNodeId = triggerNode?.id ?? null;

  const orphans = nodes.filter((node) => node.id !== triggerNodeId && !hasIncoming.has(node.id));
  if (orphans.length && triggerNodeId) {
    // Walk the main chain from the trigger to its current tail, following the first outgoing
    // edge at each step, then append orphans one after another in flow.nodes order.
    let tailId = triggerNodeId;
    const visited = new Set();
    while (outgoing.has(tailId) && outgoing.get(tailId).length && !visited.has(tailId)) {
      visited.add(tailId);
      tailId = outgoing.get(tailId)[0].target;
    }

    let previousId = tailId;
    for (const orphan of orphans) {
      addEdge({ id: `auto-heal-${previousId}-${orphan.id}`, source: previousId, target: orphan.id, sourceHandle: null, targetHandle: null });
      previousId = orphan.id;
    }
  }

  return { nodeMap, outgoing, triggerNodeId };
}

function firstSuccessor(outgoing, nodeId) {
  if (!nodeId) return null;
  const edges = outgoing.get(nodeId) || [];
  return edges[0]?.target ?? null;
}

function pickNext(outgoing, currentId, branch) {
  const edges = outgoing.get(currentId) || [];
  if (!edges.length) return null;
  if (branch) {
    const matched = edges.find((edge) => (edge.sourceHandle || null) === branch);
    return matched?.target ?? null;
  }
  const defaultEdge = edges.find((edge) => !edge.sourceHandle) || edges[0];
  return defaultEdge?.target ?? null;
}

function resolvePath(context, path) {
  const parts = String(path || "").split(".").filter(Boolean);
  let current = context;
  for (const part of parts) {
    if (current === null || current === undefined) return undefined;
    current = current[part];
  }
  return current;
}

const TOKEN_PATTERN = /\{\{\s*([\w.]+)\s*\}\}/g;

function interpolateString(value, context) {
  if (!value.includes("{{")) return value;
  return value.replace(TOKEN_PATTERN, (_match, path) => {
    const resolved = resolvePath(context, path);
    if (resolved === undefined) {
      logger.warn({ path }, "automationEngine: unresolved interpolation path");
      return "";
    }
    return typeof resolved === "string" ? resolved : JSON.stringify(resolved);
  });
}

// Resolves {{trigger.body}} / {{steps.nodeId.field}} tokens in a node's config strings against
// run.context before the executor runs. Unresolvable paths interpolate to "" with a warning
// logged, not a thrown error - consistent with this codebase's existing defensive style around
// malformed config.
export function interpolateConfig(value, context) {
  if (typeof value === "string") return interpolateString(value, context);
  if (Array.isArray(value)) return value.map((item) => interpolateConfig(item, context));
  if (value && typeof value === "object") {
    const result = {};
    for (const [key, entry] of Object.entries(value)) result[key] = interpolateConfig(entry, context);
    return result;
  }
  return value;
}

// Fresh-fetches account/contact/conversation/inboundMessage by id every time - never trust
// in-memory state across a delay, matching automationSender.js's processors.
async function loadRunEnv(run) {
  const trigger = run.trigger || {};
  const [account, contact, conversation, inboundMessage, integrations] = await Promise.all([
    trigger.accountId ? WhatsAppAccount.findOne({ _id: trigger.accountId, workspaceId: run.workspaceId }) : Promise.resolve(null),
    trigger.contactId ? Contact.findOne({ _id: trigger.contactId, workspaceId: run.workspaceId }) : Promise.resolve(null),
    trigger.conversationId ? Conversation.findOne({ _id: trigger.conversationId, workspaceId: run.workspaceId }) : Promise.resolve(null),
    trigger.inboundMessageId ? Message.findOne({ _id: trigger.inboundMessageId, workspaceId: run.workspaceId }) : Promise.resolve(null),
    getWorkspaceIntegrations(run.workspaceId),
  ]);
  return { account, contact, conversation, inboundMessage, integrations };
}

// The traversal loop. Walks from run.cursor (or the trigger's first successor on a fresh run),
// dispatches each node to its executor, records output into run.context.steps[nodeId], and picks
// the next node - either the single default edge, or (for condition/if-else) whichever edge's
// sourceHandle matches the executor's returned branch. Capped at a step limit and a per-node
// revisit limit as cycle guards.
export async function advanceRun(run, flow, { testMode = false } = {}) {
  const { nodeMap, outgoing, triggerNodeId } = normalizeFlowGraph(flow);
  const env = await loadRunEnv(run);

  run.context = run.context || { trigger: {}, steps: {} };
  run.context.steps = run.context.steps || {};
  // Run-wide bag the "variables" node kind writes to and any node can read via
  // {{variables.name}} - distinct from steps.<nodeId>.*, which only holds one node's own output.
  run.context.variables = run.context.variables || {};
  run.visitCounts = run.visitCounts || {};

  let currentId = run.cursor?.nodeId || firstSuccessor(outgoing, triggerNodeId);

  while (currentId) {
    if (run.stepCount >= STEP_LIMIT) {
      run.status = "failed";
      run.error = "step_limit_exceeded";
      currentId = null;
      break;
    }

    const node = nodeMap.get(currentId);
    if (!node) {
      // Dangling edge target (shouldn't happen post-normalization) - stop this path gracefully.
      currentId = null;
      break;
    }

    const visits = (run.visitCounts[currentId] || 0) + 1;
    run.visitCounts[currentId] = visits;
    if (visits > VISIT_LIMIT) {
      run.status = "failed";
      run.error = `cycle_guard_triggered:${currentId}`;
      currentId = null;
      break;
    }

    run.stepCount += 1;
    run.markModified("visitCounts");

    const nodeConfig = interpolateConfig(node.config || {}, run.context);
    const executor = executorFor(node.type);
    const resolve = (path) => resolvePath(run.context, path);

    let result;
    try {
      result = await executor({ node, config: nodeConfig, resolve, env, run, flow, testMode });
    } catch (error) {
      result = { status: "failed", error: error.message, logMessage: `Node "${node.type}" threw`, logLevel: "error" };
    }

    run.context.steps[node.id] = result.action || { status: result.status, branch: result.branch };
    run.markModified("context");
    run.history.push({
      nodeId: node.id,
      type: node.type,
      status: result.status,
      at: new Date(),
      ...(result.branch ? { branch: result.branch } : {}),
      ...(result.action ? { action: result.action } : {}),
      ...(result.error ? { error: result.error } : {}),
      ...(result.logMessage ? { logMessage: result.logMessage, logLevel: result.logLevel || "info" } : {}),
    });

    const nextId = pickNext(outgoing, currentId, result.branch);

    // Event-based pause (ask_mcq's first invocation, sending the question) - distinct from
    // waitMs's time-based pause below. Cursor stays AT this same node (not nextId) so the resume
    // re-invokes this node's own executor with the new inbound message, letting it decide
    // matched/edge_case; the resume trigger is a Conversation.metadata flag (see
    // automationRunner.js), not a queued timer job.
    if (result.waitForReply && !testMode) {
      run.status = "waiting_for_reply";
      run.cursor = { nodeId: currentId };
      await run.save();
      return run;
    }

    if (result.waitMs && !testMode) {
      run.status = "waiting";
      run.cursor = { nodeId: nextId };
      run.resumeAt = new Date(Date.now() + result.waitMs);
      await run.save();

      const { queued, id } = await enqueueJob(AUTOMATION_QUEUE, RESUME_JOB, { runId: run._id.toString() }, { delay: result.waitMs });
      if (queued) {
        run.resumeJobId = String(id);
        await run.save();
      }
      return run;
    }

    currentId = nextId;
    run.cursor = { nodeId: currentId };
  }

  if (run.status === "running") run.status = "completed";
  await run.save();
  return run;
}

// Re-fetches the run and flow fresh from Mongo, no-ops idempotently if the run isn't still
// "waiting" (a stale/duplicate resume job firing twice must not re-run steps), and continues
// traversal from run.cursor.
export async function resumeAutomationRun({ runId }) {
  const run = await AutomationRun.findById(runId);
  if (!run || run.status !== "waiting") return { resumed: false };

  const flow = await AutomationFlow.findById(run.flowId);
  if (!flow) {
    run.status = "failed";
    run.error = "flow_not_found";
    await run.save();
    return { resumed: false };
  }

  run.status = "running";
  await advanceRun(run, flow, { testMode: run.testMode });
  return { resumed: true };
}

// Companion to resumeAutomationRun above, for ask_mcq's event-based pause instead of a timer.
// Re-points run.trigger.inboundMessageId at the NEW reply (loadRunEnv always re-fetches
// inboundMessage fresh from this id, so this is the only change needed for the resumed node to
// see the right message) before continuing traversal from run.cursor - the same node it paused
// at, so execAskMcq's own "already asked" check re-runs against the new reply instead of re-
// sending the question.
export async function resumeAutomationRunOnReply({ runId, inboundMessageId }) {
  const run = await AutomationRun.findById(runId);
  if (!run) return { resumed: false, reason: "run_not_found" };
  if (run.status !== "waiting_for_reply") return { resumed: false, reason: `run_status_was_${run.status}` };

  const flow = await AutomationFlow.findById(run.flowId);
  if (!flow) {
    run.status = "failed";
    run.error = "flow_not_found";
    await run.save();
    return { resumed: false, reason: "flow_not_found" };
  }

  run.trigger = { ...(run.trigger || {}), inboundMessageId };
  run.status = "running";
  await advanceRun(run, flow, { testMode: run.testMode });
  return { resumed: true };
}
