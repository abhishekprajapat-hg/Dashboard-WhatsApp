import {
  AutomationFlow,
  Contact,
  Conversation,
  Message,
  Tag,
} from "../models/index.js";
import { publishConversationChanged } from "../realtime/events.js";
import { ensureConversationInCrm } from "./crm.js";
import { callOutboundWebhook } from "./integrations.js";
import { sendWhatsAppText } from "./whatsappProvider.js";
import { keywordMatches, parseKeywords } from "../utils/keywords.js";

function actionNodes(flow, type) {
  return (flow.nodes || []).filter((node) => node?.type === type);
}

function triggerMatches(flow, { inboundMessage, isNewConversation }) {
  const triggerType = String(flow.trigger?.type || "").toLowerCase();
  const inboundBody = String(inboundMessage?.body || "").toLowerCase();

  if (triggerType === "new_conversation") return Boolean(isNewConversation);

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
  flowId,
}) {
  if (!account || !contact || !conversation || !inboundMessage) return [];

  const flowFilter = {
    workspaceId: account.workspaceId,
    status: "published",
  };
  if (flowId) flowFilter._id = flowId;

  const flows = await AutomationFlow.find(flowFilter).sort({ updatedAt: -1 });

  const matchingFlows = flows.filter((flow) => triggerMatches(flow, { inboundMessage, isNewConversation }));
  const results = [];

  for (const flow of matchingFlows) {
    const flowResult = { flowId: flow._id.toString(), actions: [] };

    for (const node of actionNodes(flow, "send_message")) {
      const body = String(node?.config?.body || flow.trigger?.replyBody || "").trim();
      if (!body) continue;

      let providerResult;
      try {
        providerResult = await sendWhatsAppText({
          account,
          to: contact.phone,
          body,
        });
      } catch (error) {
        providerResult = {
          providerMessageId: `failed_automation_${flow._id}_${Date.now()}`,
          status: "failed",
          mode: "meta",
          error,
        };
      }

      const outboundMessage = await Message.create({
        organizationId: account.organizationId,
        workspaceId: account.workspaceId,
        conversationId: conversation._id,
        contactId: contact._id,
        whatsappAccountId: account._id,
        direction: "outbound",
        type: "text",
        body,
        providerMessageId: providerResult.providerMessageId,
        status: providerResult.status,
        sentAt: new Date(),
        metadata: {
          automationFlowId: flow._id,
          automationFlowName: flow.name,
          providerMode: providerResult.mode,
          ...(providerResult.error ? { error: providerResult.error.message } : {}),
        },
      });

      conversation.lastMessageId = outboundMessage._id;
      conversation.lastMessageAt = outboundMessage.sentAt;
      await Contact.updateOne({ _id: contact._id }, { lastMessageAt: outboundMessage.sentAt });
      flowResult.actions.push({ type: "send_message", messageId: outboundMessage._id.toString(), status: providerResult.status });
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
      }
    }

    for (const node of actionNodes(flow, "set_status")) {
      const status = node?.config?.status;
      const statusMap = { open: "open", waiting: "pending", pending: "pending", resolved: "resolved", archived: "archived" };
      if (statusMap[status]) {
        conversation.status = statusMap[status];
        flowResult.actions.push({ type: "set_status", status });
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
    }

    for (const node of actionNodes(flow, "add_to_crm")) {
      await ensureConversationInCrm({
        contact,
        conversation,
        source: node?.config?.source || "automation",
        stage: node?.config?.stage || "new_lead",
      });
      flowResult.actions.push({ type: "add_to_crm" });
    }

    for (const node of actionNodes(flow, "call_webhook")) {
      try {
        const webhookResult = await callOutboundWebhook({
          workspaceId: account.workspaceId,
          url: node?.config?.url,
          secret: node?.config?.secret,
          event: node?.config?.event || "automation.triggered",
          payload: {
            flow: { id: flow._id.toString(), name: flow.name },
            contact: { id: contact._id.toString(), name: contact.name, phone: contact.phone, email: contact.email || "" },
            conversation: { id: conversation._id.toString(), status: conversation.status },
            inboundMessage: { id: inboundMessage._id.toString(), body: inboundMessage.body || "" },
          },
        });
        flowResult.actions.push({ type: "call_webhook", status: webhookResult.skipped ? "skipped" : "sent" });
      } catch (error) {
        flowResult.actions.push({ type: "call_webhook", status: "failed", error: error.message });
      }
    }

    if (flowResult.actions.length === 0) continue;

    await AutomationFlow.updateOne(
      { _id: flow._id },
      {
        $inc: { "trigger.runs": 1 },
        $set: { "trigger.lastRunAt": new Date() },
      }
    );

    await conversation.save();

    results.push(flowResult);
  }

  if (results.length) {
    const hydratedConversation = await Conversation.findById(conversation._id);
    await publishConversationChanged(hydratedConversation?._id || conversation._id);
  }

  return results;
}
