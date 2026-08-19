import mongoose from "mongoose";
import { Campaign, Contact, Conversation, Message, Template, WhatsAppAccount } from "../models/index.js";
import { publishConversationChanged, publishWorkspaceEvent } from "../realtime/events.js";
import { enqueueJob } from "./jobs.js";
import { logger } from "./logger.js";
import { sendWhatsAppTemplate } from "./whatsappProvider.js";

const CAMPAIGN_QUEUE = "campaigns";
const CAMPAIGN_SEND_JOB = "campaign.send-recipient";

function toId(value) {
  return (value?._id || value)?.toString?.() || String(value);
}

function pickVariant(campaign, index) {
  const variants = campaign.abTest?.variants || [];
  if (!campaign.abTest?.enabled || variants.length < 2) return "A";
  const split = Number(campaign.abTest?.split || 50);
  return index % 100 >= split ? "B" : "A";
}

function variantTemplateId(campaign, variant) {
  const match = (campaign.abTest?.variants || []).find((item) => item.id === variant);
  return toId(match?.templateId || campaign.templateId);
}

// Enqueues one BullMQ job per recipient, spaced out to respect campaign.rateLimit.perMinute.
// Falls back to processing inline (synchronously) when Redis/BullMQ isn't available, e.g. local dev.
export async function enqueueCampaignRecipients(campaign, contacts, { userId }) {
  const perMinute = Math.max(1, Math.min(1000, Number(campaign.rateLimit?.perMinute || 60)));
  const spacingMs = Math.max(50, Math.round(60000 / perMinute));

  const jobs = contacts.map((contact, index) => {
    const variant = pickVariant(campaign, index);
    return {
      data: {
        campaignId: toId(campaign._id),
        workspaceId: toId(campaign.workspaceId),
        organizationId: toId(campaign.organizationId),
        contactId: toId(contact._id),
        accountId: toId(campaign.whatsappAccountId),
        templateId: variantTemplateId(campaign, variant),
        variant,
        userId,
      },
      delay: index * spacingMs,
    };
  });

  let queuedCount = 0;
  for (const job of jobs) {
    const result = await enqueueJob(CAMPAIGN_QUEUE, CAMPAIGN_SEND_JOB, job.data, { delay: job.delay });
    if (!result.queued) break;
    queuedCount += 1;
  }

  if (queuedCount === jobs.length) {
    return { mode: "queued", count: queuedCount };
  }

  // Redis/BullMQ unavailable - process whatever's left inline so sends still go out.
  // Unlike a real queued job (where a throw triggers BullMQ's retry/backoff), a throw here
  // would abort every remaining recipient in the batch and strand the campaign in "sending"
  // with no resend path - so one bad recipient must not stop the rest.
  for (const job of jobs.slice(queuedCount)) {
    try {
      await processCampaignRecipient(job.data);
    } catch (error) {
      logger.warn({ contactId: job.data.contactId, err: error }, "Inline campaign send failed");
      await recordRecipientFailure(job.data, error.message || "Send failed.");
    }
  }
  return { mode: queuedCount ? "mixed" : "inline", count: jobs.length };
}

