import { Router } from "express";
import mongoose from "mongoose";
import { z } from "zod";
import { contacts } from "../data/demoData.js";
import { requirePermission } from "../middleware/auth.js";
import { validateBody, validateQuery } from "../middleware/validate.js";
import { Contact, Conversation, Message, Tag } from "../models/index.js";
import { serializeContact } from "../utils/serializers.js";
import { optionalObjectIdString, trimmedString } from "../utils/zodHelpers.js";

export const contactsRouter = Router();

export const listContactsQuerySchema = z.object({
  search: z.string().trim().optional().default(""),
  lifecycle: z.string().trim().toLowerCase().optional().default(""),
});

export const createContactSchema = z.object({
  name: trimmedString("Name is required."),
  phone: trimmedString("Phone is required."),
  email: z.string().trim().optional().default(""),
  tags: z.array(z.string()).optional().default([]),
});

export const updateContactSchema = createContactSchema.extend({
  status: z.string().optional().default("active"),
});

// Empty string means "unassign" - distinct from omitting the field, which leaves the current
// owner untouched (matches conversations.js's PATCH /:id/assignment convention).
export const assignContactSchema = z.object({
  ownerUserId: optionalObjectIdString.default(""),
});

export async function ensureTags({ organizationId, workspaceId, names }) {
  const tags = [];

  for (const name of names) {
    if (!name?.trim()) continue;
    const tag = await Tag.findOneAndUpdate(
      { workspaceId, name: name.trim() },
      { organizationId, workspaceId, name: name.trim() },
      { upsert: true, new: true, setDefaultsOnInsert: true }
    );
    tags.push(tag._id);
  }

  return tags;
}

contactsRouter.get("/", requirePermission("contacts:read"), validateQuery(listContactsQuerySchema), async (req, res) => {
  if (mongoose.connection.readyState === 1 && mongoose.Types.ObjectId.isValid(req.user?.workspaceId)) {
    const workspaceId = req.user.workspaceId;
    const search = String(req.query.search || "").trim();
    const lifecycle = String(req.query.lifecycle || "").trim().toLowerCase();
    const filter = { workspaceId };

    if (["lead", "customer", "active", "inactive"].includes(lifecycle)) {
      filter.lifecycleStatus = lifecycle;
    }

    if (search) {
      filter.$or = [
        { name: new RegExp(search, "i") },
        { phone: new RegExp(search.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i") },
        { email: new RegExp(search, "i") },
      ];
    }

    const dbContacts = await Contact.find(filter)
      .populate("tagIds")
      .populate("ownerUserId", "name")
      .sort({ lastMessageAt: -1, updatedAt: -1 })
      .limit(100);

    const counts = await Conversation.aggregate([
      { $match: { workspaceId: new mongoose.Types.ObjectId(workspaceId) } },
      { $group: { _id: "$contactId", count: { $sum: 1 } } },
    ]);
    const countByContact = new Map(counts.map((item) => [item._id.toString(), item.count]));

    return res.json({
      data: dbContacts.map((contact) =>
        serializeContact(contact, { conversationCount: countByContact.get(contact._id.toString()) || 0 })
      ),
      total: dbContacts.length,
    });
  }

  const search = String(req.query.search || "").toLowerCase();
  const results = search
    ? contacts.filter((contact) =>
        [contact.name, contact.phone, contact.email].some((value) => value.toLowerCase().includes(search))
      )
    : contacts;

  res.json({ data: results, total: results.length });
});

contactsRouter.post("/", requirePermission("contacts:write"), validateBody(createContactSchema), async (req, res) => {
  const { name, phone, email, tags } = req.body;

  if (mongoose.connection.readyState === 1 && mongoose.Types.ObjectId.isValid(req.user?.workspaceId)) {
    const tagIds = await ensureTags({
      organizationId: req.user.organizationId,
      workspaceId: req.user.workspaceId,
      names: Array.isArray(tags) ? tags : [],
    });

    const contact = await Contact.create({
      organizationId: req.user.organizationId,
      workspaceId: req.user.workspaceId,
      name: name.trim(),
      phone: phone.trim(),
      email: email.trim(),
      source: "Manual",
      lifecycleStatus: "lead",
      tagIds,
      lastMessageAt: new Date(),
    });

    const hydrated = await Contact.findById(contact._id).populate("tagIds").populate("ownerUserId", "name");
    return res.status(201).json({ data: serializeContact(hydrated) });
  }

  const contact = {
    id: `cnt_${Date.now()}`,
    name,
    phone,
    email,
    tags,
    assignedTo: "Unassigned",
    source: "Manual",
    lastActivity: "Just now",
    conversations: 0,
    status: "active",
  };

  contacts.unshift(contact);
  res.status(201).json({ data: contact });
});

contactsRouter.put("/:id", requirePermission("contacts:write"), validateBody(updateContactSchema), async (req, res) => {
  if (mongoose.connection.readyState !== 1 || !mongoose.Types.ObjectId.isValid(req.params.id)) {
    return res.status(404).json({ error: "NOT_FOUND", message: "Contact not found." });
  }

  const { name, phone, email, tags, status } = req.body;

  const tagIds = await ensureTags({
    organizationId: req.user.organizationId,
    workspaceId: req.user.workspaceId,
    names: Array.isArray(tags) ? tags : [],
  });

  const contact = await Contact.findOneAndUpdate(
    { _id: req.params.id, workspaceId: req.user.workspaceId },
    {
      name: name.trim(),
      phone: phone.trim(),
      email: email.trim(),
      tagIds,
      lifecycleStatus: status === "inactive" ? "inactive" : "active",
    },
    { new: true }
  ).populate("tagIds").populate("ownerUserId", "name");

  if (!contact) {
    return res.status(404).json({ error: "NOT_FOUND", message: "Contact not found." });
  }

  res.json({ data: serializeContact(contact) });
});

contactsRouter.patch("/:id/owner", requirePermission("contacts:write"), validateBody(assignContactSchema), async (req, res) => {
  if (mongoose.connection.readyState !== 1 || !mongoose.Types.ObjectId.isValid(req.params.id)) {
    return res.status(404).json({ error: "NOT_FOUND", message: "Contact not found." });
  }

  const contact = await Contact.findOneAndUpdate(
    { _id: req.params.id, workspaceId: req.user.workspaceId },
    { ownerUserId: req.body.ownerUserId || null },
    { new: true }
  ).populate("tagIds").populate("ownerUserId", "name");

  if (!contact) {
    return res.status(404).json({ error: "NOT_FOUND", message: "Contact not found." });
  }

  res.json({ data: serializeContact(contact) });
});

contactsRouter.delete("/:id", requirePermission("contacts:write"), async (req, res) => {
  if (mongoose.connection.readyState !== 1 || !mongoose.Types.ObjectId.isValid(req.params.id)) {
    return res.status(404).json({ error: "NOT_FOUND", message: "Contact not found." });
  }

  const contact = await Contact.findOneAndDelete({ _id: req.params.id, workspaceId: req.user.workspaceId });

  if (!contact) {
    return res.status(404).json({ error: "NOT_FOUND", message: "Contact not found." });
  }

  await Promise.all([
    Conversation.deleteMany({ contactId: contact._id, workspaceId: req.user.workspaceId }),
    Message.deleteMany({ contactId: contact._id, workspaceId: req.user.workspaceId }),
  ]);
  res.sendStatus(204);
});

