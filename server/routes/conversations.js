import { Router } from "express";
import mongoose from "mongoose";
import { z } from "zod";
import { conversations } from "../data/demoData.js";
import { Contact, Conversation, Membership, Message, Template } from "../models/index.js";
import { WhatsAppAccount } from "../models/index.js";
import { hasPermission, requirePermission } from "../middleware/auth.js";
import { validateBody } from "../middleware/validate.js";
import { publishConversationChanged } from "../realtime/events.js";
import { ensureConversationInCrm, normalizeLeadStage } from "../services/crm.js";
import { syncLeadToGoogleSheetInBackground } from "../services/googleSheets.js";
import { sendWhatsAppTemplate, sendWhatsAppText } from "../services/whatsappProvider.js";
import { serializeConversation, serializeMessage } from "../utils/serializers.js";
import { optionalObjectIdString } from "../utils/zodHelpers.js";

export const conversationsRouter = Router();

conversationsRouter.use(requirePermission("inbox:read"));

const updateStatusSchema = z.object({
  status: z.preprocess(
    (value) => String(value || "").toLowerCase(),
    z.enum(["open", "waiting", "pending", "resolved", "archived"], { message: "A valid status is required." })
  ),
});

const updateSettingsSchema = z
  .object({
    pinned: z.boolean().optional(),
    muted: z.boolean().optional(),
  })
  .refine((data) => data.pinned !== undefined || data.muted !== undefined, {
    message: "No supported setting was provided.",
  });

const updateAssignmentSchema = z.object({
  userId: optionalObjectIdString.default(""),
});

const updateReceiptSchema = z.object({
  status: z.preprocess(
    (value) => String(value || "").toLowerCase(),
    z.enum(["delivered", "read"], { message: "Receipt status must be delivered or read." })
  ),
});

const updateMessageActionsSchema = z
  .object({
    pinned: z.boolean().optional(),
    starred: z.boolean().optional(),
  })
  .refine((data) => data.pinned !== undefined || data.starred !== undefined, {
    message: "No supported message action was provided.",
  });

function cleanAttachments(attachments = []) {
  if (!Array.isArray(attachments)) return [];
  return attachments
    .filter((attachment) => attachment?.url)
    .slice(0, 5)
    .map((attachment) => ({
      name: String(attachment.name || "Attachment").slice(0, 160),
      url: String(attachment.url),
      path: attachment.path ? String(attachment.path) : undefined,
      storage: attachment.storage ? String(attachment.storage) : undefined,
      providerMediaId: attachment.providerMediaId ? String(attachment.providerMediaId) : undefined,
      metaMediaId: attachment.metaMediaId ? String(attachment.metaMediaId) : undefined,
      type: String(attachment.type || "document"),
      mimeType: attachment.mimeType ? String(attachment.mimeType) : undefined,
      size: Number(attachment.size || 0),
    }));
}

function messageTypeForAttachments(attachments = []) {
  const type = attachments[0]?.type;
  if (["image", "video", "audio", "document"].includes(type)) return type;
  return "text";
}

function visibleMessagesFilter(conversationId, userId) {
  return {
    conversationId,
    deletedAt: mongoose.trusted({ $exists: false }),
    ...(userId ? { deletedForUserIds: mongoose.trusted({ $ne: userId }) } : {}),
  };
}

function paginationLimit(value, fallback = 50, max = 100) {
  const parsed = Number(value || fallback);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(1, Math.min(max, Math.floor(parsed)));
}

function cursorDate(value) {
  const date = value ? new Date(value) : null;
  return date && !Number.isNaN(date.getTime()) ? date : null;
}

function conversationVisibilityFilter(req) {
  const filter = { workspaceId: req.user.workspaceId };
  if (!hasPermission(req.user, "team:read")) {
    filter.$or = [{ assignedToUserId: req.user.sub }, { assignedToUserId: mongoose.trusted({ $exists: false }) }, { assignedToUserId: null }];
  }
  return filter;
}

