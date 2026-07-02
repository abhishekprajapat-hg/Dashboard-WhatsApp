import { Router } from "express";
import mongoose from "mongoose";
import { Role, Template, WhatsAppAccount, Workspace } from "../models/index.js";
import { requirePermission } from "../middleware/auth.js";
import { roleDefinitions } from "../utils/rbac.js";
import { callOutboundWebhook } from "../services/integrations.js";
import { credentialSummary } from "../services/whatsappProvider.js";

export const settingsRouter = Router();

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
      },
    });
  }

  res.json({
    whatsappAccounts: [],
    templates: [],
    integrations: {
      outboundWebhook: { enabled: false, url: "", secret: "" },
      googleSheets: { enabled: false, webhookUrl: "", secret: "" },
    },
    roles: Object.entries(roleDefinitions).map(([key, role]) => ({ id: `role_${key}`, key, ...role })),
  });
});

settingsRouter.put("/integrations", requirePermission("settings:write"), async (req, res) => {
  if (mongoose.connection.readyState !== 1) {
    return res.status(503).json({ error: "DATABASE_UNAVAILABLE", message: "MongoDB is required." });
  }

  const currentWorkspace = await Workspace.findById(req.user.workspaceId);
  if (!currentWorkspace) {
    return res.status(404).json({ error: "NOT_FOUND", message: "Workspace not found." });
  }

  const settings = currentWorkspace.settings && typeof currentWorkspace.settings === "object" ? currentWorkspace.settings : {};
  const incoming = req.body || {};
  const integrations = {
    ...(settings.integrations || {}),
    outboundWebhook: {
      enabled: Boolean(incoming.outboundWebhook?.enabled),
      url: String(incoming.outboundWebhook?.url || "").trim(),
      secret: String(incoming.outboundWebhook?.secret || ""),
    },
    googleSheets: {
      enabled: Boolean(incoming.googleSheets?.enabled),
      webhookUrl: String(incoming.googleSheets?.webhookUrl || "").trim(),
      secret: String(incoming.googleSheets?.secret || ""),
    },
  };

  currentWorkspace.settings = { ...settings, integrations };
  currentWorkspace.markModified("settings");
  await currentWorkspace.save();

  res.json({ integrations });
});

settingsRouter.post("/integrations/test-webhook", requirePermission("settings:write"), async (req, res) => {
  const { url = "", secret = "" } = req.body || {};
  if (!String(url).trim()) {
    return res.status(400).json({ error: "VALIDATION_ERROR", message: "Webhook URL is required." });
  }

  const result = await callOutboundWebhook({
    workspaceId: req.user.workspaceId,
    url: String(url).trim(),
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
