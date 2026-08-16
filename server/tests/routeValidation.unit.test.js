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
import { inviteMemberSchema } from "../routes/team.js";
import {
  createTemplateBodySchema,
  listTemplatesQuerySchema,
  previewTemplateBodySchema,
  syncWhatsappTemplatesSchema,
} from "../routes/templates.js";
import { createWhatsappTemplateSchema, listWhatsappTemplatesQuerySchema } from "../routes/whatsapp.js";
import { importCampaignContactsSchema, previewCampaignSchema } from "../routes/campaigns.js";
import {
  addNoteSchema,
  addToCrmSchema,
  createConversationSchema,
  deleteMessageByIdSchema,
  deleteMessageSchema,
  listConversationMessagesQuerySchema,
  listConversationsQuerySchema,
  sendMessageSchema,
  sendTemplateSchema,
} from "../routes/conversations.js";

// A syntactically valid ObjectId, reused everywhere an objectIdString field needs a real id.
const VALID_ID = "507f1f77bcf86cd799439011";

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

// --- 15-route validation backfill (team/templates/whatsapp/campaigns/conversations) ---

test("inviteMemberSchema requires a valid email and a policy-passing password, defaults role", () => {
  const valid = inviteMemberSchema.safeParse({ email: "new.member@example.com", password: "ValidPass123" });
  assert.equal(valid.success, true);
  assert.equal(valid.data.role, "agent");

  assert.equal(inviteMemberSchema.safeParse({ email: "not-an-email", password: "ValidPass123" }).success, false);
  assert.equal(inviteMemberSchema.safeParse({ email: "new.member@example.com", password: "short" }).success, false);
  assert.equal(inviteMemberSchema.safeParse({ password: "ValidPass123" }).success, false);

  // role stays a permissive free-form string - normalizeRoleKey() silently coerces anything
  // unrecognized to "agent" rather than rejecting it, so garbage here must still parse.
  const garbageRole = inviteMemberSchema.safeParse({
    email: "new.member@example.com",
    password: "ValidPass123",
    role: "not-a-real-role",
  });
  assert.equal(garbageRole.success, true);
  assert.equal(garbageRole.data.role, "not-a-real-role");
});

test("templates.js query/body schemas stay permissive on their loose string fields", () => {
  assert.equal(listTemplatesQuerySchema.safeParse({}).success, true);
  // type/status/category/language have no enum - the handler silently falls back on anything
  // unrecognized, so garbage values must still parse rather than reject.
  assert.equal(
    listTemplatesQuerySchema.safeParse({ type: "bogus", status: "bogus", category: "bogus", language: "bogus" })
      .success,
    true,
  );

  assert.equal(createTemplateBodySchema.safeParse({}).success, true);
  assert.equal(createTemplateBodySchema.safeParse({ variables: "not-an-array" }).success, false);

  assert.equal(previewTemplateBodySchema.safeParse({}).success, true);
  assert.equal(previewTemplateBodySchema.safeParse({ body: "Hi {{name}}", variables: { name: "Sam" } }).success, true);

  // accountId must stay optional - the only real caller (the "Sync WhatsApp" button) always
  // calls with zero arguments.
  assert.equal(syncWhatsappTemplatesSchema.safeParse({}).success, true);
  assert.equal(syncWhatsappTemplatesSchema.safeParse({ accountId: "not-an-id" }).success, false);
});

test("whatsapp.js template schemas require only a name, default the rest", () => {
  assert.equal(listWhatsappTemplatesQuerySchema.safeParse({}).success, true);

  const valid = createWhatsappTemplateSchema.safeParse({ name: "Order Confirmation" });
  assert.equal(valid.success, true);
  assert.equal(valid.data.language, "en");
  assert.equal(valid.data.category, "UTILITY");
  assert.equal(valid.data.body, "");

  assert.equal(createWhatsappTemplateSchema.safeParse({}).success, false);
  assert.equal(createWhatsappTemplateSchema.safeParse({ name: "   " }).success, false);
});

test("campaigns.js preview/import schemas accept a minimal payload and coerce/validate types", () => {
  assert.equal(previewCampaignSchema.safeParse({}).success, true);
  const withLimit = previewCampaignSchema.safeParse({ limit: "25" });
  assert.equal(withLimit.success, true);
  assert.equal(withLimit.data.limit, 25);
  assert.equal(previewCampaignSchema.safeParse({ limit: "not-a-number" }).success, false);

  assert.equal(importCampaignContactsSchema.safeParse({}).success, true);
  assert.equal(
    importCampaignContactsSchema.safeParse({ contacts: [{ name: "Sam", phone: 9198765432 }] }).success,
    true,
  );
  // phone is deliberately not required at the schema level - a missing phone is reported as a
  // per-row failure in the 201 response body, not a request-level rejection.
  assert.equal(importCampaignContactsSchema.safeParse({ contacts: [{ name: "Sam" }] }).success, true);
  assert.equal(importCampaignContactsSchema.safeParse({ contacts: "not-an-array" }).success, false);
});

