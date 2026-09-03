import { Router } from "express";
import mongoose from "mongoose";
import { z } from "zod";
import {
  ApiKey,
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
import { requirePermission, requirePlatformOwner } from "../middleware/auth.js";
import { generateApiKey } from "../utils/apiKey.js";
import { validateBody, validateQuery } from "../middleware/validate.js";
import { pruneAuditLogs } from "../services/auditLogRetention.js";
import { getEntitlements, PACK_TIERS } from "../services/entitlements.js";
import {
  clearFeatureFlagOverride,
  isKnownFlagKey,
  listFeatureFlagsWithMeta,
  setFeatureFlagOverride,
} from "../services/featureFlags.js";
import { jsonCsv } from "../utils/csv.js";
import { notifyVega } from "../services/vegaIntegration.js";
import { allPermissions } from "../utils/rbac.js";
import { optionalDateString } from "../utils/zodHelpers.js";

export const auditLogExportQuerySchema = z.object({
  from: optionalDateString(),
  to: optionalDateString(),
});

export const featureFlagUpdateSchema = z.object({
  enabled: z.boolean(),
});

export const packTierUpdateSchema = z.object({
  plan: z.enum(PACK_TIERS),
});

const auditLogCsvHeaders = ["id", "createdAt", "actor", "action", "entityType", "entityId", "ipAddress", "userAgent", "before", "after"];

const apiTokenSchema = z.object({
  id: z.string().optional(),
  name: z.string().trim().optional().default(""),
  token: z.string().optional().default(""),
  expiresAt: z.string().optional(),
  status: z.string().optional().default("active"),
});

// webhooks/departments/teams/billing stay loosely typed (z.record/z.unknown) - their real shape
// isn't fixed by any model or consumer elsewhere in this route, same reasoning automation node
// `config` uses: not worth inventing a strict shape nothing else enforces.
export const adminSettingsSchema = z.object({
  security: z.object({
    mfaRequired: z.boolean().optional(),
    ipAllowlist: z.array(z.string()).optional(),
    sessionTimeoutMinutes: z.number().optional(),
    dataRetentionDays: z.number().optional(),
  }).partial().optional(),
  whiteLabelBranding: z.object({
    brandName: z.string().optional(),
    logoUrl: z.string().optional(),
    primaryColor: z.string().optional(),
    customDomain: z.string().optional(),
  }).partial().optional(),
  apiTokens: z.array(apiTokenSchema).optional(),
  webhooks: z.record(z.unknown()).optional(),
  departments: z.array(z.record(z.unknown())).optional(),
  teams: z.array(z.record(z.unknown())).optional(),
  billing: z.record(z.unknown()).optional(),
});

export const adminRouter = Router();

const defaultPermissions = allPermissions();

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

adminRouter.get("/overview", requirePermission("admin:read"), async (req, res) => {
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
    apiKeyDocs,
  ] = await Promise.all([
    Organization.findById(organizationId),
    Workspace.find({ _id: workspaceId, organizationId }).sort({ createdAt: 1 }),
    Membership.find({ workspaceId }).populate("userId").populate("roleId").populate("workspaceId").sort({ createdAt: 1 }),
    Role.find({ workspaceId }).populate("workspaceId", "name slug").sort({ workspaceId: 1, name: 1 }),
    WhatsAppAccount.find({ workspaceId }).populate("workspaceId", "name slug").sort({ createdAt: -1 }),
    Template.find({ workspaceId }).sort({ updatedAt: -1 }).limit(100),
    AutomationFlow.find({ workspaceId }).sort({ updatedAt: -1 }).limit(100),
    Campaign.find({ workspaceId }).sort({ updatedAt: -1 }).limit(100),
    WebhookEvent.find({ workspaceId }).sort({ createdAt: -1 }).limit(50),
    AuditLog.find({ workspaceId }).sort({ createdAt: -1 }).limit(80),
    ApiKey.find({ workspaceId }).sort({ createdAt: -1 }).limit(50),
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
  // Real ApiKey documents now (see POST/DELETE /admin/api-keys below) - only the prefix is ever
  // shown again after creation, never a masked reconstruction of a real secret since the full key
  // is never stored anywhere, hashed or not.
  const apiKeys = apiKeyDocs.map((key) => ({
    id: key._id.toString(),
    name: key.name,
    token: `${key.keyPrefix}••••••••••••••••••••••••`,
    scopes: key.scopes,
    status: key.revokedAt ? "revoked" : "active",
    createdAt: compactDate(key.createdAt),
    lastUsedAt: key.lastUsedAt ? compactDate(key.lastUsedAt) : "Never used",
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
          tenants: 1,
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

adminRouter.put("/settings", requirePermission("admin:write"), validateBody(adminSettingsSchema), async (req, res) => {
  if (mongoose.connection.readyState !== 1) {
    return res.status(503).json({ error: "DATABASE_UNAVAILABLE", message: "MongoDB is required." });
  }

  const workspace = await Workspace.findOne({ _id: req.user.workspaceId, organizationId: req.user.organizationId });
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
    // apiKeys is deliberately no longer settable here - it used to be a client-supplied array with
    // no real auth behind it (see the real ApiKey model + POST/DELETE /admin/api-keys below).
    ...(incoming.apiTokens ? { apiTokens: incoming.apiTokens } : {}),
    ...(incoming.webhooks ? { webhooks: incoming.webhooks } : {}),
    ...(incoming.departments ? { departments: incoming.departments } : {}),
    ...(incoming.teams ? { teams: incoming.teams } : {}),
  };
  workspace.markModified("settings");

  if (incoming.billing) {
    // Deliberately never touches organization.plan/billingStatus here - those are the real
    // enforcement fields (entitlements.js gates capabilities off `plan` directly), and this is a
    // generic workspace-settings route reachable by any tenant's own admin. The only legitimate
    // ways to change them are the real Razorpay flow (billing.js) or the platform-owner-gated
    // PUT /admin/entitlements/plan - a `plan`/`status` key sent here is silently ignored rather
    // than accepted, so this stays only cosmetic display metadata (nextInvoiceAt/mrr etc).
    const { plan: _ignoredPlan, status: _ignoredStatus, ...cosmeticBilling } = incoming.billing;
    organization.settings = {
      ...settingsObject(organization.settings),
      billing: { ...(settingsObject(organization.settings).billing || {}), ...cosmeticBilling },
    };
    organization.markModified("settings");
    await organization.save();
  }

  await workspace.save();
  res.json({ ok: true, settings: workspace.settings, billing: { plan: organization.plan, status: organization.billingStatus } });
});

// Real server-to-server API keys for a client's own external system (their CRM, billing software,
// etc.) to call into this app - see middleware/apiKeyAuth.js and routes/publicApi.js for the
// consumer side. `gatesRealBehavior` per scope, same honesty convention as featureFlags.js's
// definitions - only scopes with a real route behind them should ever be issuable.
export const API_KEY_SCOPES = [{ key: "leads:write", label: "Create leads", gatesRealBehavior: true }];

const createApiKeySchema = z.object({
  name: z.string().trim().min(1, "Name is required.").max(120),
  scopes: z.array(z.string()).min(1, "At least one scope is required."),
});

adminRouter.get("/api-keys/scopes", requirePermission("admin:read"), (req, res) => {
  res.json({ data: API_KEY_SCOPES });
});

adminRouter.post("/api-keys", requirePermission("admin:write"), validateBody(createApiKeySchema), async (req, res) => {
  if (mongoose.connection.readyState !== 1) {
    return res.status(503).json({ error: "DATABASE_UNAVAILABLE", message: "MongoDB is required." });
  }

  const knownScopeKeys = API_KEY_SCOPES.map((scope) => scope.key);
  const invalidScopes = req.body.scopes.filter((scope) => !knownScopeKeys.includes(scope));
  if (invalidScopes.length) {
    return res.status(400).json({ error: "VALIDATION_ERROR", message: `Unknown scope(s): ${invalidScopes.join(", ")}` });
  }

  const { key, keyPrefix, keyHash } = generateApiKey();
  const apiKeyDoc = await ApiKey.create({
    organizationId: req.user.organizationId,
    workspaceId: req.user.workspaceId,
    name: req.body.name,
    keyPrefix,
    keyHash,
    scopes: req.body.scopes,
    createdByUserId: req.user.sub,
  });

  res.status(201).json({
    data: {
      id: apiKeyDoc._id.toString(),
      name: apiKeyDoc.name,
      scopes: apiKeyDoc.scopes,
      // The only time the real plaintext key is ever returned - the full key is never stored
      // anywhere, hashed or not, so there is no way to show it again after this response.
      key,
    },
  });
});

adminRouter.delete("/api-keys/:id", requirePermission("admin:write"), async (req, res) => {
  if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
    return res.status(404).json({ error: "NOT_FOUND", message: "API key not found." });
  }
  const apiKeyDoc = await ApiKey.findOneAndUpdate(
    { _id: req.params.id, workspaceId: req.user.workspaceId },
    { $set: { revokedAt: new Date() } },
    { new: true }
  );
  if (!apiKeyDoc) return res.status(404).json({ error: "NOT_FOUND", message: "API key not found." });
  res.json({ ok: true });
});

// Deliberately richer than GET /overview's 5-field auditTrail (that endpoint is untouched) - this
// is a separate view meant for actually exporting the record, not the dashboard summary list.
adminRouter.get("/audit-log/export", requirePermission("admin:read"), validateQuery(auditLogExportQuerySchema), async (req, res) => {
  if (mongoose.connection.readyState !== 1) {
    return res.status(503).json({ error: "DATABASE_UNAVAILABLE", message: "MongoDB is required." });
  }

  const filter = { workspaceId: req.user.workspaceId };
  if (req.query.from || req.query.to) {
    const range = {};
    if (req.query.from) range.$gte = new Date(req.query.from);
    if (req.query.to) range.$lte = new Date(req.query.to);
    filter.createdAt = mongoose.trusted(range);
  }

  const logs = await AuditLog.find(filter)
    .populate("actorUserId", "name email")
    .sort({ createdAt: -1 })
    .limit(5000);

  const rows = logs.map((log) => ({
    id: log._id.toString(),
    createdAt: log.createdAt.toISOString(),
    actor: log.actorUserId?.name || log.actorUserId?.email || "",
    action: log.action,
    entityType: log.entityType,
    entityId: log.entityId || "",
    ipAddress: log.ipAddress || "",
    userAgent: log.userAgent || "",
    before: log.before ? JSON.stringify(log.before) : "",
    after: log.after ? JSON.stringify(log.after) : "",
  }));

  res.setHeader("Content-Type", "text/csv");
  res.setHeader("Content-Disposition", `attachment; filename="audit-log-${Date.now()}.csv"`);
  res.send(jsonCsv(rows, auditLogCsvHeaders));
});

// On-demand trigger for the same pruning logic scripts/pruneAuditLogs.js runs periodically -
// lets an admin purge this workspace's expired audit log entries right now, without waiting for
// the next scheduled sweep.
adminRouter.post("/audit-log/prune", requirePermission("admin:write"), async (req, res) => {
  if (mongoose.connection.readyState !== 1) {
    return res.status(503).json({ error: "DATABASE_UNAVAILABLE", message: "MongoDB is required." });
  }

  const [result] = await pruneAuditLogs({ workspaceId: req.user.workspaceId });
  res.json({ data: result });
});

adminRouter.get("/feature-flags", requirePermission("admin:read"), requirePlatformOwner, async (req, res) => {
  res.json({ data: await listFeatureFlagsWithMeta() });
});

adminRouter.put(
  "/feature-flags/:key",
  requirePermission("admin:write"),
  requirePlatformOwner,
  validateBody(featureFlagUpdateSchema),
  async (req, res) => {
    if (mongoose.connection.readyState !== 1) {
      return res.status(503).json({ error: "DATABASE_UNAVAILABLE", message: "MongoDB is required." });
    }
    if (!isKnownFlagKey(req.params.key)) {
      return res.status(404).json({ error: "NOT_FOUND", message: `Unknown feature flag: ${req.params.key}` });
    }
    const data = await setFeatureFlagOverride(req.params.key, req.body.enabled, {
      id: req.user.sub,
      email: req.user.email,
    });
    res.json({ ok: true, data });
  }
);

adminRouter.delete("/feature-flags/:key", requirePermission("admin:write"), requirePlatformOwner, async (req, res) => {
  if (mongoose.connection.readyState !== 1) {
    return res.status(503).json({ error: "DATABASE_UNAVAILABLE", message: "MongoDB is required." });
  }
  if (!isKnownFlagKey(req.params.key)) {
    return res.status(404).json({ error: "NOT_FOUND", message: `Unknown feature flag: ${req.params.key}` });
  }
  const data = await clearFeatureFlagOverride(req.params.key);
  res.json({ ok: true, data });
});

adminRouter.get("/entitlements", requirePermission("admin:read"), async (req, res) => {
  const organization = await Organization.findById(req.user.organizationId).select("plan");
  res.json({ data: getEntitlements(organization?.plan) });
});

adminRouter.put(
  "/entitlements/plan",
  requirePermission("admin:write"),
  requirePlatformOwner,
  validateBody(packTierUpdateSchema),
  async (req, res) => {
    if (mongoose.connection.readyState !== 1) {
      return res.status(503).json({ error: "DATABASE_UNAVAILABLE", message: "MongoDB is required." });
    }
    const organization = await Organization.findById(req.user.organizationId);
    if (!organization) {
      return res.status(404).json({ error: "NOT_FOUND", message: "Organization not found." });
    }
    const previousPlan = organization.plan;
    organization.plan = req.body.plan;
    await organization.save();
    res.json({ ok: true, data: getEntitlements(organization.plan) });

    // Fired after the response, not awaited by it - a slow or unreachable Vega must never delay
    // or fail this admin action. notifyVega already swallows its own errors; this catch is just
    // defense against something unexpected in the call itself.
    notifyVega(organization._id.toString(), "plan_changed", { plan: organization.plan, previousPlan }).catch(() => undefined);
  }
);
