import { Router } from "express";
import mongoose from "mongoose";
import { AutomationFlow, Contact, Conversation, Message, Tag, WhatsAppAccount } from "../models/index.js";
import { runInboundAutomations } from "../services/automationRunner.js";
import { formatKeywords, parseKeywords } from "../utils/keywords.js";
import { relativeTime } from "../utils/serializers.js";

export const automationRouter = Router();

function toClientStatus(status) {
  if (status === "published") return "active";
  if (status === "paused") return "inactive";
  return "draft";
}

function toDbStatus(status) {
  if (status === "active") return "published";
  if (status === "inactive") return "paused";
  return "draft";
}

function serializeFlow(flow) {
  const actions = (flow.nodes || []).filter((node) => node.type !== "trigger");
  const keywords = parseKeywords(flow.trigger?.keywords || flow.trigger?.keyword || "");
  return {
    id: flow._id.toString(),
    name: flow.name,
    description: flow.trigger?.description || "",
    trigger: flow.trigger?.label || flow.trigger?.type || "Manual",
    keyword: keywords.join(", "),
    keywords,
    actions: actions.length,
    actionSummary: actions.map((node) => {
      if (node.type === "send_message") return "Reply";
      if (node.type === "assign_user") return "Assign";
      if (node.type === "set_status") return `Status: ${node.config?.status || "open"}`;
      if (node.type === "add_tag") return `Tag: ${node.config?.name || "Lead"}`;
      if (node.type === "add_to_crm") return "Add to CRM";
      if (node.type === "call_webhook") return "Webhook";
      return node.type;
    }),
    status: toClientStatus(flow.status),
    runs: Number(flow.trigger?.runs || 0),
    lastRun: relativeTime(flow.trigger?.lastRunAt),
    category: flow.trigger?.category || "General",
  };
}

automationRouter.get("/", async (req, res) => {
  if (mongoose.connection.readyState !== 1) {
    return res.json({ data: [], total: 0, summary: { runsToday: 0, automatedMessages: 0, handoffs: 0 } });
  }

  const flows = await AutomationFlow.find({ workspaceId: req.user.workspaceId }).sort({ updatedAt: -1 }).limit(100);
  const runsToday = flows.reduce((sum, flow) => sum + Number(flow.trigger?.runs || 0), 0);

  res.json({
    data: flows.map(serializeFlow),
    total: flows.length,
    summary: {
      runsToday,
      automatedMessages: runsToday,
      handoffs: 0,
    },
  });
});

automationRouter.post("/", async (req, res) => {
  if (mongoose.connection.readyState !== 1) {
    return res.status(503).json({ error: "DATABASE_UNAVAILABLE", message: "MongoDB is required." });
  }

  const {
    name,
    description = "Automation flow",
    trigger = "New conversation",
    category = "General",
    status = "draft",
    actionMessage = "Thanks for reaching out. Our team will reply shortly.",
    keyword = "",
    sendReply = true,
    assignmentUserId = "",
    nextStatus = "",
    tagName = "",
    addToCrm = false,
    callWebhook = false,
    webhookUrl = "",
    webhookSecret = "",
  } = req.body || {};

  if (!name?.trim()) {
    return res.status(400).json({ error: "VALIDATION_ERROR", message: "Flow name is required." });
  }

  const triggerType = trigger.toLowerCase().replace(/\s+/g, "_");
  const keywords = parseKeywords(keyword);
  const cleanKeyword = formatKeywords(keywords);

  if (triggerType === "keyword_match" && keywords.length === 0) {
    return res.status(400).json({ error: "VALIDATION_ERROR", message: "Keyword is required for keyword automation." });
  }

  const nodes = [{ id: "trigger", type: "trigger" }];
  const edges = [];
  let previousNodeId = "trigger";

  function addActionNode(type, config = {}) {
    const id = `${type}_${nodes.length}`;
    nodes.push({ id, type, config });
    edges.push({ source: previousNodeId, target: id });
    previousNodeId = id;
  }

  if (sendReply && actionMessage?.trim()) addActionNode("send_message", { body: actionMessage.trim() });
  if (assignmentUserId && mongoose.Types.ObjectId.isValid(assignmentUserId)) addActionNode("assign_user", { userId: assignmentUserId });
  if (nextStatus) addActionNode("set_status", { status: nextStatus });
  if (tagName?.trim()) addActionNode("add_tag", { name: tagName.trim() });
  if (addToCrm) addActionNode("add_to_crm", { source: "automation", stage: "new_lead" });
  if (callWebhook) addActionNode("call_webhook", { url: webhookUrl.trim(), secret: webhookSecret, event: "automation.triggered" });

  if (nodes.length === 1) {
    return res.status(400).json({ error: "VALIDATION_ERROR", message: "At least one automation action is required." });
  }

  const flow = await AutomationFlow.create({
    organizationId: req.user.organizationId,
    workspaceId: req.user.workspaceId,
    name: name.trim(),
    trigger: {
      type: triggerType,
      label: trigger,
      description,
      category,
      keyword: cleanKeyword,
      keywords,
      replyBody: actionMessage,
      runs: 0,
    },
    nodes,
    edges,
    status: toDbStatus(status),
    publishedAt: status === "active" ? new Date() : undefined,
    createdBy: req.user.sub,
    updatedBy: req.user.sub,
  });

  res.status(201).json({ data: serializeFlow(flow) });
});

