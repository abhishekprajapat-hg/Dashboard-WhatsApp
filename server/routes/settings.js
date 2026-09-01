import { Router } from "express";
import mongoose from "mongoose";
import { z } from "zod";
import { Role, Template, WhatsAppAccount, Workspace } from "../models/index.js";
import { requirePermission } from "../middleware/auth.js";
import { validateBody } from "../middleware/validate.js";
import { roleDefinitions } from "../utils/rbac.js";
import { httpUrlString, optionalHttpUrlString } from "../utils/zodHelpers.js";
import { callOutboundWebhook } from "../services/integrations.js";
import { credentialSummary } from "../services/whatsappProvider.js";

export const settingsRouter = Router();

const webhookConfigSchema = z.object({
  enabled: z.boolean().optional().default(false),
  url: optionalHttpUrlString(),
  secret: z.string().optional().default(""),
});

const aiProviderConfigSchema = z.object({
  enabled: z.boolean().optional().default(false),
  apiKey: z.string().optional().default(""),
});

// SendGrid-shaped: a single API key plus the verified sender identity SendGrid requires on
// every send. fromName is optional (SendGrid accepts a bare from.email with no from.name).
const emailConfigSchema = z.object({
  enabled: z.boolean().optional().default(false),
  apiKey: z.string().optional().default(""),
  fromAddress: z.string().optional().default(""),
  fromName: z.string().optional().default(""),
});

// Twilio-shaped, matching the Account SID + Auth Token credentials whatsappProvider.js already
// uses for the Twilio WhatsApp channel - this is the same provider/account, just the plain SMS
// send path instead of the whatsapp:-prefixed one.
const smsConfigSchema = z.object({
  enabled: z.boolean().optional().default(false),
  accountSid: z.string().optional().default(""),
  authToken: z.string().optional().default(""),
  fromNumber: z.string().optional().default(""),
});

const googleSheetsConfigSchema = z.object({
  enabled: z.boolean().optional().default(false),
  webhookUrl: optionalHttpUrlString(),
  secret: z.string().optional().default(""),
});

const aiProvidersConfigSchema = z.object({
  openai: aiProviderConfigSchema.optional().default({}),
  claude: aiProviderConfigSchema.optional().default({}),
  gemini: aiProviderConfigSchema.optional().default({}),
});

export const integrationsSchema = z.object({
  outboundWebhook: webhookConfigSchema.optional().default({}),
  googleSheets: googleSheetsConfigSchema.optional().default({}),
  aiProviders: aiProvidersConfigSchema.optional().default({}),
  email: emailConfigSchema.optional().default({}),
  sms: smsConfigSchema.optional().default({}),
});

export const testWebhookSchema = z.object({
  url: httpUrlString(),
  secret: z.string().optional().default(""),
});

// Kept deliberately small - real, already-emittable events (whatsapp.js/ads.js's own
// needs_attention transitions) rather than a large speculative catalog nothing fires yet.
export const notificationsSchema = z.object({
  enabled: z.boolean().optional().default(false),
  recipientEmail: z.union([z.literal(""), z.string().email("Must be a valid email address.")]).default(""),
  events: z.object({
    whatsappNeedsAttention: z.boolean().optional().default(true),
    adsNeedsAttention: z.boolean().optional().default(true),
  }).optional().default({}),
});

function defaultIntegrations() {
  return {
    outboundWebhook: { enabled: false, url: "", secret: "" },
    googleSheets: { enabled: false, webhookUrl: "", secret: "" },
    aiProviders: { openai: { enabled: false, apiKey: "" }, claude: { enabled: false, apiKey: "" }, gemini: { enabled: false, apiKey: "" } },
    email: { enabled: false, apiKey: "", fromAddress: "", fromName: "" },
    sms: { enabled: false, accountSid: "", authToken: "", fromNumber: "" },
  };
}

function defaultNotifications() {
  return {
    enabled: false,
    recipientEmail: "",
    events: { whatsappNeedsAttention: true, adsNeedsAttention: true },
  };
}

