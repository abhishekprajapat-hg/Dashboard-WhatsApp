import crypto from "crypto";
import mongoose from "mongoose";
import { AiDocument, AiMemory, Contact, Conversation, Lead, Message } from "../models/index.js";
import { getWorkspaceIntegrations } from "./integrations.js";

const providerConfig = {
  openai: {
    envKey: "OPENAI_API_KEY",
    endpoint: "https://api.openai.com/v1/chat/completions",
    model: process.env.OPENAI_MODEL || "gpt-4o-mini",
  },
  gemini: {
    envKey: "GEMINI_API_KEY",
    endpoint: "https://generativelanguage.googleapis.com/v1beta/models",
    model: process.env.GEMINI_MODEL || "gemini-1.5-flash",
  },
  claude: {
    envKey: "ANTHROPIC_API_KEY",
    endpoint: "https://api.anthropic.com/v1/messages",
    model: process.env.CLAUDE_MODEL || "claude-3-5-haiku-latest",
  },
  local: {
    endpoint: process.env.LOCAL_LLM_URL || "http://localhost:11434/api/chat",
    model: process.env.LOCAL_LLM_MODEL || "llama3.1",
  },
};

const intents = [
  { key: "pricing", terms: ["price", "cost", "rate", "charges", "budget", "quote"] },
  { key: "support", terms: ["issue", "problem", "not working", "help", "support", "complaint"] },
  { key: "demo", terms: ["demo", "trial", "presentation", "show me", "walkthrough"] },
  { key: "purchase", terms: ["buy", "purchase", "order", "payment", "invoice"] },
  { key: "follow_up", terms: ["later", "tomorrow", "next week", "call back", "follow up"] },
];

function words(text = "") {
  return String(text).toLowerCase().match(/[a-z0-9]+/g) || [];
}

function unique(items) {
  return [...new Set(items.filter(Boolean))];
}

function scoreText(text, query) {
  const source = words(text);
  const queryWords = unique(words(query));
  if (!queryWords.length) return 0;
  return queryWords.reduce((score, word) => score + source.filter((item) => item === word).length, 0);
}

function splitChunks(content = "") {
  const clean = String(content).replace(/\s+/g, " ").trim();
  if (!clean) return [];
  const chunks = [];
  for (let index = 0; index < clean.length; index += 900) {
    chunks.push({ id: crypto.randomUUID(), text: clean.slice(index, index + 1100), index: chunks.length });
  }
  return chunks;
}

function sentimentFor(text = "") {
  const lower = String(text).toLowerCase();
  const positive = ["great", "good", "thanks", "interested", "yes", "perfect", "love", "buy"].filter((term) => lower.includes(term)).length;
  const negative = ["bad", "angry", "issue", "problem", "no", "cancel", "expensive", "delay"].filter((term) => lower.includes(term)).length;
  if (positive > negative) return { label: "positive", score: Math.min(0.95, 0.55 + positive * 0.12) };
  if (negative > positive) return { label: "negative", score: Math.max(-0.95, -0.55 - negative * 0.12) };
  return { label: "neutral", score: 0 };
}

function intentFor(text = "") {
  const lower = String(text).toLowerCase();
  const match = intents
    .map((intent) => ({ ...intent, hits: intent.terms.filter((term) => lower.includes(term)).length }))
    .sort((a, b) => b.hits - a.hits)[0];
  return match?.hits ? { label: match.key, confidence: Math.min(0.95, 0.55 + match.hits * 0.14) } : { label: "general_inquiry", confidence: 0.62 };
}

function leadQualification(messages = [], contact = {}) {
  const text = messages.map((message) => message.body).join(" ");
  const lower = text.toLowerCase();
  let score = 20;
  if (contact.phone) score += 10;
  if (contact.email) score += 10;
  if (/price|cost|quote|budget/.test(lower)) score += 15;
  if (/buy|purchase|payment|invoice|book/.test(lower)) score += 20;
  if (/today|urgent|asap|now/.test(lower)) score += 15;
  if (/not interested|later|expensive/.test(lower)) score -= 10;
  const finalScore = Math.max(0, Math.min(100, score));
  const stage = finalScore >= 75 ? "hot_lead" : finalScore >= 45 ? "qualified" : "nurture";
  return {
    score: finalScore,
    stage,
    reasons: [
      contact.phone ? "Phone captured" : "",
      /price|cost|quote|budget/.test(lower) ? "Commercial intent detected" : "",
      /buy|purchase|payment|invoice|book/.test(lower) ? "Purchase language detected" : "",
      /today|urgent|asap|now/.test(lower) ? "High urgency" : "",
    ].filter(Boolean),
  };
}

function extractFacts(messages = [], contact = {}) {
  const body = messages.map((message) => message.body).join(" ");
  const products = unique((body.match(/\b(plan|pricing|demo|subscription|whatsapp|automation|campaign|crm|api)\b/gi) || []).map((item) => item.toLowerCase()));
  return {
    name: contact.name || contact.waName || "Customer",
    phone: contact.phone || "",
    products,
    preferredChannel: "WhatsApp",
    lastKnownNeed: body.slice(-220),
  };
}