conversationsRouter.get("/", async (req, res) => {
  if (mongoose.connection.readyState === 1 && mongoose.Types.ObjectId.isValid(req.user?.workspaceId)) {
    const status = String(req.query.status || "").toLowerCase();
    const search = String(req.query.search || "").trim();
    const unread = String(req.query.unread || "") === "true";
    const limit = paginationLimit(req.query.limit, 50, 100);
    const cursor = cursorDate(req.query.cursor);
    const filter = conversationVisibilityFilter(req);

    if (status) {
      filter.status = status === "waiting" ? "pending" : status;
    }
    if (unread) {
      filter[`unreadCountByUser.${req.user.sub}`] = mongoose.trusted({ $gt: 0 });
    }
    if (cursor) {
      filter.lastMessageAt = mongoose.trusted({ $lt: cursor });
    }
    if (search) {
      const phoneSearch = search.replace(/[^\d+]/g, "");
      const contactSearch = [
        { name: mongoose.trusted({ $regex: search, $options: "i" }) },
        { waName: mongoose.trusted({ $regex: search, $options: "i" }) },
      ];
      if (phoneSearch) {
        contactSearch.push({ phone: mongoose.trusted({ $regex: phoneSearch, $options: "i" }) });
      }
      const matchingContacts = await Contact.find({
        workspaceId: req.user.workspaceId,
        $or: contactSearch,
      }).select("_id");
      const matchingMessages = await Message.find({
        workspaceId: req.user.workspaceId,
        body: mongoose.trusted({ $regex: search, $options: "i" }),
      }).select("conversationId").limit(100);
      filter.$and = [
        ...(filter.$and || []),
        {
          $or: [
            { contactId: mongoose.trusted({ $in: matchingContacts.map((contact) => contact._id) }) },
            { _id: mongoose.trusted({ $in: matchingMessages.map((message) => message.conversationId) }) },
          ],
        },
      ];
    }

    let dbConversations = await Conversation.find(filter)
      .populate({ path: "contactId", populate: { path: "tagIds" } })
      .populate("assignedToUserId", "name")
      .populate("tagIds")
      .populate("lastMessageId")
      .sort({ lastMessageAt: -1, updatedAt: -1 })
      .limit(limit + 1);

    const hasMore = dbConversations.length > limit;
    dbConversations = dbConversations.slice(0, limit);

    const data = await Promise.all(
      dbConversations.map(async (conversation) => {
        const messages = await Message.find(visibleMessagesFilter(conversation._id, req.user.sub))
          .sort({ createdAt: -1, _id: -1 })
          .limit(50);
        messages.reverse();
        return serializeConversation(conversation, messages, { userId: req.user.sub });
      })
    );

    return res.json({
      data,
      total: data.length,
      page: {
        limit,
        hasMore,
        nextCursor: hasMore ? dbConversations[dbConversations.length - 1]?.lastMessageAt?.toISOString?.() : null,
      },
    });
  }

  const status = String(req.query.status || "").toLowerCase();
  const search = String(req.query.search || "").toLowerCase();
  let results = conversations;

  if (status) {
    results = results.filter((conversation) => conversation.status === status);
  }

  if (search) {
    results = results.filter((conversation) =>
      [conversation.name, conversation.phone, conversation.preview].some((value) => value.toLowerCase().includes(search))
    );
  }

  res.json({ data: results, total: results.length });
});

conversationsRouter.get("/unread-count", async (req, res) => {
  if (mongoose.connection.readyState !== 1 || !mongoose.Types.ObjectId.isValid(req.user?.workspaceId)) {
    return res.json({ unread: 0 });
  }

  const conversations = await Conversation.find(conversationVisibilityFilter(req)).select("unreadCountByUser");
  const unread = conversations.reduce(
    (total, conversation) => total + Number(conversation.unreadCountByUser?.get?.(req.user.sub) || 0),
    0
  );

  res.json({ unread });
});

conversationsRouter.get("/by-contact/:contactId", async (req, res) => {
  if (mongoose.connection.readyState !== 1 || !mongoose.Types.ObjectId.isValid(req.params.contactId)) {
    return res.status(404).json({ error: "NOT_FOUND", message: "Contact not found." });
  }

  const contact = await Contact.findOne({ _id: req.params.contactId, workspaceId: req.user.workspaceId });

  if (!contact) {
    return res.status(404).json({ error: "NOT_FOUND", message: "Contact not found." });
  }

  let conversation = await Conversation.findOne({
    contactId: contact._id,
    workspaceId: req.user.workspaceId,
    status: mongoose.trusted({ $ne: "archived" }),
  })
    .populate({ path: "contactId", populate: { path: "tagIds" } })
    .populate("assignedToUserId", "name")
    .populate("tagIds")
    .populate("lastMessageId")
    .sort({ lastMessageAt: -1, updatedAt: -1 });

  if (!conversation) {
    conversation = await Conversation.create({
      organizationId: req.user.organizationId,
      workspaceId: req.user.workspaceId,
      contactId: contact._id,
      status: "open",
      lastMessageAt: new Date(),
    });

    contact.lastMessageAt = conversation.lastMessageAt;
    await contact.save();

    conversation = await Conversation.findById(conversation._id)
      .populate({ path: "contactId", populate: { path: "tagIds" } })
      .populate("assignedToUserId", "name")
      .populate("tagIds")
      .populate("lastMessageId");
  }

  const messages = await Message.find(visibleMessagesFilter(conversation._id, req.user.sub)).sort({ createdAt: 1 }).limit(100);
  res.json({ data: serializeConversation(conversation, messages, { userId: req.user.sub }) });
});

