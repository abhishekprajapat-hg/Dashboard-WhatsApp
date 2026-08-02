import { Router } from "express";
import mongoose from "mongoose";
import { z } from "zod";
import { requirePermission } from "../middleware/auth.js";
import { validateBody } from "../middleware/validate.js";
import { AutomationFlow, Contact, Conversation, Message, Tag, WhatsAppAccount } from "../models/index.js";
import { runInboundAutomations } from "../services/automationRunner.js";
import { formatKeywords, parseKeywords } from "../utils/keywords.js";
import { relativeTime } from "../utils/serializers.js";
import { optionalHttpUrlString, optionalObjectIdString, trimmedString } from "../utils/zodHelpers.js";

export const automationRouter = Router();

// config stays z.record(z.unknown()) - 25+ node kinds makes a fully-typed discriminated union not
// worth it, each kind validates its own config at execution time (automationExecutors.js) instead.
const automationNodeSchema = z.object({
  id: trimmedString("Node id is required."),
  type: trimmedString("Node type is required."),
  position: z.object({ x: z.number(), y: z.number() }).optional(),
  config: z.record(z.unknown()).optional().default({}),
});

// sourceHandle/targetHandle record which branch (e.g. condition/if_else "true"/"false") an edge
// belongs to; null/omitted means "the single default edge" - how every pre-Phase-1 edge reads.
const automationEdgeSchema = z.object({
  id: z.string().optional(),
  source: trimmedString("Edge source is required."),
  target: trimmedString("Edge target is required."),
  sourceHandle: z.string().nullable().optional(),
  targetHandle: z.string().nullable().optional(),
});

const createFlowSchema = z
  .object({
    name: trimmedString("Flow name is required."),
    description: z.string().optional().default("Automation flow"),
    trigger: z.string().optional().default("New conversation"),
    category: z.string().optional().default("General"),
    status: z.string().optional().default("draft"),
    actionMessage: z.string().optional().default("Thanks for reaching out. Our team will reply shortly."),
    keyword: z.string().optional().default(""),
    triggerType: z.string().optional().default(""),
    conditions: z.array(z.unknown()).optional().default([]),
    actions: z.array(z.unknown()).optional().default([]),
    sendReply: z.boolean().optional().default(true),
    assignmentUserId: optionalObjectIdString,
    nextStatus: z.string().optional().default(""),
    tagName: z.string().optional().default(""),
    addToCrm: z.boolean().optional().default(false),
    leadStage: z.string().optional().default("new_lead"),
    sendToGoogleSheet: z.boolean().optional().default(false),
    templateId: optionalObjectIdString,
    callWebhook: z.boolean().optional().default(false),
    webhookUrl: optionalHttpUrlString(),
    webhookSecret: z.string().optional().default(""),
    nodes: z.array(automationNodeSchema).optional(),
    edges: z.array(automationEdgeSchema).optional(),
  })
  .refine((data) => !data.callWebhook || data.webhookUrl !== "", {
    message: "Webhook URL is required when the webhook action is enabled.",
    path: ["webhookUrl"],
  });

const testFlowSchema = z.object({
  message: z.string().optional().default(""),
});

// Partial-update schema for PATCH /:id - every field is optional since the handler only
// touches fields that were actually sent (sparse update), including the simpleEdit shorthand
// path that reconstructs nodes/edges from the individual trigger/action fields below.
const updateFlowSchema = z.object({
  name: z.string().trim().optional(),
  nodes: z.array(automationNodeSchema).optional(),
  edges: z.array(automationEdgeSchema).optional(),
  conditions: z.array(z.unknown()).optional(),
  actions: z.array(z.unknown()).optional(),
  trigger: z.union([z.string(), z.record(z.unknown())]).optional(),
  triggerType: z.string().optional(),
  description: z.string().optional(),
  category: z.string().optional(),
  status: z.string().optional(),
  simpleEdit: z.boolean().optional(),
  keyword: z.string().optional(),
  sendReply: z.boolean().optional(),
  actionMessage: z.string().optional(),
  templateId: optionalObjectIdString,
  assignmentUserId: optionalObjectIdString,
  nextStatus: z.string().optional(),
  tagName: z.string().optional(),
  addToCrm: z.boolean().optional(),
  leadStage: z.string().optional(),
  sendToGoogleSheet: z.boolean().optional(),
  versionLabel: z.string().optional(),
});

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

