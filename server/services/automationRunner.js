import mongoose from "mongoose";
import {
  AutomationFlow,
  Contact,
  Conversation,
  Tag,
  Template,
} from "../models/index.js";
import { publishConversationChanged } from "../realtime/events.js";
import {
  enqueueAutomationGoogleSheetAction,
  enqueueAutomationSendMessage,
  enqueueAutomationWebhookAction,
  processAutomationGoogleSheetAction,
  processAutomationSendMessage,
  processAutomationWebhookAction,
} from "./automationSender.js";
import { ensureConversationInCrm } from "./crm.js";
import { keywordMatches, parseKeywords } from "../utils/keywords.js";

const maxActionsPerFlow = 20;

const actionAliases = {
  send_whatsapp_message: "send_message",
  assign_team_member: "assign_user",
  update_lead_stage: "lead_stage",
  send_to_google_sheet: "google_sheets",
};

function canonicalActionType(type = "") {
  const value = String(type || "").toLowerCase();
  return actionAliases[value] || value;
}

function flowActions(flow) {
  const visualActions = (flow.nodes || []).filter((node) => node?.type && node.type !== "trigger");
  const simpleActions = (flow.actions || []).map((action, index) => ({
    id: action.id || `action_${index}`,
    type: action.type,
    config: action.config || action,
  }));
  return [...visualActions, ...simpleActions].slice(0, maxActionsPerFlow);
}

