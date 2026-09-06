import { Router } from "express";
import mongoose from "mongoose";
import { z } from "zod";
import { requirePermission } from "../middleware/auth.js";
import { validateBody, validateQuery } from "../middleware/validate.js";
import { Template, WhatsAppAccount } from "../models/index.js";
import { createWhatsAppTemplate, fetchWhatsAppTemplates } from "../services/whatsappProvider.js";
import { optionalObjectIdString } from "../utils/zodHelpers.js";

export const templatesRouter = Router();

// cleanPayload() below already coerces/defaults enum-ish fields (type, status, category) back to
// safe values when they're missing or unrecognized, so this only needs to catch genuinely
// malformed shapes (wrong types) rather than re-implement that coercion.
export const updateTemplateSchema = z.object({
  name: z.string().trim().optional(),
  type: z.string().optional(),
  category: z.string().optional(),
  language: z.string().optional(),
  body: z.string().optional(),
  variables: z.array(z.string()).optional(),
  status: z.string().optional(),
  providerTemplateId: z.string().optional(),
  whatsappAccountId: optionalObjectIdString,
});

// "all" is a real, handled literal for each of these (means "no filter") - not narrowed to an
// enum of known values, since the handler accepts (and just empty-results on) anything else too.
export const listTemplatesQuerySchema = z.object({
  type: z.string().optional(),
  status: z.string().optional(),
  category: z.string().optional(),
  language: z.string().optional(),
  search: z.string().optional(),
});

// Shape-level only, same reasoning as updateTemplateSchema above - cleanPayload() below already
// coerces/defaults type/status/category/language and conditionally requires body (only when
// type !== "whatsapp"), so this schema doesn't re-derive those business rules, just guards against
// wrong-typed input.
export const createTemplateBodySchema = z.object({
  name: z.string().optional(),
  type: z.string().optional(),
  category: z.string().optional(),
  language: z.string().optional(),
  body: z.string().optional(),
  variables: z.array(z.string()).optional(),
  status: z.string().optional(),
  providerTemplateId: z.string().optional(),
  whatsappAccountId: z.string().optional(),
});

// Read-only, never rejects today (renders {{placeholder}} tokens back verbatim when a variable is
// missing) - stays maximally permissive rather than narrowing what the handler already tolerates.
export const previewTemplateBodySchema = z.object({
  body: z.string().optional(),
  variables: z.unknown().optional(),
});

// accountId must stay optional - the only real caller (the "Sync WhatsApp" button) always calls
// with no arguments at all; omitted/invalid values already fall back to syncing every connected
// account in the workspace rather than rejecting.
export const syncWhatsappTemplatesSchema = z.object({
  accountId: optionalObjectIdString,
});

const templateTypes = ["whatsapp", "quick_reply", "automation", "campaign", "follow_up", "lead_stage"];
const categories = ["marketing", "utility", "authentication", "support", "sales", "payment", "appointment", "general"];
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
    components: template.components || [],
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
  while (await Template.exists({ workspaceId, slug: candidate, ...(excludeId ? { _id: mongoose.trusted({ $ne: excludeId }) } : {}) })) {
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

// This app's own templates use named {{variable}} tokens (see extractVariables above); Meta only
// accepts sequential positional placeholders ({{1}}, {{2}}, ...) in a submitted template body, and
// requires a realistic-looking example value for each one or the submission is rejected outright.
// Renumbering here (rather than asking authors to type {{1}} directly) keeps the friendlier named
// syntax everywhere else in the app - preview, quick replies, automation nodes.
const metaCategoryByLocalCategory = {
  marketing: "MARKETING",
  sales: "MARKETING",
  utility: "UTILITY",
  support: "UTILITY",
  payment: "UTILITY",
  appointment: "UTILITY",
  general: "UTILITY",
  authentication: "AUTHENTICATION",
};

function toMetaCategory(category) {
  return metaCategoryByLocalCategory[String(category || "").toLowerCase()] || "UTILITY";
}

// Meta template names must be lowercase snake_case - this app's slugify() produces hyphens for
// display slugs, which Meta rejects, so this stays a separate, stricter transform.
function toMetaTemplateName(name) {
  return (
    String(name || "template")
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "_")
      .replace(/^_+|_+$/g, "")
      .slice(0, 512) || "template"
  );
}