function normalizeEdges(edges = []) {
  const seen = new Set();
  return (Array.isArray(edges) ? edges : [])
    .filter((edge) => edge?.source && edge?.target)
    .map((edge, index) => {
      const baseId = String(edge.id || `${edge.source}-${edge.target}-${index}`);
      const id = seen.has(baseId) ? `${baseId}-${index}` : baseId;
      seen.add(id);
      return { ...edge, id, source: String(edge.source), target: String(edge.target) };
    });
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
    edges: normalizeEdges(flow.edges),
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

automationRouter.post("/", requirePermission("automation:write"), validateBody(createFlowSchema), async (req, res) => {
  if (mongoose.connection.readyState !== 1) {
    return res.status(503).json({ error: "DATABASE_UNAVAILABLE", message: "MongoDB is required." });
  }

  const {
    name,
    description,
    trigger,
    category,
    status,
    actionMessage,
    keyword,
    triggerType: incomingTriggerType,
    conditions,
    actions: incomingActions,
    sendReply,
    assignmentUserId,
    nextStatus,
    tagName,
    addToCrm,
    leadStage,
    sendToGoogleSheet,
    templateId,
    callWebhook,
    webhookUrl,
    webhookSecret,
    nodes: visualNodes,
    edges: visualEdges,
  } = req.body;

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
    edges.push({ id: `${previousNodeId}-${id}`, source: previousNodeId, target: id });
    previousNodeId = id;
  }

  if (sendReply && (actionMessage?.trim() || mongoose.Types.ObjectId.isValid(templateId))) {
    addActionNode("send_message", { body: actionMessage.trim(), templateId: mongoose.Types.ObjectId.isValid(templateId) ? templateId : undefined });
  }
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
    edges: normalizeEdges(edges),
    status: toDbStatus(status),
    publishedAt: status === "active" ? new Date() : undefined,
    createdBy: req.user.sub,
    updatedBy: req.user.sub,
  });

  res.status(201).json({ data: serializeFlow(flow) });
});

automationRouter.patch("/:id", requirePermission("automation:write"), validateBody(updateFlowSchema), async (req, res) => {
  if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
    return res.status(404).json({ error: "NOT_FOUND", message: "Flow not found." });
  }

  const updates = { $set: { updatedBy: req.user.sub } };
  if (req.body?.name) updates.$set.name = req.body.name.trim();
  if (Array.isArray(req.body?.nodes)) updates.$set.nodes = req.body.nodes;
  if (Array.isArray(req.body?.edges)) updates.$set.edges = normalizeEdges(req.body.edges);
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
  if (req.body?.simpleEdit) {
    const triggerType = normalizeTriggerType(req.body.triggerType || req.body.trigger);
    const keywords = parseKeywords(req.body.keyword || "");
    if (triggerType === "keyword_match" && keywords.length === 0) {
      return res.status(400).json({ error: "VALIDATION_ERROR", message: "Keyword is required for keyword automation." });
    }

    const nodes = [{ id: "trigger", type: "trigger" }];
    const edges = [];
    let previousNodeId = "trigger";
    function addActionNode(type, config = {}) {
      const id = `${type}_${nodes.length}`;
      nodes.push({ id, type, config, position: { x: 220 * nodes.length, y: 120 } });
      edges.push({ id: `${previousNodeId}-${id}`, source: previousNodeId, target: id });
      previousNodeId = id;
    }

    if (req.body.sendReply && (String(req.body.actionMessage || "").trim() || mongoose.Types.ObjectId.isValid(req.body.templateId))) {
      addActionNode("send_message", {
        body: String(req.body.actionMessage || "").trim(),
        templateId: mongoose.Types.ObjectId.isValid(req.body.templateId) ? req.body.templateId : undefined,
      });
    }
    if (req.body.assignmentUserId && mongoose.Types.ObjectId.isValid(req.body.assignmentUserId)) addActionNode("assign_user", { userId: req.body.assignmentUserId });
    if (req.body.nextStatus) addActionNode("set_status", { status: req.body.nextStatus });
    if (req.body.tagName?.trim()) addActionNode("add_tag", { name: req.body.tagName.trim() });
    if (req.body.addToCrm) addActionNode("add_to_crm", { source: "automation", stage: req.body.leadStage || "new_lead" });
    if (req.body.sendToGoogleSheet) addActionNode("google_sheets", { source: "automation", stage: req.body.leadStage || "new_lead" });

    if (nodes.length === 1) {
      return res.status(400).json({ error: "VALIDATION_ERROR", message: "At least one automation action is required." });
    }

    updates.$set.nodes = nodes;
    updates.$set.edges = normalizeEdges(edges);
    updates.$set["trigger.type"] = triggerType;
    updates.$set["trigger.label"] = labelForTrigger(triggerType);
    updates.$set["trigger.keyword"] = formatKeywords(keywords);
    updates.$set["trigger.keywords"] = keywords;
    updates.$set["trigger.replyBody"] = String(req.body.actionMessage || "").trim();
    if (req.body.description) updates.$set["trigger.description"] = req.body.description;
    if (req.body.category) updates.$set["trigger.category"] = req.body.category;
    updates.$inc = { ...(updates.$inc || {}), version: 1 };
    updates.$push = {
      ...(updates.$push || {}),
      "trigger.versions": {
        version: Date.now(),
        label: "Simple automation edit",
        at: new Date(),
        userId: req.user.sub,
      },
    };
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

automationRouter.post("/:id/test", requirePermission("automation:write"), validateBody(testFlowSchema), async (req, res) => {
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

    const results = await runInboundAutomations({
      account,
      contact,
      conversation,
      inboundMessage: message,
      isNewConversation: true,
      isNewLead: true,
      flowId: flow._id,
      testMode: true,
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
    if (testTagIds.length) cleanupTasks.push(Tag.deleteMany({ _id: mongoose.trusted({ $in: testTagIds }) }));
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
