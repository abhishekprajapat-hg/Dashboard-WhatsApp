import { Router } from "express";
import mongoose from "mongoose";
import { requirePermission } from "../middleware/auth.js";
import { Template, WhatsAppAccount } from "../models/index.js";
import { fetchWhatsAppTemplates } from "../services/whatsappProvider.js";

export const templatesRouter = Router();

const templateTypes = ["whatsapp", "quick_reply", "automation", "campaign", "follow_up", "lead_stage"];
const categories = ["marketing", "utility", "support", "sales", "payment", "appointment", "general"];
const statuses = ["draft", "active", "archived", "approved", "pending", "rejected"];

function slugify(value = "") {
  return String(value || "template")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80) || "template";
}

function normalizeCategory(value = "general") {
  const raw = String(value || "general").trim();
  const lower = raw.toLowerCase();
  return categories.includes(lower) ? lower : raw;
}

function extractBody(template) {
  if (template.body) return template.body;
  const bodyComponent = (template.components || []).find((component) => String(component?.type || "").toUpperCase() === "BODY");
  return bodyComponent?.text || "";
}

function extractVariables(body = "") {
  const matches = [...String(body || "").matchAll(/\{\{\s*([a-zA-Z0-9_.-]+)\s*\}\}/g)];
  return [...new Set(matches.map((match) => match[1]))];
}

function serializeTemplate(template) {
  return {
    id: template._id.toString(),
    organizationId: template.organizationId?.toString?.() || "",
    workspaceId: template.workspaceId?.toString?.() || "",
    name: template.name,
    slug: template.slug || "",
    type: template.type || "whatsapp",
    category: normalizeCategory(template.category),
    language: template.language || "en",
    body: extractBody(template),
    variables: template.variables || extractVariables(extractBody(template)),
    status: template.status,
    providerTemplateId: template.providerTemplateId || "",
    whatsappAccountId: template.whatsappAccountId?.toString?.() || "",
    usageCount: Number(template.usageCount || 0),
    lastUsedAt: template.lastUsedAt,
    createdAt: template.createdAt,
    updatedAt: template.updatedAt,
  };
}

async function uniqueSlug(workspaceId, name, excludeId) {
  const base = slugify(name);
  let candidate = base;
  let index = 2;
  while (await Template.exists({ workspaceId, slug: candidate, ...(excludeId ? { _id: { $ne: excludeId } } : {}) })) {
    candidate = `${base}-${index}`;
    index += 1;
  }
  return candidate;
}

function cleanPayload(body = {}) {
  const type = templateTypes.includes(body.type) ? body.type : "quick_reply";
  const status = statuses.includes(body.status) ? body.status : type === "whatsapp" ? "pending" : "draft";
  const text = String(body.body || "").trim();
  const variables = Array.isArray(body.variables) && body.variables.length
    ? body.variables.map((item) => String(item).trim()).filter(Boolean)
    : extractVariables(text);

  return {
    name: String(body.name || "").trim(),
    type,
    category: normalizeCategory(body.category),
    language: String(body.language || "en").trim() || "en",
    body: text,
    variables,
    status,
    providerTemplateId: String(body.providerTemplateId || "").trim(),
    whatsappAccountId: mongoose.Types.ObjectId.isValid(body.whatsappAccountId) ? body.whatsappAccountId : undefined,
  };
}

function renderPreview(body = "", variables = {}) {
  return String(body || "").replace(/\{\{\s*([a-zA-Z0-9_.-]+)\s*\}\}/g, (_match, key) => {
    const value = variables[key] ?? variables[String(key).toLowerCase()] ?? "";
    return value === "" ? `{{${key}}}` : String(value);
  });
}