function actionNodes(flow, type) {
  return flowActions(flow).filter((node) => canonicalActionType(node?.type) === type);
}

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

  if (triggerType === "keyword_match") {
    const keywords = parseKeywords(flow.trigger?.keywords || flow.trigger?.keyword || "");
    return keywords.length ? keywordMatches(inboundBody, keywords) : true;
  }

  if (triggerType === "webhook_event") return true;

  return false;
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

    for (const node of actionNodes(flow, "send_message")) {
      let body = String(node?.config?.body || flow.trigger?.replyBody || "").trim();
      let templateId = node?.config?.templateId;
      if (templateId && mongoose.Types.ObjectId.isValid(templateId)) {
        const template = await Template.findOne({
          _id: templateId,
          workspaceId: account.workspaceId,
          type: mongoose.trusted({ $in: ["quick_reply", "automation", "follow_up", "lead_stage"] }),
          status: mongoose.trusted({ $in: ["active", "approved"] }),
        });
        if (template) {
          body = template.body || body;
          await Template.updateOne({ _id: template._id }, { $inc: { usageCount: 1 }, lastUsedAt: new Date() });
        }
      }
      if (!body) continue;

      const sendData = {
        flowId: flow._id.toString(),
        flowName: flow.name,
        nodeId: node.id,
        accountId: account._id.toString(),
        workspaceId: account.workspaceId.toString(),
        organizationId: account.organizationId.toString(),
        contactId: contact._id.toString(),
        conversationId: conversation._id.toString(),
        body,
        testMode,
      };

      try {
        if (testMode) {
          // Flow tests need the real, immediate outcome in the response, not a queued placeholder -
          // and queuing here would race the /test route's cleanup of its scaffolding contact/conversation.
          const result = await processAutomationSendMessage(sendData);
          flowResult.actions.push({ type: "send_message", messageId: result.messageId, status: result.status });
          appendRunLog(flowResult, result.status === "failed" ? "error" : "info", "WhatsApp message action completed", { nodeId: node.id, status: result.status });
        } else {
          const { mode } = await enqueueAutomationSendMessage(sendData);
          flowResult.actions.push({ type: "send_message", status: "queued" });
          appendRunLog(flowResult, "info", "WhatsApp message action queued", { nodeId: node.id, mode });
        }
      } catch (error) {
        flowResult.actions.push({ type: "send_message", status: "failed", error: error.message });
        appendRunLog(flowResult, "error", "WhatsApp message action failed to queue", { nodeId: node.id, error: error.message });
      }
    }

    for (const node of actionNodes(flow, "assign_user")) {
      const userId = node?.config?.userId;
      if (userId) {
        conversation.assignedToUserId = userId;
        conversation.metadata = {
          ...(conversation.metadata || {}),
          automationAssignment: {
            flowId: flow._id,
            assignedAt: new Date(),
            assignedToUserId: userId,
          },
        };
        flowResult.actions.push({ type: "assign_user", userId });
        appendRunLog(flowResult, "info", "Assigned conversation", { nodeId: node.id, userId });
      }
    }

    for (const node of actionNodes(flow, "set_status")) {
      const status = node?.config?.status;
      const statusMap = { open: "open", waiting: "pending", pending: "pending", resolved: "resolved", archived: "archived" };
      if (statusMap[status]) {
        conversation.status = statusMap[status];
        flowResult.actions.push({ type: "set_status", status });
        appendRunLog(flowResult, "info", "Updated conversation status", { nodeId: node.id, status });
      }
    }

    for (const node of actionNodes(flow, "add_tag")) {
      const name = String(node?.config?.name || "").trim();
      if (!name) continue;

      const tag = await Tag.findOneAndUpdate(
        { workspaceId: account.workspaceId, name },
        {
          organizationId: account.organizationId,
          workspaceId: account.workspaceId,
          name,
          color: node?.config?.color || "#25D366",
          description: "Created by automation",
        },
        { upsert: true, new: true, setDefaultsOnInsert: true }
      );

      const tagIds = (contact.tagIds || []).map((tagId) => tagId?.toString?.() || String(tagId));
      if (!tagIds.includes(tag._id.toString())) {
        contact.tagIds = [...(contact.tagIds || []), tag._id];
        await contact.save();
      }
      flowResult.actions.push({ type: "add_tag", tag: name });
      appendRunLog(flowResult, "info", "Added contact tag", { nodeId: node.id, tag: name });
    }

    for (const node of [...actionNodes(flow, "add_to_crm"), ...actionNodes(flow, "lead_stage")]) {
      await ensureConversationInCrm({
        contact,
        conversation,
        source: node?.config?.source || "automation",
        stage: node?.config?.stage || "new_lead",
      });
      flowResult.actions.push({ type: canonicalActionType(node.type), stage: node?.config?.stage || "new_lead" });
      appendRunLog(flowResult, "info", "Updated CRM lead", { nodeId: node.id, stage: node?.config?.stage || "new_lead" });
    }

    for (const node of actionNodes(flow, "google_sheets")) {
      // The CRM lookup/creation stays synchronous - it's a fast local write, matching the other
      // CRM actions above. Only the actual Apps Script HTTP call is queued below.
      const crmResult = await ensureConversationInCrm({
        contact,
        conversation,
        inboundMessage,
        source: node?.config?.source || "automation",
        stage: node?.config?.stage || "new_lead",
      });
      const sheetData = {
        flowId: flow._id.toString(),
        nodeId: node.id,
        workspaceId: account.workspaceId.toString(),
        contactId: (crmResult.contact || contact)._id.toString(),
        conversationId: conversation._id.toString(),
        inboundMessageId: inboundMessage._id.toString(),
        leadId: crmResult.lead?._id?.toString() || "",
        testMode,
      };

      try {
        if (testMode) {
          const result = await processAutomationGoogleSheetAction(sheetData);
          flowResult.actions.push({ type: "google_sheets", status: result.status });
          appendRunLog(flowResult, "info", "Google Sheets action completed", { nodeId: node.id, status: result.status });
        } else {
          const { mode } = await enqueueAutomationGoogleSheetAction(sheetData);
          flowResult.actions.push({ type: "google_sheets", status: "queued" });
          appendRunLog(flowResult, "info", "Google Sheets action queued", { nodeId: node.id, mode });
        }
      } catch (error) {
        flowResult.actions.push({ type: "google_sheets", status: "failed", error: error.message });
        appendRunLog(flowResult, "error", "Google Sheets action failed", { nodeId: node.id, error: error.message });
      }
    }

    for (const node of actionNodes(flow, "call_webhook")) {
      const webhookData = {
        flowId: flow._id.toString(),
        nodeId: node.id,
        workspaceId: account.workspaceId.toString(),
        url: node?.config?.url,
        secret: node?.config?.secret,
        event: node?.config?.event || "automation.triggered",
        payload: {
          flow: { id: flow._id.toString(), name: flow.name },
          contact: { id: contact._id.toString(), name: contact.name, phone: contact.phone, email: contact.email || "" },
          conversation: { id: conversation._id.toString(), status: conversation.status },
          inboundMessage: { id: inboundMessage._id.toString(), body: inboundMessage.body || "" },
        },
        testMode,
      };

      try {
        if (testMode) {
          // Same reasoning as send_message: a flow test should surface the real delivery outcome
          // immediately, not a queued placeholder.
          const result = await processAutomationWebhookAction(webhookData);
          flowResult.actions.push({ type: "call_webhook", status: result.status });
          appendRunLog(flowResult, "info", "Webhook action completed", { nodeId: node.id, status: result.status });
        } else {
          const { mode } = await enqueueAutomationWebhookAction(webhookData);
          flowResult.actions.push({ type: "call_webhook", status: "queued" });
          appendRunLog(flowResult, "info", "Webhook action queued", { nodeId: node.id, mode });
        }
      } catch (error) {
        flowResult.actions.push({ type: "call_webhook", status: "failed", error: error.message });
        appendRunLog(flowResult, "error", "Webhook action failed", { nodeId: node.id, error: error.message });
      }
    }

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

    await conversation.save();

    results.push(flowResult);
  }

  if (results.length) {
    const hydratedConversation = await Conversation.findById(conversation._id);
    await publishConversationChanged(hydratedConversation?._id || conversation._id);
  }

  return results;
}
