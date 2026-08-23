import { Router } from "express";
import crypto from "crypto";
import mongoose from "mongoose";
import { z } from "zod";
import { config } from "../config.js";
import {
  Campaign,
  Contact,
  Conversation,
  Membership,
  Message,
  Template,
  WebhookEvent,
  WhatsAppAccount,
} from "../models/index.js";
import { requireAuth, requirePermission } from "../middleware/auth.js";
import { validateBody, validateQuery } from "../middleware/validate.js";
import { requireWorkspaceContext } from "../middleware/workspace.js";
import { logger } from "../services/logger.js";
import { notifyWorkspace } from "../services/notifications.js";
import { notifyVega } from "../services/vegaIntegration.js";
import { completeEmbeddedSignup } from "../services/embeddedSignup.js";
import { optionalObjectIdString, trimmedString } from "../utils/zodHelpers.js";
import { publishConversationChanged } from "../realtime/events.js";
import { detectWhatsAppLead, ensureConversationInCrm } from "../services/crm.js";
import { syncLeadToGoogleSheetInBackground } from "../services/googleSheets.js";
import { runInboundAutomations } from "../services/automationRunner.js";
import { absoluteBaseUrl, mediaTypeFor } from "../services/mediaStorage.js";
import { sendConversionEvent } from "../services/metaConversionsApi.js";
import { fetchCatalogProducts } from "../services/whatsappCommerce.js";
import {
  credentialSummary,
  decodeCredentials,
  encodeCredentials,
  fetchWhatsAppTemplates,
  normalizeTwilioWebhookPayload,
  normalizeWatiWebhookPayload,
  normalizeWebhookPayload,
  resolveInboundMedia,
  testWhatsAppConnection,
} from "../services/whatsappProvider.js";

export const whatsappRouter = Router();
export const whatsappWebhookRouter = Router();

function serializeAccount(account) {
  const credentials = credentialSummary(account);
  return {
    id: account._id.toString(),
    displayName: account.displayName,
    phoneNumber: account.phoneNumber,
    phoneNumberId: account.phoneNumberId,
    businessAccountId: account.businessAccountId,
    conversionsDatasetId: account.conversionsDatasetId || "",
    catalogId: account.catalogId || "",
    provider: account.provider,
    providerConfig: account.providerConfig || {},
    webhookStatus: account.webhookStatus,
    templateSyncStatus: account.templateSyncStatus,
    status: account.status,
    lastSyncedAt: account.lastSyncedAt,
    credentials,
  };
}

function cleanString(value) {
  return String(value || "").trim();
}

function isMetaAdReferral(referral) {
  return String(referral?.source_type || "").toLowerCase() === "ad";
}

function phoneLookupValues(phone = "") {
  const raw = String(phone || "").trim();
  const digits = raw.replace(/[^\d]/g, "");
  const values = new Set([raw, digits]);

  if (digits) {
    values.add(`+${digits}`);
    values.add(`whatsapp:+${digits}`);
  }

  const last10 = digits.length > 10 ? digits.slice(-10) : digits;
  if (last10 && last10.length === 10) {
    values.add(last10);
    values.add(`+${last10}`);
    values.add(`91${last10}`);
    values.add(`+91${last10}`);
    values.add(`whatsapp:+91${last10}`);
  }

  return Array.from(values).filter(Boolean);
}

async function findReusableContactAndConversation({ account, phone }) {
  const phoneValues = phoneLookupValues(phone);
  const contacts = await Contact.find({
    workspaceId: account.workspaceId,
    phone: mongoose.trusted({ $in: phoneValues }),
  }).sort({ lastMessageAt: -1, updatedAt: -1 });

  if (!contacts.length) {
    return { contact: null, conversation: null, existingConversation: null };
  }

  const contactIds = contacts.map((contact) => contact._id);
  const existingConversation = await Conversation.findOne({
    workspaceId: account.workspaceId,
    contactId: mongoose.trusted({ $in: contactIds }),
    status: mongoose.trusted({ $ne: "resolved" }),
  }).sort({ createdAt: 1 });

  const contact = existingConversation
    ? contacts.find((item) => item._id.equals(existingConversation.contactId)) || contacts[0]
    : contacts[0];

  return { contact, conversation: existingConversation, existingConversation };
}

function serializeTemplate(template) {
  return {
    id: template._id.toString(),
    name: template.name,
    language: template.language,
    category: template.category,
    status: template.status,
    lastSyncedAt: template.lastSyncedAt,
  };
}

async function hasMatchingVerifyToken(token) {
  if (!token) return false;
  if (token === config.whatsappVerifyToken) return true;
  if (mongoose.connection.readyState !== 1) return false;
  const accounts = await WhatsAppAccount.find({ provider: "meta" }).select("encryptedCredentials");
  return accounts.some((account) => decodeCredentials(account).verifyToken === token);
}