conversationsRouter.get("/:conversationId/messages/:messageId/info", getMessageInfoById);
conversationsRouter.get("/:conversationId/messages", getConversationMessages);
conversationsRouter.patch("/:conversationId/messages/:messageId/receipt", requirePermission("inbox:write"), validateBody(updateReceiptSchema), updateMessageReceiptById);
conversationsRouter.patch("/:conversationId/messages/:messageId/actions", requirePermission("inbox:write"), validateBody(updateMessageActionsSchema), updateMessageActionsById);
conversationsRouter.delete("/:conversationId/messages/:messageId", requirePermission("inbox:write"), deleteConversationMessageById);
conversationsRouter.post("/:conversationId/messages/:messageId/delete", requirePermission("inbox:write"), deleteConversationMessageById);
conversationsRouter.post("/:conversationId/messages/delete", requirePermission("inbox:write"), deleteConversationMessageFromBody);

conversationsRouter.get("/:id", async (req, res) => {
  if (mongoose.connection.readyState !== 1 || !mongoose.Types.ObjectId.isValid(req.params.id)) {
    return res.status(404).json({ error: "NOT_FOUND", message: "Conversation not found." });
  }

  const conversation = await Conversation.findOne({ _id: req.params.id, workspaceId: req.user.workspaceId })
    .populate({ path: "contactId", populate: { path: "tagIds" } })
    .populate("assignedToUserId", "name")
    .populate("tagIds")
    .populate("lastMessageId");

  if (!conversation) {
    return res.status(404).json({ error: "NOT_FOUND", message: "Conversation not found." });
  }

  const messages = await Message.find(visibleMessagesFilter(conversation._id, req.user.sub)).sort({ createdAt: 1 }).limit(100);
  res.json({ data: serializeConversation(conversation, messages, { userId: req.user.sub }) });
});

conversationsRouter.patch("/:id/read", requirePermission("inbox:write"), async (req, res) => {
  if (mongoose.connection.readyState !== 1 || !mongoose.Types.ObjectId.isValid(req.params.id)) {
    return res.status(404).json({ error: "NOT_FOUND", message: "Conversation not found." });
  }

  const conversation = await Conversation.findOne({ _id: req.params.id, workspaceId: req.user.workspaceId });
  if (!conversation) {
    return res.status(404).json({ error: "NOT_FOUND", message: "Conversation not found." });
  }

  conversation.unreadCountByUser?.set?.(req.user.sub, 0);
  conversation.markModified("unreadCountByUser");
  await conversation.save();

  res.json({ unread: 0 });
});

conversationsRouter.patch("/:id/status", requirePermission("inbox:write"), validateBody(updateStatusSchema), async (req, res) => {
  if (mongoose.connection.readyState !== 1 || !mongoose.Types.ObjectId.isValid(req.params.id)) {
    return res.status(404).json({ error: "NOT_FOUND", message: "Conversation not found." });
  }

  const statusMap = {
    open: "open",
    waiting: "pending",
    pending: "pending",
    resolved: "resolved",
    archived: "archived",
  };
  const nextStatus = statusMap[req.body.status];

  const conversation = await Conversation.findOneAndUpdate(
    { _id: req.params.id, workspaceId: req.user.workspaceId },
    { status: nextStatus },
    { new: true }
  )
    .populate({ path: "contactId", populate: { path: "tagIds" } })
    .populate("assignedToUserId", "name")
    .populate("tagIds")
    .populate("lastMessageId");

  if (!conversation) {
    return res.status(404).json({ error: "NOT_FOUND", message: "Conversation not found." });
  }

  const messages = await Message.find(visibleMessagesFilter(conversation._id, req.user.sub)).sort({ createdAt: 1 }).limit(100);
  await publishConversationChanged(conversation._id);

  res.json({ data: serializeConversation(conversation, messages, { userId: req.user.sub }) });
});

