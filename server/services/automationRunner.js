import {
  AutomationFlow,
  Contact,
  Conversation,
  Message,
} from "../models/index.js";
import { publishConversationChanged } from "../realtime/events.js";
import { sendWhatsAppText } from "./whatsappProvider.js";

function getSendMessageNode(flow) {
  return (flow.nodes || []).find((node) => node?.type === "send_message");
}

function getReplyBody(flow) {
  const node = getSendMessageNode(flow);
  return (
    node?.config?.body ||
    flow.trigger?.replyBody ||
    "Thanks for reaching out. Our team will reply shortly."
  );
}

function triggerMatches(flow, { inboundMessage, isNewConversation }) {
  const triggerType = String(flow.trigger?.type || "").toLowerCase();
  const inboundBody = String(inboundMessage?.body || "").toLowerCase();

  if (triggerType === "new_conversation") return Boolean(isNewConversation);

  if (triggerType === "keyword_match") {
    const keyword = String(flow.trigger?.keyword || "").trim().toLowerCase();
    return keyword ? inboundBody.includes(keyword) : true;
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
}) {
  if (!account || !contact || !conversation || !inboundMessage) return [];

  const flows = await AutomationFlow.find({
    workspaceId: account.workspaceId,
    status: "published",
  }).sort({ updatedAt: -1 });

  const matchingFlows = flows.filter((flow) => triggerMatches(flow, { inboundMessage, isNewConversation }));
  const results = [];

  for (const flow of matchingFlows) {
    const body = getReplyBody(flow).trim();
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

    await AutomationFlow.updateOne(
      { _id: flow._id },
      {
        $inc: { "trigger.runs": 1 },
        $set: { "trigger.lastRunAt": new Date() },
      }
    );

    conversation.lastMessageId = outboundMessage._id;
    conversation.lastMessageAt = outboundMessage.sentAt;
    await conversation.save();
    await Contact.updateOne({ _id: contact._id }, { lastMessageAt: outboundMessage.sentAt });

    results.push({ flowId: flow._id.toString(), messageId: outboundMessage._id.toString(), status: providerResult.status });
  }

  if (results.length) {
    const hydratedConversation = await Conversation.findById(conversation._id);
    await publishConversationChanged(hydratedConversation?._id || conversation._id);
  }

  return results;
}
