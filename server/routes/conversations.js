import { Router } from "express";
import mongoose from "mongoose";
import { conversations } from "../data/demoData.js";
import { Contact, Conversation, Membership, Message, Template } from "../models/index.js";
import { WhatsAppAccount } from "../models/index.js";
import { hasPermission, requirePermission } from "../middleware/auth.js";
import { publishConversationChanged } from "../realtime/events.js";
import { ensureConversationInCrm } from "../services/crm.js";
import { sendWhatsAppTemplate, sendWhatsAppText } from "../services/whatsappProvider.js";
import { serializeConversation, serializeMessage } from "../utils/serializers.js";

export const conversationsRouter = Router();

function cleanAttachments(attachments = []) {
  if (!Array.isArray(attachments)) return [];
  return attachments
    .filter((attachment) => attachment?.url)
    .slice(0, 5)
    .map((attachment) => ({
      name: String(attachment.name || "Attachment").slice(0, 160),
      url: String(attachment.url),
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

function visibleMessagesFilter(conversationId) {
  return { conversationId, deletedAt: { $exists: false } };
}

conversationsRouter.get("/", async (req, res) => {
  if (mongoose.connection.readyState === 1 && mongoose.Types.ObjectId.isValid(req.user?.workspaceId)) {
    const status = String(req.query.status || "").toLowerCase();
    const search = String(req.query.search || "").trim();
    const filter = { workspaceId: req.user.workspaceId };
    if (!hasPermission(req.user, "team:read")) {
      filter.$or = [{ assignedToUserId: req.user.sub }, { assignedToUserId: { $exists: false } }, { assignedToUserId: null }];
    }

    if (status) {
      filter.status = status === "waiting" ? "pending" : status;
    }

    let dbConversations = await Conversation.find(filter)
      .populate({ path: "contactId", populate: { path: "tagIds" } })
      .populate("assignedToUserId", "name")
      .populate("tagIds")
      .populate("lastMessageId")
      .sort({ lastMessageAt: -1, updatedAt: -1 })
      .limit(50);

    if (search) {
      const lowerSearch = search.toLowerCase();
      dbConversations = dbConversations.filter((conversation) => {
        const contact = conversation.contactId || {};
        const preview = conversation.lastMessageId?.body || "";
        return [contact.name, contact.phone, preview].some((value = "") => value.toLowerCase().includes(lowerSearch));
      });
    }

    const data = await Promise.all(
      dbConversations.map(async (conversation) => {
        const messages = await Message.find(visibleMessagesFilter(conversation._id))
          .sort({ createdAt: 1 })
          .limit(100);
        return serializeConversation(conversation, messages, { userId: req.user.sub });
      })
    );

    return res.json({ data, total: data.length });
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

  const conversations = await Conversation.find({ workspaceId: req.user.workspaceId }).select("unreadCountByUser");
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
    status: { $ne: "archived" },
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

  const messages = await Message.find(visibleMessagesFilter(conversation._id)).sort({ createdAt: 1 }).limit(100);
  res.json({ data: serializeConversation(conversation, messages, { userId: req.user.sub }) });
});

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

  const messages = await Message.find(visibleMessagesFilter(conversation._id)).sort({ createdAt: 1 }).limit(100);
  res.json({ data: serializeConversation(conversation, messages, { userId: req.user.sub }) });
});

conversationsRouter.patch("/:id/read", async (req, res) => {
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

conversationsRouter.patch("/:id/status", async (req, res) => {
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
  const nextStatus = statusMap[String(req.body?.status || "").toLowerCase()];

  if (!nextStatus) {
    return res.status(400).json({ error: "VALIDATION_ERROR", message: "A valid status is required." });
  }

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

  const messages = await Message.find(visibleMessagesFilter(conversation._id)).sort({ createdAt: 1 }).limit(100);
  await publishConversationChanged(conversation._id);

  res.json({ data: serializeConversation(conversation, messages, { userId: req.user.sub }) });
});

conversationsRouter.post("/", async (req, res) => {
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

conversationsRouter.post("/:id/add-to-crm", async (req, res) => {
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

  await ensureConversationInCrm({
    contact: conversation.contactId,
    conversation,
    source: "manual_inbox_action",
  });

  const [hydrated, messages] = await Promise.all([
    Conversation.findById(conversation._id)
      .populate({ path: "contactId", populate: { path: "tagIds" } })
      .populate("assignedToUserId", "name")
      .populate("tagIds")
      .populate("lastMessageId"),
    Message.find(visibleMessagesFilter(conversation._id)).sort({ createdAt: 1 }).limit(100),
  ]);

  await publishConversationChanged(conversation._id);
  res.json({ data: serializeConversation(hydrated, messages, { userId: req.user.sub }) });
});

conversationsRouter.patch("/:id/assignment", requirePermission("assignment:write"), async (req, res) => {
  if (mongoose.connection.readyState !== 1 || !mongoose.Types.ObjectId.isValid(req.params.id)) {
    return res.status(404).json({ error: "NOT_FOUND", message: "Conversation not found." });
  }

  const { userId = "" } = req.body || {};
  const conversation = await Conversation.findOne({ _id: req.params.id, workspaceId: req.user.workspaceId });
  if (!conversation) {
    return res.status(404).json({ error: "NOT_FOUND", message: "Conversation not found." });
  }

  if (!userId) {
    conversation.assignedToUserId = undefined;
  } else {
    if (!mongoose.Types.ObjectId.isValid(userId)) {
      return res.status(400).json({ error: "VALIDATION_ERROR", message: "A valid team member is required." });
    }

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
    Message.find(visibleMessagesFilter(conversation._id)).sort({ createdAt: 1 }).limit(100),
  ]);

  await publishConversationChanged(conversation._id);
  res.json({ data: serializeConversation(hydrated, messages, { userId: req.user.sub }) });
});

conversationsRouter.post("/:id/template", async (req, res) => {
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
      status: { $in: ["connected", "needs_attention"] },
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

  await publishConversationChanged(conversation._id);
  res.status(201).json({ data: serializeMessage(message) });
});

conversationsRouter.post("/:id/messages", async (req, res) => {
  if (mongoose.connection.readyState === 1 && mongoose.Types.ObjectId.isValid(req.params.id)) {
    const conversation = await Conversation.findOne({ _id: req.params.id, workspaceId: req.user.workspaceId });

    if (!conversation) {
      return res.status(404).json({ error: "NOT_FOUND", message: "Conversation not found." });
    }

    const { content, attachments = [], replyToMessageId = "" } = req.body || {};
    const mediaAttachments = cleanAttachments(attachments);

    if (!content?.trim() && mediaAttachments.length === 0) {
      return res.status(400).json({ error: "VALIDATION_ERROR", message: "Message content is required." });
    }

    const [account, contact] = await Promise.all([
      WhatsAppAccount.findOne({ workspaceId: req.user.workspaceId, status: { $in: ["connected", "needs_attention"] } }).sort({ createdAt: -1 }),
      Contact.findById(conversation.contactId),
    ]);
    let providerResult;

    try {
      providerResult = await sendWhatsAppText({
        account,
        to: contact?.phone,
        body: content.trim() || "Attachment",
        attachments: mediaAttachments,
      });
    } catch (error) {
      if (account && (error.status === 401 || error.status === 403 || error.code === 190 || /auth/i.test(error.message))) {
        account.status = "needs_attention";
        account.webhookStatus = "healthy";
        await account.save();
      }

      const failedMessage = await Message.create({
        organizationId: req.user.organizationId,
        workspaceId: req.user.workspaceId,
        conversationId: conversation._id,
        contactId: conversation.contactId,
        whatsappAccountId: conversation.whatsappAccountId || account?._id,
        direction: "outbound",
        type: messageTypeForAttachments(mediaAttachments),
        body: content.trim() || "Attachment",
        attachments: mediaAttachments,
        providerMessageId: `failed_${Date.now()}`,
        status: "failed",
        sentByUserId: req.user.sub,
        sentAt: new Date(),
        metadata: {
          providerMode: "meta",
          ...(replyToMessageId ? { replyToMessageId } : {}),
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
        error: "WHATSAPP_SEND_FAILED",
        message: error.message || "WhatsApp message could not be sent.",
        accountStatus: account?.status || "missing",
      });
    }

    const message = await Message.create({
      organizationId: req.user.organizationId,
      workspaceId: req.user.workspaceId,
      conversationId: conversation._id,
      contactId: conversation.contactId,
      whatsappAccountId: conversation.whatsappAccountId || account?._id,
      direction: "outbound",
      type: messageTypeForAttachments(mediaAttachments),
      body: content.trim() || "Attachment",
      attachments: mediaAttachments,
      providerMessageId: providerResult.providerMessageId,
      status: providerResult.status,
      sentByUserId: req.user.sub,
      sentAt: new Date(),
      metadata: { providerMode: providerResult.mode, ...(replyToMessageId ? { replyToMessageId } : {}) },
    });

    conversation.lastMessageId = message._id;
    conversation.lastMessageAt = message.sentAt;
    await conversation.save();
    await Contact.updateOne({ _id: conversation.contactId }, { lastMessageAt: message.sentAt });

    await publishConversationChanged(conversation._id);
    return res.status(201).json({ data: serializeMessage(message) });
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

conversationsRouter.post("/:id/notes", async (req, res) => {
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

conversationsRouter.get("/:conversationId/messages/:messageId/info", async (req, res) => {
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
    deletedAt: { $exists: false },
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
});

conversationsRouter.patch("/:conversationId/messages/:messageId/actions", async (req, res) => {
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

  if (Object.keys(allowed).length === 0) {
    return res.status(400).json({ error: "VALIDATION_ERROR", message: "No supported message action was provided." });
  }

  const message = await Message.findOneAndUpdate(
    {
      _id: req.params.messageId,
      conversationId: req.params.conversationId,
      workspaceId: req.user.workspaceId,
      deletedAt: { $exists: false },
    },
    allowed,
    { new: true }
  );

  if (!message) {
    return res.status(404).json({ error: "NOT_FOUND", message: "Message not found." });
  }

  await publishConversationChanged(message.conversationId);
  res.json({ data: serializeMessage(message) });
});

async function deleteConversationMessageById(req, res) {
  if (
    mongoose.connection.readyState !== 1 ||
    !mongoose.Types.ObjectId.isValid(req.params.conversationId) ||
    !mongoose.Types.ObjectId.isValid(req.params.messageId)
  ) {
    return res.status(404).json({ error: "NOT_FOUND", message: "Message not found." });
  }

  const message = await Message.findOneAndUpdate(
    {
      _id: req.params.messageId,
      conversationId: req.params.conversationId,
      workspaceId: req.user.workspaceId,
      deletedAt: { $exists: false },
    },
    {
      deletedAt: new Date(),
      deletedByUserId: req.user.sub,
      pinned: false,
      starred: false,
    },
    { new: true }
  );

  if (!message) {
    return res.status(404).json({ error: "NOT_FOUND", message: "Message not found." });
  }

  const lastMessage = await Message.findOne({
    conversationId: message.conversationId,
    workspaceId: req.user.workspaceId,
    deletedAt: { $exists: false },
  }).sort({ createdAt: -1 });

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

  await publishConversationChanged(message.conversationId);
  res.sendStatus(204);
}

conversationsRouter.delete("/:conversationId/messages/:messageId", deleteConversationMessageById);
conversationsRouter.post("/:conversationId/messages/:messageId/delete", deleteConversationMessageById);

