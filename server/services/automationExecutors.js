import mongoose from "mongoose";
import { config } from "../config.js";
import { AutomationFlow, AutomationRun, Contact, Conversation, Tag, Template } from "../models/index.js";
import { ensureConversationInCrm } from "./crm.js";
import { callGenericApi } from "./integrations.js";
import { callAiProvider } from "./aiProviders.js";
import { sendEmail, sendSms } from "./notificationChannels.js";
import { httpUrlString } from "../utils/zodHelpers.js";
import {
  enqueueAutomationGoogleSheetAction,
  enqueueAutomationSendMessage,
  enqueueAutomationWebhookAction,
  processAutomationGoogleSheetAction,
  processAutomationSendMessage,
  processAutomationWebhookAction,
} from "./automationSender.js";
// Circular import, same accepted pattern as jobs.js <-> automationEngine.js: automationEngine.js
// imports executorFor from this file, and execSubWorkflow below needs advanceRun to actually run
// the target flow. Safe because advanceRun is only called from inside a function body (when a
// sub_workflow node executes), well after both modules have finished loading - never at
// module-eval time.
import { advanceRun } from "./automationEngine.js";

// Per-node-kind dispatch table for the automation engine. Each executor receives
// { node, config, resolve, env, run, flow, testMode } and returns
// { status: "ok"|"failed"|"skipped"|"queued", action?, branch?, waitMs?, error?, logMessage?, logLevel? }.
// `action` (when present) is what shows up in the public actions[] list callers already read;
// nodes that aren't a user-visible "action" (condition/if_else/delay/unsupported) may omit it.

const actionAliases = {
  send_whatsapp_message: "send_message",
  assign_team_member: "assign_user",
  update_lead_stage: "lead_stage",
  send_to_google_sheet: "google_sheets",
};

export function canonicalNodeType(type = "") {
  const value = String(type || "").toLowerCase();
  return actionAliases[value] || value;
}

function queueProcessingAvailable() {
  return Boolean(config.redisUrl && config.featureFlags.queueProcessing);
}

async function execSendMessage({ node, config: cfg, env, run, flow, testMode }) {
  const { account, contact, conversation } = env;
  if (!account || !contact || !conversation) {
    return { status: "skipped", logMessage: "Skipped send_message: missing account/contact/conversation", logLevel: "warn" };
  }

  let body = String(cfg?.body || flow.trigger?.replyBody || "").trim();
  const templateId = cfg?.templateId;
  if (templateId && mongoose.Types.ObjectId.isValid(templateId)) {
    const template = await Template.findOne({
      _id: templateId,
      workspaceId: run.workspaceId,
      type: mongoose.trusted({ $in: ["quick_reply", "automation", "follow_up", "lead_stage"] }),
      status: mongoose.trusted({ $in: ["active", "approved"] }),
    });
    if (template) {
      body = template.body || body;
      await Template.updateOne({ _id: template._id }, { $inc: { usageCount: 1 }, lastUsedAt: new Date() });
    }
  }
  if (!body) return { status: "skipped", logMessage: "Skipped send_message: empty body", logLevel: "warn" };

  const sendData = {
    flowId: flow._id.toString(),
    flowName: flow.name,
    nodeId: node.id,
    accountId: account._id.toString(),
    workspaceId: run.workspaceId.toString(),
    organizationId: run.organizationId.toString(),
    contactId: contact._id.toString(),
    conversationId: conversation._id.toString(),
    body,
    testMode,
  };

  try {
    if (testMode) {
      const result = await processAutomationSendMessage(sendData);
      return {
        status: result.status === "failed" ? "failed" : "ok",
        action: { type: "send_message", messageId: result.messageId, status: result.status },
        logMessage: "WhatsApp message action completed",
        logLevel: result.status === "failed" ? "error" : "info",
      };
    }
    await enqueueAutomationSendMessage(sendData);
    return { status: "queued", action: { type: "send_message", status: "queued" }, logMessage: "WhatsApp message action queued" };
  } catch (error) {
    return {
      status: "failed",
      error: error.message,
      action: { type: "send_message", status: "failed", error: error.message },
      logMessage: "WhatsApp message action failed to queue",
      logLevel: "error",
    };
  }
}

