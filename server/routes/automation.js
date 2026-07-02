import { Router } from "express";
import mongoose from "mongoose";
import { requirePermission } from "../middleware/auth.js";
import { AutomationFlow, Contact, Conversation, Message, Tag, WhatsAppAccount } from "../models/index.js";
import { runInboundAutomations } from "../services/automationRunner.js";
import { encodeCredentials } from "../services/whatsappProvider.js";
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

const triggerTypeMap = {
  "new message": "new_message",
  new_message: "new_message",
  "new lead": "new_lead",
  new_lead: "new_lead",
  "keyword match": "keyword_match",
  keyword_match: "keyword_match",
  "stage changed": "stage_changed",
  stage_changed: "stage_changed",
  "new conversation": "new_conversation",
  new_conversation: "new_conversation",
};

function normalizeTriggerType(trigger = "new_message") {
  const key = String(trigger || "new_message").trim().toLowerCase().replace(/\s+/g, " ");
  return triggerTypeMap[key] || triggerTypeMap[key.replace(/\s+/g, "_")] || "new_message";
}

function labelForTrigger(type = "new_message") {
  const labels = {
    new_message: "New message",
    new_lead: "New lead",
    keyword_match: "Keyword match",
    stage_changed: "Stage changed",
    new_conversation: "New conversation",
  };
  return labels[type] || type.replace(/_/g, " ");
}

function canonicalActionType(type = "") {
  const aliases = {
    send_whatsapp_message: "send_message",
    assign_team_member: "assign_user",
    update_lead_stage: "lead_stage",
    send_to_google_sheet: "google_sheets",
  };
  const value = String(type || "").toLowerCase();
  return aliases[value] || value;
}

function serializeFlow(flow) {
  const actions = [
    ...(flow.nodes || []).filter((node) => node.type !== "trigger"),
    ...(flow.actions || []).map((action, index) => ({ id: action.id || `action_${index}`, type: action.type, config: action.config || action })),
  ];
  const keywords = parseKeywords(flow.trigger?.keywords || flow.trigger?.keyword || "");
  const runLogs = Array.isArray(flow.runLogs)
    ? flow.runLogs.flatMap((run) => (run.logs || []).map((log) => ({
        ...log,
        runAt: run.at,
        conversationId: run.conversationId,
      })))
    : [];
  return {
    id: flow._id.toString(),
    name: flow.name,
    description: flow.trigger?.description || "",
    trigger: flow.trigger?.label || flow.trigger?.type || "Manual",
    triggerType: flow.trigger?.type || "new_message",
    keyword: keywords.join(", "),
    keywords,
    actions: actions.length,
    actionSummary: actions.map((node) => {
      const type = canonicalActionType(node.type);
      if (type === "send_message") return "Reply";
      if (type === "assign_user") return "Assign";
      if (type === "set_status") return `Status: ${node.config?.status || "open"}`;
      if (type === "add_tag") return `Tag: ${node.config?.name || "Lead"}`;
      if (type === "add_to_crm") return "Add to CRM";
      if (type === "lead_stage") return `Lead: ${node.config?.stage || "new_lead"}`;
      if (type === "google_sheets") return "Google Sheets";
      if (type === "call_webhook") return "Webhook";
      return node.type;
    }),
    status: toClientStatus(flow.status),
    runs: Number(flow.trigger?.runs || 0),
    lastRun: relativeTime(flow.trigger?.lastRunAt),
    category: flow.trigger?.category || "General",
    nodes: flow.nodes || [],
    edges: flow.edges || [],
    conditions: flow.conditions || [],
    simpleActions: flow.actions || [],
    version: flow.version || 1,
    publishedAt: flow.publishedAt,
    updatedAt: flow.updatedAt,
    analytics: {
      runs: Number(flow.trigger?.runs || 0),
      lastRunAt: flow.trigger?.lastRunAt,
      completionRate: Number(flow.trigger?.completionRate || 0),
      errorRate: Number(flow.trigger?.errorRate || 0),
    },
    versions: flow.trigger?.versions || [],
    executionLogs: runLogs.length ? runLogs.slice(-100) : flow.trigger?.executionLogs || [],
  };
}