automationRouter.patch("/:id", async (req, res) => {
  if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
    return res.status(404).json({ error: "NOT_FOUND", message: "Flow not found." });
  }

  const updates = { updatedBy: req.user.sub };
  if (req.body?.name) updates.name = req.body.name.trim();
  if (req.body?.status) {
    updates.status = toDbStatus(req.body.status);
    if (updates.status === "published") updates.publishedAt = new Date();
  }

  const flow = await AutomationFlow.findOneAndUpdate(
    { _id: req.params.id, workspaceId: req.user.workspaceId },
    updates,
    { new: true }
  );

  if (!flow) return res.status(404).json({ error: "NOT_FOUND", message: "Flow not found." });
  res.json({ data: serializeFlow(flow) });
});

automationRouter.post("/:id/test", async (req, res) => {
  if (mongoose.connection.readyState !== 1 || !mongoose.Types.ObjectId.isValid(req.params.id)) {
    return res.status(404).json({ error: "NOT_FOUND", message: "Flow not found." });
  }

  const flow = await AutomationFlow.findOne({ _id: req.params.id, workspaceId: req.user.workspaceId });
  if (!flow) return res.status(404).json({ error: "NOT_FOUND", message: "Flow not found." });

  if (flow.status !== "published") {
    return res.status(400).json({ error: "FLOW_NOT_ACTIVE", message: "Only active automations can be tested." });
  }

  const account = await WhatsAppAccount.findOne({
    workspaceId: req.user.workspaceId,
    status: { $in: ["connected", "needs_attention"] },
  }).sort({ createdAt: -1 });

  if (!account) {
    return res.status(400).json({ error: "WHATSAPP_REQUIRED", message: "Connect a WhatsApp account before testing automation." });
  }

  const sampleKeyword = parseKeywords(flow.trigger?.keywords || flow.trigger?.keyword || "")[0] || "hello";
  const body = String(req.body?.message || sampleKeyword).trim();
  const testPhone = `automation_test_${Date.now()}`;
  const createdTagIdsBefore = new Set(
    (await Tag.find({ workspaceId: req.user.workspaceId }).select("_id")).map((tag) => tag._id.toString())
  );

  let contact;
  let conversation;
  let message;

  try {
    contact = await Contact.create({
      organizationId: req.user.organizationId,
      workspaceId: req.user.workspaceId,
      name: "Automation Test Contact",
      phone: testPhone,
      source: "Automation Test",
      lifecycleStatus: "lead",
      lastMessageAt: new Date(),
    });

    conversation = await Conversation.create({
      organizationId: req.user.organizationId,
      workspaceId: req.user.workspaceId,
      contactId: contact._id,
      whatsappAccountId: account._id,
      status: "open",
      lastMessageAt: new Date(),
      metadata: { automationTest: true },
    });

    message = await Message.create({
      organizationId: req.user.organizationId,
      workspaceId: req.user.workspaceId,
      conversationId: conversation._id,
      contactId: contact._id,
      whatsappAccountId: account._id,
      direction: "inbound",
      type: "text",
      body,
      providerMessageId: `automation_test_${flow._id}_${Date.now()}`,
      status: "delivered",
      receivedAt: new Date(),
      metadata: { automationTest: true },
    });

    conversation.lastMessageId = message._id;
    await conversation.save();

    const localAccount = account.toObject();
    localAccount.encryptedCredentials = Buffer.from(JSON.stringify({
      provider: account.provider || "meta",
      accessToken: "local-placeholder-token",
      authToken: "local-placeholder-token",
      apiKey: "local-placeholder-token",
    })).toString("base64");

    const results = await runInboundAutomations({
      account: localAccount,
      contact,
      conversation,
      inboundMessage: message,
      isNewConversation: true,
      flowId: flow._id,
    });

    const matched = results.some((result) => result.flowId === flow._id.toString());
    const testedFlow = await AutomationFlow.findById(flow._id);
    res.json({
      matched,
      message: body,
      flow: serializeFlow(testedFlow || flow),
      results,
      actions: results.flatMap((result) => result.actions.map((action) => ({ flowId: result.flowId, ...action }))),
    });
  } finally {
    const cleanupTasks = [];
    if (contact?._id) cleanupTasks.push(Contact.deleteOne({ _id: contact._id }));
    if (conversation?._id) cleanupTasks.push(Conversation.deleteOne({ _id: conversation._id }));
    if (contact?._id) cleanupTasks.push(Message.deleteMany({ contactId: contact._id }));
    const createdTags = await Tag.find({ workspaceId: req.user.workspaceId, description: "Created by automation" }).select("_id");
    const testTagIds = createdTags.filter((tag) => !createdTagIdsBefore.has(tag._id.toString())).map((tag) => tag._id);
    if (testTagIds.length) cleanupTasks.push(Tag.deleteMany({ _id: { $in: testTagIds } }));
    await Promise.all(cleanupTasks);
  }
});

automationRouter.delete("/:id", async (req, res) => {
  if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
    return res.status(404).json({ error: "NOT_FOUND", message: "Flow not found." });
  }

  const flow = await AutomationFlow.findOneAndDelete({ _id: req.params.id, workspaceId: req.user.workspaceId });
  if (!flow) return res.status(404).json({ error: "NOT_FOUND", message: "Flow not found." });
  res.sendStatus(204);
});