function recommendationFor(facts = {}, context = []) {
  const productText = [...(facts.products || []), ...context.map((item) => item.text || "")].join(" ").toLowerCase();
  if (productText.includes("campaign")) return "Recommend Campaign Management with segmentation, approvals, retries, and analytics.";
  if (productText.includes("automation")) return "Recommend Automation Builder with keyword triggers, CRM updates, and agent assignment.";
  if (productText.includes("api")) return "Recommend API and Webhook package with tenant API tokens and delivery logs.";
  return "Recommend WhatsApp Business Inbox with CRM capture, lead scoring, and AI reply assistance.";
}

function fallbackCompletion({ task, messages = [], contact = {}, knowledge = [], prompt = "" }) {
  const transcript = messages.map((message) => `${message.direction}: ${message.body}`).join("\n");
  const recent = messages.slice(-5).map((message) => message.body).join(" ");
  const sentiment = sentimentFor(transcript);
  const intent = intentFor(transcript || prompt);
  const qualification = leadQualification(messages, contact);
  const facts = extractFacts(messages, contact);
  const recommendation = recommendationFor(facts, knowledge);
  const summary = recent
    ? `${facts.name} contacted on WhatsApp about ${facts.products?.join(", ") || intent.label}. Current sentiment is ${sentiment.label}. Lead stage is ${qualification.stage}.`
    : "No conversation history is available yet.";

  const draft = `Hi ${facts.name}, thanks for reaching out. Based on your requirement, ${recommendation} I can help you with pricing, setup, and the next step.`;

  const payload = {
    task,
    provider: "local_rules",
    summary,
    autoReply: draft,
    draftReplies: [
      draft,
      `Thanks ${facts.name}. I can share the best option once you confirm your expected timeline and budget.`,
      "I have noted this. Would you like me to arrange a quick demo or have an agent call you?",
    ],
    intent,
    sentiment,
    leadQualification: qualification,
    productRecommendation: recommendation,
    faqAnswer: knowledge[0]?.text || "I could not find a matching knowledge-base answer yet.",
    crmInsights: {
      customer: facts,
      nextBestAction: qualification.score >= 75 ? "Assign senior agent and follow up today" : "Send product fit questions and schedule follow-up",
      followUp: qualification.score >= 75 ? "today" : "within 24 hours",
    },
    toolCalls: [
      { name: "updateLeadStage", arguments: { stage: qualification.stage, score: qualification.score } },
      { name: "triggerWorkflow", arguments: { trigger: intent.label, source: "ai_assistant" } },
    ],
    voiceReply: { text: draft, format: "text_to_speech_ready" },
    raw: prompt || transcript,
  };

  return payload;
}

async function resolveApiKey(config, workspaceId, provider) {
  // A workspace's own key (Settings > Integrations > AI Providers - the same key automation flow
  // AI nodes already use) takes priority over Nemnidhi's own server-side env var. Without this, the
  // Assistant tab (Analyze/Draft Reply/Stream) silently ran every tenant's usage through Nemnidhi's
  // own account and billing regardless of what a client configured - a real cost-isolation gap that
  // matters now that a second real paying client is using this feature, not just Nemnidhi's own team.
  if (workspaceId) {
    const integrations = await getWorkspaceIntegrations(workspaceId);
    const workspaceProvider = integrations?.aiProviders?.[provider];
    if (workspaceProvider?.enabled && workspaceProvider?.apiKey) return workspaceProvider.apiKey;
  }
  return process.env[config.envKey];
}

