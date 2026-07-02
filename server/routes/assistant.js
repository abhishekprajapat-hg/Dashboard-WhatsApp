import { Router } from "express";
import mongoose from "mongoose";
import { requirePermission } from "../middleware/auth.js";
import { AutomationFlow, Conversation, Lead, Message } from "../models/index.js";
import { publishConversationChanged } from "../realtime/events.js";
import { createKnowledgeDocument, retrieveKnowledge, runAssistantTask, transcriptionFallback } from "../services/aiAssistant.js";

export const assistantRouter = Router();

function dbUnavailable(res) {
  return res.status(503).json({ error: "DATABASE_UNAVAILABLE", message: "MongoDB is required for the AI assistant." });
}

assistantRouter.get("/overview", requirePermission("assistant:read"), async (req, res) => {
  if (mongoose.connection.readyState !== 1) return dbUnavailable(res);

  const [conversationCount, aiEnabledCount, flowCount, leadCount] = await Promise.all([
    Conversation.countDocuments({ workspaceId: req.user.workspaceId }),
    Conversation.countDocuments({ workspaceId: req.user.workspaceId, "metadata.ai": { $exists: true } }),
    AutomationFlow.countDocuments({ workspaceId: req.user.workspaceId }),
    Lead.countDocuments({ workspaceId: req.user.workspaceId, status: "open" }),
  ]);

  const recent = await Conversation.find({ workspaceId: req.user.workspaceId, "metadata.ai": { $exists: true } })
    .populate("contactId", "name phone waName")
    .sort({ updatedAt: -1 })
    .limit(8);

  res.json({
    providers: {
      openai: Boolean(process.env.OPENAI_API_KEY),
      gemini: Boolean(process.env.GEMINI_API_KEY),
      claude: Boolean(process.env.ANTHROPIC_API_KEY),
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

assistantRouter.post("/analyze", requirePermission("assistant:write"), async (req, res) => {
  if (mongoose.connection.readyState !== 1) return dbUnavailable(res);
  const { conversationId, provider = "local", task = "full_analysis", prompt = "" } = req.body || {};
  if (conversationId && !mongoose.Types.ObjectId.isValid(conversationId)) {
    return res.status(400).json({ error: "VALIDATION_ERROR", message: "A valid conversation is required." });
  }

  const result = await runAssistantTask({ workspaceId: req.user.workspaceId, conversationId, provider, task, prompt });
  if (conversationId) await publishConversationChanged(conversationId);
  res.json({ data: result });
});

assistantRouter.post("/stream", requirePermission("assistant:write"), async (req, res) => {
  if (mongoose.connection.readyState !== 1) return dbUnavailable(res);
  const { conversationId, provider = "local", task = "draft_reply", prompt = "" } = req.body || {};

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

assistantRouter.get("/search", requirePermission("assistant:read"), async (req, res) => {
  if (mongoose.connection.readyState !== 1) return dbUnavailable(res);
  const query = String(req.query.q || "").trim();
  const limit = Math.min(30, Math.max(1, Number(req.query.limit || 12)));
  const messageFilter = { workspaceId: req.user.workspaceId, deletedAt: mongoose.trusted({ $exists: false }) };
  if (query) messageFilter.$text = { $search: query };

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

assistantRouter.post("/knowledge", requirePermission("assistant:write"), async (req, res) => {
  if (mongoose.connection.readyState !== 1) return dbUnavailable(res);
  const { name = "Knowledge note", content = "", mimeType = "text/plain", source = "upload" } = req.body || {};
  if (!String(content).trim()) {
    return res.status(400).json({ error: "VALIDATION_ERROR", message: "Document content is required." });
  }

  const document = await createKnowledgeDocument({
    req,
    name: String(name).slice(0, 180),
    content: String(content).slice(0, 250000),
    mimeType,
    source,
  });
  res.status(201).json({ data: { id: document._id.toString(), name: document.name, chunks: document.chunks.length, status: document.status } });
});

assistantRouter.post("/voice/transcribe", requirePermission("assistant:write"), async (req, res) => {
  const { fileName = "", transcript = "" } = req.body || {};
  res.json({ data: transcriptionFallback({ fileName, transcript }) });
});

assistantRouter.post("/voice/reply", requirePermission("assistant:write"), async (req, res) => {
  const { text = "" } = req.body || {};
  res.json({
    data: {
      text,
      audioUrl: "",
      provider: "text_to_speech_ready",
      message: "Voice reply text is ready. Configure a TTS provider to generate audio media.",
    },
  });
});

assistantRouter.post("/tool-call", requirePermission("assistant:write"), async (req, res) => {
  if (mongoose.connection.readyState !== 1) return dbUnavailable(res);
  const { name = "", arguments: args = {}, conversationId = "" } = req.body || {};
  const conversation = conversationId && mongoose.Types.ObjectId.isValid(conversationId)
    ? await Conversation.findOne({ _id: conversationId, workspaceId: req.user.workspaceId })
    : null;

  if (name === "updateLeadStage" && conversation) {
    const lead = await Lead.findOneAndUpdate(
      { workspaceId: req.user.workspaceId, conversationId: conversation._id, status: "open" },
      {
        stage: args.stage || "qualified",
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
