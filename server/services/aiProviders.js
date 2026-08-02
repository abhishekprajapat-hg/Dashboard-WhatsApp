import { config } from "../config.js";

// Request-building and response-text-extraction are kept as small pure functions per provider so
// they're unit-testable against real sample response shapes without needing network access or a
// live API key. callAiProvider is the only part that actually performs the fetch.

const GEMINI_ENDPOINT = "https://generativelanguage.googleapis.com/v1beta/models";

export function buildOpenAiRequest({ prompt, model }) {
  return {
    url: "https://api.openai.com/v1/chat/completions",
    headers: { "Content-Type": "application/json" },
    body: {
      model: model || config.ai.openaiModel,
      messages: [{ role: "user", content: prompt }],
    },
  };
}

export function extractOpenAiText(json) {
  return json?.choices?.[0]?.message?.content ?? "";
}

export function buildClaudeRequest({ prompt, model }) {
  return {
    url: "https://api.anthropic.com/v1/messages",
    headers: { "Content-Type": "application/json", "anthropic-version": "2023-06-01" },
    body: {
      model: model || config.ai.claudeModel,
      max_tokens: 1024,
      messages: [{ role: "user", content: prompt }],
    },
  };
}

export function extractClaudeText(json) {
  const block = Array.isArray(json?.content) ? json.content.find((item) => item?.type === "text") : null;
  return block?.text ?? "";
}

export function buildGeminiRequest({ prompt, model }) {
  const chosenModel = model || config.ai.geminiModel;
  return {
    url: `${GEMINI_ENDPOINT}/${chosenModel}:generateContent`,
    headers: { "Content-Type": "application/json" },
    body: {
      contents: [{ parts: [{ text: prompt }] }],
    },
  };
}

export function extractGeminiText(json) {
  return json?.candidates?.[0]?.content?.parts?.[0]?.text ?? "";
}

const providers = {
  openai: { build: buildOpenAiRequest, extract: extractOpenAiText, authHeaders: (apiKey) => ({ Authorization: `Bearer ${apiKey}` }) },
  claude: { build: buildClaudeRequest, extract: extractClaudeText, authHeaders: (apiKey) => ({ "x-api-key": apiKey }) },
  gemini: { build: buildGeminiRequest, extract: extractGeminiText, authHeaders: (apiKey) => ({ "x-goog-api-key": apiKey }) },
};

const MAX_RESPONSE_CHARS = 8000;

// The AI provider endpoints are fixed, hardcoded constants (not user/flow-controlled), unlike the
// automation "api" node's URL - so this deliberately does not go through integrations.js's SSRF
// guard, which exists specifically for outbound requests to attacker-influenceable destinations.
export async function callAiProvider({ provider, apiKey, prompt, model }) {
  const entry = providers[provider];
  if (!entry) throw new Error(`Unsupported AI provider "${provider}"`);
  if (!apiKey) throw new Error("Missing API key");

  const { url, headers, body } = entry.build({ prompt, model });
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), config.ai.requestTimeoutMs);

  try {
    const response = await fetch(url, {
      method: "POST",
      headers: { ...headers, ...entry.authHeaders(apiKey) },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    const json = await response.json().catch(() => ({}));
    if (!response.ok) {
      const message = json?.error?.message || (typeof json?.error === "string" ? json.error : "") || `AI provider returned HTTP ${response.status}`;
      throw new Error(message);
    }
    return { text: String(entry.extract(json) || "").slice(0, MAX_RESPONSE_CHARS) };
  } catch (error) {
    if (error.name === "AbortError") throw new Error("AI provider request timed out");
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}
