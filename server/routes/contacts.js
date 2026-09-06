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
  stage: z.string().trim().toLowerCase().optional().default(""),
  source: z.string().trim().optional().default(""),
  ownerUserId: optionalObjectIdString,
  tag: optionalObjectIdString,
  skip: z.coerce.number().int().min(0).optional().default(0),
  limit: z.coerce.number().int().min(1).max(200).optional().default(50),
});

export const bulkImportContactsSchema = z.object({
  contacts: z
    .array(
      z.object({
        name: z.string().trim().optional().default(""),
        phone: z.string().trim().optional().default(""),
        email: z.string().trim().optional().default(""),
        tags: z.array(z.string()).optional().default([]),
      })
    )
    .min(1, "At least one row is required.")
    .max(500, "Import is limited to 500 rows at a time."),
});

// Same enum as server/models/Lead.js's leadStages - duplicated here rather than imported since a
// Contact's CRM stage lives in the loosely-typed customFields.crm.stage, not a real Lead
// reference, and this filter only needs the list of values a client could plausibly send.
const CONTACT_STAGES = ["new_lead", "contacted", "qualified", "proposal_sent", "won", "lost"];

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

contactsRouter.get("/filter-options", requirePermission("contacts:read"), async (req, res) => {
  if (mongoose.connection.readyState !== 1) {
    return res.json({ data: { stages: CONTACT_STAGES, sources: [], tags: [] } });
  }

  const workspaceId = req.user.workspaceId;
  const [sources, tags] = await Promise.all([
    Contact.distinct("source", { workspaceId }),
    Tag.find({ workspaceId }).select("name").sort({ name: 1 }),
  ]);

  res.json({
    data: {
      stages: CONTACT_STAGES,
      sources: sources.filter(Boolean).sort(),
      tags: tags.map((tag) => ({ id: tag._id.toString(), name: tag.name })),
    },
  });
});

contactsRouter.get("/", requirePermission("contacts:read"), validateQuery(listContactsQuerySchema), async (req, res) => {
  if (mongoose.connection.readyState === 1 && mongoose.Types.ObjectId.isValid(req.user?.workspaceId)) {
    const workspaceId = req.user.workspaceId;
    const { search, skip, limit } = req.query;
    const lifecycle = String(req.query.lifecycle || "").trim().toLowerCase();
    const stage = String(req.query.stage || "").trim().toLowerCase();
    const source = String(req.query.source || "").trim();
    const { ownerUserId, tag } = req.query;
    const filter = { workspaceId };

    if (["lead", "customer", "active", "inactive"].includes(lifecycle)) {
      filter.lifecycleStatus = lifecycle;
    }

    if (CONTACT_STAGES.includes(stage)) {
      filter["customFields.crm.stage"] = stage;
    }

    if (source) {
      filter.source = source;
    }

    if (ownerUserId) {
      filter.ownerUserId = ownerUserId;
    }

    if (tag) {
      filter.tagIds = tag;
    }

    if (search) {
      filter.$or = [
        { name: new RegExp(search, "i") },
        { phone: new RegExp(search.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i") },
        { email: new RegExp(search, "i") },
      ];
    }

    const [dbContacts, total] = await Promise.all([
      Contact.find(filter)
        .populate("tagIds")
        .populate("ownerUserId", "name")
        .sort({ lastMessageAt: -1, updatedAt: -1 })
        .skip(skip)
        .limit(limit),
      Contact.countDocuments(filter),
    ]);

    const counts = await Conversation.aggregate([
      { $match: { workspaceId: new mongoose.Types.ObjectId(workspaceId) } },
      { $group: { _id: "$contactId", count: { $sum: 1 } } },
    ]);
    const countByContact = new Map(counts.map((item) => [item._id.toString(), item.count]));

    return res.json({
      data: dbContacts.map((contact) =>
        serializeContact(contact, { conversationCount: countByContact.get(contact._id.toString()) || 0 })
      ),
      total,
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

// CSV import - one row at a time (not insertMany) so a single duplicate/invalid row never blocks
// the rest of the batch, and the caller gets a real per-row error list back instead of an
// all-or-nothing failure.
contactsRouter.post("/bulk-import", requirePermission("contacts:write"), validateBody(bulkImportContactsSchema), async (req, res) => {
  if (mongoose.connection.readyState !== 1 || !mongoose.Types.ObjectId.isValid(req.user?.workspaceId)) {
    return res.status(503).json({ error: "DATABASE_UNAVAILABLE", message: "MongoDB is required." });
  }

  const { organizationId, workspaceId } = req.user;
  const results = { created: 0, skipped: 0, errors: [] };

  const existingPhones = new Set(
    (await Contact.find({ workspaceId, phone: mongoose.trusted({ $ne: "" }) }).select("phone")).map((contact) => contact.phone)
  );

  for (const [index, row] of req.body.contacts.entries()) {
    const name = row.name.trim();
    const phone = row.phone.trim();
    const label = name || phone || `row ${index + 1}`;

    if (!name || !phone) {
      results.errors.push({ row: label, message: "Name and phone are both required." });
      continue;
    }

    if (existingPhones.has(phone)) {
      results.skipped += 1;
      continue;
    }

    try {
      const tagIds = await ensureTags({ organizationId, workspaceId, names: row.tags });
      await Contact.create({
        organizationId,
        workspaceId,
        name,
        phone,
        email: row.email.trim(),
        source: "Import",
        lifecycleStatus: "lead",
        tagIds,
        lastMessageAt: new Date(),
      });
      existingPhones.add(phone);
      results.created += 1;
    } catch (error) {
      results.errors.push({ row: label, message: "Could not create this contact (likely a duplicate phone number)." });
    }
  }

  res.status(201).json({ data: results });
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

