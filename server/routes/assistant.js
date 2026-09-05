import { Router } from "express";
import mongoose from "mongoose";
import { z } from "zod";
import { hasEntitlementForActor, requireEntitlement, requirePermission } from "../middleware/auth.js";
import { validateBody, validateQuery } from "../middleware/validate.js";
import { AutomationFlow, Conversation, Lead, Message, Organization } from "../models/index.js";
import { publishConversationChanged } from "../realtime/events.js";
import { createKnowledgeDocument, retrieveKnowledge, runAssistantTask, transcriptionFallback } from "../services/aiAssistant.js";
import { normalizeLeadStage } from "../services/crm.js";
import { getWorkspaceIntegrations } from "../services/integrations.js";
import { optionalObjectIdString, trimmedString } from "../utils/zodHelpers.js";

export const assistantRouter = Router();

export const analyzeSchema = z.object({
  conversationId: optionalObjectIdString,
  provider: z.string().trim().optional().default("local"),
  task: z.string().trim().optional().default("full_analysis"),
  prompt: z.string().optional().default(""),
});

export const streamSchema = analyzeSchema.extend({
  task: z.string().trim().optional().default("draft_reply"),
});

export const searchQuerySchema = z.object({
  q: z.string().trim().optional().default(""),
  limit: z.coerce.number().int().optional(),
});

export const knowledgeSchema = z.object({
  name: z.string().trim().optional().default("Knowledge note"),
  content: trimmedString("Document content is required."),
  mimeType: z.string().trim().optional().default("text/plain"),
  source: z.string().trim().optional().default("upload"),
});

export const transcribeSchema = z.object({
  fileName: z.string().optional().default(""),
  transcript: z.string().optional().default(""),
});

export const voiceReplySchema = z.object({
  text: z.string().optional().default(""),
});

// `name` stays optional/permissive - an empty tool name already falls through both known-tool
// branches today and returns a generic "registered" response, not a 400, so requiring it here
// would reject requests that currently succeed.
export const toolCallSchema = z.object({
  name: z.string().trim().optional().default(""),
  arguments: z.record(z.unknown()).optional().default({}),
  conversationId: optionalObjectIdString,
});

function dbUnavailable(res) {
  return res.status(503).json({ error: "DATABASE_UNAVAILABLE", message: "MongoDB is required for the AI assistant." });
}

assistantRouter.get("/overview", requirePermission("assistant:read"), async (req, res) => {
  if (mongoose.connection.readyState !== 1) return dbUnavailable(res);

  const [conversationCount, aiEnabledCount, flowCount, leadCount, organization, integrations] = await Promise.all([
    Conversation.countDocuments({ workspaceId: req.user.workspaceId }),
    Conversation.countDocuments({ workspaceId: req.user.workspaceId, "metadata.ai": mongoose.trusted({ $exists: true }) }),
    AutomationFlow.countDocuments({ workspaceId: req.user.workspaceId }),
    Lead.countDocuments({ workspaceId: req.user.workspaceId, status: "open" }),
    Organization.findById(req.user.organizationId).select("plan"),
    getWorkspaceIntegrations(req.user.workspaceId),
  ]);
  const workspaceAiProviders = integrations?.aiProviders || {};

  const recent = await Conversation.find({ workspaceId: req.user.workspaceId, "metadata.ai": mongoose.trusted({ $exists: true }) })
    .populate("contactId", "name phone waName")
    .sort({ updatedAt: -1 })
    .limit(8);

  res.json({
    entitlements: {
      // Read here (not just enforced by requireEntitlement on the action routes) so the client
      // can show an upsell state up front instead of waiting for a user to click something and
      // hit a 403 - the overview route itself stays ungated since these metrics have value on
      // any plan.
      aiAssistant: hasEntitlementForActor(req.user, organization?.plan, "aiAssistant"),
    },
    providers: {
      // "Available" if either this workspace configured its own key (Settings > Integrations) or
      // Nemnidhi's own server-side key is set as a fallback - matches aiAssistant.js's own
      // workspace-key-first resolution, so this badge never lies about what a real call will do.
      openai: Boolean((workspaceAiProviders.openai?.enabled && workspaceAiProviders.openai?.apiKey) || process.env.OPENAI_API_KEY),
      gemini: Boolean((workspaceAiProviders.gemini?.enabled && workspaceAiProviders.gemini?.apiKey) || process.env.GEMINI_API_KEY),
      claude: Boolean((workspaceAiProviders.claude?.enabled && workspaceAiProviders.claude?.apiKey) || process.env.ANTHROPIC_API_KEY),
      local: true,
    },
    capabilities: [
      "Conversation Summary",
      "Auto Reply",
      "Lead Qualification",
      "Intent Detection",
      "Sentiment Analysis",
      "Product Recommendation",
      "FAQ",
      "Knowledge Base",
      "RAG",
      "Document Upload",
      "Voice Transcription",
      "Voice Reply",
      "AI Suggestions",
      "Draft Replies",
      "Smart Follow Up",
      "CRM Insights",
      "Conversation Search",
      "Customer Memory",
      "Tool Calling",
      "Workflow Trigger",
      "Streaming Responses",
      "Function Calling",
    ],
    metrics: {
      conversations: conversationCount,
      analyzed: aiEnabledCount,
      automations: flowCount,
      openLeads: leadCount,
    },
    recent: recent.map((conversation) => ({
      id: conversation._id.toString(),
      customer: conversation.contactId?.name || conversation.contactId?.waName || "Customer",
      phone: conversation.contactId?.phone || "",
      summary: conversation.metadata?.ai?.summary || "",
      intent: conversation.metadata?.ai?.intent?.label || "",
      sentiment: conversation.metadata?.ai?.sentiment?.label || "",
      score: conversation.metadata?.ai?.leadQualification?.score || 0,
      updatedAt: conversation.updatedAt,
    })),
  });
});