export async function processCampaignRecipient(data) {
  const { campaignId, workspaceId, organizationId, contactId, accountId, templateId, variant, userId } = data;
  const contactObjectId = new mongoose.Types.ObjectId(contactId);

  const campaign = await Campaign.findOne({ _id: campaignId, workspaceId });
  if (!campaign) return;

  if (campaign.status === "cancelled") {
    await Campaign.updateOne(
      { _id: campaignId, "recipients.contactId": contactObjectId },
      { $set: { "recipients.$.status": "cancelled" } }
    );
    return;
  }

  if (campaign.status === "paused") {
    await Campaign.updateOne(
      { _id: campaignId, "recipients.contactId": contactObjectId },
      { $set: { "recipients.$.status": "paused" } }
    );
    return;
  }

  // Pausing doesn't cancel already-enqueued jobs - it only makes them self-skip via the check
  // above if they fire while still paused. If a resume later re-enqueues fresh jobs for the same
  // recipients, the original (never-cancelled) job can still be sitting delayed in Redis and fire
  // after resume flips status back to "sending" - without this guard that would send twice.
  const recipient = (campaign.recipients || []).find((item) => toId(item.contactId) === contactId);
  if (recipient && recipient.status !== "queued") return;

  const [account, template, contact] = await Promise.all([
    WhatsAppAccount.findOne({ _id: accountId, workspaceId }),
    Template.findOne({ _id: templateId, workspaceId }),
    Contact.findOne({ _id: contactId, workspaceId }),
  ]);

  let providerResult;
  let errorMessage = "";
  if (!account || !template || !contact) {
    errorMessage = "Missing account, template, or contact.";
    providerResult = { providerMessageId: `failed_campaign_${campaignId}_${contactId}_${Date.now()}`, status: "failed", mode: "meta" };
  } else {
    try {
      providerResult = await sendWhatsAppTemplate({ account, to: contact.phone, template, parameters: [], useMarketingMessagesLite: campaign.useMarketingMessagesLite });
    } catch (error) {
      errorMessage = error.message || "Send failed.";
      providerResult = { providerMessageId: `failed_campaign_${campaignId}_${contactId}_${Date.now()}`, status: "failed", mode: "meta" };
    }
  }

  if (account && contact) {
    const conversation = await Conversation.findOneAndUpdate(
      { workspaceId, contactId: contact._id, status: mongoose.trusted({ $ne: "archived" }) },
      {
        organizationId,
        workspaceId,
        contactId: contact._id,
        whatsappAccountId: account._id,
        status: "open",
        lastMessageAt: new Date(),
      },
      { upsert: true, new: true, setDefaultsOnInsert: true }
    );

    const message = await Message.create({
      organizationId,
      workspaceId,
      conversationId: conversation._id,
      contactId: contact._id,
      whatsappAccountId: account._id,
      direction: "outbound",
      type: "template",
      body: `Campaign template sent: ${template?.name || "template"}`,
      providerMessageId: providerResult.providerMessageId,
      status: providerResult.status,
      sentByUserId: userId,
      sentAt: new Date(),
      metadata: {
        campaignId: campaign._id,
        campaignName: campaign.name,
        campaignEvent: "send",
        variant,
        providerMode: providerResult.mode,
        templateId: template?._id,
        templateName: template?.name,
        ...(errorMessage ? { error: errorMessage } : {}),
      },
    });

    conversation.lastMessageId = message._id;
    conversation.lastMessageAt = message.sentAt;
    await conversation.save();
    await Contact.updateOne({ _id: contact._id }, { lastMessageAt: message.sentAt });
    await publishConversationChanged(conversation._id);
  }

  if (!(providerResult.status === "failed") && template?._id) {
    await Template.updateOne({ _id: template._id, workspaceId }, { $inc: { usageCount: 1 }, lastUsedAt: new Date() });
  }

  await finalizeRecipientResult({
    campaignId,
    workspaceId,
    contactObjectId,
    variant,
    userId,
    status: providerResult.status,
    providerMessageId: providerResult.providerMessageId,
    errorMessage,
  });
}

// Records a hard failure for a recipient whose send never reached a provider result at all
// (e.g. an unexpected error in the inline fallback loop), so the batch can still complete.
async function recordRecipientFailure(data, errorMessage) {
  const { campaignId, workspaceId, contactId, variant, userId } = data;
  await finalizeRecipientResult({
    campaignId,
    workspaceId,
    contactObjectId: new mongoose.Types.ObjectId(contactId),
    variant,
    userId,
    status: "failed",
    providerMessageId: `failed_campaign_${campaignId}_${contactId}_${Date.now()}`,
    errorMessage,
  });
}

async function finalizeRecipientResult({ campaignId, workspaceId, contactObjectId, variant, userId, status, providerMessageId, errorMessage }) {
  const isFailed = status === "failed";
  const isDelivered = ["delivered", "read"].includes(status);
  const incFields = {
    "recipients.$.attempts": 1,
    "queue.queued": -1,
    "queue.completed": 1,
  };
  if (isFailed) {
    incFields["queue.failed"] = 1;
    incFields["metrics.failed"] = 1;
  } else {
    incFields["metrics.sent"] = 1;
    if (isDelivered) incFields["metrics.delivered"] = 1;
  }

  const updated = await Campaign.findOneAndUpdate(
    { _id: campaignId, "recipients.contactId": contactObjectId },
    {
      $set: {
        "recipients.$.status": status,
        "recipients.$.providerMessageId": providerMessageId,
        "recipients.$.error": errorMessage || "",
        "recipients.$.variant": variant,
        "recipients.$.sentAt": new Date(),
      },
      $inc: incFields,
    },
    { new: true }
  );

  if (
    updated &&
    ["sending", "queued"].includes(updated.status) &&
    Number(updated.queue?.completed || 0) + Number(updated.queue?.failed || 0) >= Number(updated.metrics?.recipients || 0)
  ) {
    updated.status = Number(updated.metrics?.sent || 0) === 0 && Number(updated.metrics?.failed || 0) > 0 ? "failed" : "sent";
    updated.sentAt = new Date();
    updated.history = [
      ...(updated.history || []),
      { type: "send_completed", actorUserId: userId, at: new Date(), sent: updated.metrics?.sent, failed: updated.metrics?.failed },
    ];
    await updated.save();
  }

  publishWorkspaceEvent(workspaceId, "campaign", {
    campaignId,
    status: updated?.status,
    metrics: updated?.metrics,
    queue: updated?.queue,
  });
}
