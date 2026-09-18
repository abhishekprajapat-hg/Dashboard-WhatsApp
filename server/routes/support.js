import { Router } from "express";
import mongoose from "mongoose";
import { z } from "zod";
import { requireEntitlement, requirePermission } from "../middleware/auth.js";
import { validateBody, validateQuery } from "../middleware/validate.js";
import { Conversation } from "../models/index.js";
import { runAssistantTask } from "../services/aiAssistant.js";
import { messagePreview, relativeTime } from "../utils/serializers.js";
import { objectIdString, optionalObjectIdString } from "../utils/zodHelpers.js";

export const supportRouter = Router();

// Loose, UI-presented suggestions, not a hard enum - see Conversation.js's own comment on why
// supportCategory stays a plain string at the schema level.
export const SUPPORT_CATEGORIES = ["billing", "delivery", "product", "technical", "general", "other"];

export const createTicketSchema = z.object({
  conversationId: objectIdString,
  category: z.string().trim().min(1, "Category is required."),
  assignedToUserId: optionalObjectIdString,
});

export const updateTicketSchema = z
  .object({
    category: z.string().trim().optional(),
    status: z.enum(["open", "pending", "resolved"]).optional(),
    assignedToUserId: optionalObjectIdString,
  })
  .refine((data) => data.category !== undefined || data.status !== undefined || data.assignedToUserId !== undefined, {
    message: "No supported field was provided.",
  });

export const listTicketsQuerySchema = z.object({
  category: z.string().optional(),
  status: z.string().optional(),
  assignedToUserId: optionalObjectIdString,
});

function serializeTicket(conversation) {
  const contact = conversation.contactId || {};
  return {
    id: conversation._id.toString(),
    contactId: contact._id?.toString?.() || "",
    contactName: contact.name || "Unknown contact",
    contactPhone: contact.phone || "",
    category: conversation.supportCategory,
    status: conversation.status,
    assignedToUserId: conversation.assignedToUserId?._id
      ? { id: conversation.assignedToUserId._id.toString(), name: conversation.assignedToUserId.name }
      : null,
    preview: messagePreview(conversation.lastMessageId),
    lastActivity: relativeTime(conversation.lastMessageAt || conversation.updatedAt).replace(" ago", ""),
    createdAt: conversation.createdAt,
    updatedAt: conversation.updatedAt,
  };
}

// Tickets ARE conversations with supportCategory set - not a parallel collection, so listing them
// is just Conversation.find with that one extra filter, reusing the exact same status/assignment
// fields the Inbox already manages (platform master plan, Phase 4).
supportRouter.get("/tickets", requirePermission("inbox:read"), requireEntitlement("support"), validateQuery(listTicketsQuerySchema), async (req, res) => {
  if (mongoose.connection.readyState !== 1) {
    return res.json({ data: [], total: 0 });
  }

  const filter = {
    workspaceId: req.user.workspaceId,
    supportCategory: mongoose.trusted({ $ne: "" }),
  };
  if (req.query.category) filter.supportCategory = req.query.category;
  if (req.query.status) filter.status = req.query.status;
  if (req.query.assignedToUserId) filter.assignedToUserId = req.query.assignedToUserId;

  const tickets = await Conversation.find(filter)
    .populate("contactId", "name phone")
    .populate("assignedToUserId", "name")
    .populate("lastMessageId")
    .sort({ lastMessageAt: -1, updatedAt: -1 })
    .limit(200);

  res.json({ data: tickets.map(serializeTicket), total: tickets.length });
});

// Converts an existing conversation into a tracked ticket by setting its category - does not
// create a new conversation, so this is idempotent-ish by design: calling it again on the same
// conversation just re-categorizes/reassigns it rather than erroring.
supportRouter.post("/tickets", requirePermission("inbox:write"), requireEntitlement("support"), validateBody(createTicketSchema), async (req, res) => {
  if (!mongoose.Types.ObjectId.isValid(req.body.conversationId)) {
    return res.status(404).json({ error: "NOT_FOUND", message: "Conversation not found." });
  }
  const conversation = await Conversation.findOne({ _id: req.body.conversationId, workspaceId: req.user.workspaceId });
  if (!conversation) {
    return res.status(404).json({ error: "NOT_FOUND", message: "Conversation not found." });
  }

  conversation.supportCategory = req.body.category;
  if (req.body.assignedToUserId !== undefined) {
    conversation.assignedToUserId = req.body.assignedToUserId || undefined;
  }
  await conversation.save();
  await conversation.populate("contactId", "name phone");
  await conversation.populate("assignedToUserId", "name");
  await conversation.populate("lastMessageId");

  res.status(201).json({ data: serializeTicket(conversation) });
});

supportRouter.patch("/tickets/:id", requirePermission("inbox:write"), requireEntitlement("support"), validateBody(updateTicketSchema), async (req, res) => {
  if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
    return res.status(404).json({ error: "NOT_FOUND", message: "Ticket not found." });
  }
  const conversation = await Conversation.findOne({
    _id: req.params.id,
    workspaceId: req.user.workspaceId,
    supportCategory: mongoose.trusted({ $ne: "" }),
  });
  if (!conversation) {
    return res.status(404).json({ error: "NOT_FOUND", message: "Ticket not found." });
  }

  if (req.body.category !== undefined) conversation.supportCategory = req.body.category;
  if (req.body.status !== undefined) conversation.status = req.body.status;
  if (req.body.assignedToUserId !== undefined) conversation.assignedToUserId = req.body.assignedToUserId || undefined;
  await conversation.save();
  await conversation.populate("contactId", "name phone");
  await conversation.populate("assignedToUserId", "name");
  await conversation.populate("lastMessageId");

  res.json({ data: serializeTicket(conversation) });
});

// The Support pillar's AI piece (platform master plan, Phase 5) - a ticket IS a Conversation (see
// this file's own header comment), so a reply suggestion for one is exactly the same "draft_reply"
// task the Inbox's own reply-suggest button already calls (InboxView.tsx) - this route exists so
// Support has its own documented endpoint for it, without duplicating runAssistantTask's logic.
// Gated by aiAssistant (not "support") since the AI capability itself, not ticket tracking, is what
// this actually depends on - same precedent as the Documentation pillar's AI drafting.
supportRouter.post("/tickets/:id/suggest-reply", requirePermission("inbox:write"), requireEntitlement("aiAssistant"), async (req, res) => {
  if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
    return res.status(404).json({ error: "NOT_FOUND", message: "Ticket not found." });
  }
  const ticket = await Conversation.findOne({
    _id: req.params.id,
    workspaceId: req.user.workspaceId,
    supportCategory: mongoose.trusted({ $ne: "" }),
  });
  if (!ticket) {
    return res.status(404).json({ error: "NOT_FOUND", message: "Ticket not found." });
  }

  const result = await runAssistantTask({
    workspaceId: req.user.workspaceId,
    conversationId: ticket._id.toString(),
    task: "draft_reply",
  });
  res.json({ data: { reply: result.autoReply || "", provider: result.provider } });
});
