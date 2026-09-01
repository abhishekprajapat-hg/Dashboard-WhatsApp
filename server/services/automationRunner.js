import { AutomationFlow, AutomationRun, Conversation } from "../models/index.js";
import { publishConversationChanged } from "../realtime/events.js";
import { advanceRun, resumeAutomationRunOnReply } from "./automationEngine.js";
import { keywordMatches, parseKeywords } from "../utils/keywords.js";
import { logger } from "./logger.js";

function appendRunLog(flowResult, level, message, data = {}) {
  flowResult.logs.push({ at: new Date(), level, message, ...data });
}

function triggerMatches(flow, { inboundMessage, isNewConversation, isNewLead = false, stageChanged = false }) {
  const triggerType = String(flow.trigger?.type || "").toLowerCase();
  const inboundBody = String(inboundMessage?.body || "").toLowerCase();

  if (triggerType === "new_message" || triggerType === "webhook_event") return true;
  if (triggerType === "new_conversation") return Boolean(isNewConversation);
  if (triggerType === "new_lead") return Boolean(isNewLead);
  if (triggerType === "stage_changed") return Boolean(stageChanged);
  // Scoped to Flow completions specifically, not every inbound message - a flow tied to this
  // trigger type would otherwise need to be "new_message"-scoped and re-fire on every future
  // message from that contact forever, not just the one Flow submission it's meant to react to.
  if (triggerType === "flow_response") return inboundMessage?.type === "flow_response";

  if (triggerType === "keyword_match") {
    const keywords = parseKeywords(flow.trigger?.keywords || flow.trigger?.keyword || "");
    return keywords.length ? keywordMatches(inboundBody, keywords) : true;
  }

  if (triggerType === "webhook_event") return true;

  return false;
}

// Translates one AutomationRun's step history into the {actions, logs} shape
// runInboundAutomations has always returned - every existing caller/response shape stays intact.
function translateRunHistory(run, flowResult) {
  for (const entry of run.history) {
    if (entry.action) flowResult.actions.push(entry.action);
    if (entry.logMessage) {
      const { type: _omit, ...actionRest } = entry.action || {};
      appendRunLog(flowResult, entry.logLevel || "info", entry.logMessage, {
        nodeId: entry.nodeId,
        ...actionRest,
        ...(entry.error ? { error: entry.error } : {}),
      });
    }
  }
}

export async function runInboundAutomations({
  account,
  contact,
  conversation,
  inboundMessage,
  isNewConversation = false,
  isNewLead = false,
  stageChanged = false,
  flowId,
  testMode = false,
}) {
  if (!account || !contact || !conversation || !inboundMessage) return [];
  if (inboundMessage.direction === "outbound" || inboundMessage.metadata?.automationGenerated) return [];

  // A conversation mid-qualifying-sequence has this set by ask_mcq's first invocation (see
  // automationExecutors.js) - this inbound message is the answer to that pending question, not a
  // fresh trigger event. Resume that specific paused run before evaluating any flow's trigger
  // from scratch, so the same message doesn't also get treated as a brand-new "new_message" event
  // for the flow it's already mid-way through.
  let resumedRun = false;
  const pendingRunId = conversation.metadata?.pendingAutomationRunId;
  logger.info(
    { conversationId: conversation._id?.toString(), inboundMessageId: inboundMessage._id?.toString(), pendingRunId: pendingRunId ? String(pendingRunId) : null },
    "runInboundAutomations: pending-run check"
  );
  if (pendingRunId) {
    await Conversation.updateOne({ _id: conversation._id }, { $unset: { "metadata.pendingAutomationRunId": "" } });
    const { resumed, reason } = await resumeAutomationRunOnReply({ runId: pendingRunId, inboundMessageId: inboundMessage._id });
    resumedRun = resumed;
    logger.info({ runId: String(pendingRunId), resumed, reason: reason || null }, "runInboundAutomations: resume attempt result");
  }

  const flowFilter = {
    workspaceId: account.workspaceId,
    status: "published",
  };
  if (flowId) flowFilter._id = flowId;

  const flows = await AutomationFlow.find(flowFilter).sort({ updatedAt: -1 });

  const alreadyRan = new Set(inboundMessage.metadata?.automationRunFlowIds || []);
  const matchingFlows = flows.filter((flow) =>
    !alreadyRan.has(flow._id.toString()) && triggerMatches(flow, { inboundMessage, isNewConversation, isNewLead, stageChanged })
  );
  const results = [];

  for (const flow of matchingFlows) {
    const flowResult = { flowId: flow._id.toString(), actions: [], logs: [] };
    appendRunLog(flowResult, "info", "Automation started", { triggerType: flow.trigger?.type });

    const run = await AutomationRun.create({
      organizationId: account.organizationId,
      workspaceId: account.workspaceId,
      flowId: flow._id,
      chain: [flow._id],
      testMode,
      trigger: {
        accountId: account._id,
        contactId: contact._id,
        conversationId: conversation._id,
        inboundMessageId: inboundMessage._id,
        isNewConversation,
        isNewLead,
        stageChanged,
      },
      context: {
        trigger: {
          body: inboundMessage.body || "",
          contactId: contact._id.toString(),
          conversationId: conversation._id.toString(),
          isNewConversation,
          isNewLead,
          stageChanged,
          // Lets a condition node branch on individual answered fields (e.g.
          // {{trigger.flowResponse.data.team_size}}) instead of only the flattened body text.
          flowResponse: inboundMessage.metadata?.flowResponse || null,
        },
        steps: {},
        variables: {},
      },
    });

    await advanceRun(run, flow, { testMode });
    translateRunHistory(run, flowResult);

    if (flowResult.actions.length === 0) continue;
    const failedActions = flowResult.actions.filter((action) => action.status === "failed").length;

    await AutomationFlow.updateOne(
      { _id: flow._id },
      {
        $inc: {
          "trigger.runs": 1,
          "trigger.failures": failedActions > 0 ? 1 : 0,
        },
        $set: {
          "trigger.lastRunAt": new Date(),
          "trigger.errorRate": failedActions > 0 ? 100 : 0,
        },
        $push: {
          "trigger.executionLogs": { $each: flowResult.logs, $slice: -100 },
          runLogs: {
            $each: [{
              at: new Date(),
              inboundMessageId: inboundMessage._id,
              conversationId: conversation._id,
              actions: flowResult.actions,
              logs: flowResult.logs,
            }],
            $slice: -100,
          },
        },
      }
    );

    inboundMessage.metadata = {
      ...(inboundMessage.metadata || {}),
      automationRunFlowIds: [...alreadyRan, flow._id.toString()],
    };
    inboundMessage.markModified("metadata");
    await inboundMessage.save();
    alreadyRan.add(flow._id.toString());

    results.push(flowResult);
  }

  if (results.length || resumedRun) {
    const hydratedConversation = await Conversation.findById(conversation._id);
    await publishConversationChanged(hydratedConversation?._id || conversation._id);
  }

  return results;
}