export function hasValidMetaSignature(req, appSecret) {
  if (!appSecret) return true;
  const header = String(req.headers["x-hub-signature-256"] || "");
  const expectedPrefix = "sha256=";
  if (!header.startsWith(expectedPrefix) || !req.rawBody) return false;

  const digest = `${expectedPrefix}${crypto.createHmac("sha256", appSecret).update(req.rawBody).digest("hex")}`;
  const headerBuffer = Buffer.from(header);
  const digestBuffer = Buffer.from(digest);
  return headerBuffer.length === digestBuffer.length && crypto.timingSafeEqual(headerBuffer, digestBuffer);
}

whatsappRouter.use(requireAuth, requireWorkspaceContext);

function shortTime(date) {
  if (!date) return "";
  return new Date(date).toLocaleString("en-IN", {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

whatsappRouter.get("/accounts", requirePermission("settings:read"), async (req, res) => {
  const accounts = await WhatsAppAccount.find({ workspaceId: req.user.workspaceId }).sort({ createdAt: -1 });
  res.json({ data: accounts.map(serializeAccount), total: accounts.length });
});

whatsappRouter.get("/console", requirePermission("settings:read"), async (req, res) => {
  if (mongoose.connection.readyState !== 1) {
    return res.json({
      health: { status: "offline", connectedAccounts: 0, healthyWebhooks: 0, needsAttention: 0 },
      messageStats: { inbound: 0, outbound: 0, sent: 0, delivered: 0, failed: 0 },
      templateStats: { total: 0, approved: 0, pending: 0, rejected: 0 },
      recentMessages: [],
      recentWebhookEvents: [],
    });
  }

  const workspaceId = req.user.workspaceId;
  const [
    accounts,
    messageStats,
    templateStats,
    recentMessages,
    recentWebhookEvents,
  ] = await Promise.all([
    WhatsAppAccount.find({ workspaceId }),
    Message.aggregate([
      { $match: { workspaceId: new mongoose.Types.ObjectId(workspaceId) } },
      {
        $group: {
          _id: null,
          inbound: { $sum: { $cond: [{ $eq: ["$direction", "inbound"] }, 1, 0] } },
          outbound: { $sum: { $cond: [{ $eq: ["$direction", "outbound"] }, 1, 0] } },
          sent: { $sum: { $cond: [{ $eq: ["$status", "sent"] }, 1, 0] } },
          delivered: { $sum: { $cond: [{ $eq: ["$status", "delivered"] }, 1, 0] } },
          failed: { $sum: { $cond: [{ $eq: ["$status", "failed"] }, 1, 0] } },
        },
      },
    ]),
    Template.aggregate([
      { $match: { workspaceId: new mongoose.Types.ObjectId(workspaceId) } },
      {
        $group: {
          _id: null,
          total: { $sum: 1 },
          approved: { $sum: { $cond: [{ $eq: ["$status", "approved"] }, 1, 0] } },
          pending: { $sum: { $cond: [{ $eq: ["$status", "pending"] }, 1, 0] } },
          rejected: { $sum: { $cond: [{ $eq: ["$status", "rejected"] }, 1, 0] } },
        },
      },
    ]),
    Message.find({ workspaceId })
      .populate("contactId", "name phone")
      .populate("whatsappAccountId", "displayName phoneNumberId")
      .sort({ createdAt: -1 })
      .limit(10),
    WebhookEvent.find({ workspaceId })
      .sort({ createdAt: -1 })
      .limit(10),
  ]);

  const stats = messageStats[0] || {};
  const templates = templateStats[0] || {};
  const connectedAccounts = accounts.filter((account) => account.status === "connected").length;
  const healthyWebhooks = accounts.filter((account) => account.webhookStatus === "healthy").length;
  const needsAttention = accounts.filter((account) => account.status === "needs_attention").length;

  res.json({
    health: {
      status: connectedAccounts > 0 && needsAttention === 0 ? "healthy" : connectedAccounts > 0 ? "attention" : "offline",
      connectedAccounts,
      healthyWebhooks,
      needsAttention,
    },
    messageStats: {
      inbound: stats.inbound || 0,
      outbound: stats.outbound || 0,
      sent: stats.sent || 0,
      delivered: stats.delivered || 0,
      failed: stats.failed || 0,
    },
    templateStats: {
      total: templates.total || 0,
      approved: templates.approved || 0,
      pending: templates.pending || 0,
      rejected: templates.rejected || 0,
    },
    recentMessages: recentMessages.map((message) => ({
      id: message._id.toString(),
      direction: message.direction,
      type: message.type,
      body: message.body || "",
      status: message.status,
      contact: message.contactId?.name || message.contactId?.phone || "Unknown",
      phone: message.contactId?.phone || "",
      account: message.whatsappAccountId?.displayName || "Default",
      providerMessageId: message.providerMessageId || "",
      time: shortTime(message.sentAt || message.receivedAt || message.createdAt),
    })),
    recentWebhookEvents: recentWebhookEvents.map((event) => ({
      id: event._id.toString(),
      eventType: event.eventType,
      status: event.status,
      error: event.error || "",
      idempotencyKey: event.idempotencyKey,
      time: shortTime(event.createdAt),
    })),
  });
});

// accountId stays optional and tolerant of an invalid id - the handler already silently falls
// back to "all templates in workspace" rather than rejecting, and no real caller sends this today.
export const listWhatsappTemplatesQuerySchema = z.object({
  accountId: z.string().optional(),
});

// Only name is genuinely required - the handler defaults accountId/language/category/body itself
// (falls back to the most-recently-connected account, "en", "UTILITY", "" respectively).
export const createWhatsappTemplateSchema = z.object({
  accountId: optionalObjectIdString,
  name: trimmedString("Template name is required."),
  language: z.string().trim().optional().default("en"),
  category: z.string().trim().optional().default("UTILITY"),
  body: z.string().optional().default(""),
});

export const connectAccountSchema = z.object({
  provider: z.preprocess(
    (value) => String(value || "meta").toLowerCase(),
    z.enum(["meta", "twilio", "wati"], { message: "Provider must be Meta, Twilio, or Wati." })
  ),
  displayName: trimmedString("Display name is required."),
  phoneNumber: trimmedString("Phone number is required."),
  phoneNumberId: trimmedString("Phone number ID is required."),
  businessAccountId: trimmedString("Business account ID is required."),
  accessToken: z.string().optional().default("local-placeholder-token"),
  accountSid: z.string().optional().default(""),
  authToken: z.string().optional().default(""),
  apiKey: z.string().optional().default(""),
  apiBaseUrl: z.string().optional().default(""),
  tenantId: z.string().optional().default(""),
  verifyToken: z.string().optional().default(""),
  appSecret: z.string().optional().default(""),
  conversionsDatasetId: z.string().optional().default(""),
  conversionsTestEventCode: z.string().optional().default(""),
  catalogId: z.string().optional().default(""),
  catalogAccessToken: z.string().optional().default(""),
});

export const embeddedSignupSchema = z.object({
  code: trimmedString("Authorization code is required."),
  wabaId: trimmedString("WhatsApp Business Account ID is required."),
  phoneNumberId: trimmedString("Phone number ID is required."),
  displayName: z.string().optional().default(""),
  phoneNumber: z.string().optional().default(""),
});

whatsappRouter.post("/accounts", requirePermission("settings:write"), validateBody(connectAccountSchema), async (req, res) => {
  const {
    provider: providerKey,
    displayName,
    phoneNumber,
    phoneNumberId,
    businessAccountId,
    accessToken,
    accountSid,
    authToken,
    apiKey,
    apiBaseUrl,
    tenantId,
    verifyToken,
    appSecret,
    conversionsDatasetId,
    conversionsTestEventCode,
    catalogId,
    catalogAccessToken,
  } = req.body;

  const existingAccount = await WhatsAppAccount.findOne({ workspaceId: req.user.workspaceId, phoneNumberId });
  const existingCredentials = existingAccount ? decodeCredentials(existingAccount) : {};
  const tokenValue = cleanString(accessToken) || existingCredentials.accessToken || process.env.WHATSAPP_ACCESS_TOKEN || "local-placeholder-token";
  const verifyTokenValue = cleanString(verifyToken) || existingCredentials.verifyToken || process.env.WHATSAPP_VERIFY_TOKEN || config.whatsappVerifyToken;
  const appSecretValue = cleanString(appSecret) || existingCredentials.appSecret || process.env.WHATSAPP_APP_SECRET || "";
  // Reading a catalog's products needs the catalog_management permission - a genuinely different
  // scope from whatsapp_business_messaging/management (confirmed live: the main WhatsApp token got
  // a real "(#100) not been approved" error on the products endpoint until a separate token was
  // generated for the app's "Manage products with Catalog API" use case). Stored alongside the
  // other credentials, same encrypted blob, same "blank keeps the existing value" convention.
  const catalogAccessTokenValue = cleanString(catalogAccessToken) || existingCredentials.catalogAccessToken || "";

  const credentials = {
    ...existingCredentials,
    provider: providerKey,
    accessToken: tokenValue,
    accountSid: cleanString(accountSid) || existingCredentials.accountSid || "",
    authToken: cleanString(authToken) || existingCredentials.authToken || "",
    apiKey: cleanString(apiKey) || existingCredentials.apiKey || "",
    apiBaseUrl: cleanString(apiBaseUrl) || existingCredentials.apiBaseUrl || "",
    verifyToken: verifyTokenValue,
    appSecret: appSecretValue,
    catalogAccessToken: catalogAccessTokenValue,
  };

  const account = await WhatsAppAccount.findOneAndUpdate(
    { workspaceId: req.user.workspaceId, phoneNumberId },
    {
      organizationId: req.user.organizationId,
      workspaceId: req.user.workspaceId,
      displayName,
      phoneNumber,
      phoneNumberId,
      businessAccountId,
      encryptedCredentials: encodeCredentials(credentials),
      conversionsDatasetId: cleanString(conversionsDatasetId) || existingAccount?.conversionsDatasetId || "",
      conversionsTestEventCode: cleanString(conversionsTestEventCode) || existingAccount?.conversionsTestEventCode || "",
      catalogId: cleanString(catalogId) || existingAccount?.catalogId || "",
      provider: providerKey,
      providerConfig: {
        tenantId: tenantId || businessAccountId,
        apiBaseUrl,
        webhookPath: providerKey === "meta" ? "/webhooks/whatsapp" : `/webhooks/whatsapp/${providerKey}`,
      },
      webhookStatus: "healthy",
      templateSyncStatus: "pending",
      status: "connected",
      lastError: "",
      credentialsUpdatedAt: new Date(),
    },
    { upsert: true, new: true, setDefaultsOnInsert: true }
  );

  res.status(201).json({ data: serializeAccount(account) });
});

// The self-serve counterpart to the manual "Add account" form above - a client completes Meta's
// Embedded Signup popup entirely themselves (no phone/business/token details to hunt down and
// hand to Nemnidhi staff), the browser posts the resulting code/wabaId/phoneNumberId here, and
// this does the same three server-side calls every Tech Provider integration needs before the
// account is usable: exchange the code, register the number, subscribe to its webhooks.
whatsappRouter.post("/accounts/embedded-signup", requirePermission("settings:write"), validateBody(embeddedSignupSchema), async (req, res) => {
  const { code, wabaId, phoneNumberId, displayName, phoneNumber } = req.body;

  let accessToken;
  let pin;
  try {
    ({ accessToken, pin } = await completeEmbeddedSignup({ code, wabaId, phoneNumberId }));
  } catch (error) {
    logger.warn({ err: error, wabaId, phoneNumberId }, "Embedded Signup completion failed");
    return res.status(error.status || 502).json({
      error: error.code || "EMBEDDED_SIGNUP_FAILED",
      message: error.message || "Embedded Signup could not be completed.",
    });
  }

  const account = await WhatsAppAccount.findOneAndUpdate(
    { workspaceId: req.user.workspaceId, phoneNumberId },
    {
      organizationId: req.user.organizationId,
      workspaceId: req.user.workspaceId,
      displayName: displayName || `WhatsApp ${phoneNumber || phoneNumberId}`,
      phoneNumber: phoneNumber || "",
      phoneNumberId,
      businessAccountId: wabaId,
      encryptedCredentials: encodeCredentials({
        provider: "meta",
        accessToken,
        verifyToken: config.whatsappVerifyToken,
        appSecret: config.meta.appSecret,
      }),
      provider: "meta",
      providerConfig: { webhookPath: "/webhooks/whatsapp" },
      webhookStatus: "healthy",
      templateSyncStatus: "pending",
      status: "connected",
      lastError: "",
      credentialsUpdatedAt: new Date(),
    },
    { upsert: true, new: true, setDefaultsOnInsert: true }
  );

  // pin is intentionally only ever in this one response, never stored - it's the account's new
  // two-step verification PIN, shown once so the customer can save it themselves.
  res.status(201).json({ data: serializeAccount(account), pin });
});

whatsappRouter.delete("/accounts/:id", requirePermission("settings:write"), async (req, res) => {
  if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
    return res.status(404).json({ error: "NOT_FOUND", message: "WhatsApp account not found." });
  }

  const account = await WhatsAppAccount.findOneAndDelete({ _id: req.params.id, workspaceId: req.user.workspaceId });

  if (!account) {
    return res.status(404).json({ error: "NOT_FOUND", message: "WhatsApp account not found." });
  }

  await Template.deleteMany({ whatsappAccountId: account._id, workspaceId: req.user.workspaceId });
  res.sendStatus(204);
});

whatsappRouter.get("/templates", requirePermission("settings:read"), validateQuery(listWhatsappTemplatesQuerySchema), async (req, res) => {
  const filter = { workspaceId: req.user.workspaceId };
  if (req.query.accountId && mongoose.Types.ObjectId.isValid(req.query.accountId)) {
    filter.whatsappAccountId = req.query.accountId;
  }

  const templates = await Template.find(filter).sort({ status: 1, name: 1 });
  res.json({ data: templates.map(serializeTemplate), total: templates.length });
});

whatsappRouter.post("/templates", requirePermission("settings:write"), validateBody(createWhatsappTemplateSchema), async (req, res) => {
  const { accountId, name, language, category, body } = req.body;

  const accountFilter = {
    workspaceId: req.user.workspaceId,
    status: mongoose.trusted({ $in: ["connected", "needs_attention"] }),
  };
  if (accountId && mongoose.Types.ObjectId.isValid(accountId)) {
    accountFilter._id = accountId;
  }

  const account = await WhatsAppAccount.findOne(accountFilter).sort({ createdAt: -1 });
  if (!account) {
    return res.status(404).json({ error: "NOT_FOUND", message: "Connected WhatsApp account not found." });
  }

  const components = body.trim()
    ? [
        {
          type: "BODY",
          text: body.trim(),
        },
      ]
    : [];

  const template = await Template.findOneAndUpdate(
    {
      workspaceId: req.user.workspaceId,
      whatsappAccountId: account._id,
      name: name.trim(),
      language: language.trim() || "en",
    },
    {
      organizationId: req.user.organizationId,
      workspaceId: req.user.workspaceId,
      whatsappAccountId: account._id,
      providerTemplateId: name.trim(),
      name: name.trim(),
      language: language.trim() || "en",
      category: category.trim() || "UTILITY",
      components,
      status: "approved",
      lastSyncedAt: new Date(),
    },
    { upsert: true, new: true, setDefaultsOnInsert: true }
  );

  res.status(201).json({ data: serializeTemplate(template) });
});

whatsappRouter.post("/accounts/:id/sync-templates", requirePermission("settings:write"), async (req, res) => {
  const account = await WhatsAppAccount.findOne({ _id: req.params.id, workspaceId: req.user.workspaceId });

  if (!account) {
    return res.status(404).json({ error: "NOT_FOUND", message: "WhatsApp account not found." });
  }

  const syncedTemplates = await fetchWhatsAppTemplates(account);

  for (const item of syncedTemplates) {
    await Template.findOneAndUpdate(
      { workspaceId: req.user.workspaceId, whatsappAccountId: account._id, name: item.name, language: item.language || "en" },
      {
        organizationId: req.user.organizationId,
        workspaceId: req.user.workspaceId,
        whatsappAccountId: account._id,
        providerTemplateId: item.providerTemplateId || item.name,
        name: item.name,
        language: item.language || "en",
        category: item.category,
        components: item.components || [],
        status: item.status || "approved",
        lastSyncedAt: new Date(),
      },
      { upsert: true, new: true, setDefaultsOnInsert: true }
    );
  }

  account.templateSyncStatus = "synced";
  account.lastSyncedAt = new Date();
  await account.save();

  const templates = await Template.find({ whatsappAccountId: account._id, workspaceId: req.user.workspaceId });
  res.json({ account: serializeAccount(account), templates: templates.map(serializeTemplate) });
});

whatsappRouter.post("/accounts/:id/test", requirePermission("settings:write"), async (req, res) => {
  if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
    return res.status(404).json({ error: "NOT_FOUND", message: "WhatsApp account not found." });
  }

  const account = await WhatsAppAccount.findOne({ _id: req.params.id, workspaceId: req.user.workspaceId });
  if (!account) {
    return res.status(404).json({ error: "NOT_FOUND", message: "WhatsApp account not found." });
  }

  const wasNeedsAttention = account.status === "needs_attention";

  try {
    const result = await testWhatsAppConnection(account);
    account.status = "connected";
    account.webhookStatus = "healthy";
    account.lastSyncedAt = new Date();
    account.lastTestedAt = new Date();
    account.lastError = "";
    await account.save();
    // Only worth telling Vega about a recovery, not every routine "still healthy" test click -
    // the interesting signal is the account coming back, not that it stayed fine.
    if (wasNeedsAttention) {
      notifyVega(account.organizationId.toString(), "whatsapp_account_recovered", {
        accountId: account._id.toString(),
        phoneNumber: account.phoneNumber,
      }).catch(() => undefined);
    }
    res.json({ result, account: serializeAccount(account) });
  } catch (error) {
    account.status = "needs_attention";
    account.webhookStatus = "needs_attention";
    account.lastTestedAt = new Date();
    account.lastError = error.message || "Connection test failed.";
    await account.save();
    notifyWorkspace(req.user.workspaceId, "whatsappNeedsAttention", {
      subject: `WhatsApp account "${account.displayName}" needs attention`,
      body: `The connection test for "${account.displayName}" (${account.phoneNumber}) failed: ${account.lastError}`,
    });
    notifyVega(account.organizationId.toString(), "whatsapp_account_needs_attention", {
      accountId: account._id.toString(),
      phoneNumber: account.phoneNumber,
      error: account.lastError,
    }).catch(() => undefined);
    res.status(error.status || 502).json({
      error: error.code || "CONNECTION_TEST_FAILED",
      message: error.message || "Connection test failed.",
      account: serializeAccount(account),
    });
  }
});

whatsappRouter.post("/accounts/:id/test-conversion-event", requirePermission("settings:write"), async (req, res) => {
  if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
    return res.status(404).json({ error: "NOT_FOUND", message: "WhatsApp account not found." });
  }

  const account = await WhatsAppAccount.findOne({ _id: req.params.id, workspaceId: req.user.workspaceId });
  if (!account) {
    return res.status(404).json({ error: "NOT_FOUND", message: "WhatsApp account not found." });
  }

  if (!account.conversionsDatasetId) {
    return res.status(400).json({ error: "CONVERSIONS_NOT_CONFIGURED", message: "Set a Conversions Dataset ID on this account first." });
  }

  try {
    const result = await sendConversionEvent(account, {
      eventName: "QualifiedLead",
      ctwaClid: `demo-${Date.now()}`,
      testEventCode: account.conversionsTestEventCode || undefined,
    });
    res.json({ result });
  } catch (error) {
    res.status(error.status || 502).json({
      error: error.code || "META_CONVERSIONS_TEST_FAILED",
      message: error.message || "Test conversion event failed.",
    });
  }
});

