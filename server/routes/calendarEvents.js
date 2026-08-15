import { Router } from "express";
import mongoose from "mongoose";
import { z } from "zod";
import { requirePermission } from "../middleware/auth.js";
import { validateBody, validateQuery } from "../middleware/validate.js";
import { CalendarEvent } from "../models/index.js";
import { optionalDateString, optionalObjectIdString, requiredDateString, trimmedString } from "../utils/zodHelpers.js";

export const calendarEventsRouter = Router();

export const listEventsQuerySchema = z.object({
  from: optionalDateString(),
  to: optionalDateString(),
  assignedToUserId: optionalObjectIdString,
});

export const eventBodySchema = z.object({
  title: trimmedString("Title is required."),
  description: z.string().optional().default(""),
  startAt: requiredDateString("A valid start date/time is required."),
  endAt: optionalDateString(),
  assignedToUserId: optionalObjectIdString,
  contactId: optionalObjectIdString,
  conversationId: optionalObjectIdString,
});

export const patchEventSchema = eventBodySchema.partial();

function serializeEvent(event) {
  return {
    id: event._id.toString(),
    title: event.title,
    description: event.description || "",
    startAt: event.startAt,
    endAt: event.endAt,
    assignedToUserId: event.assignedToUserId?._id
      ? { id: event.assignedToUserId._id.toString(), name: event.assignedToUserId.name }
      : null,
    contactId: event.contactId ? event.contactId.toString() : null,
    conversationId: event.conversationId ? event.conversationId.toString() : null,
    source: event.source || "manual",
    createdAt: event.createdAt,
    updatedAt: event.updatedAt,
  };
}

calendarEventsRouter.get("/", requirePermission("tasks:read"), validateQuery(listEventsQuerySchema), async (req, res) => {
  if (mongoose.connection.readyState !== 1) {
    return res.json({ data: [], total: 0 });
  }

  const filter = { workspaceId: req.user.workspaceId };
  if (req.query.assignedToUserId) filter.assignedToUserId = req.query.assignedToUserId;

  // An event overlaps [from, to] if it starts on/before `to` and its effective end (endAt, or
  // startAt when there's no endAt) lands on/after `from` - this also picks up events that started
  // before the grid's visible range but still run into it.
  if (req.query.to) filter.startAt = mongoose.trusted({ $lte: new Date(req.query.to) });

  const events = await CalendarEvent.find(filter)
    .populate("assignedToUserId", "name")
    .sort({ startAt: 1 });

  const from = req.query.from ? new Date(req.query.from) : null;
  const filtered = from
    ? events.filter((event) => (event.endAt || event.startAt) >= from)
    : events;

  res.json({ data: filtered.map(serializeEvent), total: filtered.length });
});

calendarEventsRouter.post("/", requirePermission("tasks:write"), validateBody(eventBodySchema), async (req, res) => {
  if (mongoose.connection.readyState !== 1) {
    return res.status(503).json({ error: "DATABASE_UNAVAILABLE", message: "MongoDB is required." });
  }

  const event = await CalendarEvent.create({
    organizationId: req.user.organizationId,
    workspaceId: req.user.workspaceId,
    title: req.body.title,
    description: req.body.description,
    startAt: req.body.startAt,
    endAt: req.body.endAt || null,
    assignedToUserId: req.body.assignedToUserId || null,
    contactId: req.body.contactId || null,
    conversationId: req.body.conversationId || null,
    source: "manual",
  });

  await event.populate("assignedToUserId", "name");
  res.status(201).json({ data: serializeEvent(event) });
});

calendarEventsRouter.patch("/:id", requirePermission("tasks:write"), validateBody(patchEventSchema), async (req, res) => {
  if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
    return res.status(404).json({ error: "NOT_FOUND", message: "Calendar event not found." });
  }

  const event = await CalendarEvent.findOne({ _id: req.params.id, workspaceId: req.user.workspaceId });
  if (!event) return res.status(404).json({ error: "NOT_FOUND", message: "Calendar event not found." });

  const nullableFields = ["endAt", "assignedToUserId", "contactId", "conversationId"];
  for (const field of nullableFields) {
    if (req.body[field] === undefined) continue;
    event[field] = req.body[field] || null;
  }

  if (req.body.title !== undefined) event.title = req.body.title;
  if (req.body.description !== undefined) event.description = req.body.description;
  if (req.body.startAt !== undefined) event.startAt = req.body.startAt;

  await event.save();
  await event.populate("assignedToUserId", "name");
  res.json({ data: serializeEvent(event) });
});

calendarEventsRouter.delete("/:id", requirePermission("tasks:write"), async (req, res) => {
  if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
    return res.status(404).json({ error: "NOT_FOUND", message: "Calendar event not found." });
  }

  const event = await CalendarEvent.findOneAndDelete({ _id: req.params.id, workspaceId: req.user.workspaceId });
  if (!event) return res.status(404).json({ error: "NOT_FOUND", message: "Calendar event not found." });
  res.sendStatus(204);
});
