import test from "node:test";
import assert from "node:assert/strict";
import mongoose from "mongoose";
import { startTestServer } from "./helpers/testServer.js";
import { seedTestWorkspace } from "./helpers/seedTestWorkspace.js";

// Targeted e2e coverage for the highest-traffic routes among the 15-route validation backfill
// (team.js/templates.js/whatsapp.js/campaigns.js/conversations.js) - proves the real wired
// validateBody/validateQuery schemas behave correctly against a real running server, not just
// via safeParse() in isolation (see routeValidation.unit.test.js for the broader schema-level
// coverage). Distinct port/database from every other e2e file since node's test runner executes
// files concurrently by default.
const TEST_PORT = 4217;
const MONGO_URI = process.env.TEST_MONGODB_URI_E2E || "mongodb://127.0.0.1:27017/whatscrm_test_e2e_backfill";

let server;
let token;
let seed;

async function api(path, { method = "GET", body, expectStatus } = {}) {
  const response = await fetch(`${server.baseUrl}${path}`, {
    method,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const data = await response.json().catch(() => ({}));
  if (expectStatus && response.status !== expectStatus) {
    throw new Error(`Expected ${expectStatus} from ${method} ${path}, got ${response.status}: ${JSON.stringify(data)}`);
  }
  return { status: response.status, data };
}

test.before(async () => {
  const admin = await mongoose.connect(MONGO_URI, { serverSelectionTimeoutMS: 10000 });
  await admin.connection.dropDatabase().catch(() => undefined);
  await mongoose.disconnect();

  seed = await seedTestWorkspace({ mongoUri: MONGO_URI, contactCount: 3 });

  server = startTestServer({ port: TEST_PORT, mongoUri: MONGO_URI });
  await server.waitUntilReady();

  const login = await api("/api/auth/login", {
    method: "POST",
    body: { email: seed.email, password: seed.password },
    expectStatus: 200,
  });
  token = login.data.token;
  assert.ok(token, "login did not return a token");
});

test.after(async () => {
  await server?.stop();
  const admin = await mongoose.connect(MONGO_URI, { serverSelectionTimeoutMS: 10000 });
  await admin.connection.dropDatabase().catch(() => undefined);
  await mongoose.disconnect();
});

test("team invite: rejects a bad email/weak password, succeeds with a valid one", async () => {
  const badEmail = await api("/api/team", {
    method: "POST",
    body: { email: "not-an-email", password: "ValidPass123" },
  });
  assert.equal(badEmail.status, 400);

  const weakPassword = await api("/api/team", {
    method: "POST",
    body: { email: "new.agent@test.local", password: "short" },
  });
  assert.equal(weakPassword.status, 400);

  const created = await api("/api/team", {
    method: "POST",
    body: { email: "new.agent@test.local", password: "ValidPass123", name: "New Agent" },
    expectStatus: 201,
  });
  assert.equal(created.data.data.email, "new.agent@test.local");
});

test("sync-whatsapp: the real zero-argument call (the only real caller's shape) succeeds", async () => {
  // Confirms the OpenAPI pass's original guess (accountId required) would have broken this real
  // caller - the actual schema makes accountId optional, and calling with zero arguments still
  // syncs every connected account in the workspace.
  const { status, data } = await api("/api/templates/sync-whatsapp", { method: "POST", body: {} });
  assert.equal(status, 200);
  assert.equal(data.accounts, 1, "expected the one seeded connected account to be swept");
  assert.ok(data.synced >= 1, "expected at least one provider template to sync");

  const invalidAccountId = await api("/api/templates/sync-whatsapp", {
    method: "POST",
    body: { accountId: "not-an-id" },
  });
  assert.equal(invalidAccountId.status, 400);
});

test("whatsapp template creation: only name is required, language/category/body default", async () => {
  const { status, data } = await api("/api/whatsapp/templates", {
    method: "POST",
    body: { name: `defaults_check_${Date.now()}` },
    expectStatus: 201,
  });
  assert.equal(status, 201);
  assert.equal(data.data.language, "en");
  assert.equal(data.data.category, "UTILITY");

  const missingName = await api("/api/whatsapp/templates", { method: "POST", body: {} });
  assert.equal(missingName.status, 400);
});

test("campaign preview: resolves a real audience without creating a campaign", async () => {
  const { status, data } = await api("/api/campaigns/preview", {
    method: "POST",
    body: { audienceType: "all" },
    expectStatus: 200,
  });
  assert.equal(status, 200);
  assert.ok(data.data.count >= 1, "expected the preview to see the seeded contacts");
  assert.ok(Array.isArray(data.data.sample));

  const badLimit = await api("/api/campaigns/preview", {
    method: "POST",
    body: { audienceType: "all", limit: "not-a-number" },
  });
  assert.equal(badLimit.status, 400);
});

test("conversations POST /:id/messages: both real message shapes succeed, a missing content is a clean 400", async () => {
  const contact = seed.contacts[0];
  const conversation = await api("/api/conversations", {
    method: "POST",
    body: { contactId: contact._id.toString(), content: "Conversation started" },
    expectStatus: 201,
  });
  const conversationId = conversation.data.data.id;

  const textMessage = await api(`/api/conversations/${conversationId}/messages`, {
    method: "POST",
    body: { content: "Plain text reply" },
    expectStatus: 201,
  });
  assert.equal(textMessage.data.data.status, "sent");

  // The fixed crash case: content is required (allowing "") - an attachment-only send with an
  // empty content string must succeed with a clean 201, not throw.
  const attachmentOnly = await api(`/api/conversations/${conversationId}/messages`, {
    method: "POST",
    body: {
      content: "",
      attachments: [{ url: "https://cdn.example.com/e2e-test-file.pdf", type: "document", name: "file.pdf" }],
    },
    expectStatus: 201,
  });
  assert.equal(attachmentOnly.status, 201);

  // Before this pass, an omitted content was an unhandled TypeError (content.trim() on
  // undefined) - a 500, not a clean validation error. Confirms it's now a 400.
  const missingContent = await api(`/api/conversations/${conversationId}/messages`, {
    method: "POST",
    body: { attachments: [{ url: "https://cdn.example.com/no-content.pdf" }] },
  });
  assert.equal(missingContent.status, 400);
  assert.equal(missingContent.data.error, "VALIDATION_ERROR");
});