async function execAssignUser({ node, env, flow }) {
  const { conversation } = env;
  const userId = node?.config?.userId;
  if (!userId || !conversation) return { status: "skipped", logMessage: "Skipped assign_user: no userId/conversation", logLevel: "warn" };

  await Conversation.updateOne(
    { _id: conversation._id },
    {
      $set: {
        assignedToUserId: userId,
        "metadata.automationAssignment": { flowId: flow._id, assignedAt: new Date(), assignedToUserId: userId },
      },
    }
  );
  return { status: "ok", action: { type: "assign_user", userId }, logMessage: "Assigned conversation" };
}

const conversationStatusMap = { open: "open", waiting: "pending", pending: "pending", resolved: "resolved", archived: "archived" };

async function execSetStatus({ node, env }) {
  const { conversation } = env;
  const requested = node?.config?.status;
  const mapped = conversationStatusMap[requested];
  if (!mapped || !conversation) return { status: "skipped", logMessage: "Skipped set_status: unrecognized status/no conversation", logLevel: "warn" };

  await Conversation.updateOne({ _id: conversation._id }, { $set: { status: mapped } });
  return { status: "ok", action: { type: "set_status", status: requested }, logMessage: "Updated conversation status" };
}

async function execAddTag({ node, env }) {
  const { contact } = env;
  const name = String(node?.config?.name || "").trim();
  if (!name || !contact) return { status: "skipped", logMessage: "Skipped add_tag: no name/contact", logLevel: "warn" };

  const tag = await Tag.findOneAndUpdate(
    { workspaceId: contact.workspaceId, name },
    {
      organizationId: contact.organizationId,
      workspaceId: contact.workspaceId,
      name,
      color: node?.config?.color || "#25D366",
      description: "Created by automation",
    },
    { upsert: true, new: true, setDefaultsOnInsert: true }
  );
  await Contact.updateOne({ _id: contact._id }, { $addToSet: { tagIds: tag._id } });
  return { status: "ok", action: { type: "add_tag", tag: name }, logMessage: "Added contact tag" };
}

function makeCrmExecutor(label) {
  return async function execCrmUpdate({ node, env }) {
    const { contact, conversation, inboundMessage } = env;
    if (!contact || !conversation) return { status: "skipped", logMessage: `Skipped ${label}: no contact/conversation`, logLevel: "warn" };

    const cfg = node.config || {};
    await ensureConversationInCrm({
      contact,
      conversation,
      inboundMessage,
      source: cfg.source || "automation",
      stage: cfg.stage || "new_lead",
    });
    return { status: "ok", action: { type: label, stage: cfg.stage || "new_lead" }, logMessage: "Updated CRM lead" };
  };
}

async function execGoogleSheets({ node, env, run, flow, testMode }) {
  const { contact, conversation, inboundMessage } = env;
  if (!contact || !conversation) return { status: "skipped", logMessage: "Skipped google_sheets: no contact/conversation", logLevel: "warn" };

  const cfg = node.config || {};
  // The CRM lookup/creation stays synchronous - fast local write, matching the other CRM actions.
  // Only the actual Apps Script HTTP call is queued below.
  const crmResult = await ensureConversationInCrm({
    contact,
    conversation,
    inboundMessage,
    source: cfg.source || "automation",
    stage: cfg.stage || "new_lead",
  });
  const sheetData = {
    flowId: flow._id.toString(),
    nodeId: node.id,
    workspaceId: run.workspaceId.toString(),
    contactId: (crmResult.contact || contact)._id.toString(),
    conversationId: conversation._id.toString(),
    inboundMessageId: inboundMessage?._id?.toString() || "",
    leadId: crmResult.lead?._id?.toString() || "",
    testMode,
  };

  try {
    if (testMode) {
      const result = await processAutomationGoogleSheetAction(sheetData);
      return { status: "ok", action: { type: "google_sheets", status: result.status }, logMessage: "Google Sheets action completed" };
    }
    await enqueueAutomationGoogleSheetAction(sheetData);
    return { status: "queued", action: { type: "google_sheets", status: "queued" }, logMessage: "Google Sheets action queued" };
  } catch (error) {
    return {
      status: "failed",
      error: error.message,
      action: { type: "google_sheets", status: "failed", error: error.message },
      logMessage: "Google Sheets action failed",
      logLevel: "error",
    };
  }
}