assistantRouter.post("/analyze", requirePermission("assistant:write"), requireEntitlement("aiAssistant"), validateBody(analyzeSchema), async (req, res) => {
  if (mongoose.connection.readyState !== 1) return dbUnavailable(res);
  const { conversationId, provider, task, prompt } = req.body;

  const result = await runAssistantTask({ workspaceId: req.user.workspaceId, conversationId, provider, task, prompt });
  if (conversationId) await publishConversationChanged(conversationId);
  res.json({ data: result });
});

assistantRouter.post("/stream", requirePermission("assistant:write"), requireEntitlement("aiAssistant"), validateBody(streamSchema), async (req, res) => {
  if (mongoose.connection.readyState !== 1) return dbUnavailable(res);
  const { conversationId, provider, task, prompt } = req.body;

  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");

  const result = await runAssistantTask({ workspaceId: req.user.workspaceId, conversationId, provider, task, prompt });
  const text = result.autoReply || result.summary || "";
  for (const token of text.split(" ")) {
    res.write(`data: ${JSON.stringify({ token: `${token} ` })}\n\n`);
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  res.write(`data: ${JSON.stringify({ done: true, result })}\n\n`);
  res.end();
});

assistantRouter.get("/search", requirePermission("assistant:read"), requireEntitlement("aiAssistant"), validateQuery(searchQuerySchema), async (req, res) => {
  if (mongoose.connection.readyState !== 1) return dbUnavailable(res);
  const query = req.query.q;
  const limit = Math.min(30, Math.max(1, req.query.limit || 12));
  const messageFilter = { workspaceId: req.user.workspaceId, deletedAt: mongoose.trusted({ $exists: false }) };
  if (query) messageFilter.$text = mongoose.trusted({ $search: query });

  const messages = await Message.find(messageFilter)
    .populate("contactId", "name phone waName")
    .sort(query ? { score: { $meta: "textScore" } } : { createdAt: -1 })
    .limit(limit);
  const knowledge = await retrieveKnowledge({ workspaceId: req.user.workspaceId, query, limit: 5 });

  res.json({
    data: {
      messages: messages.map((message) => ({
        id: message._id.toString(),
        conversationId: message.conversationId.toString(),
        customer: message.contactId?.name || message.contactId?.waName || "Customer",
        phone: message.contactId?.phone || "",
        body: message.body,
        direction: message.direction,
        createdAt: message.createdAt,
      })),
      knowledge,
    },
  });
});

assistantRouter.post("/knowledge", requirePermission("assistant:write"), requireEntitlement("aiAssistant"), validateBody(knowledgeSchema), async (req, res) => {
  if (mongoose.connection.readyState !== 1) return dbUnavailable(res);
  const { name, content, mimeType, source } = req.body;

  const document = await createKnowledgeDocument({
    req,
    name: String(name).slice(0, 180),
    content: String(content).slice(0, 250000),
    mimeType,
    source,
  });
  res.status(201).json({ data: { id: document._id.toString(), name: document.name, chunks: document.chunks.length, status: document.status } });
});

assistantRouter.post("/voice/transcribe", requirePermission("assistant:write"), requireEntitlement("aiAssistant"), validateBody(transcribeSchema), async (req, res) => {
  const { fileName, transcript } = req.body;
  res.json({ data: transcriptionFallback({ fileName, transcript }) });
});

assistantRouter.post("/voice/reply", requirePermission("assistant:write"), requireEntitlement("aiAssistant"), validateBody(voiceReplySchema), async (req, res) => {
  const { text } = req.body;
  res.json({
    data: {
      text,
      audioUrl: "",
      provider: "text_to_speech_ready",
      message: "Voice reply text is ready. Configure a TTS provider to generate audio media.",
    },
  });
});

assistantRouter.post("/tool-call", requirePermission("assistant:write"), requireEntitlement("aiAssistant"), validateBody(toolCallSchema), async (req, res) => {
  if (mongoose.connection.readyState !== 1) return dbUnavailable(res);
  const { name, arguments: args, conversationId } = req.body;
  const conversation = conversationId && mongoose.Types.ObjectId.isValid(conversationId)
    ? await Conversation.findOne({ _id: conversationId, workspaceId: req.user.workspaceId })
    : null;

  if (name === "updateLeadStage" && conversation) {
    const lead = await Lead.findOneAndUpdate(
      { workspaceId: req.user.workspaceId, conversationId: conversation._id, status: "open" },
      {
        stage: normalizeLeadStage(args.stage || "qualified"),
        score: Number(args.score || 50),
        lastActivityAt: new Date(),
        $push: { timeline: { type: "ai_tool_call", label: "AI updated lead stage", at: new Date(), data: args } },
      },
      { new: true }
    );
    return res.json({ data: { tool: name, status: lead ? "completed" : "skipped", leadId: lead?._id?.toString?.() } });
  }

  if (name === "triggerWorkflow") {
    const flows = await AutomationFlow.find({ workspaceId: req.user.workspaceId, status: "published" }).limit(5);
    return res.json({ data: { tool: name, status: "queued", matchedFlows: flows.map((flow) => ({ id: flow._id.toString(), name: flow.name })) } });
  }

  res.json({ data: { tool: name || "unknown", status: "registered", arguments: args } });
});