automationRouter.get("/", requirePermission("automation:read"), async (req, res) => {
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

automationRouter.post("/", requirePermission("automation:write"), async (req, res) => {
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
    triggerType: incomingTriggerType = "",
    conditions = [],
    actions: incomingActions = [],
    sendReply = true,
    assignmentUserId = "",
    nextStatus = "",
    tagName = "",
    addToCrm = false,
    leadStage = "new_lead",
    sendToGoogleSheet = false,
    callWebhook = false,
    webhookUrl = "",
    webhookSecret = "",
    nodes: visualNodes,
    edges: visualEdges,
  } = req.body || {};

  if (!name?.trim()) {
    return res.status(400).json({ error: "VALIDATION_ERROR", message: "Flow name is required." });
  }

  const triggerType = normalizeTriggerType(incomingTriggerType || trigger);
  const keywords = parseKeywords(keyword);
  const cleanKeyword = formatKeywords(keywords);

  if (triggerType === "keyword_match" && keywords.length === 0) {
    return res.status(400).json({ error: "VALIDATION_ERROR", message: "Keyword is required for keyword automation." });
  }

  const nodes = Array.isArray(visualNodes) && visualNodes.length ? visualNodes : [{ id: "trigger", type: "trigger" }];
  const edges = Array.isArray(visualEdges) ? visualEdges : [];
  let previousNodeId = nodes[0]?.id || "trigger";

  function addActionNode(type, config = {}) {
    const id = `${type}_${nodes.length}`;
    nodes.push({ id, type, config, position: { x: 220 * nodes.length, y: 120 } });
    edges.push({ source: previousNodeId, target: id });
    previousNodeId = id;
  }

  if (sendReply && actionMessage?.trim()) addActionNode("send_message", { body: actionMessage.trim() });
  if (assignmentUserId && mongoose.Types.ObjectId.isValid(assignmentUserId)) addActionNode("assign_user", { userId: assignmentUserId });
  if (nextStatus) addActionNode("set_status", { status: nextStatus });
  if (tagName?.trim()) addActionNode("add_tag", { name: tagName.trim() });
  if (addToCrm) addActionNode("add_to_crm", { source: "automation", stage: leadStage || "new_lead" });
  if (sendToGoogleSheet) addActionNode("google_sheets", { source: "automation", stage: leadStage || "new_lead" });
  if (callWebhook) addActionNode("call_webhook", { url: webhookUrl.trim(), secret: webhookSecret, event: "automation.triggered" });

  const simpleActions = Array.isArray(incomingActions)
    ? incomingActions.map((action) => ({ ...action, type: canonicalActionType(action?.type), config: action?.config || action })).filter((action) => action.type)
    : [];

  if (nodes.length === 1 && simpleActions.length === 0) {
    return res.status(400).json({ error: "VALIDATION_ERROR", message: "At least one automation action is required." });
  }

  const flow = await AutomationFlow.create({
    organizationId: req.user.organizationId,
    workspaceId: req.user.workspaceId,
    name: name.trim(),
    trigger: {
      type: triggerType,
      label: labelForTrigger(triggerType),
      description,
      category,
      keyword: cleanKeyword,
      keywords,
      replyBody: actionMessage,
      runs: 0,
      versions: [{ version: 1, label: "Initial draft", at: new Date(), userId: req.user.sub }],
      executionLogs: [],
    },
    conditions: Array.isArray(conditions) ? conditions : [],
    actions: simpleActions,
    nodes,
    edges,
    status: toDbStatus(status),
    publishedAt: status === "active" ? new Date() : undefined,
    createdBy: req.user.sub,
    updatedBy: req.user.sub,
  });

  res.status(201).json({ data: serializeFlow(flow) });
});

automationRouter.patch("/:id", requirePermission("automation:write"), async (req, res) => {
  if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
    return res.status(404).json({ error: "NOT_FOUND", message: "Flow not found." });
  }

  const updates = { $set: { updatedBy: req.user.sub } };
  if (req.body?.name) updates.$set.name = req.body.name.trim();
  if (Array.isArray(req.body?.nodes)) updates.$set.nodes = req.body.nodes;
  if (Array.isArray(req.body?.edges)) updates.$set.edges = req.body.edges;
  if (Array.isArray(req.body?.conditions)) updates.$set.conditions = req.body.conditions;
  if (Array.isArray(req.body?.actions)) {
    updates.$set.actions = req.body.actions.map((action) => ({ ...action, type: canonicalActionType(action?.type), config: action?.config || action }));
  }
  if (req.body?.trigger && typeof req.body.trigger === "object") updates.$set.trigger = req.body.trigger;
  if (req.body?.triggerType) updates.$set["trigger.type"] = normalizeTriggerType(req.body.triggerType);
  if (req.body?.description) updates.$set["trigger.description"] = req.body.description;
  if (req.body?.category) updates.$set["trigger.category"] = req.body.category;
  if (req.body?.status) {
    updates.$set.status = toDbStatus(req.body.status);
    if (updates.$set.status === "published") updates.$set.publishedAt = new Date();
  }
  if (Array.isArray(req.body?.nodes) || Array.isArray(req.body?.edges)) {
    updates.$inc = { version: 1 };
    updates.$push = {
      "trigger.versions": {
        version: Date.now(),
        label: req.body?.versionLabel || "Canvas update",
        at: new Date(),
        userId: req.user.sub,
      },
    };
  }

  const flow = await AutomationFlow.findOneAndUpdate(
    { _id: req.params.id, workspaceId: req.user.workspaceId },
    updates,
    { new: true }
  );

  if (!flow) return res.status(404).json({ error: "NOT_FOUND", message: "Flow not found." });
  res.json({ data: serializeFlow(flow) });
});

automationRouter.post("/:id/test", requirePermission("automation:write"), async (req, res) => {
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
    status: mongoose.trusted({ $in: ["connected", "needs_attention"] }),
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
    localAccount.encryptedCredentials = encodeCredentials({
      provider: account.provider || "meta",
      accessToken: "local-placeholder-token",
      authToken: "local-placeholder-token",
      apiKey: "local-placeholder-token",
    });

    const results = await runInboundAutomations({
      account: localAccount,
      contact,
      conversation,
      inboundMessage: message,
      isNewConversation: true,
      isNewLead: true,
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

automationRouter.delete("/:id", requirePermission("automation:write"), async (req, res) => {
  if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
    return res.status(404).json({ error: "NOT_FOUND", message: "Flow not found." });
  }

  const flow = await AutomationFlow.findOneAndDelete({ _id: req.params.id, workspaceId: req.user.workspaceId });
  if (!flow) return res.status(404).json({ error: "NOT_FOUND", message: "Flow not found." });
  res.sendStatus(204);
});