async function execCallWebhook({ node, env, run, flow, testMode }) {
  const { contact, conversation, inboundMessage } = env;
  const cfg = node.config || {};
  const webhookData = {
    flowId: flow._id.toString(),
    nodeId: node.id,
    workspaceId: run.workspaceId.toString(),
    url: cfg.url,
    secret: cfg.secret,
    event: cfg.event || "automation.triggered",
    payload: {
      flow: { id: flow._id.toString(), name: flow.name },
      contact: contact ? { id: contact._id.toString(), name: contact.name, phone: contact.phone, email: contact.email || "" } : {},
      conversation: conversation ? { id: conversation._id.toString(), status: conversation.status } : {},
      inboundMessage: inboundMessage ? { id: inboundMessage._id.toString(), body: inboundMessage.body || "" } : {},
    },
    testMode,
  };

  try {
    if (testMode) {
      const result = await processAutomationWebhookAction(webhookData);
      return { status: "ok", action: { type: "call_webhook", status: result.status }, logMessage: "Webhook action completed" };
    }
    await enqueueAutomationWebhookAction(webhookData);
    return { status: "queued", action: { type: "call_webhook", status: "queued" }, logMessage: "Webhook action queued" };
  } catch (error) {
    return {
      status: "failed",
      error: error.message,
      action: { type: "call_webhook", status: "failed", error: error.message },
      logMessage: "Webhook action failed",
      logLevel: "error",
    };
  }
}

const conditionOperators = {
  equals: (a, b) => String(a ?? "") === String(b ?? ""),
  not_equals: (a, b) => String(a ?? "") !== String(b ?? ""),
  contains: (a, b) => String(a ?? "").toLowerCase().includes(String(b ?? "").toLowerCase()),
  not_contains: (a, b) => !String(a ?? "").toLowerCase().includes(String(b ?? "").toLowerCase()),
  greater_than: (a, b) => Number(a) > Number(b),
  less_than: (a, b) => Number(a) < Number(b),
  is_empty: (a) => a === undefined || a === null || String(a).trim() === "",
  is_not_empty: (a) => !(a === undefined || a === null || String(a).trim() === ""),
};

function evaluateCondition(node, resolve) {
  const cfg = node.config || {};
  const field = String(cfg.field || "").trim();
  const operator = conditionOperators[cfg.operator] ? cfg.operator : "equals";
  const actual = field ? resolve(field) : undefined;
  const passed = Boolean(conditionOperators[operator](actual, cfg.value));
  return { passed, field, operator };
}

async function execCondition({ node, resolve }) {
  const { passed, field, operator } = evaluateCondition(node, resolve);
  return {
    status: "ok",
    branch: passed ? "true" : "false",
    action: { type: "condition", field, operator, result: passed },
    logMessage: "Condition evaluated",
  };
}

async function execIfElse({ node, resolve }) {
  const { passed, field, operator } = evaluateCondition(node, resolve);
  return {
    status: "ok",
    branch: passed ? "true" : "false",
    action: { type: "if_else", field, operator, result: passed },
    logMessage: "If/Else evaluated",
  };
}

