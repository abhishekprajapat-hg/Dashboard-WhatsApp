import { Router } from "express";
import mongoose from "mongoose";
import { z } from "zod";
import { requireApiKey } from "../middleware/apiKeyAuth.js";
import { validateBody } from "../middleware/validate.js";
import { Contact } from "../models/index.js";
import { ensureTags } from "./contacts.js";
import { serializeContact } from "../utils/serializers.js";
import { trimmedString } from "../utils/zodHelpers.js";

// Real inbound surface for a client's own external system (their CRM, billing software, etc.) to
// push data into this app - authenticated with requireApiKey, not requireAuth's JWT, since there's
// no logged-in human on the other end. This is the first real route of its kind in the app; the
// admin "API Keys" panel existed before this but had no auth middleware actually checking anything.
export const publicApiRouter = Router();

export const createLeadSchema = z.object({
  name: trimmedString("Name is required."),
  phone: trimmedString("Phone is required."),
  email: z.string().trim().optional().default(""),
  source: z.string().trim().optional().default(""),
  tags: z.array(z.string()).optional().default([]),
});

// Upsert by phone, not a plain create - an external CRM re-sending the same lead (its own retry,
// or a genuine "this lead's details changed") should update the existing contact, not error on the
// same unique-phone-per-workspace index every other contact-creation path in this app respects.
publicApiRouter.post("/leads", requireApiKey("leads:write"), validateBody(createLeadSchema), async (req, res) => {
  if (mongoose.connection.readyState !== 1) {
    return res.status(503).json({ error: "DATABASE_UNAVAILABLE", message: "MongoDB is required." });
  }

  const { organizationId, workspaceId } = req.apiKeyAuth;
  const { name, phone, email, source, tags } = req.body;
  const normalizedPhone = phone.trim();

  const tagIds = await ensureTags({ organizationId, workspaceId, names: tags });

  const contact = await Contact.findOneAndUpdate(
    { workspaceId, phone: normalizedPhone },
    {
      $setOnInsert: {
        organizationId,
        workspaceId,
        phone: normalizedPhone,
        source: source.trim() || "External API",
        lifecycleStatus: "lead",
      },
      $set: { name: name.trim(), email: email.trim(), lastMessageAt: new Date() },
      ...(tagIds.length ? { $addToSet: { tagIds: { $each: tagIds } } } : {}),
    },
    { upsert: true, new: true, setDefaultsOnInsert: true }
  );

  const hydrated = await Contact.findById(contact._id).populate("tagIds").populate("ownerUserId", "name");
  res.status(201).json({ data: serializeContact(hydrated) });
});
