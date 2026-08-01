import mongoose from "mongoose";
import { AutomationFlow, Contact, Conversation, Message, WhatsAppAccount } from "../models/index.js";
import { callOutboundWebhook } from "./integrations.js";
import { publishConversationChanged } from "../realtime/events.js";
import { enqueueJob } from "./jobs.js";
import { encodeCredentials, sendWhatsAppText } from "./whatsappProvider.js";

const AUTOMATION_QUEUE = "automations";
const AUTOMATION_SEND_JOB = "automation.send-message";
const AUTOMATION_WEBHOOK_JOB = "automation.call-webhook";

// Enqueues the actual WhatsApp send for one automation action, decoupling it from the inbound
// webhook request (which today blocks on it) and picking up BullMQ's retry/backoff on failure.
// Falls back to processing inline when Redis/BullMQ isn't available, e.g. local dev.
export async function enqueueAutomationSendMessage(data) {
  const result = await enqueueJob(AUTOMATION_QUEUE, AUTOMATION_SEND_JOB, data, {});
  if (result.queued) return { mode: "queued" };
  await processAutomationSendMessage(data);
  return { mode: "inline" };
}

export async function processAutomationSendMessage(data) {
  const { flowId, flowName, nodeId, accountId, workspaceId, organizationId, contactId, conversationId, body, testMode } = data;

  const [account, contact] = await Promise.all([
    WhatsAppAccount.findOne({ _id: accountId, workspaceId }),
    Contact.findOne({ _id: contactId, workspaceId }),
  ]);
  if (!account || !contact) return { status: "failed", messageId: "" };

  // Flow-test runs must never place a real, credentialed API call - the job re-fetches the real
  // account by id (it has no access to the request's in-memory object), so testMode forces the
  // same local-placeholder credentials the /test route used to patch in directly.
  const sendAccount = testMode
    ? {
        ...account.toObject(),
        encryptedCredentials: encodeCredentials({
          provider: account.provider || "meta",
          accessToken: "local-placeholder-token",
          authToken: "local-placeholder-token",
          apiKey: "local-placeholder-token",
        }),
      }
    : account;

  let providerResult;
  try {
    providerResult = await sendWhatsAppText({ account: sendAccount, to: contact.phone, body });
  } catch (error) {
    providerResult = {
      providerMessageId: `failed_automation_${flowId}_${Date.now()}`,
      status: "failed",
      mode: "meta",
      error,
    };
  }

  const message = await Message.create({
    organizationId,
    workspaceId,
    conversationId,
    contactId: contact._id,
    whatsappAccountId: account._id,
    direction: "outbound",
    type: "text",
    body,
    providerMessageId: providerResult.providerMessageId,
    status: providerResult.status,
    sentAt: new Date(),
    metadata: {
      automationFlowId: new mongoose.Types.ObjectId(flowId),
      automationFlowName: flowName,
      automationGenerated: true,
      providerMode: providerResult.mode,
      ...(providerResult.error ? { error: providerResult.error.message } : {}),
    },
  });

  await Conversation.updateOne(
    { _id: conversationId },
    { $set: { lastMessageId: message._id, lastMessageAt: message.sentAt } }
  );
  await Contact.updateOne({ _id: contact._id }, { lastMessageAt: message.sentAt });

  const isFailed = providerResult.status === "failed";
  await AutomationFlow.updateOne(
    { _id: flowId },
    {
      // Only self-report to trigger.failures for the async path (queued/inline-fallback), where
      // the caller always logs "queued" regardless of outcome and the run-level aggregate in
      // runInboundAutomations never sees the real result. In testMode the caller uses the real
      // status directly, so that same run-level aggregate already counts it - counting here too
      // would double it.
      $inc: { "trigger.failures": isFailed && !testMode ? 1 : 0 },
      $push: {
        "trigger.executionLogs": {
          $each: [{
            at: new Date(),
            level: isFailed ? "error" : "info",
            message: "WhatsApp message action completed",
            nodeId,
            status: providerResult.status,
            messageId: message._id.toString(),
          }],
          $slice: -100,
        },
      },
    }
  );

  await publishConversationChanged(conversationId);

  return { status: providerResult.status, messageId: message._id.toString() };
}

// Enqueues the outbound webhook call for one automation action, decoupling it from the inbound
// webhook request and picking up BullMQ's retry/backoff on failure - user-configured webhook URLs
// are the most likely of any automation action to be slow or flaky.
// Falls back to processing inline when Redis/BullMQ isn't available, e.g. local dev.
export async function enqueueAutomationWebhookAction(data) {
  const result = await enqueueJob(AUTOMATION_QUEUE, AUTOMATION_WEBHOOK_JOB, data, {});
  if (result.queued) return { mode: "queued" };
  await processAutomationWebhookAction(data);
  return { mode: "inline" };
}

export async function processAutomationWebhookAction(data) {
  const { flowId, nodeId, workspaceId, url, secret, event, payload, testMode } = data;

  try {
    const result = await callOutboundWebhook({ workspaceId, url, secret, event, payload });
    const status = result.skipped ? "skipped" : "sent";
    await AutomationFlow.updateOne(
      { _id: flowId },
      {
        $push: {
          "trigger.executionLogs": {
            $each: [{ at: new Date(), level: "info", message: "Webhook action completed", nodeId, status }],
            $slice: -100,
          },
        },
      }
    );
    return { status };
  } catch (error) {
    await AutomationFlow.updateOne(
      { _id: flowId },
      {
        // See the matching note in processAutomationSendMessage - testMode's failure is already
        // counted by runInboundAutomations' own run-level aggregate.
        $inc: { "trigger.failures": testMode ? 0 : 1 },
        $push: {
          "trigger.executionLogs": {
            $each: [{ at: new Date(), level: "error", message: "Webhook action failed", nodeId, error: error.message }],
            $slice: -100,
          },
        },
      }
    );
    throw error;
  }
}