async function execApi({ node, config: cfg }) {
  const url = String(cfg?.url || "").trim();
  if (!httpUrlString().safeParse(url).success) {
    return {
      status: "failed",
      error: "invalid_api_url",
      action: { type: "api", status: "failed", error: "Must be a valid http(s) URL." },
      logMessage: "API node failed: invalid URL",
      logLevel: "error",
    };
  }

  let headers = cfg?.headers;
  if (typeof headers === "string") {
    try {
      headers = headers.trim() ? JSON.parse(headers) : {};
    } catch {
      headers = {};
    }
  }
  let body = cfg?.body;
  if (typeof body === "string" && body.trim()) {
    try {
      body = JSON.parse(body);
    } catch {
      // Not JSON - send as a raw string body.
    }
  }

  try {
    const result = await callGenericApi({ method: cfg?.method || "GET", url, headers: headers || {}, body });
    return {
      status: result.ok ? "ok" : "failed",
      action: { type: "api", status: result.ok ? "ok" : "failed", httpStatus: result.status, body: result.body },
      logMessage: "API call completed",
      logLevel: result.ok ? "info" : "error",
    };
  } catch (error) {
    return {
      status: "failed",
      error: error.message,
      action: { type: "api", status: "failed", error: error.message },
      logMessage: "API call failed",
      logLevel: "error",
    };
  }
}

const delayUnitMs = { seconds: 1000, minutes: 60000, hours: 3600000, days: 86400000 };

async function execDelay({ node, testMode }) {
  const cfg = node.config || {};
  const amount = Number(cfg.duration ?? cfg.amount ?? 0);
  const unit = delayUnitMs[String(cfg.unit || "seconds").toLowerCase()] ? String(cfg.unit).toLowerCase() : "seconds";
  const waitMs = Number.isFinite(amount) ? Math.max(0, Math.round(amount * delayUnitMs[unit])) : 0;

  if (testMode) {
    return { status: "ok", action: { type: "delay", status: "skipped", skipped: true, waitMs }, logMessage: "Delay skipped in test mode" };
  }
  if (!waitMs) {
    return { status: "ok", action: { type: "delay", status: "ok", waitMs: 0 }, logMessage: "Delay skipped: zero duration" };
  }
  if (!queueProcessingAvailable()) {
    return {
      status: "failed",
      error: "delay_requires_queue_processing",
      action: { type: "delay", status: "failed", error: "delay_requires_queue_processing" },
      logMessage: "Delay requires queue processing (Redis) to be enabled",
      logLevel: "error",
    };
  }
  return { status: "ok", waitMs, action: { type: "delay", status: "waiting", waitMs }, logMessage: "Delay started" };
}

async function execUnsupported({ node }) {
  return { status: "skipped", logMessage: `Node type "${node.type}" is not yet supported`, logLevel: "warn" };
}

const aiProviderLabels = { openai: "OpenAI", claude: "Claude", gemini: "Gemini" };

// Reuses the generic form's "body" field as the prompt (interpolateConfig already resolves
// {{trigger.x}}/{{steps.x}}/{{variables.x}} tokens in it before this runs) - no new client form
// needed, same reasoning as execJsonParser/execVariables. The API key is never per-node config
// (which would round-trip through flow JSON/execution logs); it's read from the workspace's
// settings, the same place callOutboundWebhook reads its webhook secret from.
function makeAiExecutor(provider) {
  const label = aiProviderLabels[provider];
  return async function execAiProvider({ node, config: cfg, env, testMode }) {
    const prompt = String(cfg?.body || "").trim();
    if (!prompt) return { status: "skipped", logMessage: `Skipped ${label}: empty prompt`, logLevel: "warn" };

    const providerConfig = env.integrations?.aiProviders?.[provider];
    if (!providerConfig?.enabled || !providerConfig?.apiKey) {
      return {
        status: "failed",
        error: "ai_provider_not_configured",
        action: { type: provider, status: "failed", error: "ai_provider_not_configured" },
        logMessage: `${label} is not configured for this workspace (Settings > Integrations)`,
        logLevel: "error",
      };
    }

    if (testMode) {
      return {
        status: "ok",
        action: { type: provider, status: "skipped", skipped: true, response: `[test mode - ${label} call skipped]` },
        logMessage: `${label} call skipped in test mode`,
      };
    }

    try {
      const result = await callAiProvider({ provider, apiKey: providerConfig.apiKey, prompt });
      return {
        status: "ok",
        action: { type: provider, status: "ok", response: result.text },
        logMessage: `${label} call completed`,
      };
    } catch (error) {
      return {
        status: "failed",
        error: error.message,
        action: { type: provider, status: "failed", error: error.message },
        logMessage: `${label} call failed`,
        logLevel: "error",
      };
    }
  };
}