templatesRouter.get("/", requirePermission("templates:read"), async (req, res) => {
  if (mongoose.connection.readyState !== 1) {
    return res.json({ data: [], total: 0 });
  }

  const filter = { workspaceId: req.user.workspaceId };
  if (req.query.type && req.query.type !== "all") filter.type = req.query.type;
  if (req.query.status && req.query.status !== "all") filter.status = req.query.status;
  if (req.query.category && req.query.category !== "all") filter.category = req.query.category;
  if (req.query.language && req.query.language !== "all") filter.language = req.query.language;
  if (req.query.search) {
    const search = String(req.query.search).trim();
    filter.$or = [
      { name: { $regex: search, $options: "i" } },
      { slug: { $regex: search, $options: "i" } },
      { body: { $regex: search, $options: "i" } },
    ];
  }

  const templates = await Template.find(filter).sort({ type: 1, status: 1, updatedAt: -1 }).limit(250);
  res.json({ data: templates.map(serializeTemplate), total: templates.length });
});

templatesRouter.post("/", requirePermission("templates:write"), async (req, res) => {
  if (mongoose.connection.readyState !== 1) {
    return res.status(503).json({ error: "DATABASE_UNAVAILABLE", message: "MongoDB is required." });
  }

  const payload = cleanPayload(req.body || {});
  if (!payload.name) return res.status(400).json({ error: "VALIDATION_ERROR", message: "Template name is required." });
  if (!payload.body && payload.type !== "whatsapp") return res.status(400).json({ error: "VALIDATION_ERROR", message: "Template body is required." });

  const template = await Template.create({
    organizationId: req.user.organizationId,
    workspaceId: req.user.workspaceId,
    ...payload,
    slug: await uniqueSlug(req.user.workspaceId, payload.name),
    status: payload.type === "whatsapp" && !payload.providerTemplateId ? "pending" : payload.status,
    createdBy: req.user.sub,
    updatedBy: req.user.sub,
  });

  res.status(201).json({ data: serializeTemplate(template) });
});

templatesRouter.post("/preview", requirePermission("templates:read"), async (req, res) => {
  const body = String(req.body?.body || "");
  const variables = req.body?.variables && typeof req.body.variables === "object" ? req.body.variables : {};
  res.json({ data: { body, variables: extractVariables(body), preview: renderPreview(body, variables) } });
});

templatesRouter.post("/sync-whatsapp", requirePermission("templates:write"), async (req, res) => {
  if (mongoose.connection.readyState !== 1) {
    return res.status(503).json({ error: "DATABASE_UNAVAILABLE", message: "MongoDB is required." });
  }

  const accountFilter = { workspaceId: req.user.workspaceId, status: { $in: ["connected", "needs_attention"] } };
  if (req.body?.accountId && mongoose.Types.ObjectId.isValid(req.body.accountId)) accountFilter._id = req.body.accountId;
  const accounts = await WhatsAppAccount.find(accountFilter);
  let synced = 0;

  for (const account of accounts) {
    const providerTemplates = await fetchWhatsAppTemplates(account);
    for (const item of providerTemplates) {
      const body = item.body || (item.components || []).find((component) => String(component?.type || "").toUpperCase() === "BODY")?.text || "";
      const existing = await Template.findOne({
        workspaceId: req.user.workspaceId,
        whatsappAccountId: account._id,
        name: item.name,
        language: item.language || "en",
      }).select("_id slug");
      await Template.findOneAndUpdate(
        {
          workspaceId: req.user.workspaceId,
          whatsappAccountId: account._id,
          name: item.name,
          language: item.language || "en",
        },
        {
          organizationId: req.user.organizationId,
          workspaceId: req.user.workspaceId,
          whatsappAccountId: account._id,
          providerTemplateId: item.providerTemplateId || item.id || item.name,
          name: item.name,
          slug: existing?.slug || await uniqueSlug(req.user.workspaceId, item.name, existing?._id),
          type: "whatsapp",
          category: normalizeCategory(item.category || "utility"),
          language: item.language || "en",
          body,
          variables: extractVariables(body),
          components: item.components || [],
          status: String(item.status || "pending").toLowerCase(),
          lastSyncedAt: new Date(),
          ...(!existing?._id ? { createdBy: req.user.sub } : {}),
          updatedBy: req.user.sub,
        },
        { upsert: true, new: true, setDefaultsOnInsert: true }
      );
      synced += 1;
    }
    account.templateSyncStatus = "synced";
    account.lastSyncedAt = new Date();
    await account.save();
  }

  res.json({ synced, accounts: accounts.length });
});

