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
import { fetchWhatsAppTemplates, normalizeWebhookPayload } from "../services/whatsappProvider.js";

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

whatsappRouter.get("/accounts", async (req, res) => {
  const accounts = await WhatsAppAccount.find({ workspaceId: req.user.workspaceId }).sort({ createdAt: -1 });
  res.json({ data: accounts.map(serializeAccount), total: accounts.length });
});

whatsappRouter.post("/accounts", async (req, res) => {
  const {
    displayName,
    phoneNumber,
    phoneNumberId,
    businessAccountId,
    accessToken = "local-placeholder-token",
  } = req.body || {};

  if (!displayName || !phoneNumber || !phoneNumberId || !businessAccountId) {
    return res.status(400).json({
      error: "VALIDATION_ERROR",
      message: "Display name, phone number, phone number ID, and business account ID are required.",
    });
  }

  const account = await WhatsAppAccount.findOneAndUpdate(
    { workspaceId: req.user.workspaceId, phoneNumberId },
    {
      organizationId: req.user.organizationId,
      workspaceId: req.user.workspaceId,
      displayName,
      phoneNumber,
      phoneNumberId,
      businessAccountId,
      encryptedCredentials: Buffer.from(accessToken).toString("base64"),
      provider: "meta",
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

whatsappWebhookRouter.get("/", (req, res) => {
  const mode = req.query["hub.mode"];
  const token = req.query["hub.verify_token"];
  const challenge = req.query["hub.challenge"];

  if (mode === "subscribe" && token === config.whatsappVerifyToken) {
    return res.status(200).send(challenge);
  }

  res.sendStatus(403);
});

whatsappWebhookRouter.post("/", async (req, res) => {
  const normalized = normalizeWebhookPayload(req.body);

  const account = normalized.phoneNumberId
    ? await WhatsAppAccount.findOne({ phoneNumberId: normalized.phoneNumberId })
    : null;

  const event = await WebhookEvent.findOneAndUpdate(
    { idempotencyKey: normalized.idempotencyKey },
    {
      organizationId: account?.organizationId,
      workspaceId: account?.workspaceId,
      provider: "meta",
      eventType: normalized.type,
      payload: normalized.raw,
      status: "received",
    },
    { upsert: true, new: true, setDefaultsOnInsert: true }
  );

  try {
    if (normalized.type === "message" && account) {
      const isAdLead = isMetaAdReferral(normalized.referral);
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
          type: "text",
          body: normalized.body,
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
});