test("conversations.js list query schemas accept an empty query and garbage filter values", () => {
  assert.equal(listConversationsQuerySchema.safeParse({}).success, true);
  // status/search/unread have no enum - invalid values are silently ignored, never rejected.
  assert.equal(listConversationsQuerySchema.safeParse({ status: "bogus", unread: "bogus" }).success, true);
  const coerced = listConversationsQuerySchema.safeParse({ limit: "50" });
  assert.equal(coerced.success, true);
  assert.equal(coerced.data.limit, 50);

  assert.equal(listConversationMessagesQuerySchema.safeParse({}).success, true);
  assert.equal(listConversationMessagesQuerySchema.safeParse({ limit: "10", before: "not-a-real-cursor" }).success, true);
});

test("conversations.js delete-message schemas keep mode permissive but require a real messageId where present", () => {
  assert.equal(deleteMessageSchema.safeParse({}).success, true);
  // mode has no enum - the handler string-compares against "me" and treats anything else,
  // including garbage, as the full-delete branch.
  assert.equal(deleteMessageSchema.safeParse({ mode: "bogus" }).success, true);

  assert.equal(deleteMessageByIdSchema.safeParse({ messageId: VALID_ID }).success, true);
  assert.equal(deleteMessageByIdSchema.safeParse({}).success, false);
  assert.equal(deleteMessageByIdSchema.safeParse({ messageId: "not-an-id" }).success, false);
});

test("createConversationSchema requires a real contactId, addToCrmSchema stays permissive on stage", () => {
  assert.equal(createConversationSchema.safeParse({ contactId: VALID_ID }).success, true);
  assert.equal(createConversationSchema.safeParse({}).success, false);
  assert.equal(createConversationSchema.safeParse({ contactId: "not-an-id" }).success, false);

  assert.equal(addToCrmSchema.safeParse({}).success, true);
  // stage has no enum - normalizeLeadStage() silently falls back to "new_lead" for anything
  // unrecognized rather than rejecting.
  assert.equal(addToCrmSchema.safeParse({ stage: "not-a-real-stage" }).success, true);
});

test("sendTemplateSchema requires a real templateId and treats parameters as an array, not a record", () => {
  const valid = sendTemplateSchema.safeParse({ templateId: VALID_ID, parameters: ["Sam", "Order #42"] });
  assert.equal(valid.success, true);

  assert.equal(sendTemplateSchema.safeParse({}).success, false);
  assert.equal(sendTemplateSchema.safeParse({ templateId: "not-an-id" }).success, false);
  // Real bug the earlier OpenAPI guess would have shipped: parameters is an array (matching the
  // client's own string[] contract and the handler's Array.isArray check), not a record.
  assert.equal(
    sendTemplateSchema.safeParse({ templateId: VALID_ID, parameters: { name: "Sam" } }).success,
    false,
  );
});

test("sendMessageSchema requires content (allowing empty string for media-only sends)", () => {
  // The one deliberate behavior change in this pass: content.trim() previously had no
  // null-check, so an omitted content was an unhandled 500. Requiring the field (while still
  // allowing "") converts that into a clean 400 without rejecting the one real caller's shape.
  assert.equal(sendMessageSchema.safeParse({ content: "Hello there" }).success, true);
  assert.equal(sendMessageSchema.safeParse({ content: "" }).success, true);
  assert.equal(sendMessageSchema.safeParse({}).success, false);

  const withAttachment = sendMessageSchema.safeParse({
    content: "",
    attachments: [{ url: "https://cdn.example.com/file.pdf", type: "document" }],
  });
  assert.equal(withAttachment.success, true);
  assert.equal(sendMessageSchema.safeParse({ content: "", attachments: [{ type: "document" }] }).success, false);
});

test("addNoteSchema rejects empty and whitespace-only content", () => {
  assert.equal(addNoteSchema.safeParse({ content: "Called back, left voicemail." }).success, true);
  assert.equal(addNoteSchema.safeParse({ content: "   " }).success, false);
  assert.equal(addNoteSchema.safeParse({}).success, false);
});
