import test from "node:test";
import assert from "node:assert/strict";
import { adminSettingsSchema } from "../routes/admin.js";
import {
  analyzeSchema,
  knowledgeSchema,
  searchQuerySchema,
  streamSchema,
  toolCallSchema,
  transcribeSchema,
  voiceReplySchema,
} from "../routes/assistant.js";
import { uploadMediaSchema } from "../routes/media.js";
import { createWorkspaceSchema, updateWorkspaceSchema } from "../routes/workspace.js";

test("adminSettingsSchema accepts a minimal payload and rejects a malformed one", () => {
  assert.equal(adminSettingsSchema.safeParse({}).success, true);
  const valid = adminSettingsSchema.safeParse({
    security: { mfaRequired: true },
    apiKeys: [{ name: "Key 1", scopes: ["admin:read"] }],
  });
  assert.equal(valid.success, true);
  assert.equal(valid.data.apiKeys[0].status, "active");

  assert.equal(adminSettingsSchema.safeParse({ apiKeys: "not-an-array" }).success, false);
  assert.equal(adminSettingsSchema.safeParse({ security: { mfaRequired: "yes" } }).success, false);
});

test("uploadMediaSchema requires data and defaults name/mimeType", () => {
  const valid = uploadMediaSchema.safeParse({ data: "base64==" });
  assert.equal(valid.success, true);
  assert.equal(valid.data.name, "attachment");
  assert.equal(valid.data.mimeType, "application/octet-stream");

  assert.equal(uploadMediaSchema.safeParse({}).success, false);
  assert.equal(uploadMediaSchema.safeParse({ data: "" }).success, false);
});

test("createWorkspaceSchema requires a name, updateWorkspaceSchema allows a partial body", () => {
  const created = createWorkspaceSchema.safeParse({ name: "  Acme  " });
  assert.equal(created.success, true);
  assert.equal(created.data.name, "Acme");
  assert.equal(created.data.businessCategory, "Support");
  assert.equal(createWorkspaceSchema.safeParse({}).success, false);

  assert.equal(updateWorkspaceSchema.safeParse({}).success, true);
  assert.equal(updateWorkspaceSchema.safeParse({ timezone: "Asia/Kolkata" }).success, true);
  assert.equal(updateWorkspaceSchema.safeParse({ name: 42 }).success, false);
});

test("assistant analyze/stream schemas accept an empty body and reject a bad conversationId", () => {
  const analyzed = analyzeSchema.safeParse({});
  assert.equal(analyzed.success, true);
  assert.equal(analyzed.data.provider, "local");
  assert.equal(analyzed.data.task, "full_analysis");

  const streamed = streamSchema.safeParse({});
  assert.equal(streamed.data.task, "draft_reply");

  assert.equal(analyzeSchema.safeParse({ conversationId: "not-an-id" }).success, false);
  assert.equal(analyzeSchema.safeParse({ conversationId: "" }).success, true);
});

test("searchQuerySchema coerces limit from a query string", () => {
  const parsed = searchQuerySchema.safeParse({ q: "hello", limit: "5" });
  assert.equal(parsed.success, true);
  assert.equal(parsed.data.limit, 5);
  assert.equal(searchQuerySchema.safeParse({}).data.q, "");
});

test("knowledgeSchema requires non-empty content", () => {
  assert.equal(knowledgeSchema.safeParse({ content: "Real content" }).success, true);
  assert.equal(knowledgeSchema.safeParse({ content: "   " }).success, false);
  assert.equal(knowledgeSchema.safeParse({}).success, false);
});

test("transcribe/voiceReply schemas are fully optional", () => {
  assert.equal(transcribeSchema.safeParse({}).success, true);
  assert.equal(voiceReplySchema.safeParse({}).success, true);
});

test("toolCallSchema allows an empty name and a free-form arguments object", () => {
  const parsed = toolCallSchema.safeParse({ name: "updateLeadStage", arguments: { stage: "qualified", score: 80 } });
  assert.equal(parsed.success, true);
  assert.equal(parsed.data.arguments.stage, "qualified");

  assert.equal(toolCallSchema.safeParse({}).success, true);
  assert.equal(toolCallSchema.safeParse({ conversationId: "not-an-id" }).success, false);
});