// Reuses the generic 7-field inspector form's "body" input as the JSON source string - no client
// change needed. Parses it and stores the result under action.parsed so downstream nodes can
// interpolate {{steps.<nodeId>.parsed.field}}.
async function execJsonParser({ config: cfg }) {
  const raw = String(cfg?.body ?? "").trim();
  if (!raw) return { status: "skipped", logMessage: "Skipped json_parser: empty input", logLevel: "warn" };

  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    return {
      status: "failed",
      error: error.message,
      action: { type: "json_parser", status: "failed", error: error.message },
      logMessage: "JSON parser failed: invalid JSON",
      logLevel: "error",
    };
  }
  return { status: "ok", action: { type: "json_parser", status: "ok", parsed }, logMessage: "Parsed JSON payload" };
}

// Reuses the generic form's "variable" (name) and "body" (value) fields - no client change
// needed. Sets run.context.variables[name], a run-wide bag any later node can read via
// {{variables.name}} - unlike a node's own action output, which only lives under
// steps.<thatNodeId>.*, this is meant to be set once and referenced from anywhere downstream.
async function execVariables({ config: cfg, run }) {
  const name = String(cfg?.variable || "").trim();
  if (!name) return { status: "skipped", logMessage: "Skipped variables: no variable name", logLevel: "warn" };

  run.context.variables = run.context.variables || {};
  const value = cfg?.body ?? "";
  run.context.variables[name] = value;
  return { status: "ok", action: { type: "variables", name, value }, logMessage: "Set flow variable" };
}

// Needs a "subject" field the generic 7-field form doesn't have, so this is the one new node kind
// in this pair that gets its own per-kind client inspector form (config: {subject, body}).
// Recipient is always the triggering contact's email, matching how send_message always sends to
// contact.phone with no per-node override.
async function execEmail({ config: cfg, env, testMode }) {
  const to = env.contact?.email;
  const subject = String(cfg?.subject || "").trim();
  const body = String(cfg?.body || "").trim();
  if (!to) return { status: "skipped", logMessage: "Skipped email: contact has no email address", logLevel: "warn" };
  if (!body) return { status: "skipped", logMessage: "Skipped email: empty body", logLevel: "warn" };

  const emailConfig = env.integrations?.email;
  if (!emailConfig?.enabled || !emailConfig?.apiKey || !emailConfig?.fromAddress) {
    return {
      status: "failed",
      error: "email_not_configured",
      action: { type: "email", status: "failed", error: "email_not_configured" },
      logMessage: "Email is not configured for this workspace (Settings > Integrations)",
      logLevel: "error",
    };
  }

  if (testMode) {
    return { status: "ok", action: { type: "email", status: "skipped", skipped: true, to }, logMessage: "Email skipped in test mode" };
  }

  try {
    const result = await sendEmail({ apiKey: emailConfig.apiKey, fromAddress: emailConfig.fromAddress, fromName: emailConfig.fromName, to, subject, body });
    return { status: "ok", action: { type: "email", status: result.status, to }, logMessage: "Email sent" };
  } catch (error) {
    return {
      status: "failed",
      error: error.message,
      action: { type: "email", status: "failed", error: error.message },
      logMessage: "Email failed to send",
      logLevel: "error",
    };
  }
}