templatesRouter.get("/:id", requirePermission("templates:read"), async (req, res) => {
  if (!mongoose.Types.ObjectId.isValid(req.params.id)) return res.status(404).json({ error: "NOT_FOUND", message: "Template not found." });
  const template = await Template.findOne({ _id: req.params.id, workspaceId: req.user.workspaceId });
  if (!template) return res.status(404).json({ error: "NOT_FOUND", message: "Template not found." });
  res.json({ data: serializeTemplate(template) });
});

templatesRouter.patch("/:id", requirePermission("templates:write"), async (req, res) => {
  if (!mongoose.Types.ObjectId.isValid(req.params.id)) return res.status(404).json({ error: "NOT_FOUND", message: "Template not found." });
  const existing = await Template.findOne({ _id: req.params.id, workspaceId: req.user.workspaceId });
  if (!existing) return res.status(404).json({ error: "NOT_FOUND", message: "Template not found." });

  const payload = cleanPayload({ ...existing.toObject(), ...(req.body || {}) });
  if (!payload.name) return res.status(400).json({ error: "VALIDATION_ERROR", message: "Template name is required." });
  existing.set({
    ...payload,
    slug: req.body?.name && req.body.name !== existing.name ? await uniqueSlug(req.user.workspaceId, payload.name, existing._id) : existing.slug || await uniqueSlug(req.user.workspaceId, payload.name, existing._id),
    updatedBy: req.user.sub,
  });
  await existing.save();
  res.json({ data: serializeTemplate(existing) });
});

templatesRouter.delete("/:id", requirePermission("templates:write"), async (req, res) => {
  if (!mongoose.Types.ObjectId.isValid(req.params.id)) return res.status(404).json({ error: "NOT_FOUND", message: "Template not found." });
  const template = await Template.findOneAndUpdate(
    { _id: req.params.id, workspaceId: req.user.workspaceId },
    { status: "archived", updatedBy: req.user.sub },
    { new: true }
  );
  if (!template) return res.status(404).json({ error: "NOT_FOUND", message: "Template not found." });
  res.json({ data: serializeTemplate(template) });
});

templatesRouter.post("/:id/duplicate", requirePermission("templates:write"), async (req, res) => {
  if (!mongoose.Types.ObjectId.isValid(req.params.id)) return res.status(404).json({ error: "NOT_FOUND", message: "Template not found." });
  const source = await Template.findOne({ _id: req.params.id, workspaceId: req.user.workspaceId });
  if (!source) return res.status(404).json({ error: "NOT_FOUND", message: "Template not found." });
  const name = `${source.name} Copy`;
  const copy = await Template.create({
    organizationId: req.user.organizationId,
    workspaceId: req.user.workspaceId,
    name,
    slug: await uniqueSlug(req.user.workspaceId, name),
    type: source.type === "whatsapp" ? "quick_reply" : source.type,
    category: normalizeCategory(source.category),
    language: source.language,
    body: extractBody(source),
    variables: source.variables || extractVariables(extractBody(source)),
    status: source.type === "whatsapp" ? "draft" : source.status === "archived" ? "draft" : source.status,
    createdBy: req.user.sub,
    updatedBy: req.user.sub,
  });
  res.status(201).json({ data: serializeTemplate(copy) });
});

templatesRouter.post("/:id/use", requirePermission("templates:read"), async (req, res) => {
  if (!mongoose.Types.ObjectId.isValid(req.params.id)) return res.status(404).json({ error: "NOT_FOUND", message: "Template not found." });
  const template = await Template.findOneAndUpdate(
    { _id: req.params.id, workspaceId: req.user.workspaceId },
    { $inc: { usageCount: 1 }, lastUsedAt: new Date() },
    { new: true }
  );
  if (!template) return res.status(404).json({ error: "NOT_FOUND", message: "Template not found." });
  res.json({ data: serializeTemplate(template) });
});