function mergeNotifications(stored = {}) {
  const defaults = defaultNotifications();
  return {
    ...defaults,
    ...stored,
    events: { ...defaults.events, ...stored.events },
  };
}

// Backfills any keys missing from a stored integrations document with defaults, one level deep
// (and one level deeper for aiProviders' three sub-providers) - a workspace that saved
// integrations before a new integration type (aiProviders, then email/sms) existed has a document
// missing those keys entirely, and `stored || defaults` only helps when the whole document is
// absent, not when it's present but partial. Without this, the client crashes on
// integrationForm.email.enabled with email undefined.
function mergeIntegrations(stored = {}) {
  const defaults = defaultIntegrations();
  return {
    outboundWebhook: { ...defaults.outboundWebhook, ...stored.outboundWebhook },
    googleSheets: { ...defaults.googleSheets, ...stored.googleSheets },
    aiProviders: {
      openai: { ...defaults.aiProviders.openai, ...stored.aiProviders?.openai },
      claude: { ...defaults.aiProviders.claude, ...stored.aiProviders?.claude },
      gemini: { ...defaults.aiProviders.gemini, ...stored.aiProviders?.gemini },
    },
    email: { ...defaults.email, ...stored.email },
    sms: { ...defaults.sms, ...stored.sms },
  };
}

settingsRouter.get("/", requirePermission("settings:read"), async (req, res) => {
  if (mongoose.connection.readyState === 1) {
    const [accounts, roles, templates, workspace] = await Promise.all([
      WhatsAppAccount.find({ workspaceId: req.user.workspaceId }).sort({ createdAt: -1 }),
      Role.find({ workspaceId: req.user.workspaceId }).sort({ name: 1 }),
      Template.find({ workspaceId: req.user.workspaceId }).sort({ name: 1 }),
      Workspace.findById(req.user.workspaceId).select("settings"),
    ]);

    return res.json({
      whatsappAccounts: accounts.map((account) => ({
        id: account._id.toString(),
        displayName: account.displayName,
        phoneNumber: account.phoneNumber,
        phoneNumberId: account.phoneNumberId,
        businessAccountId: account.businessAccountId,
        conversionsDatasetId: account.conversionsDatasetId || "",
        catalogId: account.catalogId || "",
        provider: account.provider,
        providerConfig: account.providerConfig || {},
        status: account.status,
        webhookStatus: account.webhookStatus,
        templateSyncStatus: account.templateSyncStatus,
        lastSyncedAt: account.lastSyncedAt,
        isSystemAccount: Boolean(account.isSystemAccount),
        credentials: credentialSummary(account),
      })),
      templates: templates.map((template) => ({
        id: template._id.toString(),
        name: template.name,
        language: template.language,
        category: template.category,
        status: template.status,
      })),
      roles: roles.map((role) => ({
        id: role._id.toString(),
        name: role.name,
        key: role.key,
        permissions: role.permissions,
      })),
      integrations: mergeIntegrations(workspace?.settings?.integrations),
      notifications: mergeNotifications(workspace?.settings?.notifications),
    });
  }

  res.json({
    whatsappAccounts: [],
    templates: [],
    integrations: defaultIntegrations(),
    notifications: defaultNotifications(),
    roles: Object.entries(roleDefinitions).map(([key, role]) => ({ id: `role_${key}`, key, ...role })),
  });
});

settingsRouter.put("/integrations", requirePermission("settings:write"), validateBody(integrationsSchema), async (req, res) => {
  if (mongoose.connection.readyState !== 1) {
    return res.status(503).json({ error: "DATABASE_UNAVAILABLE", message: "MongoDB is required." });
  }

  const currentWorkspace = await Workspace.findById(req.user.workspaceId);
  if (!currentWorkspace) {
    return res.status(404).json({ error: "NOT_FOUND", message: "Workspace not found." });
  }

  const settings = currentWorkspace.settings && typeof currentWorkspace.settings === "object" ? currentWorkspace.settings : {};
  const integrations = {
    ...(settings.integrations || {}),
    outboundWebhook: req.body.outboundWebhook,
    googleSheets: req.body.googleSheets,
    aiProviders: req.body.aiProviders,
    email: req.body.email,
    sms: req.body.sms,
  };

  currentWorkspace.settings = { ...settings, integrations };
  currentWorkspace.markModified("settings");
  await currentWorkspace.save();

  res.json({ integrations });
});

