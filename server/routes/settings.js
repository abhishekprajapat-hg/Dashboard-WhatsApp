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

const integrationsSchema = z.object({
  outboundWebhook: webhookConfigSchema.optional().default({}),
  googleSheets: z.object({
    enabled: z.boolean().optional().default(false),
    webhookUrl: optionalHttpUrlString(),
    secret: z.string().optional().default(""),
  }).optional().default({}),
  aiProviders: z.object({
    openai: aiProviderConfigSchema.optional().default({}),
    claude: aiProviderConfigSchema.optional().default({}),
    gemini: aiProviderConfigSchema.optional().default({}),
  }).optional().default({}),
});

const testWebhookSchema = z.object({
  url: httpUrlString(),
  secret: z.string().optional().default(""),
});

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
        provider: account.provider,
        providerConfig: account.providerConfig || {},
        status: account.status,
        webhookStatus: account.webhookStatus,
        templateSyncStatus: account.templateSyncStatus,
        lastSyncedAt: account.lastSyncedAt,
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
      integrations: workspace?.settings?.integrations || {
        outboundWebhook: { enabled: false, url: "", secret: "" },
        googleSheets: { enabled: false, webhookUrl: "", secret: "" },
        aiProviders: { openai: { enabled: false, apiKey: "" }, claude: { enabled: false, apiKey: "" }, gemini: { enabled: false, apiKey: "" } },
      },
    });
  }

  res.json({
    whatsappAccounts: [],
    templates: [],
    integrations: {
      outboundWebhook: { enabled: false, url: "", secret: "" },
      googleSheets: { enabled: false, webhookUrl: "", secret: "" },
      aiProviders: { openai: { enabled: false, apiKey: "" }, claude: { enabled: false, apiKey: "" }, gemini: { enabled: false, apiKey: "" } },
    },
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
  };

  currentWorkspace.settings = { ...settings, integrations };
  currentWorkspace.markModified("settings");
  await currentWorkspace.save();

  res.json({ integrations });
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
