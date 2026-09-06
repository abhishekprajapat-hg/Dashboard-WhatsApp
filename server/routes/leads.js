import { Router } from "express";
import mongoose from "mongoose";
import { z } from "zod";
import { requirePermission } from "../middleware/auth.js";
import { validateBody, validateQuery } from "../middleware/validate.js";
import { Lead } from "../models/index.js";
import { leadStages } from "../models/Lead.js";
import { normalizeLeadStage } from "../services/crm.js";
import { optionalDateString, optionalObjectIdString, trimmedString } from "../utils/zodHelpers.js";

export const leadsRouter = Router();

export const listLeadsQuerySchema = z.object({
  stage: z.string().trim().toLowerCase().optional().default(""),
  ownerUserId: optionalObjectIdString,
  source: z.string().trim().optional().default(""),
  skip: z.coerce.number().int().min(0).optional().default(0),
  limit: z.coerce.number().int().min(1).max(200).optional().default(50),
});

// Empty string means "clear the deal value" - same convention as optionalObjectIdString's empty
// string meaning "unassign". The literal("") branch MUST come first: z.coerce.number() happily
// coerces "" to 0 (which then passes .min(0)), so if the number branch were tried first, z.union
// would resolve "" to the number 0 and the literal branch would never be reached - "clear" would
// silently become "set to zero" instead.
const dealValueSchema = z.union([z.literal(""), z.coerce.number().min(0, "Deal value must be zero or more.")]).optional();

// At least one field required - an empty patch is a no-op the client shouldn't be sending.
export const patchLeadSchema = z
  .object({
    stage: z.string().optional(),
    ownerUserId: optionalObjectIdString,
    followUpAt: optionalDateString(),
    dealValue: dealValueSchema,
    dealCurrency: z.string().trim().toUpperCase().length(3, "Currency must be a 3-letter code.").optional(),
  })
  .refine(
    (data) =>
      data.stage !== undefined ||
      data.ownerUserId !== undefined ||
      data.followUpAt !== undefined ||
      data.dealValue !== undefined ||
      data.dealCurrency !== undefined,
    { message: "No supported field was provided." }
  );

export const addLeadNoteSchema = z.object({
  text: trimmedString("Note text is required."),
});

export const addLeadInternalCommentSchema = z.object({
  text: trimmedString("Comment text is required."),
});

function serializeLead(lead) {
  const contact = lead.contactId && typeof lead.contactId === "object" ? lead.contactId : null;
  const owner = lead.ownerUserId && typeof lead.ownerUserId === "object" ? lead.ownerUserId : null;

  return {
    id: lead._id.toString(),
    contactId: contact?._id?.toString?.() || lead.contactId?.toString?.() || "",
    contactName: contact?.name || "",
    contactPhone: contact?.phone || "",
    contactEmail: contact?.email || "",
    conversationId: lead.conversationId?.toString?.() || "",
    ownerUserId: owner?._id?.toString?.() || lead.ownerUserId?.toString?.() || "",
    ownerName: owner?.name || "Unassigned",
    stage: lead.stage,
    status: lead.status,
    score: lead.score,
    source: lead.source || "",
    campaign: lead.campaign || "",
    followUpAt: lead.followUpAt || null,
    dealValue: typeof lead.dealValue === "number" ? lead.dealValue : null,
    dealCurrency: lead.dealCurrency || "INR",
    lastActivityAt: lead.lastActivityAt || lead.updatedAt,
    createdAt: lead.createdAt,
    updatedAt: lead.updatedAt,
  };
}

function serializeLeadDetail(lead) {
  return {
    ...serializeLead(lead),
    timeline: Array.isArray(lead.timeline) ? lead.timeline : [],
    internalComments: Array.isArray(lead.internalComments) ? lead.internalComments : [],
    customFields: lead.customFields || {},
  };
}