conversationsRouter.patch("/:id/settings", requirePermission("inbox:write"), validateBody(updateSettingsSchema), async (req, res) => {
  if (mongoose.connection.readyState !== 1 || !mongoose.Types.ObjectId.isValid(req.params.id)) {
    return res.status(404).json({ error: "NOT_FOUND", message: "Conversation not found." });
  }

  const update = {};
  if (typeof req.body?.pinned === "boolean") {
    const operator = req.body.pinned ? "$addToSet" : "$pull";
    update[operator] = { ...(update[operator] || {}), pinnedByUserIds: req.user.sub };
  }
  if (typeof req.body?.muted === "boolean") {
    const operator = req.body.muted ? "$addToSet" : "$pull";
    update[operator] = { ...(update[operator] || {}), mutedByUserIds: req.user.sub };
  }

  const conversation = await Conversation.findOneAndUpdate(
    { _id: req.params.id, workspaceId: req.user.workspaceId },
    update,
    { new: true }
  )
    .populate({ path: "contactId", populate: { path: "tagIds" } })
    .populate("assignedToUserId", "name")
    .populate("tagIds")
    .populate("lastMessageId");

  if (!conversation) {
    return res.status(404).json({ error: "NOT_FOUND", message: "Conversation not found." });
  }

  const messages = await Message.find(visibleMessagesFilter(conversation._id, req.user.sub))
    .sort({ createdAt: -1, _id: -1 })
    .limit(50);
  await publishConversationChanged(conversation._id);
  res.json({ data: serializeConversation(conversation, messages.reverse(), { userId: req.user.sub }) });
});

conversationsRouter.post("/", requirePermission("inbox:write"), async (req, res) => {
  if (mongoose.connection.readyState !== 1) {
    return res.status(503).json({ error: "DATABASE_UNAVAILABLE", message: "MongoDB is required to create conversations." });
  }

  const { contactId, content = "Conversation started" } = req.body || {};

  if (!mongoose.Types.ObjectId.isValid(contactId)) {
    return res.status(400).json({ error: "VALIDATION_ERROR", message: "A valid contact is required." });
  }

  const contact = await Contact.findOne({ _id: contactId, workspaceId: req.user.workspaceId });

  if (!contact) {
    return res.status(404).json({ error: "NOT_FOUND", message: "Contact not found." });
  }

  const conversation = await Conversation.create({
    organizationId: req.user.organizationId,
    workspaceId: req.user.workspaceId,
    contactId: contact._id,
    status: "open",
    lastMessageAt: new Date(),
  });

  const message = await Message.create({
    organizationId: req.user.organizationId,
    workspaceId: req.user.workspaceId,
    conversationId: conversation._id,
    contactId: contact._id,
    direction: "outbound",
    type: "text",
    body: content,
    status: "sent",
    sentByUserId: req.user.sub,
    sentAt: new Date(),
  });

    conversation.lastMessageId = message._id;
    await conversation.save();

  contact.lastMessageAt = message.sentAt;
  await contact.save();

  const hydrated = await Conversation.findById(conversation._id)
    .populate({ path: "contactId", populate: { path: "tagIds" } })
    .populate("assignedToUserId", "name")
    .populate("tagIds")
    .populate("lastMessageId");

  await publishConversationChanged(conversation._id);
  res.status(201).json({ data: serializeConversation(hydrated, [message], { userId: req.user.sub }) });
});

conversationsRouter.post("/:id/add-to-crm", requirePermission("contacts:write"), async (req, res) => {
  if (mongoose.connection.readyState !== 1 || !mongoose.Types.ObjectId.isValid(req.params.id)) {
    return res.status(404).json({ error: "NOT_FOUND", message: "Conversation not found." });
  }

  const conversation = await Conversation.findOne({ _id: req.params.id, workspaceId: req.user.workspaceId })
    .populate({ path: "contactId", populate: { path: "tagIds" } })
    .populate("assignedToUserId", "name")
    .populate("tagIds")
    .populate("lastMessageId");

  if (!conversation) {
    return res.status(404).json({ error: "NOT_FOUND", message: "Conversation not found." });
  }

  const stage = normalizeLeadStage(req.body?.stage || "new_lead");
  const latestInboundMessage = await Message.findOne({
    conversationId: conversation._id,
    workspaceId: req.user.workspaceId,
    direction: "inbound",
    deletedAt: mongoose.trusted({ $exists: false }),
  }).sort({ receivedAt: -1, createdAt: -1 });

  const crmResult = await ensureConversationInCrm({
    contact: conversation.contactId,
    conversation,
    inboundMessage: latestInboundMessage || conversation.lastMessageId,
    source: "manual_inbox_action",
    stage,
    manual: true,
  });

  const [hydrated, messages] = await Promise.all([
    Conversation.findById(conversation._id)
      .populate({ path: "contactId", populate: { path: "tagIds" } })
      .populate("assignedToUserId", "name")
      .populate("tagIds")
      .populate("lastMessageId"),
    Message.find(visibleMessagesFilter(conversation._id, req.user.sub)).sort({ createdAt: 1 }).limit(100),
  ]);

  await publishConversationChanged(conversation._id);
  syncLeadToGoogleSheetInBackground({
    contact: hydrated.contactId,
    conversation: hydrated,
    message: latestInboundMessage || conversation.lastMessageId,
    lead: crmResult.lead,
    onError: (error) => console.warn(`Manual lead sheet sync failed: ${error.message}`),
  });
  res.json({ data: serializeConversation(hydrated, messages, { userId: req.user.sub }) });
});

