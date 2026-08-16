import { Router } from "express";
import mongoose from "mongoose";
import { z } from "zod";
import { requirePermission } from "../middleware/auth.js";
import { validateBody } from "../middleware/validate.js";
import { Campaign, Contact, Conversation, Lead, Message, Tag, Template, WhatsAppAccount } from "../models/index.js";
import { enqueueCampaignRecipients } from "../services/campaignSender.js";
import { optionalDateString, optionalObjectIdString, trimmedString } from "../utils/zodHelpers.js";

export const campaignsRouter = Router();

export const audienceFiltersSchema = z
  .object({
    audienceType: z.string().optional(),
    leadStage: z.string().optional(),
    tags: z.array(z.string()).optional(),
    tagIds: z.array(z.string()).optional(),
    createdFrom: z.string().optional(),
    createdTo: z.string().optional(),
  })
  .passthrough()
  .optional()
  .default({});

// audienceFiltersSchema's .default({}) is safe to reuse here (unlike PATCH /:id, which
// deliberately avoids it - see updateCampaignSchema's comment below) because this handler has no
// "only rebuild the audience if audienceFilters was actually provided" gate; it normalizes the
// audience unconditionally on every call.
export const previewCampaignSchema = z.object({
  audienceFilters: audienceFiltersSchema,
  audienceType: z.string().optional(),
  leadStage: z.string().optional(),
  tags: z.array(z.string()).optional(),
  tagIds: z.array(z.string()).optional(),
  createdFrom: z.string().optional(),
  createdTo: z.string().optional(),
  limit: z.coerce.number().int().positive().optional(),
});

// phone stays optional at the schema level (not required) - the handler already reports a missing
// phone as a per-row failure inside a 201 response body, not a request-level rejection. Requiring
// it here would turn "some rows failed" into "the whole import request is rejected."
const importContactRowSchema = z
  .object({
    name: z.string().optional(),
    phone: z.union([z.string(), z.number()]).optional(),
    email: z.string().optional(),
    lifecycleStatus: z.string().optional(),
  })
  .passthrough();

export const importCampaignContactsSchema = z.object({
  contacts: z.array(importContactRowSchema).optional(),
  csv: z.string().optional(),
});

export const createCampaignSchema = z.object({
  name: trimmedString("Campaign name is required."),
  type: z.enum(["template", "bulk", "scheduled", "recurring", "ab_test"]).optional().default("template"),
  campaignKind: z.string().optional().default("broadcast"),
  audience: z.string().optional().default("All Contacts"),
  audienceType: z.string().optional().default("all"),
  templateId: optionalObjectIdString,
  templateBId: optionalObjectIdString,
  status: z.string().optional().default("draft"),
  scheduledAt: optionalDateString("Scheduled date must be a valid date."),
  recurring: z.boolean().optional().default(false),
  recurrence: z.string().optional().default("none"),
  requireApproval: z.boolean().optional().default(false),
  rateLimit: z.object({
    perMinute: z.coerce.number().positive().optional(),
    batchSize: z.coerce.number().positive().optional(),
  }).optional().default({}),
  abTest: z.object({
    enabled: z.boolean().optional(),
    split: z.coerce.number().optional(),
    winnerMetric: z.string().optional(),
  }).passthrough().optional().default({}),
  audienceFilters: audienceFiltersSchema,
  leadStage: z.string().optional().default(""),
  tags: z.array(z.string()).optional().default([]),
  tagIds: z.array(z.string()).optional().default([]),
  createdFrom: z.string().optional(),
  createdTo: z.string().optional(),
});

export const sendCampaignSchema = z.object({
  limit: z.coerce.number().positive().optional(),
  sendNow: z.boolean().optional().default(false),
});

// Partial-update schema for PATCH /:id - sparse update, every field optional since the
// handler only touches fields that were actually sent.
export const updateCampaignSchema = z.object({
  name: z.string().trim().optional(),
  status: z.string().optional(),
  templateId: optionalObjectIdString,
  scheduledAt: optionalDateString("Scheduled date must be a valid date."),
  schedule: z.record(z.unknown()).optional(),
  rateLimit: z
    .object({
      perMinute: z.coerce.number().positive().optional(),
      batchSize: z.coerce.number().positive().optional(),
    })
    .optional(),
  type: z.string().optional(),
  campaignKind: z.string().optional(),
  audience: z.string().optional(),
  audienceType: z.string().optional(),
  // Deliberately not reusing audienceFiltersSchema here - its `.default({})` would make
  // req.body.audienceFilters always truthy, which would wrongly trigger the audience-rebuild
  // block below on every PATCH even when the caller never touched audience targeting.
  audienceFilters: z
    .object({
      audienceType: z.string().optional(),
      leadStage: z.string().optional(),
      tags: z.array(z.string()).optional(),
      tagIds: z.array(z.string()).optional(),
      createdFrom: z.string().optional(),
      createdTo: z.string().optional(),
    })
    .passthrough()
    .optional(),
  leadStage: z.string().optional(),
  tags: z.array(z.string()).optional(),
  tagIds: z.array(z.string()).optional(),
  createdFrom: z.string().optional(),
  createdTo: z.string().optional(),
});

