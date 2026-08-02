import test from "node:test";
import assert from "node:assert/strict";
import {
  buildOpenAiRequest,
  extractOpenAiText,
  buildClaudeRequest,
  extractClaudeText,
  buildGeminiRequest,
  extractGeminiText,
  callAiProvider,
} from "../services/aiProviders.js";

// Request-building and response-extraction are pure functions, tested here against realistic
// sample shapes from each provider's public API docs - no network access needed. callAiProvider's
// actual fetch is exercised separately below with a stubbed globalThis.fetch, since Node's fetch
// is a global that's safe to swap out and restore within a single test.

test("buildOpenAiRequest / extractOpenAiText round-trip a realistic chat completion", () => {
  const { url, body } = buildOpenAiRequest({ prompt: "Hello" });
  assert.equal(url, "https://api.openai.com/v1/chat/completions");
  assert.equal(body.messages[0].content, "Hello");
  assert.ok(body.model);

  const sample = { choices: [{ message: { role: "assistant", content: "Hi there!" } }] };
  assert.equal(extractOpenAiText(sample), "Hi there!");
});

test("buildClaudeRequest / extractClaudeText round-trip a realistic messages response", () => {
  const { url, headers, body } = buildClaudeRequest({ prompt: "Hello" });
  assert.equal(url, "https://api.anthropic.com/v1/messages");
  assert.equal(headers["anthropic-version"], "2023-06-01");
  assert.equal(body.messages[0].content, "Hello");

  const sample = { content: [{ type: "text", text: "Hi there!" }] };
  assert.equal(extractClaudeText(sample), "Hi there!");
});

test("buildGeminiRequest / extractGeminiText round-trip a realistic generateContent response", () => {
  const { url, body } = buildGeminiRequest({ prompt: "Hello", model: "gemini-1.5-flash" });
  assert.ok(url.includes("gemini-1.5-flash:generateContent"));
  assert.equal(body.contents[0].parts[0].text, "Hello");

  const sample = { candidates: [{ content: { parts: [{ text: "Hi there!" }] } }] };
  assert.equal(extractGeminiText(sample), "Hi there!");
});

test("extractors tolerate missing/malformed shapes without throwing", () => {
  assert.equal(extractOpenAiText({}), "");
  assert.equal(extractClaudeText({ content: [] }), "");
  assert.equal(extractGeminiText({ candidates: [] }), "");
  assert.equal(extractOpenAiText(undefined), "");
});

test("callAiProvider sends the right auth header per provider and returns extracted text", async (t) => {
  const calls = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url, options) => {
    calls.push({ url, options });
    return { ok: true, status: 200, json: async () => ({ choices: [{ message: { content: "mock reply" } }] }) };
  };
  t.after(() => {
    globalThis.fetch = originalFetch;
  });

  const result = await callAiProvider({ provider: "openai", apiKey: "sk-test", prompt: "Hi" });
  assert.equal(result.text, "mock reply");
  assert.equal(calls[0].options.headers.Authorization, "Bearer sk-test");
});

test("callAiProvider uses Claude's x-api-key header and Gemini's x-goog-api-key header", async (t) => {
  const calls = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url, options) => {
    calls.push({ url, options });
    return { ok: true, status: 200, json: async () => ({}) };
  };
  t.after(() => {
    globalThis.fetch = originalFetch;
  });

  await callAiProvider({ provider: "claude", apiKey: "sk-ant-test", prompt: "Hi" });
  await callAiProvider({ provider: "gemini", apiKey: "AIza-test", prompt: "Hi" });

  assert.equal(calls[0].options.headers["x-api-key"], "sk-ant-test");
  assert.equal(calls[1].options.headers["x-goog-api-key"], "AIza-test");
});

test("callAiProvider throws a clear error on a non-2xx response", async (t) => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => ({ ok: false, status: 401, json: async () => ({ error: { message: "Invalid API key" } }) });
  t.after(() => {
    globalThis.fetch = originalFetch;
  });

  await assert.rejects(() => callAiProvider({ provider: "openai", apiKey: "bad-key", prompt: "Hi" }), /Invalid API key/);
});

test("callAiProvider rejects unsupported providers and missing api keys before making any request", async () => {
  await assert.rejects(() => callAiProvider({ provider: "not-a-provider", apiKey: "x", prompt: "hi" }), /Unsupported AI provider/);
  await assert.rejects(() => callAiProvider({ provider: "openai", apiKey: "", prompt: "hi" }), /Missing API key/);
});
