import test from "node:test";
import assert from "node:assert/strict";
import mongoose from "mongoose";
import { startTestServer } from "./helpers/testServer.js";
import { seedTestWorkspace } from "./helpers/seedTestWorkspace.js";

// Drives the full critical path end to end against a real running server: login, connect a
// WhatsApp account, receive an inbound message via webhook, reply from the inbox, send a
// campaign, then create an automation flow and prove it fires automatically on the next inbound
// message. Each test builds on state left by the previous one (accountId, conversationId, etc.),
// the same way an actual user session through the app would - this is the "does the whole thing
// actually work together" suite, not a substitute for the more targeted unit/integration tests.
//
// Uses its own port and database, distinct from campaign.integration.test.js, since node's test
// runner executes different test files concurrently by default.
const TEST_PORT = 4212;
const MONGO_URI = process.env.TEST_MONGODB_URI_E2E || "mongodb://127.0.0.1:27017/whatscrm_test_e2e";

let server;
let token;
let seed;

let accountId;
let phoneNumberId;
let templateId;
let contactPhone;
let conversationId;

async function api(path, { method = "GET", body, expectStatus } = {}) {
  const response = await fetch(`${server.baseUrl}${path}`, {
    method,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await response.json().catch(() => ({}));
  if (expectStatus && response.status !== expectStatus) {
    throw new Error(`Expected ${expectStatus} from ${method} ${path}, got ${response.status}: ${JSON.stringify(data)}`);
  }
  return { status: response.status, data };
}

async function postWebhook(payload) {
  const response = await fetch(`${server.baseUrl}/webhooks/whatsapp`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  return response.status;
}

function metaInboundPayload({ from, messageId, text, waName = "E2E Contact" }) {
  return {
    entry: [
      {
        changes: [
          {
            value: {
              metadata: { phone_number_id: phoneNumberId },
              contacts: [{ wa_id: from, profile: { name: waName } }],
              messages: [{ id: messageId, from, text: { body: text } }],
            },
          },
        ],
      },
    ],
  };
}

// Inbound processing, campaign sends, and automation runs all happen after the webhook/API call
// returns (queued through BullMQ when Redis is configured, inline-but-still-async otherwise) -
// poll instead of asserting immediately.
async function waitFor(fn, { timeoutMs = 20000, intervalMs = 300 } = {}) {
  const start = Date.now();
  let lastError;
  while (Date.now() - start < timeoutMs) {
    try {
      const result = await fn();
      if (result) return result;
    } catch (error) {
      lastError = error;
    }
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
  throw lastError || new Error(`Condition not met within ${timeoutMs}ms.`);
}

test.before(async () => {
  const admin = await mongoose.connect(MONGO_URI, { serverSelectionTimeoutMS: 10000 });
  await admin.connection.dropDatabase().catch(() => undefined);
  await mongoose.disconnect();

  // Only used for login/org/workspace bootstrap - the WhatsApp account, template, and contact
  // used through the rest of this suite are all created via the real API below, not seeded
  // directly, so "connect WhatsApp" and "create template" are genuinely exercised.
  seed = await seedTestWorkspace({ mongoUri: MONGO_URI, contactCount: 0 });

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

test("connects a WhatsApp account", async () => {
  phoneNumberId = `e2e_phone_${Date.now()}`;
  const { status, data } = await api("/api/whatsapp/accounts", {
    method: "POST",
    body: {
      provider: "meta",
      displayName: "E2E WhatsApp",
      phoneNumber: "+919990000001",
      phoneNumberId,
      businessAccountId: `e2e_business_${Date.now()}`,
    },
  });

  assert.equal(status, 201);
  assert.equal(data.data.status, "connected");
  // No accessToken was sent, so this defaults to the local-placeholder-token path - sends
  // against this account resolve locally ("mode: local") instead of calling the real Graph API.
  assert.equal(data.data.credentials.accessTokenConfigured, true);
  accountId = data.data.id;
});

test("creates an approved template for the connected account", async () => {
  const { status, data } = await api("/api/whatsapp/templates", {
    method: "POST",
    body: { accountId, name: "e2e_hello", language: "en", category: "UTILITY", body: "Hello from E2E" },
  });

  assert.equal(status, 201);
  assert.equal(data.data.status, "approved");
  templateId = data.data.id;
});

test("an inbound WhatsApp message creates a contact and conversation", async () => {
  contactPhone = "919990001111";
  const webhookStatus = await postWebhook(
    metaInboundPayload({ from: contactPhone, messageId: `e2e_msg_${Date.now()}`, text: "Hi, I need help with my order." })
  );
  assert.equal(webhookStatus, 200);

  const found = await waitFor(async () => {
    const { data } = await api(`/api/conversations?search=${contactPhone}`);
    return data.data?.find((conversation) => conversation.phone === contactPhone);
  });

  assert.equal(found.status, "open");
  conversationId = found.id;

  const messages = await api(`/api/conversations/${conversationId}/messages`, { expectStatus: 200 });
  assert.equal(messages.data.data.length, 1);
  assert.equal(messages.data.data[0].from, "contact");
  assert.equal(messages.data.data[0].content, "Hi, I need help with my order.");
});

test("an agent can reply from the inbox", async () => {
  const { status, data } = await api(`/api/conversations/${conversationId}/messages`, {
    method: "POST",
    body: { content: "Thanks for reaching out, how can I help?" },
  });

  assert.equal(status, 201);
  assert.equal(data.data.status, "sent");

  const messages = await api(`/api/conversations/${conversationId}/messages`, { expectStatus: 200 });
  assert.equal(messages.data.data.length, 2, "expected the inbound message plus the agent reply");
  const reply = messages.data.data.find((message) => message.from === "agent");
  assert.equal(reply?.content, "Thanks for reaching out, how can I help?");
});

test("a campaign reaches the inbound contact", async () => {
  const created = await api("/api/campaigns", {
    method: "POST",
    body: { name: "E2E Campaign", audienceType: "all", templateId, rateLimit: { perMinute: 600 } },
    expectStatus: 201,
  });
  const campaignId = created.data.data.id;
  assert.ok(created.data.data.recipients >= 1, "expected the campaign to target at least the inbound contact");

  await api(`/api/campaigns/${campaignId}/send`, { method: "POST", body: {}, expectStatus: 200 });

  const finalCampaign = await waitFor(async () => {
    const { data } = await api(`/api/campaigns/${campaignId}`);
    const campaignStatus = data.data?.status;
    return campaignStatus === "sent" || campaignStatus === "failed" ? data.data : null;
  });

  assert.equal(finalCampaign.status, "sent");
  assert.ok(finalCampaign.sent >= 1);

  // The campaign send reuses the contact's existing open conversation (not a new one), so this
  // proves the send actually landed against the same contact the earlier steps talked to.
  const campaignMessage = await waitFor(async () => {
    const { data } = await api(`/api/conversations/${conversationId}/messages`);
    return data.data.find((message) => message.content.includes("Campaign template sent"));
  });
  assert.ok(campaignMessage, "expected the campaign send to appear in the inbound contact's conversation");
});

test("an automation flow replies automatically to a new inbound message", async () => {
  const flow = await api("/api/automation", {
    method: "POST",
    body: {
      name: "E2E Auto Reply",
      // Creating a flow without an explicit triggerType defaults to "new_conversation" (the
      // schema's `trigger` field defaults to the human label "New conversation"), which would
      // NOT fire on this test's second inbound message since the conversation already exists.
      triggerType: "new_message",
      sendReply: true,
      actionMessage: "This is an automated reply.",
      status: "active",
    },
    expectStatus: 201,
  });
  assert.equal(flow.data.data.status, "active");
  assert.equal(flow.data.data.triggerType, "new_message");

  const webhookStatus = await postWebhook(
    metaInboundPayload({ from: contactPhone, messageId: `e2e_msg_2_${Date.now()}`, text: "Are you still there?" })
  );
  assert.equal(webhookStatus, 200);

  const autoReply = await waitFor(async () => {
    const { data } = await api(`/api/conversations/${conversationId}/messages`);
    return data.data.find((message) => message.content === "This is an automated reply.");
  });

  assert.equal(autoReply.from, "agent");
});