conversationsRouter.patch("/:id/assignment", requirePermission("assignment:write"), validateBody(updateAssignmentSchema), async (req, res) => {
  if (mongoose.connection.readyState !== 1 || !mongoose.Types.ObjectId.isValid(req.params.id)) {
    return res.status(404).json({ error: "NOT_FOUND", message: "Conversation not found." });
  }

  const { userId } = req.body;
  const conversation = await Conversation.findOne({ _id: req.params.id, workspaceId: req.user.workspaceId });
  if (!conversation) {
    return res.status(404).json({ error: "NOT_FOUND", message: "Conversation not found." });
  }

  if (!userId) {
    conversation.assignedToUserId = undefined;
  } else {
    const membership = await Membership.findOne({ workspaceId: req.user.workspaceId, userId, status: "active" });
    if (!membership) {
      return res.status(404).json({ error: "NOT_FOUND", message: "Team member is not active in this workspace." });
    }

    conversation.assignedToUserId = userId;
  }

  conversation.metadata = {
    ...(conversation.metadata || {}),
    assignment: {
      assignedByUserId: req.user.sub,
      assignedAt: new Date(),
      assignedToUserId: userId || null,
    },
  };
  await conversation.save();

  const [hydrated, messages] = await Promise.all([
    Conversation.findById(conversation._id)
      .populate({ path: "contactId", populate: { path: "tagIds" } })
      .populate("assignedToUserId", "name")
      .populate("tagIds")
      .populate("lastMessageId"),
    Message.find(visibleMessagesFilter(conversation._id, req.user.sub)).sort({ createdAt: 1 }).limit(100),
  ]);

  await publishConversationChanged(conversation._id);
  res.json({ data: serializeConversation(hydrated, messages, { userId: req.user.sub }) });
});

conversationsRouter.post("/:id/template", requirePermission("inbox:write"), async (req, res) => {
  if (mongoose.connection.readyState !== 1 || !mongoose.Types.ObjectId.isValid(req.params.id)) {
    return res.status(404).json({ error: "NOT_FOUND", message: "Conversation not found." });
  }

  const { templateId, parameters = [] } = req.body || {};

  if (!mongoose.Types.ObjectId.isValid(templateId)) {
    return res.status(400).json({ error: "VALIDATION_ERROR", message: "A valid template is required." });
  }

  const [conversation, template] = await Promise.all([
    Conversation.findOne({ _id: req.params.id, workspaceId: req.user.workspaceId }),
    Template.findOne({ _id: templateId, workspaceId: req.user.workspaceId, status: "approved" }),
  ]);

  if (!conversation) {
    return res.status(404).json({ error: "NOT_FOUND", message: "Conversation not found." });
  }

  if (!template) {
    return res.status(404).json({ error: "NOT_FOUND", message: "Approved template not found." });
  }

  const [account, contact] = await Promise.all([
    WhatsAppAccount.findOne({
      _id: template.whatsappAccountId,
      workspaceId: req.user.workspaceId,
      status: mongoose.trusted({ $in: ["connected", "needs_attention"] }),
    }),
    Contact.findById(conversation.contactId),
  ]);

  if (!account || !contact?.phone) {
    return res.status(400).json({
      error: "WHATSAPP_TEMPLATE_UNAVAILABLE",
      message: "Connected WhatsApp account and contact phone are required.",
    });
  }

  let providerResult;

  try {
    providerResult = await sendWhatsAppTemplate({
      account,
      to: contact.phone,
      template,
      parameters: Array.isArray(parameters) ? parameters : [],
    });
  } catch (error) {
    if (error.status === 401 || error.status === 403 || error.code === 190 || /auth/i.test(error.message)) {
      account.status = "needs_attention";
      account.webhookStatus = "healthy";
      await account.save();
    }

    const failedMessage = await Message.create({
      organizationId: req.user.organizationId,
      workspaceId: req.user.workspaceId,
      conversationId: conversation._id,
      contactId: conversation.contactId,
      whatsappAccountId: account._id,
      direction: "outbound",
      type: "template",
      body: `Template failed: ${template.name}`,
      providerMessageId: `failed_template_${Date.now()}`,
      status: "failed",
      sentByUserId: req.user.sub,
      sentAt: new Date(),
      metadata: {
        providerMode: "meta",
        templateId: template._id,
        templateName: template.name,
        parameters,
        error: error.message,
        meta: error.meta,
      },
    });

    conversation.lastMessageId = failedMessage._id;
    conversation.lastMessageAt = failedMessage.sentAt;
    await conversation.save();
    await Contact.updateOne({ _id: conversation.contactId }, { lastMessageAt: failedMessage.sentAt });
    await publishConversationChanged(conversation._id);

    return res.status(error.status || 502).json({
      error: "WHATSAPP_TEMPLATE_FAILED",
      message: error.message || "WhatsApp template could not be sent.",
      accountStatus: account.status,
    });
  }

  const message = await Message.create({
    organizationId: req.user.organizationId,
    workspaceId: req.user.workspaceId,
    conversationId: conversation._id,
    contactId: conversation.contactId,
    whatsappAccountId: account._id,
    direction: "outbound",
    type: "template",
    body: `Template sent: ${template.name}`,
    providerMessageId: providerResult.providerMessageId,
    status: providerResult.status,
    sentByUserId: req.user.sub,
    sentAt: new Date(),
    metadata: {
      providerMode: providerResult.mode,
      templateId: template._id,
      templateName: template.name,
      parameters,
    },
  });

  conversation.whatsappAccountId = account._id;
  conversation.lastMessageId = message._id;
  conversation.lastMessageAt = message.sentAt;
  await conversation.save();
  await Contact.updateOne({ _id: conversation.contactId }, { lastMessageAt: message.sentAt });
  await Template.updateOne({ _id: template._id, workspaceId: req.user.workspaceId }, { $inc: { usageCount: 1 }, lastUsedAt: new Date() });

  await publishConversationChanged(conversation._id);
  res.status(201).json({ data: serializeMessage(message) });
});