leadsRouter.get("/", requirePermission("contacts:read"), validateQuery(listLeadsQuerySchema), async (req, res) => {
  if (mongoose.connection.readyState !== 1) {
    return res.json({ data: [], total: 0 });
  }

  const { stage, ownerUserId, source, skip, limit } = req.query;
  const filter = { workspaceId: req.user.workspaceId };

  if (stage && leadStages.includes(stage)) filter.stage = stage;
  if (ownerUserId) filter.ownerUserId = ownerUserId;
  if (source) filter.source = new RegExp(source.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i");

  const [leads, total] = await Promise.all([
    Lead.find(filter)
      .populate("contactId", "name phone email")
      .populate("ownerUserId", "name")
      .sort({ lastActivityAt: -1, createdAt: -1 })
      .skip(skip)
      .limit(limit),
    Lead.countDocuments(filter),
  ]);

  res.json({ data: leads.map(serializeLead), total });
});

leadsRouter.get("/:id", requirePermission("contacts:read"), async (req, res) => {
  if (mongoose.connection.readyState !== 1 || !mongoose.Types.ObjectId.isValid(req.params.id)) {
    return res.status(404).json({ error: "NOT_FOUND", message: "Lead not found." });
  }

  const lead = await Lead.findOne({ _id: req.params.id, workspaceId: req.user.workspaceId })
    .populate("contactId", "name phone email")
    .populate("ownerUserId", "name");

  if (!lead) {
    return res.status(404).json({ error: "NOT_FOUND", message: "Lead not found." });
  }

  res.json({ data: serializeLeadDetail(lead) });
});

leadsRouter.patch("/:id", requirePermission("contacts:write"), validateBody(patchLeadSchema), async (req, res) => {
  if (mongoose.connection.readyState !== 1 || !mongoose.Types.ObjectId.isValid(req.params.id)) {
    return res.status(404).json({ error: "NOT_FOUND", message: "Lead not found." });
  }

  const lead = await Lead.findOne({ _id: req.params.id, workspaceId: req.user.workspaceId });
  if (!lead) {
    return res.status(404).json({ error: "NOT_FOUND", message: "Lead not found." });
  }

  const now = new Date();
  const set = {};
  // Same shape crm.js's ensureConversationInCrm() already pushes into this array, so both a
  // WhatsApp-driven timeline entry and a manual one from this route render consistently.
  const timelineEvents = [];

  if (req.body.stage !== undefined) {
    const nextStage = normalizeLeadStage(req.body.stage);
    if (nextStage !== lead.stage) {
      set.stage = nextStage;
      set.status = ["won", "lost"].includes(nextStage) ? nextStage : "open";
      timelineEvents.push({
        id: `stage:${lead._id}:${now.getTime()}`,
        type: "stage_change",
        title: `Stage changed to ${nextStage.replace(/_/g, " ")}`,
        from: lead.stage,
        to: nextStage,
        at: now,
        source: "manual",
        actorUserId: req.user.sub,
      });
    }
  }

  if (req.body.ownerUserId !== undefined) {
    const nextOwner = req.body.ownerUserId || null;
    if (String(lead.ownerUserId || "") !== String(nextOwner || "")) {
      set.ownerUserId = nextOwner;
      timelineEvents.push({
        id: `owner:${lead._id}:${now.getTime()}`,
        type: "owner_change",
        title: nextOwner ? "Owner reassigned" : "Owner unassigned",
        at: now,
        source: "manual",
        actorUserId: req.user.sub,
      });
    }
  }

  if (req.body.followUpAt !== undefined) {
    const nextFollowUp = req.body.followUpAt ? new Date(req.body.followUpAt) : null;
    set.followUpAt = nextFollowUp;
    timelineEvents.push({
      id: `followup:${lead._id}:${now.getTime()}`,
      type: "follow_up_set",
      // toLocaleDateString(), not toLocaleString() - the client only sends a date-only picker
      // value (parsed as UTC midnight), so a full date+time render would show a spurious
      // timezone-shifted time (e.g. "5:30:00 am") next to a date that's otherwise correct.
      title: nextFollowUp ? `Follow-up set for ${nextFollowUp.toLocaleDateString()}` : "Follow-up cleared",
      at: now,
      source: "manual",
      actorUserId: req.user.sub,
    });
  }

  if (req.body.dealValue !== undefined || req.body.dealCurrency !== undefined) {
    const nextValue = req.body.dealValue === undefined ? lead.dealValue : req.body.dealValue === "" ? null : req.body.dealValue;
    const nextCurrency = req.body.dealCurrency || lead.dealCurrency || "INR";
    if (nextValue !== (lead.dealValue ?? null) || nextCurrency !== (lead.dealCurrency || "INR")) {
      set.dealValue = nextValue;
      set.dealCurrency = nextCurrency;
      timelineEvents.push({
        id: `deal:${lead._id}:${now.getTime()}`,
        type: "deal_updated",
        title: nextValue === null ? "Deal value cleared" : `Deal value set to ${nextCurrency} ${nextValue}`,
        at: now,
        source: "manual",
        actorUserId: req.user.sub,
      });
    }
  }

  if (timelineEvents.length) set.lastActivityAt = now;

  const updated = await Lead.findOneAndUpdate(
    { _id: lead._id, workspaceId: req.user.workspaceId },
    {
      ...(Object.keys(set).length ? { $set: set } : {}),
      ...(timelineEvents.length ? { $push: { timeline: { $each: timelineEvents, $slice: -200 } } } : {}),
    },
    { new: true, runValidators: true }
  )
    .populate("contactId", "name phone email")
    .populate("ownerUserId", "name");

  res.json({ data: serializeLeadDetail(updated) });
});

leadsRouter.post("/:id/notes", requirePermission("contacts:write"), validateBody(addLeadNoteSchema), async (req, res) => {
  if (mongoose.connection.readyState !== 1 || !mongoose.Types.ObjectId.isValid(req.params.id)) {
    return res.status(404).json({ error: "NOT_FOUND", message: "Lead not found." });
  }

  const now = new Date();
  const noteEvent = {
    id: `note:${req.params.id}:${now.getTime()}`,
    type: "note",
    title: "Note added",
    body: req.body.text,
    at: now,
    source: "manual",
    actorUserId: req.user.sub,
  };

  const updated = await Lead.findOneAndUpdate(
    { _id: req.params.id, workspaceId: req.user.workspaceId },
    {
      $set: { lastActivityAt: now },
      $push: { timeline: { $each: [noteEvent], $slice: -200 } },
    },
    { new: true }
  )
    .populate("contactId", "name phone email")
    .populate("ownerUserId", "name");

  if (!updated) {
    return res.status(404).json({ error: "NOT_FOUND", message: "Lead not found." });
  }

  res.json({ data: serializeLeadDetail(updated) });
});

// Deliberately separate from POST /:id/notes and the timeline it writes to - internal comments
// are a private team-only discussion thread (pricing strategy, risk notes) that never mixes into
// the customer-activity/note feed. Doesn't touch lastActivityAt for the same reason: it's not
// customer-facing activity.
leadsRouter.post("/:id/internal-comments", requirePermission("contacts:write"), validateBody(addLeadInternalCommentSchema), async (req, res) => {
  if (mongoose.connection.readyState !== 1 || !mongoose.Types.ObjectId.isValid(req.params.id)) {
    return res.status(404).json({ error: "NOT_FOUND", message: "Lead not found." });
  }

  const now = new Date();
  const comment = {
    id: `comment:${req.params.id}:${now.getTime()}`,
    text: req.body.text,
    at: now,
    actorUserId: req.user.sub,
  };

  const updated = await Lead.findOneAndUpdate(
    { _id: req.params.id, workspaceId: req.user.workspaceId },
    { $push: { internalComments: { $each: [comment], $slice: -200 } } },
    { new: true }
  )
    .populate("contactId", "name phone email")
    .populate("ownerUserId", "name");

  if (!updated) {
    return res.status(404).json({ error: "NOT_FOUND", message: "Lead not found." });
  }

  res.json({ data: serializeLeadDetail(updated) });
});
