import { Router } from "express";
import mongoose from "mongoose";
import { z } from "zod";
import { requireEntitlement, requirePermission } from "../middleware/auth.js";
import { validateBody, validateQuery } from "../middleware/validate.js";
import { BusinessDocument, Contact, Organization } from "../models/index.js";
import { draftProposalDocument } from "../services/aiAssistant.js";
import { generateBusinessDocumentPdfBuffer } from "../services/businessDocumentPdf.js";
import { objectIdString, optionalObjectIdString, trimmedString } from "../utils/zodHelpers.js";

export const documentsRouter = Router();

export const draftDocumentSchema = z.object({
  contactId: objectIdString,
  goal: trimmedString("Describe what this proposal is for."),
  notes: z.string().optional().default(""),
  provider: z.enum(["local", "openai", "gemini", "claude"]).optional().default("local"),
});

export const updateDocumentSchema = z.object({
  title: z.string().trim().optional(),
  content: z.string().optional(),
  status: z.enum(["draft", "finalized"]).optional(),
});

export const listDocumentsQuerySchema = z.object({
  contactId: optionalObjectIdString,
  type: z.string().optional(),
});

function serializeDocument(document) {
  return {
    id: document._id.toString(),
    contactId: document.contactId?._id ? document.contactId._id.toString() : document.contactId?.toString(),
    contact: document.contactId?.name
      ? { id: document.contactId._id.toString(), name: document.contactId.name, phone: document.contactId.phone }
      : undefined,
    type: document.type,
    title: document.title,
    content: document.content,
    status: document.status,
    aiProvider: document.aiProvider,
    createdAt: document.createdAt,
    updatedAt: document.updatedAt,
  };
}

documentsRouter.get("/", requirePermission("assistant:read"), validateQuery(listDocumentsQuerySchema), async (req, res) => {
  if (mongoose.connection.readyState !== 1) {
    return res.json({ data: [], total: 0 });
  }
  const filter = { workspaceId: req.user.workspaceId };
  if (req.query.contactId) filter.contactId = req.query.contactId;
  if (req.query.type) filter.type = req.query.type;

  const documents = await BusinessDocument.find(filter).populate("contactId", "name phone").sort({ createdAt: -1 }).limit(200);
  res.json({ data: documents.map(serializeDocument), total: documents.length });
});

documentsRouter.get("/:id", requirePermission("assistant:read"), async (req, res) => {
  if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
    return res.status(404).json({ error: "NOT_FOUND", message: "Document not found." });
  }
  const document = await BusinessDocument.findOne({ _id: req.params.id, workspaceId: req.user.workspaceId }).populate("contactId", "name phone email");
  if (!document) {
    return res.status(404).json({ error: "NOT_FOUND", message: "Document not found." });
  }
  res.json({ data: serializeDocument(document) });
});

documentsRouter.post("/draft", requirePermission("assistant:write"), requireEntitlement("aiAssistant"), validateBody(draftDocumentSchema), async (req, res) => {
  if (mongoose.connection.readyState !== 1) {
    return res.status(503).json({ error: "DATABASE_UNAVAILABLE", message: "MongoDB is required." });
  }

  const contact = await Contact.findOne({ _id: req.body.contactId, workspaceId: req.user.workspaceId });
  if (!contact) {
    return res.status(404).json({ error: "NOT_FOUND", message: "Contact not found." });
  }

  const drafted = await draftProposalDocument({
    workspaceId: req.user.workspaceId,
    contact,
    goal: req.body.goal,
    notes: req.body.notes,
    provider: req.body.provider,
  });

  const document = await BusinessDocument.create({
    organizationId: req.user.organizationId,
    workspaceId: req.user.workspaceId,
    contactId: contact._id,
    type: "proposal",
    title: drafted.title,
    content: drafted.body,
    status: "draft",
    aiProvider: drafted.provider,
    createdByUserId: req.user.sub,
  });

  res.status(201).json({ data: serializeDocument(document) });
});

documentsRouter.patch("/:id", requirePermission("assistant:write"), validateBody(updateDocumentSchema), async (req, res) => {
  if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
    return res.status(404).json({ error: "NOT_FOUND", message: "Document not found." });
  }
  const document = await BusinessDocument.findOne({ _id: req.params.id, workspaceId: req.user.workspaceId });
  if (!document) {
    return res.status(404).json({ error: "NOT_FOUND", message: "Document not found." });
  }

  if (req.body.title !== undefined) document.title = req.body.title;
  // Only relabel when the content actually changed from what's stored - the client always sends
  // `content` on every save (including a plain "Finalize" with no edits), so comparing against the
  // current value (not just checking the field is present) is what keeps a genuinely-unedited
  // AI draft correctly attributed after a status-only save.
  if (req.body.content !== undefined && req.body.content !== document.content) {
    document.content = req.body.content;
    // A hand-edited document no longer reflects what the AI actually produced - relabeling avoids
    // the UI implying a provider generated text the user has since rewritten.
    document.aiProvider = "manual";
  }
  if (req.body.status !== undefined) document.status = req.body.status;
  await document.save();

  res.json({ data: serializeDocument(document) });
});

documentsRouter.get("/:id/pdf", requirePermission("assistant:read"), async (req, res) => {
  if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
    return res.status(404).json({ error: "NOT_FOUND", message: "Document not found." });
  }
  const document = await BusinessDocument.findOne({ _id: req.params.id, workspaceId: req.user.workspaceId }).populate("contactId", "name phone");
  if (!document) {
    return res.status(404).json({ error: "NOT_FOUND", message: "Document not found." });
  }

  const organization = await Organization.findById(req.user.organizationId).select("name");
  const pdfBuffer = await generateBusinessDocumentPdfBuffer(document, {
    issuerName: organization?.name || "",
    contact: document.contactId,
  });

  res.set("Content-Type", "application/pdf");
  res.set("Content-Disposition", `attachment; filename="${document.title.replace(/[^a-z0-9]+/gi, "-").toLowerCase()}.pdf"`);
  res.send(pdfBuffer);
});