function buildMetaTemplateComponents(body = "", variables = []) {
  let numberedBody = body;
  variables.forEach((variable, index) => {
    numberedBody = numberedBody.replace(new RegExp(`\\{\\{\\s*${variable}\\s*\\}\\}`, "g"), `{{${index + 1}}}`);
  });

  const bodyComponent = { type: "BODY", text: numberedBody };
  if (variables.length) {
    bodyComponent.example = { body_text: [variables.map((variable) => `Sample ${variable}`)] };
  }
  return { numberedBody, components: [bodyComponent] };
}

// Meta's AUTHENTICATION category is a fixed, non-freeform shape - Meta auto-generates the body text
// itself (e.g. "{{1}} is your verification code.") from add_security_recommendation, and delivery
// happens via a dedicated OTP button, not literal body placeholders. So unlike
// buildMetaTemplateComponents above, this deliberately ignores the locally-authored body/variables
// (kept only as local display copy) and always submits this same three-component shape.
function buildAuthTemplateComponents() {
  return [
    { type: "BODY", add_security_recommendation: true },
    { type: "FOOTER", code_expiration_minutes: 10 },
    { type: "BUTTONS", buttons: [{ type: "OTP", otp_type: "COPY_CODE" }] },
  ];
}

function renderPreview(body = "", variables = {}) {
  return String(body || "").replace(/\{\{\s*([a-zA-Z0-9_.-]+)\s*\}\}/g, (_match, key) => {
    const value = variables[key] ?? variables[String(key).toLowerCase()] ?? "";
    return value === "" ? `{{${key}}}` : String(value);
  });
}

templatesRouter.get("/", requirePermission("templates:read"), validateQuery(listTemplatesQuerySchema), async (req, res) => {
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
      { name: mongoose.trusted({ $regex: search, $options: "i" }) },
      { slug: mongoose.trusted({ $regex: search, $options: "i" }) },
      { body: mongoose.trusted({ $regex: search, $options: "i" }) },
    ];
  }

  const templates = await Template.find(filter).sort({ type: 1, status: 1, updatedAt: -1 }).limit(250);
  res.json({ data: templates.map(serializeTemplate), total: templates.length });
});

