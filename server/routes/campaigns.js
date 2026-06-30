import { Router } from "express";
import mongoose from "mongoose";
import { Campaign, Contact, Conversation, Message, Template, WhatsAppAccount } from "../models/index.js";
import { sendWhatsAppTemplate } from "../services/whatsappProvider.js";
import { publishConversationChanged } from "../realtime/events.js";

export const campaignsRouter = Router();

function serializeCampaign(campaign) {
  const metrics = campaign.metrics || {};
  const sent = Number(metrics.sent || 0);
  const delivered = Number(metrics.delivered || 0);
  const read = Number(metrics.read || 0);
  const replied = Number(metrics.replied || 0);
  const status = campaign.status === "sending" ? "running" : campaign.status;

  return {
    id: campaign._id.toString(),
    name: campaign.name,
    status,
    type: campaign.audienceFilter?.type || "broadcast",
    audience: campaign.audienceFilter?.label || "All Contacts",
    recipients: Number(metrics.recipients || 0),
    sent,
    delivered,
    read,
    replied,
    scheduledAt: campaign.scheduledAt ? campaign.scheduledAt.toLocaleString("en-US", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" }) : undefined,
    sentAt: campaign.sentAt ? campaign.sentAt.toLocaleString("en-US", { month: "short", day: "numeric" }) : undefined,
    template: campaign.templateId?.name || "No template",
    templateId: campaign.templateId?._id?.toString?.() || campaign.templateId?.toString?.() || "",
    failed: Number(metrics.failed || 0),
  };
}

function formatDateTime(date) {
  if (!date) return "";
  return new Date(date).toLocaleString("en-IN", {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function serializeRecipient(recipient = {}) {
  return {
    contactId: recipient.contactId?.toString?.() || "",
    name: recipient.name || "Unknown",
    phone: recipient.phone || "",
    status: recipient.status || "queued",
    providerMessageId: recipient.providerMessageId || "",
    error: recipient.error || "",
    sentAt: formatDateTime(recipient.sentAt),
  };
}

function getAudienceFilter(workspaceId, type = "all") {
  const filter = { workspaceId };
  if (type === "opted_in") filter.optInStatus = "opted_in";
  if (type === "leads") filter.lifecycleStatus = "lead";
  if (type === "customers") filter.lifecycleStatus = "customer";
  return filter;
}

function getAudienceLabel(type = "all") {
  const labels = {
    all: "All Contacts",
    opted_in: "Opted-in Contacts",
    leads: "Leads",
    customers: "Customers",
  };
  return labels[type] || "All Contacts";
}

async function getCampaignDefaults(workspaceId, audienceType = "all") {
  const [account, template, recipients] = await Promise.all([
    WhatsAppAccount.findOne({ workspaceId, status: "connected" }).sort({ createdAt: -1 }),
    Template.findOne({ workspaceId, status: "approved" }).sort({ name: 1 }),
    Contact.countDocuments(getAudienceFilter(workspaceId, audienceType)),
  ]);

  return { account, template, recipients };
}

campaignsRouter.get("/", async (req, res) => {
  if (mongoose.connection.readyState !== 1) {
    return res.json({ data: [], total: 0, summary: { totalSent: 0, deliveryRate: 0, readRate: 0, replyRate: 0 } });
  }

  const campaigns = await Campaign.find({ workspaceId: req.user.workspaceId })
    .populate("templateId")
    .sort({ createdAt: -1 })
    .limit(100);

  const summary = campaigns.reduce(
    (acc, campaign) => {
      const metrics = campaign.metrics || {};
      acc.totalSent += Number(metrics.sent || 0);
      acc.delivered += Number(metrics.delivered || 0);
      acc.read += Number(metrics.read || 0);
      acc.replied += Number(metrics.replied || 0);
      return acc;
    },
    { totalSent: 0, delivered: 0, read: 0, replied: 0 }
  );

  res.json({
    data: campaigns.map(serializeCampaign),
    total: campaigns.length,
    summary: {
      totalSent: summary.totalSent,
      deliveryRate: summary.totalSent ? Math.round((summary.delivered / summary.totalSent) * 100) : 0,
      readRate: summary.delivered ? Math.round((summary.read / summary.delivered) * 100) : 0,
      replyRate: summary.delivered ? Math.round((summary.replied / summary.delivered) * 100) : 0,
    },
  });
});

campaignsRouter.get("/:id", async (req, res) => {
  if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
    return res.status(404).json({ error: "NOT_FOUND", message: "Campaign not found." });
  }

  const campaign = await Campaign.findOne({ _id: req.params.id, workspaceId: req.user.workspaceId })
    .populate("templateId")
    .populate("whatsappAccountId", "displayName phoneNumber phoneNumberId");

  if (!campaign) return res.status(404).json({ error: "NOT_FOUND", message: "Campaign not found." });

  const messages = await Message.find({
    workspaceId: req.user.workspaceId,
    "metadata.campaignId": campaign._id,
  })
    .populate("contactId", "name phone")
    .sort({ createdAt: -1 })
    .limit(100);

  res.json({
    data: {
      ...serializeCampaign(campaign),
      account: campaign.whatsappAccountId
        ? {
            id: campaign.whatsappAccountId._id.toString(),
            displayName: campaign.whatsappAccountId.displayName,
            phoneNumber: campaign.whatsappAccountId.phoneNumber,
            phoneNumberId: campaign.whatsappAccountId.phoneNumberId,
          }
        : null,
      recipients: (campaign.recipients || []).map(serializeRecipient),
      timeline: messages.map((message) => ({
        id: message._id.toString(),
        contact: message.contactId?.name || "Unknown",
        phone: message.contactId?.phone || "",
        status: message.status,
        body: message.body || "",
        providerMessageId: message.providerMessageId || "",
        error: message.metadata?.error || "",
        time: formatDateTime(message.sentAt || message.createdAt),
      })),
    },
  });
});

campaignsRouter.post("/", async (req, res) => {
  if (mongoose.connection.readyState !== 1) {
    return res.status(503).json({ error: "DATABASE_UNAVAILABLE", message: "MongoDB is required." });
  }

  const {
    name,
    type = "broadcast",
    audience = "All Contacts",
    audienceType = "all",
    templateId,
    status = "draft",
    scheduledAt,
  } = req.body || {};
  if (!name?.trim()) {
    return res.status(400).json({ error: "VALIDATION_ERROR", message: "Campaign name is required." });
  }

  const { account, template: defaultTemplate, recipients } = await getCampaignDefaults(req.user.workspaceId, audienceType);
  const template = templateId && mongoose.Types.ObjectId.isValid(templateId)
    ? await Template.findOne({ _id: templateId, workspaceId: req.user.workspaceId, status: "approved" })
    : defaultTemplate;

  if (!account || !template) {
    return res.status(400).json({ error: "WHATSAPP_REQUIRED", message: "Connect WhatsApp and sync templates before creating campaigns." });
  }

  const dbStatus = status === "running" ? "sending" : status;

  const campaign = await Campaign.create({
    organizationId: req.user.organizationId,
    workspaceId: req.user.workspaceId,
    name: name.trim(),
    whatsappAccountId: account._id,
    templateId: template._id,
    audienceFilter: { type, label: audience || getAudienceLabel(audienceType), audienceType },
    status: ["draft", "scheduled", "sending", "sent", "paused", "failed"].includes(dbStatus) ? dbStatus : "draft",
    scheduledAt: scheduledAt ? new Date(scheduledAt) : undefined,
    createdBy: req.user.sub,
    metrics: { recipients, sent: 0, delivered: 0, read: 0, replied: 0, failed: 0 },
  });

  await campaign.populate("templateId");
  res.status(201).json({ data: serializeCampaign(campaign) });
});

campaignsRouter.post("/:id/send", async (req, res) => {
  if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
    return res.status(404).json({ error: "NOT_FOUND", message: "Campaign not found." });
  }

  const campaign = await Campaign.findOne({ _id: req.params.id, workspaceId: req.user.workspaceId })
    .populate("templateId")
    .populate("whatsappAccountId");

  if (!campaign) return res.status(404).json({ error: "NOT_FOUND", message: "Campaign not found." });
  if (!["draft", "scheduled", "paused", "failed"].includes(campaign.status)) {
    return res.status(400).json({ error: "INVALID_STATUS", message: "Only draft, scheduled, paused, or failed campaigns can be sent." });
  }

  const account = campaign.whatsappAccountId;
  const template = campaign.templateId;
  if (!account || !template) {
    return res.status(400).json({ error: "WHATSAPP_REQUIRED", message: "Campaign account and template are required." });
  }

  const audienceType = campaign.audienceFilter?.audienceType || "all";
  const contacts = await Contact.find(getAudienceFilter(req.user.workspaceId, audienceType))
    .sort({ createdAt: -1 })
    .limit(500);

  campaign.status = "sending";
  campaign.metrics = { ...(campaign.metrics || {}), recipients: contacts.length, sent: 0, delivered: 0, failed: 0 };
  campaign.recipients = [];
  await campaign.save();

  let sent = 0;
  let delivered = 0;
  let failed = 0;
  const recipientLogs = [];

  for (const contact of contacts) {
    let providerResult;
    let errorMessage = "";

    try {
      providerResult = await sendWhatsAppTemplate({ account, to: contact.phone, template, parameters: [] });
      sent += 1;
      if (["sent", "delivered", "read"].includes(providerResult.status)) delivered += 1;
    } catch (error) {
      failed += 1;
      errorMessage = error.message || "Send failed.";
      providerResult = {
        providerMessageId: `failed_campaign_${campaign._id}_${contact._id}_${Date.now()}`,
        status: "failed",
        mode: "meta",
      };
    }

    const conversation = await Conversation.findOneAndUpdate(
      { workspaceId: req.user.workspaceId, contactId: contact._id, status: { $ne: "archived" } },
      {
        organizationId: req.user.organizationId,
        workspaceId: req.user.workspaceId,
        contactId: contact._id,
        whatsappAccountId: account._id,
        status: "open",
        lastMessageAt: new Date(),
      },
      { upsert: true, new: true, setDefaultsOnInsert: true }
    );

    const message = await Message.create({
      organizationId: req.user.organizationId,
      workspaceId: req.user.workspaceId,
      conversationId: conversation._id,
      contactId: contact._id,
      whatsappAccountId: account._id,
      direction: "outbound",
      type: "template",
      body: `Campaign template sent: ${template.name}`,
      providerMessageId: providerResult.providerMessageId,
      status: providerResult.status,
      sentByUserId: req.user.sub,
      sentAt: new Date(),
      metadata: {
        campaignId: campaign._id,
        campaignName: campaign.name,
        providerMode: providerResult.mode,
        templateId: template._id,
        templateName: template.name,
        ...(errorMessage ? { error: errorMessage } : {}),
      },
    });

    conversation.lastMessageId = message._id;
    conversation.lastMessageAt = message.sentAt;
    await conversation.save();
    await Contact.updateOne({ _id: contact._id }, { lastMessageAt: message.sentAt });
    await publishConversationChanged(conversation._id);

    recipientLogs.push({
      contactId: contact._id,
      name: contact.name,
      phone: contact.phone,
      status: providerResult.status,
      providerMessageId: providerResult.providerMessageId,
      error: errorMessage,
      sentAt: new Date(),
    });
  }

  campaign.status = failed > 0 && sent === 0 ? "failed" : "sent";
  campaign.sentAt = new Date();
  campaign.metrics = { recipients: contacts.length, sent, delivered, read: 0, replied: 0, failed };
  campaign.recipients = recipientLogs;
  await campaign.save();
  await campaign.populate("templateId");

  res.json({ data: serializeCampaign(campaign), recipients: recipientLogs });
});

campaignsRouter.patch("/:id", async (req, res) => {
  if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
    return res.status(404).json({ error: "NOT_FOUND", message: "Campaign not found." });
  }

  const updates = {};
  if (req.body?.name) updates.name = req.body.name.trim();
  if (req.body?.status) updates.status = req.body.status === "running" ? "sending" : req.body.status;
  if (req.body?.templateId && mongoose.Types.ObjectId.isValid(req.body.templateId)) updates.templateId = req.body.templateId;
  if (req.body?.type || req.body?.audience) {
    updates.audienceFilter = {
      type: req.body.type || "broadcast",
      label: req.body.audience || getAudienceLabel(req.body.audienceType),
      audienceType: req.body.audienceType || "all",
    };
  }

  const campaign = await Campaign.findOneAndUpdate(
    { _id: req.params.id, workspaceId: req.user.workspaceId },
    updates,
    { new: true }
  ).populate("templateId");

  if (!campaign) return res.status(404).json({ error: "NOT_FOUND", message: "Campaign not found." });
  res.json({ data: serializeCampaign(campaign) });
});

campaignsRouter.delete("/:id", async (req, res) => {
  if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
    return res.status(404).json({ error: "NOT_FOUND", message: "Campaign not found." });
  }

  const campaign = await Campaign.findOneAndDelete({ _id: req.params.id, workspaceId: req.user.workspaceId });
  if (!campaign) return res.status(404).json({ error: "NOT_FOUND", message: "Campaign not found." });
  res.sendStatus(204);
});