whatsappRouter.get("/accounts/:id/catalog/products", requirePermission("settings:read"), async (req, res) => {
  if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
    return res.status(404).json({ error: "NOT_FOUND", message: "WhatsApp account not found." });
  }

  const account = await WhatsAppAccount.findOne({ _id: req.params.id, workspaceId: req.user.workspaceId });
  if (!account) {
    return res.status(404).json({ error: "NOT_FOUND", message: "WhatsApp account not found." });
  }

  if (!account.catalogId) {
    return res.status(400).json({ error: "CATALOG_NOT_CONFIGURED", message: "Set a Catalog ID on this account first." });
  }

  try {
    const products = await fetchCatalogProducts({ account, catalogId: account.catalogId, search: req.query.search || "" });
    res.json({ data: products });
  } catch (error) {
    // Never forward Meta's own 401/403 as this response's status - the client's shared request()
    // helper treats ANY 401 as "this admin's own login session is invalid" and force-logs them out
    // (confirmed live: a fake local dev token's real Meta 401 here triggered a full app logout,
    // not just an error on this one action). A downstream Graph API auth failure is a completely
    // different thing from this app's own session expiring - always answer with 502 instead,
    // preserving the real Meta error code/message in the body for debugging.
    const status = error.status === 401 || error.status === 403 ? 502 : error.status || 502;
    res.status(status).json({ error: error.code || "WHATSAPP_CATALOG_FETCH_FAILED", message: error.message });
  }
});