templatesRouter.post("/", requirePermission("templates:write"), validateBody(createTemplateBodySchema), async (req, res) => {
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

templatesRouter.post("/preview", requirePermission("templates:read"), validateBody(previewTemplateBodySchema), async (req, res) => {
  const body = String(req.body?.body || "");
  const variables = req.body?.variables && typeof req.body.variables === "object" ? req.body.variables : {};
  res.json({ data: { body, variables: extractVariables(body), preview: renderPreview(body, variables) } });
});

templatesRouter.post("/sync-whatsapp", requirePermission("templates:write"), validateBody(syncWhatsappTemplatesSchema), async (req, res) => {
  if (mongoose.connection.readyState !== 1) {
    return res.status(503).json({ error: "DATABASE_UNAVAILABLE", message: "MongoDB is required." });
  }

  const accountFilter = { workspaceId: req.user.workspaceId, status: mongoose.trusted({ $in: ["connected", "needs_attention"] }) };
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

// Submits a locally-authored template to Meta for real review - closes the gap where creating a
// "whatsapp" template only ever wrote to this app's own DB (see cleanPayload/POST "/" above) and
// never actually reached Meta. Only meaningful for templates that haven't already been submitted -
// synced-from-Meta templates already carry a real providerTemplateId and go through sync-whatsapp
// for status updates, not this route.
templatesRouter.post("/:id/submit", requirePermission("templates:write"), async (req, res) => {
  if (!mongoose.Types.ObjectId.isValid(req.params.id)) return res.status(404).json({ error: "NOT_FOUND", message: "Template not found." });
  const template = await Template.findOne({ _id: req.params.id, workspaceId: req.user.workspaceId });
  if (!template) return res.status(404).json({ error: "NOT_FOUND", message: "Template not found." });

  if (template.type !== "whatsapp") {
    return res.status(400).json({ error: "VALIDATION_ERROR", message: "Only WhatsApp templates can be submitted for Meta review." });
  }
  if (template.providerTemplateId) {
    return res.status(409).json({ error: "ALREADY_SUBMITTED", message: "This template has already been submitted to Meta." });
  }
  if (!template.body?.trim()) {
    return res.status(400).json({ error: "VALIDATION_ERROR", message: "Add a message body before submitting for review." });
  }
  if (!template.whatsappAccountId) {
    return res.status(400).json({ error: "VALIDATION_ERROR", message: "Choose a connected WhatsApp account before submitting for review." });
  }

  const account = await WhatsAppAccount.findOne({ _id: template.whatsappAccountId, workspaceId: req.user.workspaceId });
  if (!account) {
    return res.status(404).json({ error: "NOT_FOUND", message: "The WhatsApp account linked to this template was not found." });
  }

  const metaName = toMetaTemplateName(template.name);
  const metaCategory = toMetaCategory(template.category);
  const { numberedBody, components } = metaCategory === "AUTHENTICATION"
    ? { numberedBody: template.body, components: buildAuthTemplateComponents() }
    : buildMetaTemplateComponents(template.body, template.variables || []);

  let result;
  try {
    result = await createWhatsAppTemplate({
      account,
      name: metaName,
      category: metaCategory,
      language: template.language || "en",
      components,
    });
  } catch (error) {
    return res.status(error.status || 502).json({ error: error.code || "META_TEMPLATE_SUBMIT_FAILED", message: error.message });
  }

  // Meta's create-template response never echoes back the components it actually generated - for
  // AUTHENTICATION templates specifically, the BODY component sent above has no literal text of its
  // own (Meta auto-generates it), so without this the stored record would keep a textless BODY
  // component forever. buildTemplateComponents() (whatsappProvider.js, used at real send time) skips
  // any component with no placeholder to fill, so a later send would silently drop the body
  // parameter and Meta would reject it for a parameter-count mismatch. Re-fetching immediately and
  // swapping in Meta's real component list (with its real auto-generated body text) closes that gap.
  let finalComponents = components;
  if (metaCategory === "AUTHENTICATION") {
    try {
      const synced = await fetchWhatsAppTemplates(account);
      const match = synced.find((item) => item.providerTemplateId === result.providerTemplateId);
      if (match?.components?.length) finalComponents = match.components;
    } catch {
      // Best-effort - Meta already accepted the template even if this re-fetch fails; the existing
      // "Sync WhatsApp" button is still available as a manual fallback to pick up the real shape later.
    }
  }

  template.name = metaName;
  template.body = metaCategory === "AUTHENTICATION" ? extractBody({ components: finalComponents }) : numberedBody;
  template.components = finalComponents;
  template.category = normalizeCategory(metaCategory);
  template.providerTemplateId = result.providerTemplateId;
  template.status = result.status;
  template.updatedBy = req.user.sub;
  try {
    await template.save();
  } catch (error) {
    // Meta already accepted the submission (result.providerTemplateId is real) by the time this
    // could happen - a name collision with another template on the same account/language here
    // would otherwise report success while silently failing to persist the real id/status.
    if (error.code === 11000) {
      return res.status(409).json({
        error: "DUPLICATE_TEMPLATE_NAME",
        message: `Meta accepted the submission as "${metaName}", but another template with that name already exists for this account and language.`,
      });
    }
    throw error;
  }

  res.json({ data: serializeTemplate(template) });
});

templatesRouter.patch("/:id", requirePermission("templates:write"), validateBody(updateTemplateSchema), async (req, res) => {
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