async function callProvider({ provider, system, prompt, stream = false, workspaceId }) {
  const selected = providerConfig[provider] ? provider : "local";
  if (selected === "local" || stream) return null;

  const config = providerConfig[selected];
  const apiKey = await resolveApiKey(config, workspaceId, selected);
  if (!apiKey || typeof fetch !== "function") return null;

  if (selected === "openai") {
    const response = await fetch(config.endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({
        model: config.model,
        response_format: { type: "json_object" },
        messages: [{ role: "system", content: system }, { role: "user", content: prompt }],
      }),
    });
    const payload = await response.json();
    return payload.choices?.[0]?.message?.content || null;
  }

  if (selected === "gemini") {
    const response = await fetch(`${config.endpoint}/${config.model}:generateContent?key=${apiKey}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ contents: [{ parts: [{ text: `${system}\n\n${prompt}` }] }] }),
    });
    const payload = await response.json();
    return payload.candidates?.[0]?.content?.parts?.[0]?.text || null;
  }

  if (selected === "claude") {
    const response = await fetch(config.endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-api-key": apiKey, "anthropic-version": "2023-06-01" },
      body: JSON.stringify({ model: config.model, max_tokens: 1200, system, messages: [{ role: "user", content: prompt }] }),
    });
    const payload = await response.json();
    return payload.content?.[0]?.text || null;
  }

  return null;
}

export async function getConversationContext({ workspaceId, conversationId }) {
  const conversation = await Conversation.findOne({ _id: conversationId, workspaceId })
    .populate("contactId")
    .populate("assignedToUserId", "name email");
  if (!conversation) return null;

  const [messages, lead, memories] = await Promise.all([
    Message.find({ conversationId, workspaceId, deletedAt: mongoose.trusted({ $exists: false }) }).sort({ createdAt: -1 }).limit(80),
    Lead.findOne({ conversationId, workspaceId, status: "open" }).sort({ updatedAt: -1 }),
    AiMemory.find({ conversationId, workspaceId }).sort({ updatedAt: -1 }).limit(20),
  ]);

  return {
    conversation,
    contact: conversation.contactId || {},
    messages: messages.reverse(),
    lead,
    memories,
  };
}

export async function retrieveKnowledge({ workspaceId, query = "", limit = 6 }) {
  const documents = await AiDocument.find({ workspaceId, status: "indexed" }).sort({ updatedAt: -1 }).limit(80);
  const scored = [];
  for (const document of documents) {
    for (const chunk of document.chunks || []) {
      const score = scoreText(chunk.text || "", query);
      if (score > 0 || !query) {
        scored.push({ documentId: document._id.toString(), documentName: document.name, text: chunk.text, score });
      }
    }
  }
  return scored.sort((a, b) => b.score - a.score).slice(0, limit);
}

export async function runAssistantTask({ workspaceId, conversationId, provider = "local", task = "full_analysis", prompt = "" }) {
  const context = conversationId ? await getConversationContext({ workspaceId, conversationId }) : null;
  const contact = context?.contact || {};
  const messages = context?.messages || [];
  const query = prompt || messages.slice(-8).map((message) => message.body).join(" ");
  const knowledge = await retrieveKnowledge({ workspaceId, query });
  const system = "You are an enterprise WhatsApp CRM AI assistant. Return compact JSON with summary, autoReply, draftReplies, intent, sentiment, leadQualification, productRecommendation, faqAnswer, crmInsights, toolCalls, and voiceReply.";
  const aiPrompt = JSON.stringify({
    task,
    prompt,
    contact: { name: contact.name, phone: contact.phone, waName: contact.waName, source: contact.source },
    lead: context?.lead,
    memory: context?.memories?.map((memory) => ({ key: memory.key, value: memory.value })),
    knowledge,
    transcript: messages.map((message) => ({ direction: message.direction, type: message.type, body: message.body, createdAt: message.createdAt })),
  });

  let result = fallbackCompletion({ task, messages, contact, knowledge, prompt });
  try {
    const providerText = await callProvider({ provider, system, prompt: aiPrompt, workspaceId });
    if (providerText) {
      const parsed = JSON.parse(providerText.replace(/^```json|```$/g, "").trim());
      result = { ...result, ...parsed, provider };
    }
  } catch {
    result.provider = "local_rules";
  }

  if (context?.conversation) {
    context.conversation.metadata = {
      ...(context.conversation.metadata || {}),
      ai: {
        summary: result.summary,
        intent: result.intent,
        sentiment: result.sentiment,
        leadQualification: result.leadQualification,
        updatedAt: new Date(),
      },
    };
    context.conversation.markModified("metadata");
    await context.conversation.save();

    await AiMemory.findOneAndUpdate(
      { workspaceId, contactId: contact._id, key: "customer_profile" },
      {
        organizationId: context.conversation.organizationId,
        workspaceId,
        contactId: contact._id,
        conversationId: context.conversation._id,
        key: "customer_profile",
        value: result.crmInsights?.customer || {},
        confidence: result.intent?.confidence || 0.7,
        source: "assistant_analysis",
      },
      { upsert: true, new: true, setDefaultsOnInsert: true }
    );
  }

  return { ...result, knowledge, conversationId };
}

export async function createKnowledgeDocument({ req, name, content, mimeType = "text/plain", source = "upload" }) {
  const chunks = splitChunks(content);
  return AiDocument.create({
    organizationId: req.user.organizationId,
    workspaceId: req.user.workspaceId,
    uploadedByUserId: req.user.sub,
    name,
    mimeType,
    size: Buffer.byteLength(content || ""),
    source,
    status: "indexed",
    content,
    chunks,
    metadata: { chunkCount: chunks.length },
  });
}

export function transcriptionFallback({ fileName = "", transcript = "" }) {
  return {
    transcript: transcript || `Voice note ${fileName || "audio"} received. Connect OpenAI, Gemini, Claude, or a local speech model to transcribe media bytes.`,
    language: "en",
    confidence: transcript ? 0.92 : 0.48,
    provider: transcript ? "provided" : "local_stub",
  };
}
