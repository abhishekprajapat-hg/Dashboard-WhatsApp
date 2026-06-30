import { Router } from "express";
import mongoose from "mongoose";
import { config } from "../config.js";
import {
  Contact,
  Conversation,
  Membership,
  Message,
  Template,
  WebhookEvent,
  WhatsAppAccount,
} from "../models/index.js";
import { requireAuth } from "../middleware/auth.js";
import { publishConversationChanged } from "../realtime/events.js";
import { ensureConversationInCrm } from "../services/crm.js";
import { syncLeadToGoogleSheet } from "../services/googleSheets.js";
import { runInboundAutomations } from "../services/automationRunner.js";
import { absoluteBaseUrl, mediaTypeFor } from "../services/mediaStorage.js";
import {
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
  return {
    id: account._id.toString(),
    displayName: account.displayName,
    phoneNumber: account.phoneNumber,
    phoneNumberId: account.phoneNumberId,
    businessAccountId: account.businessAccountId,
    provider: account.provider,
    providerConfig: account.providerConfig || {},
    webhookStatus: account.webhookStatus,
    templateSyncStatus: account.templateSyncStatus,
    status: account.status,
    lastSyncedAt: account.lastSyncedAt,
  };
}

function isMetaAdReferral(referral) {
  return String(referral?.source_type || "").toLowerCase() === "ad";
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

whatsappRouter.use(requireAuth);

function shortTime(date) {
  if (!date) return "";
  return new Date(date).toLocaleString("en-IN", {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

whatsappRouter.get("/accounts", async (req, res) => {
  const accounts = await WhatsAppAccount.find({ workspaceId: req.user.workspaceId }).sort({ createdAt: -1 });
  res.json({ data: accounts.map(serializeAccount), total: accounts.length });
});

whatsappRouter.get("/console", async (req, res) => {
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

whatsappRouter.post("/accounts", async (req, res) => {
  const {
    provider = "meta",
    displayName,
    phoneNumber,
    phoneNumberId,
    businessAccountId,
    accessToken = "local-placeholder-token",
    accountSid = "",
    authToken = "",
    apiKey = "",
    apiBaseUrl = "",
    tenantId = "",
  } = req.body || {};

  const providerKey = String(provider || "meta").toLowerCase();
  if (!["meta", "twilio", "wati"].includes(providerKey)) {
    return res.status(400).json({ error: "VALIDATION_ERROR", message: "Provider must be Meta, Twilio, or Wati." });
  }

  if (!displayName || !phoneNumber || !phoneNumberId || !businessAccountId) {
    return res.status(400).json({
      error: "VALIDATION_ERROR",
      message: "Display name, phone number, phone number ID, and business account ID are required.",
    });
  }

  const credentials = {
    provider: providerKey,
    accessToken,
    accountSid,
    authToken,
    apiKey,
    apiBaseUrl,
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
      encryptedCredentials: Buffer.from(JSON.stringify(credentials)).toString("base64"),
      provider: providerKey,
      providerConfig: {
        tenantId: tenantId || businessAccountId,
        apiBaseUrl,
        webhookPath: providerKey === "meta" ? "/webhooks/whatsapp" : `/webhooks/whatsapp/${providerKey}`,
      },
      webhookStatus: "healthy",
      templateSyncStatus: "pending",
      status: "connected",
    },
    { upsert: true, new: true, setDefaultsOnInsert: true }
  );

  res.status(201).json({ data: serializeAccount(account) });
});

whatsappRouter.delete("/accounts/:id", async (req, res) => {
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

whatsappRouter.get("/templates", async (req, res) => {
  const filter = { workspaceId: req.user.workspaceId };
  if (req.query.accountId && mongoose.Types.ObjectId.isValid(req.query.accountId)) {
    filter.whatsappAccountId = req.query.accountId;
  }

  const templates = await Template.find(filter).sort({ status: 1, name: 1 });
  res.json({ data: templates.map(serializeTemplate), total: templates.length });
});

whatsappRouter.post("/templates", async (req, res) => {
  const { accountId, name = "", language = "en", category = "UTILITY", body = "" } = req.body || {};

  if (!name.trim()) {
    return res.status(400).json({ error: "VALIDATION_ERROR", message: "Template name is required." });
  }

  const accountFilter = {
    workspaceId: req.user.workspaceId,
    status: { $in: ["connected", "needs_attention"] },
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

whatsappRouter.post("/accounts/:id/sync-templates", async (req, res) => {
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

whatsappRouter.post("/accounts/:id/test", async (req, res) => {
  if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
    return res.status(404).json({ error: "NOT_FOUND", message: "WhatsApp account not found." });
  }

  const account = await WhatsAppAccount.findOne({ _id: req.params.id, workspaceId: req.user.workspaceId });
  if (!account) {
    return res.status(404).json({ error: "NOT_FOUND", message: "WhatsApp account not found." });
  }

  try {
    const result = await testWhatsAppConnection(account);
    account.status = "connected";
    account.webhookStatus = "healthy";
    account.lastSyncedAt = new Date();
    await account.save();
    res.json({ result, account: serializeAccount(account) });
  } catch (error) {
    account.status = "needs_attention";
    account.webhookStatus = "needs_attention";
    await account.save();
    res.status(error.status || 502).json({
      error: error.code || "CONNECTION_TEST_FAILED",
      message: error.message || "Connection test failed.",
      account: serializeAccount(account),
    });
  }
});

whatsappWebhookRouter.get("/", (req, res) => {
  const mode = req.query["hub.mode"];
  const token = req.query["hub.verify_token"];
  const challenge = req.query["hub.challenge"];

  if (mode === "subscribe" && token === config.whatsappVerifyToken) {
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
      const isAdLead = isMetaAdReferral(normalized.referral);
      const attachments = await resolveInboundMedia({ account, normalized, baseUrl: absoluteBaseUrl(req) });
      const messageBody = normalized.body || attachments[0]?.caption || (attachments.length ? "Attachment" : "");
      const messageType = attachments[0]?.type || mediaTypeFor(attachments[0]?.mimeType || "") || "text";
      const contact = await Contact.findOneAndUpdate(
        { workspaceId: account.workspaceId, phone: normalized.from },
        {
          organizationId: account.organizationId,
          workspaceId: account.workspaceId,
          name: normalized.from,
          phone: normalized.from,
          source: isAdLead ? "Meta Ad" : "WhatsApp",
          ...(isAdLead
            ? {
                "customFields.metaAdReferral": normalized.referral,
                "customFields.leadSource": "meta_ad",
              }
            : {}),
          lifecycleStatus: "lead",
          lastMessageAt: new Date(),
        },
        { upsert: true, new: true, setDefaultsOnInsert: true }
      );

      const existingConversation = await Conversation.findOne({
        workspaceId: account.workspaceId,
        contactId: contact._id,
        status: { $ne: "resolved" },
      });

      const conversation = await Conversation.findOneAndUpdate(
        { workspaceId: account.workspaceId, contactId: contact._id, status: { $ne: "resolved" } },
        {
          organizationId: account.organizationId,
          workspaceId: account.workspaceId,
          contactId: contact._id,
          whatsappAccountId: account._id,
          status: "open",
          lastMessageAt: new Date(),
        },
        { upsert: true, new: true, setDefaultsOnInsert: true }
      );

      const message = await Message.findOneAndUpdate(
        { workspaceId: account.workspaceId, providerMessageId: normalized.providerMessageId },
        {
          organizationId: account.organizationId,
          workspaceId: account.workspaceId,
          conversationId: conversation._id,
          contactId: contact._id,
          whatsappAccountId: account._id,
          direction: "inbound",
          type: attachments.length ? messageType : "text",
          body: messageBody,
          attachments,
          providerMessageId: normalized.providerMessageId,
          status: "delivered",
          receivedAt: new Date(),
          metadata: normalized.referral ? { referral: normalized.referral } : {},
        },
        { upsert: true, new: true, setDefaultsOnInsert: true }
      );

      conversation.lastMessageId = message._id;
      conversation.lastMessageAt = message.receivedAt || new Date();
      await ensureConversationInCrm({ contact, conversation, source: isAdLead ? "meta_ad" : "whatsapp_inbound" });
      if (isAdLead) {
        try {
          await syncLeadToGoogleSheet({ contact, conversation, message });
        } catch (sheetError) {
          event.error = `Google Sheet sync failed: ${sheetError.message}`;
        }
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
      });
      if (automationResults.length) {
        event.metadata = {
          ...(event.metadata || {}),
          automationResults,
        };
      }
    }

    if (normalized.type === "status" && account) {
      const message = await Message.findOneAndUpdate(
        { workspaceId: account.workspaceId, providerMessageId: normalized.providerMessageId },
        { status: normalized.status },
        { new: true }
      );

      if (message) {
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