// Scoped per-section routes - each validates and persists ONLY its own slice via a targeted
// $set, so one section's invalid field (e.g. a malformed webhook URL nobody's touched in months)
// can never block saving an unrelated section (e.g. adding a fresh AI provider key). The combined
// PUT /integrations route above stays for any existing caller, but silently defaulted every
// omitted section back to its schema default on save - a real data-loss risk once callers start
// sending partial payloads, which is exactly what these scoped routes are for instead.
function makeScopedIntegrationRoute(section, schema) {
  return async (req, res) => {
    if (mongoose.connection.readyState !== 1) {
      return res.status(503).json({ error: "DATABASE_UNAVAILABLE", message: "MongoDB is required." });
    }
    const currentWorkspace = await Workspace.findById(req.user.workspaceId);
    if (!currentWorkspace) {
      return res.status(404).json({ error: "NOT_FOUND", message: "Workspace not found." });
    }

    const settings = currentWorkspace.settings && typeof currentWorkspace.settings === "object" ? currentWorkspace.settings : {};
    const integrations = { ...defaultIntegrations(), ...(settings.integrations || {}), [section]: req.body };

    currentWorkspace.settings = { ...settings, integrations };
    currentWorkspace.markModified("settings");
    await currentWorkspace.save();

    res.json({ integrations });
  };
}

settingsRouter.put(
  "/integrations/webhook",
  requirePermission("settings:write"),
  validateBody(webhookConfigSchema),
  makeScopedIntegrationRoute("outboundWebhook", webhookConfigSchema)
);
settingsRouter.put(
  "/integrations/google-sheets",
  requirePermission("settings:write"),
  validateBody(googleSheetsConfigSchema),
  makeScopedIntegrationRoute("googleSheets", googleSheetsConfigSchema)
);
settingsRouter.put(
  "/integrations/ai-providers",
  requirePermission("settings:write"),
  validateBody(aiProvidersConfigSchema),
  makeScopedIntegrationRoute("aiProviders", aiProvidersConfigSchema)
);
settingsRouter.put(
  "/integrations/email",
  requirePermission("settings:write"),
  validateBody(emailConfigSchema),
  makeScopedIntegrationRoute("email", emailConfigSchema)
);
settingsRouter.put(
  "/integrations/sms",
  requirePermission("settings:write"),
  validateBody(smsConfigSchema),
  makeScopedIntegrationRoute("sms", smsConfigSchema)
);

settingsRouter.put("/notifications", requirePermission("settings:write"), validateBody(notificationsSchema), async (req, res) => {
  if (mongoose.connection.readyState !== 1) {
    return res.status(503).json({ error: "DATABASE_UNAVAILABLE", message: "MongoDB is required." });
  }

  const currentWorkspace = await Workspace.findById(req.user.workspaceId);
  if (!currentWorkspace) {
    return res.status(404).json({ error: "NOT_FOUND", message: "Workspace not found." });
  }

  const settings = currentWorkspace.settings && typeof currentWorkspace.settings === "object" ? currentWorkspace.settings : {};
  const notifications = { enabled: req.body.enabled, recipientEmail: req.body.recipientEmail, events: req.body.events };

  currentWorkspace.settings = { ...settings, notifications };
  currentWorkspace.markModified("settings");
  await currentWorkspace.save();

  res.json({ notifications });
});

settingsRouter.post("/integrations/test-webhook", requirePermission("settings:write"), validateBody(testWebhookSchema), async (req, res) => {
  const { url, secret } = req.body;

  const result = await callOutboundWebhook({
    workspaceId: req.user.workspaceId,
    url,
    secret,
    event: "integration.test",
    payload: {
      workspaceId: req.user.workspaceId,
      userId: req.user.sub,
      message: "WhatsCRM test webhook",
    },
  });

  res.json({ result });
});