conversationsRouter.post("/:id/messages", requirePermission("inbox:write"), async (req, res) => {
  if (mongoose.connection.readyState === 1 && mongoose.Types.ObjectId.isValid(req.params.id)) {
    const conversation = await Conversation.findOne({ _id: req.params.id, workspaceId: req.user.workspaceId });

    if (!conversation) {
      return res.status(404).json({ error: "NOT_FOUND", message: "Conversation not found." });
    }

    const { content, attachments = [], replyToMessageId = "", clientMessageId = "" } = req.body || {};
    const mediaAttachments = cleanAttachments(attachments);
    const messageBody = content.trim();

    if (!messageBody && mediaAttachments.length === 0) {
      return res.status(400).json({ error: "VALIDATION_ERROR", message: "Message content is required." });
    }

    if (clientMessageId) {
      const existingMessage = await Message.findOne({ workspaceId: req.user.workspaceId, clientMessageId });
      if (existingMessage) {
        return res.status(200).json({ data: serializeMessage(existingMessage), duplicate: true });
      }
    }

    const [account, contact] = await Promise.all([
      WhatsAppAccount.findOne({ workspaceId: req.user.workspaceId, status: mongoose.trusted({ $in: ["connected", "needs_attention"] }) }).sort({ createdAt: -1 }),
      Contact.findById(conversation.contactId),
    ]);
    const outboundMessage = await Message.create({
      organizationId: req.user.organizationId,
      workspaceId: req.user.workspaceId,
      conversationId: conversation._id,
      contactId: conversation.contactId,
      whatsappAccountId: conversation.whatsappAccountId || account?._id,
      direction: "outbound",
      type: messageTypeForAttachments(mediaAttachments),
      body: messageBody,
      attachments: mediaAttachments,
      clientMessageId: clientMessageId || undefined,
      status: "queued",
      sentByUserId: req.user.sub,
      metadata: {
        providerMode: account?.provider || "meta",
        ...(clientMessageId ? { clientMessageId } : {}),
        ...(replyToMessageId ? { replyToMessageId } : {}),
      },
    });

    conversation.lastMessageId = outboundMessage._id;
    conversation.lastMessageAt = outboundMessage.createdAt;
    await conversation.save();
    await publishConversationChanged(conversation._id);

    let providerResult;

    try {
      providerResult = await sendWhatsAppText({
        account,
        to: contact?.phone,
        body: messageBody,
        attachments: mediaAttachments,
      });
    } catch (error) {
      if (account && (error.status === 401 || error.status === 403 || error.code === 190 || /auth/i.test(error.message))) {
        account.status = "needs_attention";
        account.webhookStatus = "healthy";
        await account.save();
      }

      outboundMessage.status = "failed";
      outboundMessage.sentAt = new Date();
      outboundMessage.providerMessageId = `failed_${outboundMessage._id}`;
      outboundMessage.metadata = {
        ...(outboundMessage.metadata || {}),
        error: error.message,
        meta: error.meta,
      };
      await outboundMessage.save();

      conversation.lastMessageId = outboundMessage._id;
      conversation.lastMessageAt = outboundMessage.sentAt;
      await conversation.save();
      await Contact.updateOne({ _id: conversation.contactId }, { lastMessageAt: outboundMessage.sentAt });
      await publishConversationChanged(conversation._id);

      return res.status(error.status || 502).json({
        error: "WHATSAPP_SEND_FAILED",
        message: error.message || "WhatsApp message could not be sent.",
        accountStatus: account?.status || "missing",
      });
    }

    outboundMessage.whatsappAccountId = conversation.whatsappAccountId || account?._id;
    outboundMessage.providerMessageId = providerResult.providerMessageId;
    outboundMessage.status = providerResult.status;
    outboundMessage.sentAt = new Date();
    outboundMessage.metadata = {
      ...(outboundMessage.metadata || {}),
      providerMode: providerResult.mode,
    };
    await outboundMessage.save();

    conversation.lastMessageId = outboundMessage._id;
    conversation.lastMessageAt = outboundMessage.sentAt;
    await conversation.save();
    await Contact.updateOne({ _id: conversation.contactId }, { lastMessageAt: outboundMessage.sentAt });

    await publishConversationChanged(conversation._id);
    return res.status(201).json({ data: serializeMessage(outboundMessage) });
  }

  const conversation = conversations.find((item) => item.id === req.params.id);

  if (!conversation) {
    return res.status(404).json({ error: "NOT_FOUND", message: "Conversation not found." });
  }

  const { content } = req.body || {};

  if (!content?.trim()) {
    return res.status(400).json({ error: "VALIDATION_ERROR", message: "Message content is required." });
  }

  const message = {
    id: `msg_${Date.now()}`,
    content: content.trim(),
    from: "agent",
    time: new Date().toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit" }),
    status: "sent",
  };

  conversation.messages.push(message);
  conversation.preview = message.content;
  conversation.unread = 0;

  res.status(201).json({ data: message });
});