whatsappWebhookRouter.get("/", async (req, res) => {
  const mode = req.query["hub.mode"];
  const token = req.query["hub.verify_token"];
  const challenge = req.query["hub.challenge"];

  if (mode === "subscribe" && await hasMatchingVerifyToken(token)) {
    return res.status(200).send(challenge);
  }

  res.sendStatus(403);
});

async function findWebhookAccount(normalized, provider = "meta") {
  if (!normalized.phoneNumberId) return null;
  const lookup = String(normalized.phoneNumberId);
  return WhatsAppAccount.findOne({
    provider,
    $or: [
      { phoneNumberId: lookup },
      { phoneNumber: lookup },
      { businessAccountId: lookup },
      { "providerConfig.tenantId": lookup },
    ],
  });
}

async function handleProviderWebhook({ normalized, provider, req, res }) {
  const account = await findWebhookAccount(normalized, provider);

  if (provider === "meta" && account) {
    const credentials = decodeCredentials(account);
    if (!hasValidMetaSignature(req, credentials.appSecret)) {
      return res.status(403).json({ error: "INVALID_SIGNATURE", message: "WhatsApp webhook signature verification failed." });
    }
  }

  const event = await WebhookEvent.findOneAndUpdate(
    { idempotencyKey: normalized.idempotencyKey },
    {
      organizationId: account?.organizationId,
      workspaceId: account?.workspaceId,
      provider,
      eventType: normalized.type,
      payload: normalized.raw,
      status: "received",
    },
    { upsert: true, new: true, setDefaultsOnInsert: true }
  );

  try {
    if (normalized.type === "message" && account) {
      const existingMessage = normalized.providerMessageId
        ? await Message.findOne({ workspaceId: account.workspaceId, providerMessageId: normalized.providerMessageId }).select("_id conversationId")
        : null;
      if (existingMessage) {
        event.status = "processed";
        event.processedAt = new Date();
        event.metadata = {
          ...(event.metadata || {}),
          duplicateMessage: true,
          messageId: existingMessage._id,
        };
        await event.save();
        await publishConversationChanged(existingMessage.conversationId);
        return res.sendStatus(200);
      }

      const isAdLead = isMetaAdReferral(normalized.referral);
      const attachments = await resolveInboundMedia({ account, normalized, baseUrl: absoluteBaseUrl(req) });
      const flowResponseSummary = normalized.flowResponse
        ? Object.entries(normalized.flowResponse.data)
          .map(([key, value]) => `${key}: ${value}`)
          .join(", ")
        : "";
      const messageBody = normalized.body || attachments[0]?.caption || flowResponseSummary || normalized.order?.text || "";
      const messageType = attachments[0]?.type || mediaTypeFor(attachments[0]?.mimeType || "") || "text";
      const found = await findReusableContactAndConversation({ account, phone: normalized.from });
      const waName = normalized.profile?.waName || found.contact?.waName || found.contact?.name || normalized.from;
      const profilePhoto = normalized.profile?.profilePhoto || found.contact?.profilePhoto || "";
      const source = isAdLead ? "Meta Ad" : found.contact?.source || "WhatsApp";
      const campaign = normalized.campaign || normalized.referral?.headline || normalized.referral?.source_id || "";
      const existingCustomFields = found.contact?.customFields && typeof found.contact.customFields === "object"
        ? found.contact.customFields
        : {};
      const contactUpdate = {
        organizationId: account.organizationId,
        workspaceId: account.workspaceId,
        name: found.contact?.name || waName || normalized.from,
        waName,
        profilePhoto,
        phone: found.contact?.phone || normalized.from,
        source,
        customFields: {
          ...existingCustomFields,
          ...(isAdLead ? { metaAdReferral: normalized.referral, leadSource: "meta_ad" } : {}),
          whatsapp: {
            ...(existingCustomFields.whatsapp || {}),
            phone: normalized.from,
            waName,
            profilePhoto,
            source: isAdLead ? "meta_ad" : "whatsapp_inbound",
            campaign,
            location: normalized.location || existingCustomFields.whatsapp?.location || null,
          },
        },
        lifecycleStatus: found.contact?.lifecycleStatus || "lead",
        lastMessageAt: new Date(),
      };
      let contact = found.contact
        ? await Contact.findByIdAndUpdate(found.contact._id, contactUpdate, { new: true })
        : await Contact.create(contactUpdate);

      const existingConversation = found.existingConversation;
      const conversation = existingConversation
        ? await Conversation.findByIdAndUpdate(existingConversation._id, {
          whatsappAccountId: account._id,
          status: "open",
          lastMessageAt: new Date(),
        }, { new: true })
        : await Conversation.create({
          organizationId: account.organizationId,
          workspaceId: account.workspaceId,
          contactId: contact._id,
          whatsappAccountId: account._id,
          status: "open",
          lastMessageAt: new Date(),
        });

      const message = await Message.findOneAndUpdate(
        { workspaceId: account.workspaceId, providerMessageId: normalized.providerMessageId },
        {
          organizationId: account.organizationId,
          workspaceId: account.workspaceId,
          conversationId: conversation._id,
          contactId: contact._id,
          whatsappAccountId: account._id,
          direction: "inbound",
          type: normalized.order ? "order" : normalized.flowResponse ? "flow_response" : attachments.length ? messageType : "text",
          body: messageBody,
          attachments,
          providerMessageId: normalized.providerMessageId,
          status: "delivered",
          receivedAt: new Date(),
          metadata: {
            ...(normalized.referral ? { referral: normalized.referral } : {}),
            ...(normalized.location ? { location: normalized.location } : {}),
            ...(normalized.profile ? { profile: normalized.profile } : {}),
            ...(campaign ? { campaign } : {}),
            ...(normalized.flowResponse ? { flowResponse: normalized.flowResponse } : {}),
            ...(normalized.order ? { order: normalized.order } : {}),
          },
        },
        { upsert: true, new: true, setDefaultsOnInsert: true }
      );

      conversation.lastMessageId = message._id;
      conversation.lastMessageAt = message.receivedAt || new Date();
      const leadDetection = detectWhatsAppLead({
        normalized,
        message,
        isAdLead,
        isFirstConversation: !existingConversation,
      });
      if (leadDetection.isLead) {
        const crmResult = await ensureConversationInCrm({
          contact,
          conversation,
          inboundMessage: message,
          normalized,
          source: isAdLead ? "meta_ad" : "whatsapp_inbound",
          stage: leadDetection.stage,
          detection: leadDetection,
        });
        contact = crmResult.contact || contact;
        syncLeadToGoogleSheetInBackground({
          contact,
          conversation,
          message,
          lead: crmResult.lead,
          onError: (sheetError) => {
            logger.warn({ err: sheetError }, "Google Sheet lead sync failed");
          },
        });
      }
      const memberships = await Membership.find({ workspaceId: account.workspaceId, status: "active" }).select("userId");
      for (const membership of memberships) {
        const key = membership.userId.toString();
        const current = Number(conversation.unreadCountByUser?.get?.(key) || 0);
        conversation.unreadCountByUser.set(key, current + 1);
      }
      conversation.markModified("unreadCountByUser");
      await conversation.save();
      await publishConversationChanged(conversation._id);
      const automationResults = await runInboundAutomations({
        account,
        contact,
        conversation,
        inboundMessage: message,
        isNewConversation: !existingConversation,
        isNewLead: Boolean(leadDetection.isLead),
      });
      if (automationResults.length) {
        event.metadata = {
          ...(event.metadata || {}),
          automationResults,
        };
      }
    }

    if (normalized.type === "status" && account) {
      const status = ["sent", "delivered", "read", "failed"].includes(normalized.status) ? normalized.status : "delivered";
      const now = new Date();
      const message = await Message.findOneAndUpdate(
        { workspaceId: account.workspaceId, providerMessageId: normalized.providerMessageId },
        {
          status,
          ...(status === "delivered" || status === "read" ? { deliveredAt: now } : {}),
          ...(status === "read" ? { readAt: now } : {}),
          ...(status === "failed" ? { "metadata.statusError": normalized.raw?.errors || normalized.raw?.error || null } : {}),
        },
        { new: true }
      );

      if (message) {
        const campaignId = message.metadata?.campaignId;
        if (campaignId) {
          const campaign = await Campaign.findOne({ _id: campaignId, workspaceId: account.workspaceId });
          if (campaign) {
            const nowValue = now;
            const updateRecipient = (recipient = {}) => {
              if (recipient.providerMessageId !== normalized.providerMessageId) return recipient;
              return {
                ...recipient,
                status,
                error: status === "failed" ? JSON.stringify(normalized.raw?.errors || normalized.raw?.error || "") : recipient.error || "",
                deliveredAt: status === "delivered" || status === "read" ? (recipient.deliveredAt || nowValue) : recipient.deliveredAt,
                readAt: status === "read" ? (recipient.readAt || nowValue) : recipient.readAt,
              };
            };
            const deliveryResults = (campaign.deliveryResults?.length ? campaign.deliveryResults : campaign.recipients || []).map(updateRecipient);
            const counts = deliveryResults.reduce(
              (acc, recipient) => {
                const recipientStatus = recipient.status || "queued";
                if (recipientStatus === "sent") acc.sent += 1;
                if (recipientStatus === "delivered") acc.delivered += 1;
                if (recipientStatus === "read") {
                  acc.delivered += 1;
                  acc.read += 1;
                }
                if (recipientStatus === "failed") acc.failed += 1;
                return acc;
              },
              { sent: 0, delivered: 0, read: 0, failed: 0 }
            );
            campaign.deliveryResults = deliveryResults;
            campaign.recipients = deliveryResults;
            campaign.metrics = {
              ...(campaign.metrics || {}),
              recipients: deliveryResults.length || Number(campaign.metrics?.recipients || 0),
              sent: Math.max(Number(campaign.metrics?.sent || 0), counts.sent + counts.delivered),
              delivered: counts.delivered,
              read: counts.read,
              failed: counts.failed,
            };
            campaign.queue = {
              ...(campaign.queue || {}),
              failed: counts.failed,
              completed: Math.max(Number(campaign.queue?.completed || 0), counts.sent + counts.delivered),
            };
            await campaign.save();
          }
        }
        await publishConversationChanged(message.conversationId);
      }
    }

    event.status = "processed";
    event.processedAt = new Date();
    await event.save();
  } catch (error) {
    event.status = "failed";
    event.error = error.message;
    await event.save();
  }

  res.sendStatus(200);
}

whatsappWebhookRouter.post("/", async (req, res) => {
  await handleProviderWebhook({ normalized: normalizeWebhookPayload(req.body), provider: "meta", req, res });
});

whatsappWebhookRouter.post("/twilio", async (req, res) => {
  await handleProviderWebhook({ normalized: normalizeTwilioWebhookPayload(req.body), provider: "twilio", req, res });
});

whatsappWebhookRouter.post("/wati", async (req, res) => {
  await handleProviderWebhook({ normalized: normalizeWatiWebhookPayload(req.body), provider: "wati", req, res });
});