// Reuses the generic form's "body" field as the message text - fits cleanly, same as
// send_message, no new client form needed. Recipient is always contact.phone.
async function execSms({ config: cfg, env, testMode }) {
  const to = env.contact?.phone;
  const body = String(cfg?.body || "").trim();
  if (!to) return { status: "skipped", logMessage: "Skipped sms: contact has no phone number", logLevel: "warn" };
  if (!body) return { status: "skipped", logMessage: "Skipped sms: empty body", logLevel: "warn" };

  const smsConfig = env.integrations?.sms;
  if (!smsConfig?.enabled || !smsConfig?.accountSid || !smsConfig?.authToken || !smsConfig?.fromNumber) {
    return {
      status: "failed",
      error: "sms_not_configured",
      action: { type: "sms", status: "failed", error: "sms_not_configured" },
      logMessage: "SMS is not configured for this workspace (Settings > Integrations)",
      logLevel: "error",
    };
  }

  if (testMode) {
    return { status: "ok", action: { type: "sms", status: "skipped", skipped: true, to }, logMessage: "SMS skipped in test mode" };
  }

  try {
    const result = await sendSms({ accountSid: smsConfig.accountSid, authToken: smsConfig.authToken, fromNumber: smsConfig.fromNumber, to, body });
    return { status: "ok", action: { type: "sms", status: result.status, to }, logMessage: "SMS sent" };
  } catch (error) {
    return {
      status: "failed",
      error: error.message,
      action: { type: "sms", status: "failed", error: error.message },
      logMessage: "SMS failed to send",
      logLevel: "error",
    };
  }
}

// Config: {field} - a raw context path (same convention as condition/if_else's "field", resolved
// via resolve() rather than {{}}-templated) pointing at the array to iterate, e.g.
// "steps.apiNode.parsed.items" or "variables.contactList".
//
// The loop body is wired back to this same node in the flow graph (a real cycle, drawn by the
// user) - each revisit reads this node's own prior step state (which the engine already
// preserves at run.context.steps[node.id] between visits, same mechanism every other node relies
// on for downstream interpolation) to know which item comes next, rather than the AutomationRun
// model needing a separate stack of iteration frames. "loop" branch continues into the body;
// "done" branch falls through once every item has been processed. See automationEngine.js's
// STEP_LIMIT/VISIT_LIMIT comment for why the revisit cap had to move for this to work.
async function execLoop({ node, run, resolve }) {
  const fieldPath = String(node.config?.field || "").trim();
  const priorState = run.context.steps[node.id];
  // Only "continuing" if the prior visit was mid-loop, not finished - otherwise a nested loop's
  // inner node, revisited by a new outer iteration, would wrongly think it's resuming the inner
  // loop it already finished last time instead of starting over.
  const continuing = Boolean(priorState && Array.isArray(priorState.items) && !priorState.done);

  let items;
  let index;
  if (continuing) {
    items = priorState.items;
    index = priorState.index + 1;
  } else {
    const resolved = fieldPath ? resolve(fieldPath) : undefined;
    items = Array.isArray(resolved) ? resolved : [];
    index = 0;
  }

  const done = index >= items.length;
  return {
    status: "ok",
    branch: done ? "done" : "loop",
    action: { type: "loop", status: "ok", done, index, total: items.length, item: done ? undefined : items[index], items },
    logMessage: done ? `Loop finished (${items.length} items)` : `Loop iteration ${index + 1}/${items.length}`,
  };
}

const MAX_SUB_WORKFLOW_DEPTH = 5;