export const campaignActionSchema = z.object({
  action: z.preprocess(
    (value) => String(value || "").toLowerCase(),
    z.enum(["submit_approval", "approve", "reject", "pause", "resume", "cancel", "retry"], {
      message: "Unsupported campaign action.",
    })
  ),
  reason: z.string().optional(),
});

function serializeCampaign(campaign) {
  const metrics = campaign.metrics || {};
  const queue = campaign.queue || {};
  const approval = campaign.approval || {};
  const filters = campaign.audienceFilters || campaign.audienceFilter || {};
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
    audience: campaign.audienceFilter?.label || getAudienceLabel(filters),
    audienceType: filters.audienceType || campaign.audienceFilter?.audienceType || "all",
    audienceFilters: filters,
    recipients: Number(metrics.recipients || 0),
    sent,
    delivered,
    read,
    replied,
    clicks,
    conversions,
    scheduledAt: campaign.scheduledAt ? campaign.scheduledAt.toLocaleString("en-US", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" }) : undefined,
    sentAt: campaign.sentAt ? campaign.sentAt.toLocaleString("en-US", { month: "short", day: "numeric" }) : undefined,
    template: campaign.templateId?.name || campaign.templateName || "No template",
    templateName: campaign.templateId?.name || campaign.templateName || "",
    language: campaign.templateId?.language || campaign.language || "en",
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
    deliveryResults: campaign.deliveryResults || campaign.recipients || [],
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

function getLegacyAudienceFilter(workspaceId, type = "all") {
  const filter = { workspaceId };
  if (type === "opted_in") filter.optInStatus = "opted_in";
  if (type === "leads") filter.lifecycleStatus = "lead";
  if (type === "customers") filter.lifecycleStatus = "customer";
  if (type === "hot_leads") filter["customFields.crm.leadScore"] = mongoose.trusted({ $gte: 70 });
  if (type === "imported") filter["customFields.importedFromCampaign"] = true;
  return filter;
}

function normalizeAudienceFilters(input = {}) {
  const raw = input && typeof input === "object" ? input : {};
  const audienceType = String(raw.audienceType || raw.type || "all");
  const createdFrom = raw.createdFrom ? new Date(raw.createdFrom) : null;
  const createdTo = raw.createdTo ? new Date(raw.createdTo) : null;
  const tagIds = Array.isArray(raw.tagIds) ? raw.tagIds.filter((id) => mongoose.Types.ObjectId.isValid(id)) : [];
  const tags = Array.isArray(raw.tags) ? raw.tags.map((tag) => String(tag).trim()).filter(Boolean).slice(0, 20) : [];

  return {
    audienceType,
    leadStage: raw.leadStage ? String(raw.leadStage) : "",
    tagIds,
    tags,
    createdFrom: createdFrom && !Number.isNaN(createdFrom.getTime()) ? createdFrom : null,
    createdTo: createdTo && !Number.isNaN(createdTo.getTime()) ? createdTo : null,
  };
}

function serializeAudienceFilters(filters = {}) {
  return {
    audienceType: filters.audienceType || "all",
    leadStage: filters.leadStage || "",
    tagIds: filters.tagIds || [],
    tags: filters.tags || [],
    createdFrom: filters.createdFrom ? new Date(filters.createdFrom).toISOString() : "",
    createdTo: filters.createdTo ? new Date(filters.createdTo).toISOString() : "",
  };
}

async function buildAudienceQuery(workspaceId, filters = {}) {
  const normalized = normalizeAudienceFilters(filters);
  const query = getLegacyAudienceFilter(workspaceId, normalized.audienceType);

  if (normalized.leadStage) {
    const leadContactIds = await Lead.distinct("contactId", {
      workspaceId,
      stage: normalized.leadStage,
      status: mongoose.trusted({ $ne: "archived" }),
    });
    query._id = mongoose.trusted({ $in: leadContactIds });
  }

  const tagObjectIds = [...normalized.tagIds];
  if (normalized.tags.length) {
    const tagDocs = await Tag.find({
      workspaceId,
      name: mongoose.trusted({ $in: normalized.tags }),
    }).select("_id");
    tagObjectIds.push(...tagDocs.map((tag) => tag._id));
  }
  if (tagObjectIds.length) query.tagIds = mongoose.trusted({ $in: tagObjectIds });

  if (normalized.createdFrom || normalized.createdTo) {
    const range = {};
    if (normalized.createdFrom) range.$gte = normalized.createdFrom;
    if (normalized.createdTo) range.$lte = normalized.createdTo;
    query.createdAt = mongoose.trusted(range);
  }

  return query;
}

function getAudienceLabel(filters = "all") {
  const type = typeof filters === "string" ? filters : filters.audienceType || "all";
  const labels = {
    all: "All Contacts",
    opted_in: "Opted-in Contacts",
    leads: "Leads",
    customers: "Customers",
    hot_leads: "Hot Leads",
    imported: "Imported Contacts",
  };
  const parts = [labels[type] || "All Contacts"];
  if (typeof filters === "object" && filters.leadStage) parts.push(`stage ${String(filters.leadStage).replace(/_/g, " ")}`);
  if (typeof filters === "object" && (filters.tags?.length || filters.tagIds?.length)) parts.push("tagged contacts");
  if (typeof filters === "object" && (filters.createdFrom || filters.createdTo)) parts.push("date filtered");
  return parts.join(" - ");
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
  const audienceFilters = normalizeAudienceFilters(typeof audienceType === "object" ? audienceType : { audienceType });
  const audienceQuery = await buildAudienceQuery(workspaceId, audienceFilters);
  const [account, template, recipients] = await Promise.all([
    WhatsAppAccount.findOne({ workspaceId, status: "connected" }).sort({ createdAt: -1 }),
    Template.findOne({ workspaceId, status: "approved" }).sort({ name: 1 }),
    Contact.countDocuments(audienceQuery),
  ]);

  return { account, template, recipients };
}

async function previewAudience(workspaceId, filters = {}, limit = 10) {
  const query = await buildAudienceQuery(workspaceId, filters);
  const [count, contacts] = await Promise.all([
    Contact.countDocuments(query),
    Contact.find(query).sort({ createdAt: -1 }).limit(Math.max(1, Math.min(25, Number(limit || 10)))),
  ]);

  return {
    count,
    sample: contacts.map((contact) => ({
      id: contact._id.toString(),
      name: contact.name,
      phone: contact.phone,
      email: contact.email || "",
      lifecycleStatus: contact.lifecycleStatus || "",
      createdAt: contact.createdAt,
    })),
  };
}

campaignsRouter.get("/", requirePermission("campaigns:read"), async (req, res) => {
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

campaignsRouter.post("/preview", requirePermission("campaigns:read"), validateBody(previewCampaignSchema), async (req, res) => {
  if (mongoose.connection.readyState !== 1) {
    return res.status(503).json({ error: "DATABASE_UNAVAILABLE", message: "MongoDB is required." });
  }

  const filters = normalizeAudienceFilters({
    ...(req.body?.audienceFilters || {}),
    audienceType: req.body?.audienceType || req.body?.audienceFilters?.audienceType || "all",
    leadStage: req.body?.leadStage || req.body?.audienceFilters?.leadStage,
    tags: req.body?.tags || req.body?.audienceFilters?.tags,
    tagIds: req.body?.tagIds || req.body?.audienceFilters?.tagIds,
    createdFrom: req.body?.createdFrom || req.body?.audienceFilters?.createdFrom,
    createdTo: req.body?.createdTo || req.body?.audienceFilters?.createdTo,
  });
  const preview = await previewAudience(req.user.workspaceId, filters, req.body?.limit || 10);
  res.json({ data: { ...preview, label: getAudienceLabel(filters), filters: serializeAudienceFilters(filters) } });
});

campaignsRouter.get("/:id", requirePermission("campaigns:read"), async (req, res) => {
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

campaignsRouter.post("/", requirePermission("campaigns:write"), validateBody(createCampaignSchema), async (req, res) => {
  if (mongoose.connection.readyState !== 1) {
    return res.status(503).json({ error: "DATABASE_UNAVAILABLE", message: "MongoDB is required." });
  }

  const {
    name,
    type,
    campaignKind,
    audience,
    audienceType,
    templateId,
    templateBId,
    status,
    scheduledAt,
    recurring,
    recurrence,
    requireApproval,
    rateLimit,
    abTest,
    audienceFilters: rawAudienceFilters,
    leadStage,
    tags,
    tagIds,
    createdFrom,
    createdTo,
  } = req.body;

  const audienceFilters = normalizeAudienceFilters({
    ...rawAudienceFilters,
    audienceType: rawAudienceFilters.audienceType || audienceType,
    leadStage: rawAudienceFilters.leadStage || leadStage,
    tags: rawAudienceFilters.tags || tags,
    tagIds: rawAudienceFilters.tagIds || tagIds,
    createdFrom: rawAudienceFilters.createdFrom || createdFrom,
    createdTo: rawAudienceFilters.createdTo || createdTo,
  });
  const { account, template: defaultTemplate, recipients } = await getCampaignDefaults(req.user.workspaceId, audienceFilters);
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
    templateName: template.name,
    language: template.language || "en",
    templateIds: [template._id, ...(templateBId && mongoose.Types.ObjectId.isValid(templateBId) ? [templateBId] : [])],
    type,
    audienceFilter: { type: campaignKind, label: audience || getAudienceLabel(audienceFilters), audienceType: audienceFilters.audienceType },
    audienceFilters: serializeAudienceFilters(audienceFilters),
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

campaignsRouter.post("/:id/send", requirePermission("campaigns:write"), validateBody(sendCampaignSchema), async (req, res) => {
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

  const audienceFilters = normalizeAudienceFilters(campaign.audienceFilters || { audienceType: campaign.audienceFilter?.audienceType || "all" });
  const audienceQuery = await buildAudienceQuery(req.user.workspaceId, audienceFilters);
  const contacts = await Contact.find(audienceQuery)
    .sort({ createdAt: -1 })
    .limit(Math.max(1, Math.min(5000, Number(req.body?.limit || 1000))));

  if (campaign.scheduledAt && campaign.scheduledAt > new Date() && !req.body?.sendNow) {
    campaign.status = "scheduled";
    campaign.metrics = { ...(campaign.metrics || {}), recipients: contacts.length };
    campaign.queue = { ...(campaign.queue || {}), queued: contacts.length, processing: 0 };
    campaign.history = [...(campaign.history || []), historyEvent("scheduled", req.user.sub, { recipients: contacts.length, scheduledAt: campaign.scheduledAt })];
    await campaign.save();
    await campaign.populate("templateId");
    return res.json({ data: serializeCampaign(campaign), recipients: [] });
  }

  campaign.recipients = contacts.map((contact) => ({
    contactId: contact._id,
    name: contact.name,
    phone: contact.phone,
    status: "queued",
    variant: "A",
    attempts: 0,
  }));
  campaign.deliveryResults = [];
  campaign.metrics = { ...(campaign.metrics || {}), recipients: contacts.length, sent: 0, delivered: 0, read: 0, replied: 0, clicks: 0, conversions: 0, failed: 0 };
  campaign.queue = { queued: contacts.length, processing: 0, completed: 0, failed: 0, retries: Number(campaign.queue?.retries || 0) };
  campaign.status = contacts.length ? "sending" : "sent";
  campaign.sentAt = contacts.length ? undefined : new Date();
  campaign.history = [...(campaign.history || []), historyEvent(contacts.length ? "send_queued" : "send_completed", req.user.sub, { recipients: contacts.length })];
  await campaign.save();

  let queueMode = "n/a";
  if (contacts.length) {
    try {
      const result = await enqueueCampaignRecipients(campaign, contacts, { userId: req.user.sub });
      queueMode = result.mode;
    } catch (error) {
      await Campaign.updateOne(
        { _id: campaign._id },
        {
          $set: { status: "failed" },
          $push: { history: historyEvent("send_failed", req.user.sub, { error: error.message }) },
        }
      );
      throw error;
    }
  }

  const finalCampaign = await Campaign.findById(campaign._id).populate("templateId");
  res.json({
    data: serializeCampaign(finalCampaign),
    recipients: (finalCampaign.recipients || []).map(serializeRecipient),
    queueMode,
  });
});

campaignsRouter.patch("/:id", requirePermission("campaigns:write"), validateBody(updateCampaignSchema), async (req, res) => {
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
  if (req.body?.type || req.body?.audience || req.body?.audienceFilters || req.body?.leadStage || req.body?.tags || req.body?.tagIds || req.body?.createdFrom || req.body?.createdTo) {
    const filters = normalizeAudienceFilters({
      ...(req.body.audienceFilters || {}),
      audienceType: req.body.audienceType || req.body.audienceFilters?.audienceType || "all",
      leadStage: req.body.leadStage || req.body.audienceFilters?.leadStage,
      tags: req.body.tags || req.body.audienceFilters?.tags,
      tagIds: req.body.tagIds || req.body.audienceFilters?.tagIds,
      createdFrom: req.body.createdFrom || req.body.audienceFilters?.createdFrom,
      createdTo: req.body.createdTo || req.body.audienceFilters?.createdTo,
    });
    updates.audienceFilter = {
      type: req.body.campaignKind || req.body.type || "broadcast",
      label: req.body.audience || getAudienceLabel(filters),
      audienceType: filters.audienceType || "all",
    };
    updates.audienceFilters = serializeAudienceFilters(filters);
  }

  const campaign = await Campaign.findOneAndUpdate(
    { _id: req.params.id, workspaceId: req.user.workspaceId },
    updates,
    { new: true }
  ).populate("templateId");

  if (!campaign) return res.status(404).json({ error: "NOT_FOUND", message: "Campaign not found." });
  res.json({ data: serializeCampaign(campaign) });
});

campaignsRouter.post("/:id/action", requirePermission("campaigns:write"), validateBody(campaignActionSchema), async (req, res) => {
  if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
    return res.status(404).json({ error: "NOT_FOUND", message: "Campaign not found." });
  }

  const action = req.body.action;
  const campaign = await Campaign.findOne({ _id: req.params.id, workspaceId: req.user.workspaceId }).populate("templateId");
  if (!campaign) return res.status(404).json({ error: "NOT_FOUND", message: "Campaign not found." });

  const history = [...(campaign.history || [])];
  let contactsToEnqueue = [];
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
    campaign.recipients = (campaign.recipients || []).map((recipient) =>
      recipient.status === "queued" ? { ...recipient, status: "paused" } : recipient
    );
  } else if (action === "resume") {
    const pausedRecipients = (campaign.recipients || []).filter((recipient) => recipient.status === "paused");
    if (pausedRecipients.length) {
      campaign.status = "sending";
      campaign.recipients = (campaign.recipients || []).map((recipient) =>
        recipient.status === "paused" ? { ...recipient, status: "queued" } : recipient
      );
      contactsToEnqueue = pausedRecipients.map((recipient) => recipient.contactId);
    } else {
      campaign.status = campaign.scheduledAt && campaign.scheduledAt > new Date() ? "scheduled" : "queued";
    }
  } else if (action === "cancel") {
    campaign.status = "cancelled";
    campaign.cancelledAt = new Date();
    campaign.recipients = (campaign.recipients || []).map((recipient) =>
      ["queued", "paused"].includes(recipient.status) ? { ...recipient, status: "cancelled" } : recipient
    );
    campaign.queue = { ...(campaign.queue || {}), queued: 0 };
  } else if (action === "retry") {
    const failedRecipients = (campaign.recipients || []).filter((recipient) => recipient.status === "failed");
    campaign.status = failedRecipients.length ? "sending" : campaign.status;
    campaign.queue = {
      ...(campaign.queue || {}),
      queued: Number(campaign.queue?.queued || 0) + failedRecipients.length,
      failed: Math.max(0, Number(campaign.queue?.failed || 0) - failedRecipients.length),
      retries: Number(campaign.queue?.retries || 0) + failedRecipients.length,
    };
    campaign.recipients = (campaign.recipients || []).map((recipient) =>
      recipient.status === "failed"
        ? { ...recipient, status: "queued", error: "", attempts: Number(recipient.attempts || 1) }
        : recipient
    );
    contactsToEnqueue = failedRecipients.map((recipient) => recipient.contactId);
  } else {
    return res.status(400).json({ error: "INVALID_ACTION", message: "Unsupported campaign action." });
  }

  history.push(historyEvent(action, req.user.sub, { status: campaign.status }));
  campaign.history = history;
  await campaign.save();

  if (contactsToEnqueue.length) {
    const pendingContacts = await Contact.find({ _id: mongoose.trusted({ $in: contactsToEnqueue }), workspaceId: req.user.workspaceId });
    await enqueueCampaignRecipients(campaign, pendingContacts, { userId: req.user.sub });
  }

  await campaign.populate("templateId");
  res.json({ data: serializeCampaign(campaign) });
});

campaignsRouter.post("/import", requirePermission("campaigns:write"), validateBody(importCampaignContactsSchema), async (req, res) => {
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

campaignsRouter.delete("/:id", requirePermission("campaigns:write"), async (req, res) => {
  if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
    return res.status(404).json({ error: "NOT_FOUND", message: "Campaign not found." });
  }

  const campaign = await Campaign.findOneAndDelete({ _id: req.params.id, workspaceId: req.user.workspaceId });
  if (!campaign) return res.status(404).json({ error: "NOT_FOUND", message: "Campaign not found." });
  res.sendStatus(204);
});