conversationsRouter.post("/:id/notes", requirePermission("inbox:write"), async (req, res) => {
  if (mongoose.connection.readyState !== 1 || !mongoose.Types.ObjectId.isValid(req.params.id)) {
    return res.status(404).json({ error: "NOT_FOUND", message: "Conversation not found." });
  }

  const conversation = await Conversation.findOne({ _id: req.params.id, workspaceId: req.user.workspaceId });
  if (!conversation) {
    return res.status(404).json({ error: "NOT_FOUND", message: "Conversation not found." });
  }

  const { content } = req.body || {};
  if (!content?.trim()) {
    return res.status(400).json({ error: "VALIDATION_ERROR", message: "Note content is required." });
  }

  const message = await Message.create({
    organizationId: req.user.organizationId,
    workspaceId: req.user.workspaceId,
    conversationId: conversation._id,
    contactId: conversation.contactId,
    whatsappAccountId: conversation.whatsappAccountId,
    direction: "outbound",
    type: "note",
    body: content.trim(),
    status: "sent",
    sentByUserId: req.user.sub,
    sentAt: new Date(),
    metadata: { internal: true },
  });

  await publishConversationChanged(conversation._id);
  res.status(201).json({ data: serializeMessage(message) });
});

async function getConversationMessages(req, res) {
  if (mongoose.connection.readyState !== 1 || !mongoose.Types.ObjectId.isValid(req.params.conversationId)) {
    return res.status(404).json({ error: "NOT_FOUND", message: "Conversation not found." });
  }

  const conversation = await Conversation.findOne({ _id: req.params.conversationId, workspaceId: req.user.workspaceId }).select("_id");
  if (!conversation) {
    return res.status(404).json({ error: "NOT_FOUND", message: "Conversation not found." });
  }

  const limit = paginationLimit(req.query.limit, 50, 100);
  const before = cursorDate(req.query.before);
  const filter = visibleMessagesFilter(conversation._id, req.user.sub);
  if (before) filter.createdAt = mongoose.trusted({ $lt: before });

  const messages = await Message.find(filter).sort({ createdAt: -1, _id: -1 }).limit(limit + 1);
  const hasMore = messages.length > limit;
  const pageMessages = messages.slice(0, limit).reverse();

  res.json({
    data: pageMessages.map(serializeMessage),
    page: {
      limit,
      hasMore,
      nextCursor: hasMore ? messages[limit - 1]?.createdAt?.toISOString?.() : null,
    },
  });
}

