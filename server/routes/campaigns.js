import { Router } from "express";
import mongoose from "mongoose";
import { Campaign, Contact, Conversation, Message, Template, WhatsAppAccount } from "../models/index.js";
import { sendWhatsAppTemplate } from "../services/whatsappProvider.js";
import { publishConversationChanged } from "../realtime/events.js";

export const campaignsRouter = Router();

function serializeCampaign(campaign) {
  const metrics = campaign.metrics || {};
  const queue = campaign.queue || {};
  const approval = campaign.approval || {};
  const sent = Number(metrics.sent || 0);
  const delivered = Number(metrics.delivered || 0);
  const read = Number(metrics.read || 0);
  const replied = Number(metrics.replied || 0);
  const clicks = Number(metrics.clicks || 0);
  const conversions = Number(metrics.conversions || 0);
  const status = campaign.status === "sending" ? "running" : campaign.status === "cancelled" ? "cancelled" : campaign.status;

  return {
    id: campaign._id.toString(),
    name: campaign.name,
    status,
    type: campaign.type || campaign.audienceFilter?.type || "template",
    campaignKind: campaign.audienceFilter?.type || "broadcast",
    audience: campaign.audienceFilter?.label || "All Contacts",
    audienceType: campaign.audienceFilter?.audienceType || "all",
    recipients: Number(metrics.recipients || 0),
    sent,
    delivered,
    read,
    replied,
    clicks,
    conversions,
    scheduledAt: campaign.scheduledAt ? campaign.scheduledAt.toLocaleString("en-US", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" }) : undefined,
    sentAt: campaign.sentAt ? campaign.sentAt.toLocaleString("en-US", { month: "short", day: "numeric" }) : undefined,
    template: campaign.templateId?.name || "No template",
    templateId: campaign.templateId?._id?.toString?.() || campaign.templateId?.toString?.() || "",
    failed: Number(metrics.failed || 0),
    failures: Number(metrics.failed || 0),
    queued: Number(queue.queued || 0),
    processing: Number(queue.processing || 0),
    completed: Number(queue.completed || 0),
    retries: Number(queue.retries || 0),
    rateLimit: campaign.rateLimit || { perMinute: 60, batchSize: 50 },
    approval,
    requiresApproval: Boolean(approval.required),
    abTest: campaign.abTest || {},
    schedule: campaign.schedule || {},
    history: campaign.history || [],
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
    attempts: Number(recipient.attempts || 0),
    variant: recipient.variant || "",
    deliveredAt: formatDateTime(recipient.deliveredAt),
    readAt: formatDateTime(recipient.readAt),
    repliedAt: formatDateTime(recipient.repliedAt),
    clickedAt: formatDateTime(recipient.clickedAt),
    convertedAt: formatDateTime(recipient.convertedAt),
    sentAt: formatDateTime(recipient.sentAt),
  };
}

function getAudienceFilter(workspaceId, type = "all") {
  const filter = { workspaceId };
  if (type === "opted_in") filter.optInStatus = "opted_in";
  if (type === "leads") filter.lifecycleStatus = "lead";
  if (type === "customers") filter.lifecycleStatus = "customer";
  if (type === "hot_leads") filter["customFields.crm.leadScore"] = { $gte: 70 };
  if (type === "imported") filter["customFields.importedFromCampaign"] = true;
  return filter;
}

function getAudienceLabel(type = "all") {
  const labels = {
    all: "All Contacts",
    opted_in: "Opted-in Contacts",
    leads: "Leads",
    customers: "Customers",
    hot_leads: "Hot Leads",
    imported: "Imported Contacts",
  };
  return labels[type] || "All Contacts";
}

function dbStatus(status = "draft") {
  const map = { running: "sending", cancelled: "cancelled", canceled: "cancelled" };
  const value = map[status] || status;
  return ["draft", "pending_approval", "approved", "rejected", "scheduled", "queued", "sending", "sent", "paused", "cancelled", "failed"].includes(value)
    ? value
    : "draft";
}

function historyEvent(type, actorUserId, data = {}) {
  return { type, actorUserId, at: new Date(), ...data };
}

function parseCsvContacts(csv = "") {
  const lines = String(csv || "").split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  if (!lines.length) return [];
  const headers = lines[0].split(",").map((item) => item.trim().toLowerCase());
  const hasHeader = headers.some((item) => ["name", "phone", "email"].includes(item));
  const dataLines = hasHeader ? lines.slice(1) : lines;
  return dataLines.map((line) => {
    const cols = line.split(",").map((item) => item.trim());
    if (hasHeader) {
      const row = Object.fromEntries(headers.map((header, index) => [header, cols[index] || ""]));
      return { name: row.name || row.fullname || row.phone, phone: row.phone || row.mobile || row.whatsapp, email: row.email || "" };
    }
    return { name: cols[0] || cols[1], phone: cols[1] || cols[0], email: cols[2] || "" };
  }).filter((item) => item.phone);
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
      acc.clicks += Number(metrics.clicks || 0);
      acc.conversions += Number(metrics.conversions || 0);
      acc.failed += Number(metrics.failed || 0);
      return acc;
    },
    { totalSent: 0, delivered: 0, read: 0, replied: 0, clicks: 0, conversions: 0, failed: 0 }
  );

  res.json({
    data: campaigns.map(serializeCampaign),
    total: campaigns.length,
    summary: {
      totalSent: summary.totalSent,
      deliveryRate: summary.totalSent ? Math.round((summary.delivered / summary.totalSent) * 100) : 0,
      readRate: summary.delivered ? Math.round((summary.read / summary.delivered) * 100) : 0,
      replyRate: summary.delivered ? Math.round((summary.replied / summary.delivered) * 100) : 0,
      clickRate: summary.delivered ? Math.round((summary.clicks / summary.delivered) * 100) : 0,
      conversionRate: summary.delivered ? Math.round((summary.conversions / summary.delivered) * 100) : 0,
      failures: summary.failed,
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
      queue: campaign.queue || {},
      rateLimit: campaign.rateLimit || {},
      approval: campaign.approval || {},
      abTest: campaign.abTest || {},
      imports: campaign.imports || [],
      history: campaign.history || [],
      timeline: messages.map((message) => ({
        id: message._id.toString(),
        contact: message.contactId?.name || "Unknown",
        phone: message.contactId?.phone || "",
        status: message.status,
        body: message.body || "",
        providerMessageId: message.providerMessageId || "",
        error: message.metadata?.error || "",
        campaignEvent: message.metadata?.campaignEvent || "",
        variant: message.metadata?.variant || "",
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
    type = "template",
    campaignKind = "broadcast",
    audience = "All Contacts",
    audienceType = "all",
    templateId,
    templateBId,
    status = "draft",
    scheduledAt,
    recurring = false,
    recurrence = "none",
    requireApproval = false,
    rateLimit = {},
    abTest = {},
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

  const cleanStatus = requireApproval && status !== "draft" ? "pending_approval" : dbStatus(status);

  const campaign = await Campaign.create({
    organizationId: req.user.organizationId,
    workspaceId: req.user.workspaceId,
    name: name.trim(),
    whatsappAccountId: account._id,
    templateId: template._id,
    templateIds: [template._id, ...(templateBId && mongoose.Types.ObjectId.isValid(templateBId) ? [templateBId] : [])],
    type,
    audienceFilter: { type: campaignKind, label: audience || getAudienceLabel(audienceType), audienceType },
    status: cleanStatus,
    scheduledAt: scheduledAt ? new Date(scheduledAt) : undefined,
    schedule: {
      scheduledAt: scheduledAt ? new Date(scheduledAt) : null,
      recurring: Boolean(recurring),
      recurrence,
      timezone: req.user.timezone || "Asia/Kolkata",
    },
    rateLimit: {
      perMinute: Math.max(1, Math.min(1000, Number(rateLimit.perMinute || 60))),
      batchSize: Math.max(1, Math.min(500, Number(rateLimit.batchSize || 50))),
    },
    approval: {
      required: Boolean(requireApproval),
      status: requireApproval ? "pending" : "not_required",
      requestedAt: requireApproval ? new Date() : undefined,
      requestedBy: requireApproval ? req.user.sub : undefined,
    },
    abTest: {
      enabled: Boolean(abTest.enabled || templateBId),
      split: Math.max(1, Math.min(99, Number(abTest.split || 50))),
      winnerMetric: abTest.winnerMetric || "read",
      variants: [
        { id: "A", templateId: template._id, label: "Variant A" },
        ...(templateBId && mongoose.Types.ObjectId.isValid(templateBId) ? [{ id: "B", templateId: templateBId, label: "Variant B" }] : []),
      ],
    },
    createdBy: req.user.sub,
    metrics: { recipients, sent: 0, delivered: 0, read: 0, replied: 0, clicks: 0, conversions: 0, failed: 0 },
    queue: { queued: recipients, processing: 0, completed: 0, failed: 0, retries: 0 },
    history: [historyEvent("created", req.user.sub, { status: cleanStatus })],
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
  if (campaign.approval?.required && campaign.approval?.status !== "approved") {
    return res.status(400).json({ error: "APPROVAL_REQUIRED", message: "Campaign must be approved before sending." });
  }
  if (!["draft", "approved", "scheduled", "queued", "paused", "failed"].includes(campaign.status)) {
    return res.status(400).json({ error: "INVALID_STATUS", message: "Only draft, approved, scheduled, queued, paused, or failed campaigns can be sent." });
  }

  const account = campaign.whatsappAccountId;
  const template = campaign.templateId;
  if (!account || !template) {
    return res.status(400).json({ error: "WHATSAPP_REQUIRED", message: "Campaign account and template are required." });
  }

  const audienceType = campaign.audienceFilter?.audienceType || "all";
  const contacts = await Contact.find(getAudienceFilter(req.user.workspaceId, audienceType))
    .sort({ createdAt: -1 })
    .limit(Math.max(1, Math.min(5000, Number(req.body?.limit || 1000))));

  campaign.status = "sending";
  campaign.metrics = { ...(campaign.metrics || {}), recipients: contacts.length, sent: 0, delivered: 0, read: 0, replied: 0, clicks: 0, conversions: 0, failed: 0 };
  campaign.queue = { ...(campaign.queue || {}), queued: contacts.length, processing: 0, completed: 0, failed: 0 };
  campaign.recipients = [];
  campaign.history = [...(campaign.history || []), historyEvent("send_started", req.user.sub, { recipients: contacts.length })];
  await campaign.save();

  let sent = 0;
  let delivered = 0;
  let failed = 0;
  const recipientLogs = [];

  for (const [index, contact] of contacts.entries()) {
    let providerResult;
    let errorMessage = "";
    const variant = campaign.abTest?.enabled && campaign.abTest?.variants?.length > 1 && index % 100 >= Number(campaign.abTest.split || 50) ? "B" : "A";
    const variantTemplateId = campaign.abTest?.variants?.find((item) => item.id === variant)?.templateId;
    const sendTemplate = variantTemplateId
      ? await Template.findOne({ _id: variantTemplateId, workspaceId: req.user.workspaceId, status: "approved" }) || template
      : template;

    try {
      providerResult = await sendWhatsAppTemplate({ account, to: contact.phone, template: sendTemplate, parameters: [] });
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
      body: `Campaign template sent: ${sendTemplate.name}`,
      providerMessageId: providerResult.providerMessageId,
      status: providerResult.status,
      sentByUserId: req.user.sub,
      sentAt: new Date(),
      metadata: {
        campaignId: campaign._id,
        campaignName: campaign.name,
        campaignEvent: "send",
        variant,
        providerMode: providerResult.mode,
        templateId: sendTemplate._id,
        templateName: sendTemplate.name,
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
      variant,
      attempts: 1,
      providerMessageId: providerResult.providerMessageId,
      error: errorMessage,
      sentAt: new Date(),
    });
  }

  campaign.status = failed > 0 && sent === 0 ? "failed" : "sent";
  campaign.sentAt = new Date();
  campaign.metrics = { recipients: contacts.length, sent, delivered, read: 0, replied: 0, clicks: 0, conversions: 0, failed };
  campaign.queue = { ...(campaign.queue || {}), queued: 0, processing: 0, completed: sent, failed, retries: Number(campaign.queue?.retries || 0) };
  campaign.recipients = recipientLogs;
  campaign.history = [...(campaign.history || []), historyEvent("send_completed", req.user.sub, { sent, failed })];
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
  if (req.body?.status) updates.status = dbStatus(req.body.status);
  if (req.body?.templateId && mongoose.Types.ObjectId.isValid(req.body.templateId)) updates.templateId = req.body.templateId;
  if (req.body?.scheduledAt) {
    updates.scheduledAt = new Date(req.body.scheduledAt);
    updates.schedule = { ...(req.body.schedule || {}), scheduledAt: updates.scheduledAt };
  }
  if (req.body?.rateLimit) {
    updates.rateLimit = {
      perMinute: Math.max(1, Math.min(1000, Number(req.body.rateLimit.perMinute || 60))),
      batchSize: Math.max(1, Math.min(500, Number(req.body.rateLimit.batchSize || 50))),
    };
  }
  if (req.body?.type || req.body?.audience) {
    updates.audienceFilter = {
      type: req.body.campaignKind || req.body.type || "broadcast",
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

campaignsRouter.post("/:id/action", async (req, res) => {
  if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
    return res.status(404).json({ error: "NOT_FOUND", message: "Campaign not found." });
  }

  const action = String(req.body?.action || "").toLowerCase();
  const campaign = await Campaign.findOne({ _id: req.params.id, workspaceId: req.user.workspaceId }).populate("templateId");
  if (!campaign) return res.status(404).json({ error: "NOT_FOUND", message: "Campaign not found." });

  const history = [...(campaign.history || [])];
  if (action === "submit_approval") {
    campaign.status = "pending_approval";
    campaign.approval = { ...(campaign.approval || {}), required: true, status: "pending", requestedAt: new Date(), requestedBy: req.user.sub };
  } else if (action === "approve") {
    campaign.status = "approved";
    campaign.approval = { ...(campaign.approval || {}), required: true, status: "approved", approvedAt: new Date(), approvedBy: req.user.sub };
    campaign.approvedBy = req.user.sub;
  } else if (action === "reject") {
    campaign.status = "rejected";
    campaign.approval = { ...(campaign.approval || {}), required: true, status: "rejected", rejectedAt: new Date(), rejectedBy: req.user.sub, reason: req.body?.reason || "" };
  } else if (action === "pause") {
    campaign.status = "paused";
    campaign.pausedAt = new Date();
  } else if (action === "resume") {
    campaign.status = campaign.scheduledAt && campaign.scheduledAt > new Date() ? "scheduled" : "queued";
  } else if (action === "cancel") {
    campaign.status = "cancelled";
    campaign.cancelledAt = new Date();
  } else if (action === "retry") {
    const failedRecipients = (campaign.recipients || []).filter((recipient) => recipient.status === "failed");
    campaign.status = failedRecipients.length ? "queued" : campaign.status;
    campaign.queue = {
      ...(campaign.queue || {}),
      queued: failedRecipients.length,
      failed: Math.max(0, Number(campaign.queue?.failed || 0) - failedRecipients.length),
      retries: Number(campaign.queue?.retries || 0) + failedRecipients.length,
    };
    campaign.recipients = (campaign.recipients || []).map((recipient) =>
      recipient.status === "failed"
        ? { ...recipient, status: "queued", error: "", attempts: Number(recipient.attempts || 1) + 1 }
        : recipient
    );
  } else {
    return res.status(400).json({ error: "INVALID_ACTION", message: "Unsupported campaign action." });
  }

  history.push(historyEvent(action, req.user.sub, { status: campaign.status }));
  campaign.history = history;
  await campaign.save();
  res.json({ data: serializeCampaign(campaign) });
});

campaignsRouter.post("/import", async (req, res) => {
  if (mongoose.connection.readyState !== 1) {
    return res.status(503).json({ error: "DATABASE_UNAVAILABLE", message: "MongoDB is required." });
  }

  const rows = Array.isArray(req.body?.contacts) ? req.body.contacts : parseCsvContacts(req.body?.csv || "");
  if (!rows.length) {
    return res.status(400).json({ error: "VALIDATION_ERROR", message: "CSV or contacts are required." });
  }

  let created = 0;
  let updated = 0;
  const failures = [];
  for (const row of rows.slice(0, 5000)) {
    const phone = String(row.phone || "").replace(/[^\d+]/g, "");
    if (!phone) {
      failures.push({ row, error: "Missing phone" });
      continue;
    }
    const existing = await Contact.findOne({ workspaceId: req.user.workspaceId, phone });
    await Contact.findOneAndUpdate(
      { workspaceId: req.user.workspaceId, phone },
      {
        organizationId: req.user.organizationId,
        workspaceId: req.user.workspaceId,
        name: row.name || phone,
        phone,
        email: row.email || undefined,
        source: "Campaign CSV Import",
        lifecycleStatus: row.lifecycleStatus || "lead",
        "customFields.importedFromCampaign": true,
        "customFields.importedAt": new Date(),
      },
      { upsert: true, new: true, setDefaultsOnInsert: true }
    );
    if (existing) updated += 1;
    else created += 1;
  }

  res.status(201).json({ created, updated, failed: failures.length, failures });
});

campaignsRouter.delete("/:id", async (req, res) => {
  if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
    return res.status(404).json({ error: "NOT_FOUND", message: "Campaign not found." });
  }

  const campaign = await Campaign.findOneAndDelete({ _id: req.params.id, workspaceId: req.user.workspaceId });
  if (!campaign) return res.status(404).json({ error: "NOT_FOUND", message: "Campaign not found." });
  res.sendStatus(204);
});