// Calls another published flow as a synchronous sub-routine: creates a new AutomationRun for the
// target flow (parentRunId links it back to this run, for the Run History UI to eventually show
// nesting), seeds its context.variables.input from this node's interpolated "body" config so the
// sub-flow can read {{variables.input}}, and awaits its completion before continuing - the same
// synchronous, no-queue pattern as every other Phase 2 node kind.
//
// Depth is guarded by chain.length rather than rejecting exact cycles outright, so bounded
// self-recursion (a flow calling itself a fixed number of times) still works - only runaway depth
// is blocked, regardless of whether the cycle is direct (A->A) or mutual (A->B->A->B->...).
//
// If the sub-flow's own graph pauses on a delay node, this does NOT block waiting for it - the
// child resumes independently later via its own BullMQ job, and this step reports
// subRunStatus: "waiting" and lets the parent continue immediately. Propagating a pause up through
// nested runs would need a much bigger change (multi-level wait/resume); not attempted here.
async function execSubWorkflow({ node, config: cfg, run, testMode }) {
  const targetFlowId = String(node.config?.flowId || "").trim();
  if (!targetFlowId || !mongoose.Types.ObjectId.isValid(targetFlowId)) {
    return { status: "skipped", logMessage: "Skipped sub_workflow: no target flow selected", logLevel: "warn" };
  }

  const chain = Array.isArray(run.chain) ? run.chain : [];
  if (chain.length >= MAX_SUB_WORKFLOW_DEPTH) {
    return {
      status: "failed",
      error: "sub_workflow_depth_exceeded",
      action: { type: "sub_workflow", status: "failed", error: "sub_workflow_depth_exceeded" },
      logMessage: `Sub-workflow call skipped: exceeded max nesting depth (${MAX_SUB_WORKFLOW_DEPTH})`,
      logLevel: "error",
    };
  }

  const targetFlow = await AutomationFlow.findOne({ _id: targetFlowId, workspaceId: run.workspaceId, status: "published" });
  if (!targetFlow) {
    return {
      status: "failed",
      error: "sub_workflow_not_found",
      action: { type: "sub_workflow", status: "failed", error: "sub_workflow_not_found" },
      logMessage: "Sub-workflow call failed: target flow not found or not published",
      logLevel: "error",
    };
  }

  const childRun = await AutomationRun.create({
    organizationId: run.organizationId,
    workspaceId: run.workspaceId,
    flowId: targetFlow._id,
    parentRunId: run._id,
    chain: [...chain, targetFlow._id],
    testMode,
    trigger: { ...(run.trigger || {}) },
    context: { trigger: run.context?.trigger || {}, steps: {}, variables: { input: cfg?.body ?? "" } },
  });

  await advanceRun(childRun, targetFlow, { testMode });

  return {
    status: childRun.status === "failed" ? "failed" : "ok",
    action: {
      type: "sub_workflow",
      status: childRun.status,
      subFlowId: targetFlow._id.toString(),
      subRunId: childRun._id.toString(),
    },
    logMessage: `Sub-workflow "${targetFlow.name}" ${childRun.status}`,
    logLevel: childRun.status === "failed" ? "error" : "info",
  };
}

const executors = {
  send_message: execSendMessage,
  assign_user: execAssignUser,
  set_status: execSetStatus,
  add_tag: execAddTag,
  add_to_crm: makeCrmExecutor("add_to_crm"),
  lead_stage: makeCrmExecutor("lead_stage"),
  google_sheets: execGoogleSheets,
  call_webhook: execCallWebhook,
  condition: execCondition,
  if_else: execIfElse,
  api: execApi,
  http_request: execApi,
  delay: execDelay,
  json_parser: execJsonParser,
  variables: execVariables,
  openai: makeAiExecutor("openai"),
  claude: makeAiExecutor("claude"),
  gemini: makeAiExecutor("gemini"),
  email: execEmail,
  sms: execSms,
  loop: execLoop,
  sub_workflow: execSubWorkflow,
};

export function executorFor(type) {
  return executors[canonicalNodeType(type)] || execUnsupported;
}