async function updateMessageReceiptById(req, res) {
  if (
    mongoose.connection.readyState !== 1 ||
    !mongoose.Types.ObjectId.isValid(req.params.conversationId) ||
    !mongoose.Types.ObjectId.isValid(req.params.messageId)
  ) {
    return res.status(404).json({ error: "NOT_FOUND", message: "Message not found." });
  }

  const status = req.body.status;
  const now = new Date();
  const message = await Message.findOneAndUpdate(
    {
      _id: req.params.messageId,
      conversationId: req.params.conversationId,
      workspaceId: req.user.workspaceId,
      deletedAt: mongoose.trusted({ $exists: false }),
    },
    {
      status,
      deliveredAt: now,
      ...(status === "read" ? { readAt: now } : {}),
    },
    { new: true }
  );

  if (!message) {
    return res.status(404).json({ error: "NOT_FOUND", message: "Message not found." });
  }

  await publishConversationChanged(message.conversationId);
  res.json({ data: serializeMessage(message) });
}

async function getMessageInfoById(req, res) {
  if (
    mongoose.connection.readyState !== 1 ||
    !mongoose.Types.ObjectId.isValid(req.params.conversationId) ||
    !mongoose.Types.ObjectId.isValid(req.params.messageId)
  ) {
    return res.status(404).json({ error: "NOT_FOUND", message: "Message not found." });
  }

  const message = await Message.findOne({
    _id: req.params.messageId,
    conversationId: req.params.conversationId,
    workspaceId: req.user.workspaceId,
    deletedAt: mongoose.trusted({ $exists: false }),
  });

  if (!message) {
    return res.status(404).json({ error: "NOT_FOUND", message: "Message not found." });
  }

  res.json({
    data: {
      ...serializeMessage(message),
      providerMessageId: message.providerMessageId || "",
      sentAt: message.sentAt,
      receivedAt: message.receivedAt,
      createdAt: message.createdAt,
      updatedAt: message.updatedAt,
      metadata: message.metadata || {},
    },
  });
}

async function updateMessageActionsById(req, res) {
  if (
    mongoose.connection.readyState !== 1 ||
    !mongoose.Types.ObjectId.isValid(req.params.conversationId) ||
    !mongoose.Types.ObjectId.isValid(req.params.messageId)
  ) {
    return res.status(404).json({ error: "NOT_FOUND", message: "Message not found." });
  }

  const allowed = {};
  if (typeof req.body?.pinned === "boolean") allowed.pinned = req.body.pinned;
  if (typeof req.body?.starred === "boolean") allowed.starred = req.body.starred;

  const message = await Message.findOneAndUpdate(
    {
      _id: req.params.messageId,
      conversationId: req.params.conversationId,
      workspaceId: req.user.workspaceId,
      deletedAt: mongoose.trusted({ $exists: false }),
    },
    allowed,
    { new: true }
  );

  if (!message) {
    return res.status(404).json({ error: "NOT_FOUND", message: "Message not found." });
  }

  await publishConversationChanged(message.conversationId);
  res.json({ data: serializeMessage(message) });
}

async function deleteConversationMessageById(req, res) {
  if (
    mongoose.connection.readyState !== 1 ||
    !mongoose.Types.ObjectId.isValid(req.params.conversationId) ||
    !mongoose.Types.ObjectId.isValid(req.params.messageId)
  ) {
    return res.status(404).json({ error: "NOT_FOUND", message: "Message not found." });
  }

  const mode = String(req.body?.mode || req.query?.mode || "everyone").toLowerCase();
  const update = mode === "me"
    ? { $addToSet: { deletedForUserIds: req.user.sub } }
    : {
        $set: {
          deletedAt: new Date(),
          deletedByUserId: req.user.sub,
          pinned: false,
          starred: false,
        },
      };

  const message = await Message.findOneAndUpdate(
    {
      _id: req.params.messageId,
      conversationId: req.params.conversationId,
      workspaceId: req.user.workspaceId,
      deletedAt: mongoose.trusted({ $exists: false }),
    },
    update,
    { new: true }
  );

  if (!message) {
    return res.status(404).json({ error: "NOT_FOUND", message: "Message not found." });
  }

  if (mode !== "me") {
    const lastMessage = await Message.findOne(visibleMessagesFilter(message.conversationId, req.user.sub)).sort({ createdAt: -1 });

    if (lastMessage) {
      await Conversation.updateOne(
        { _id: message.conversationId, workspaceId: req.user.workspaceId },
        { lastMessageId: lastMessage._id, lastMessageAt: lastMessage.sentAt || lastMessage.receivedAt || lastMessage.createdAt }
      );
    } else {
      await Conversation.updateOne(
        { _id: message.conversationId, workspaceId: req.user.workspaceId },
        { $unset: { lastMessageId: "" }, lastMessageAt: new Date() }
      );
    }
  }

  await publishConversationChanged(message.conversationId);
  res.sendStatus(204);
}

async function deleteConversationMessageFromBody(req, res) {
  req.params.messageId = req.body?.messageId;
  return deleteConversationMessageById(req, res);
}

