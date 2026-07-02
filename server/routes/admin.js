import { Router } from "express";
import mongoose from "mongoose";
import {
  AuditLog,
  AutomationFlow,
  Campaign,
  Membership,
  Organization,
  Role,
  Template,
  WebhookEvent,
  WhatsAppAccount,
  Workspace,
} from "../models/index.js";

export const adminRouter = Router();

const defaultPermissions = [
  "admin:read",
  "admin:write",
  "inbox:read",
  "inbox:write",
  "contacts:read",
  "contacts:write",
  "campaigns:read",
  "campaigns:write",
  "automation:read",
  "automation:write",
  "team:read",
  "team:write",
  "settings:read",
  "settings:write",
  "billing:read",
  "security:write",
  "reports:read",
  "assignment:write",
];

function compactDate(date) {
  if (!date) return "";
  return new Date(date).toLocaleString("en-US", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
}

function maskSecret(value = "") {
  const text = String(value || "");
  if (!text) return "";
  if (text.length <= 8) return "****";
  return `${text.slice(0, 4)}****${text.slice(-4)}`;
}

function settingsObject(value) {
  return value && typeof value === "object" ? value : {};
}

adminRouter.get("/overview", async (req, res) => {
  if (mongoose.connection.readyState !== 1) {
    return res.json({
      companies: [],
      tenants: [],
      users: [],
      roles: [],
      permissions: defaultPermissions,
      whatsappNumbers: [],
      apiKeys: [],
      apiTokens: [],
      templates: [],
      automation: [],
      agents: [],
      departments: [],
      teams: [],
      billing: {},
      subscriptions: [],
      usage: {},
      logs: [],
      auditTrail: [],
      security: {},
      webhooks: [],
      analytics: {},
      settings: {},
      whiteLabelBranding: {},
    });
  }

  const workspaceId = req.user.workspaceId;
  const organizationId = req.user.organizationId;
  const [
    organization,
    workspaces,
    memberships,
    roles,
    accounts,
    templates,
    automations,
    campaigns,
    webhookEvents,
    auditLogs,
  ] = await Promise.all([
    Organization.findById(organizationId),
    Workspace.find({ organizationId }).sort({ createdAt: 1 }),
    Membership.find({ organizationId }).populate("userId").populate("roleId").populate("workspaceId").sort({ createdAt: 1 }),
    Role.find({ organizationId }).populate("workspaceId", "name slug").sort({ workspaceId: 1, name: 1 }),
    WhatsAppAccount.find({ organizationId }).populate("workspaceId", "name slug").sort({ createdAt: -1 }),
    Template.find({ workspaceId }).sort({ updatedAt: -1 }).limit(100),
    AutomationFlow.find({ workspaceId }).sort({ updatedAt: -1 }).limit(100),
    Campaign.find({ workspaceId }).sort({ updatedAt: -1 }).limit(100),
    WebhookEvent.find({ workspaceId }).sort({ createdAt: -1 }).limit(50),
    AuditLog.find({ workspaceId }).sort({ createdAt: -1 }).limit(80),
  ]);

  const workspace = workspaces.find((item) => item._id.toString() === workspaceId) || workspaces[0];
  const orgSettings = settingsObject(organization?.settings);
  const workspaceSettings = settingsObject(workspace?.settings);
  const billing = {
    plan: organization?.plan || "starter",
    status: organization?.billingStatus || "trial",
    seats: memberships.length,
    nextInvoiceAt: orgSettings.billing?.nextInvoiceAt || "",
    mrr: orgSettings.billing?.mrr || 0,
  };
  const apiKeys = (workspaceSettings.apiKeys || orgSettings.apiKeys || []).map((key, index) => ({
    id: key.id || `api_key_${index}`,
    name: key.name || `API Key ${index + 1}`,
    token: maskSecret(key.token || key.value),
    scopes: key.scopes || ["admin:read"],
    status: key.status || "active",
    createdAt: compactDate(key.createdAt),
  }));
  const apiTokens = (workspaceSettings.apiTokens || []).map((token, index) => ({
    id: token.id || `api_token_${index}`,
    name: token.name || `Token ${index + 1}`,
    token: maskSecret(token.token || token.value),
    expiresAt: token.expiresAt || "",
    status: token.status || "active",
  }));
  const webhooks = Object.entries(workspaceSettings.integrations || {}).map(([key, value]) => ({
    id: key,
    name: key.replace(/([A-Z])/g, " $1"),
    enabled: Boolean(value?.enabled),
    url: value?.url || value?.webhookUrl || "",
    secret: maskSecret(value?.secret || ""),
  }));
  const departments = workspaceSettings.departments || [
    { id: "sales", name: "Sales", agents: memberships.length, sla: "15m" },
    { id: "support", name: "Support", agents: memberships.length, sla: "30m" },
  ];
  const teams = workspaceSettings.teams || [
    { id: "inbound", name: "Inbound Team", department: "Support", members: memberships.length },
    { id: "growth", name: "Growth Team", department: "Sales", members: Math.max(1, Math.ceil(memberships.length / 2)) },
  ];

  res.json({
    companies: organization
      ? [{
          id: organization._id.toString(),
          name: organization.name,
          slug: organization.slug,
          ownerUserId: organization.ownerUserId?.toString?.() || "",
          plan: organization.plan,
          billingStatus: organization.billingStatus,
          tenants: workspaces.length,
          createdAt: compactDate(organization.createdAt),
        }]
      : [],
    tenants: workspaces.map((item) => ({
      id: item._id.toString(),
      name: item.name,
      slug: item.slug,
      timezone: item.timezone,
      businessCategory: item.businessCategory || "",
      status: item._id.toString() === workspaceId ? "current" : "active",
      createdAt: compactDate(item.createdAt),
    })),
    users: memberships.map((membership) => ({
      id: membership.userId?._id?.toString?.() || membership._id.toString(),
      membershipId: membership._id.toString(),
      name: membership.userId?.name || "Invited user",
      email: membership.userId?.email || "",
      status: membership.userId?.status || membership.status,
      role: membership.roleId?.name || "Agent",
      tenant: membership.workspaceId?.name || "",
      lastLoginAt: compactDate(membership.userId?.lastLoginAt),
    })),
    roles: roles.map((role) => ({
      id: role._id.toString(),
      name: role.name,
      key: role.key,
      description: role.description || "",
      permissions: role.permissions || [],
      tenant: role.workspaceId?.name || "",
      isSystemRole: role.isSystemRole,
    })),
    permissions: defaultPermissions,
    whatsappNumbers: accounts.map((account) => ({
      id: account._id.toString(),
      tenant: account.workspaceId?.name || "",
      provider: account.provider,
      displayName: account.displayName,
      phoneNumber: account.phoneNumber,
      phoneNumberId: account.phoneNumberId,
      status: account.status,
      webhookStatus: account.webhookStatus,
      templateSyncStatus: account.templateSyncStatus,
      lastSyncedAt: compactDate(account.lastSyncedAt),
    })),
    apiKeys,
    apiTokens,
    templates: templates.map((template) => ({
      id: template._id.toString(),
      name: template.name,
      language: template.language,
      category: template.category,
      status: template.status,
      updatedAt: compactDate(template.updatedAt),
    })),
    automation: automations.map((flow) => ({
      id: flow._id.toString(),
      name: flow.name,
      status: flow.status,
      version: flow.version,
      nodes: flow.nodes?.length || 0,
      runs: Number(flow.trigger?.runs || 0),
      updatedAt: compactDate(flow.updatedAt),
    })),
    agents: memberships.map((membership) => ({
      id: membership.userId?._id?.toString?.() || membership._id.toString(),
      name: membership.userId?.name || "Agent",
      status: membership.userId?.status || membership.status,
      department: membership.roleId?.key === "manager" ? "Sales" : "Support",
      tenant: membership.workspaceId?.name || "",
    })),
    departments,
    teams,
    billing,
    subscriptions: [{
      id: organization?._id?.toString?.() || "subscription",
      plan: billing.plan,
      status: billing.status,
      seats: billing.seats,
      usageLimit: orgSettings.billing?.usageLimit || 10000,
    }],
    usage: {
      messages: campaigns.reduce((sum, item) => sum + Number(item.metrics?.sent || 0), 0),
      campaigns: campaigns.length,
      automations: automations.length,
      templates: templates.length,
      whatsappNumbers: accounts.length,
      users: memberships.length,
    },
    logs: webhookEvents.map((event) => ({
      id: event._id.toString(),
      eventType: event.eventType,
      provider: event.provider,
      status: event.status,
      error: event.error || "",
      createdAt: compactDate(event.createdAt),
    })),
    auditTrail: auditLogs.map((log) => ({
      id: log._id.toString(),
      action: log.action,
      entityType: log.entityType,
      entityId: log.entityId,
      createdAt: compactDate(log.createdAt),
    })),
    security: {
      mfaRequired: Boolean(workspaceSettings.security?.mfaRequired),
      ipAllowlist: workspaceSettings.security?.ipAllowlist || [],
      sessionTimeoutMinutes: workspaceSettings.security?.sessionTimeoutMinutes || 480,
      dataRetentionDays: workspaceSettings.security?.dataRetentionDays || 365,
    },
    webhooks,
    analytics: {
      activeTenants: workspaces.length,
      activeUsers: memberships.filter((item) => item.status === "active").length,
      connectedNumbers: accounts.filter((item) => item.status === "connected").length,
      failedWebhooks: webhookEvents.filter((item) => item.status === "failed").length,
    },
    settings: workspaceSettings,
    whiteLabelBranding: workspaceSettings.whiteLabelBranding || {
      brandName: organization?.name || "WhatsCRM",
      logoUrl: "",
      primaryColor: "#22c55e",
      customDomain: "",
    },
  });
});

adminRouter.put("/settings", async (req, res) => {
  if (mongoose.connection.readyState !== 1) {
    return res.status(503).json({ error: "DATABASE_UNAVAILABLE", message: "MongoDB is required." });
  }

  const workspace = await Workspace.findById(req.user.workspaceId);
  const organization = await Organization.findById(req.user.organizationId);
  if (!workspace || !organization) {
    return res.status(404).json({ error: "NOT_FOUND", message: "Tenant not found." });
  }

  const current = settingsObject(workspace.settings);
  const incoming = req.body || {};
  workspace.settings = {
    ...current,
    ...(incoming.security ? { security: { ...(current.security || {}), ...incoming.security } } : {}),
    ...(incoming.whiteLabelBranding ? { whiteLabelBranding: { ...(current.whiteLabelBranding || {}), ...incoming.whiteLabelBranding } } : {}),
    ...(incoming.apiKeys ? { apiKeys: incoming.apiKeys } : {}),
    ...(incoming.apiTokens ? { apiTokens: incoming.apiTokens } : {}),
    ...(incoming.webhooks ? { webhooks: incoming.webhooks } : {}),
    ...(incoming.departments ? { departments: incoming.departments } : {}),
    ...(incoming.teams ? { teams: incoming.teams } : {}),
  };
  workspace.markModified("settings");

  if (incoming.billing) {
    organization.plan = incoming.billing.plan || organization.plan;
    organization.billingStatus = incoming.billing.status || organization.billingStatus;
    organization.settings = {
      ...settingsObject(organization.settings),
      billing: { ...(settingsObject(organization.settings).billing || {}), ...incoming.billing },
    };
    organization.markModified("settings");
    await organization.save();
  }

  await workspace.save();
  res.json({ ok: true, settings: workspace.settings, billing: { plan: organization.plan, status: organization.billingStatus } });
});
