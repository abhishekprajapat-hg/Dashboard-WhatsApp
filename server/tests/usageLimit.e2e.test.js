import test from "node:test";
import assert from "node:assert/strict";
import mongoose from "mongoose";
import { Notification, Organization, UsageCounter } from "../models/index.js";
import { startTestServer } from "./helpers/testServer.js";
import { seedTestWorkspace } from "./helpers/seedTestWorkspace.js";

// Phase 6 (master plan) coverage for requireUnderUsageLimit (middleware/usageLimit.js) against a
// real running server: soft-warn behavior is always on, hard-block only activates behind the
// usageLimitHardBlock feature flag. seedTestWorkspace's org is plan "starter" (normalizes to
// "basic"), whose PLAN_LIMITS.messagesSent is 1000 (services/entitlements.js) - counters are set
// directly rather than actually sending 800-1000 messages to reach the thresholds.
//
// Distinct port/database from every other e2e file, same reasoning as validationBackfillGapRoutes.
const TEST_PORT = 4231;
const MONGO_URI = process.env.TEST_MONGODB_URI_E2E || "mongodb://127.0.0.1:27017/whatscrm_test_e2e_usagelimit";

let server;
let token;
let seed;
let conversationId;

function currentPeriod() {
  const now = new Date();
  return `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, "0")}`;
}

async function setUsageCount(organizationId, count) {
  await mongoose.connect(MONGO_URI, { serverSelectionTimeoutMS: 10000 });
  await UsageCounter.findOneAndUpdate(
    { organizationId, period: currentPeriod(), metric: "messagesSent" },
    { $set: { count } },
    { upsert: true, setDefaultsOnInsert: true }
  );
  await mongoose.disconnect();
}

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

  seed = await seedTestWorkspace({ mongoUri: MONGO_URI, contactCount: 1 });

  // seedTestWorkspace defaults to "pro" (every entitlement unlocked) - this suite specifically
  // exercises the "basic" tier's PLAN_LIMITS.messagesSent (1000), so it downgrades its own org
  // rather than relying on the shared helper's default.
  await mongoose.connect(MONGO_URI, { serverSelectionTimeoutMS: 10000 });
  await Organization.updateOne({ _id: seed.organizationId }, { $set: { plan: "basic" } });
  await mongoose.disconnect();

  server = startTestServer({ port: TEST_PORT, mongoUri: MONGO_URI });
  await server.waitUntilReady();

  const login = await api("/api/auth/login", {
    method: "POST",
    body: { email: seed.email, password: seed.password },
    expectStatus: 200,
  });
  token = login.data.token;
  assert.ok(token, "login did not return a token");

  const conversation = await api("/api/conversations", {
    method: "POST",
    body: { contactId: seed.contacts[0]._id.toString() },
    expectStatus: 201,
  });
  conversationId = conversation.data.data.id;
});

test.after(async () => {
  await server?.stop();
  const admin = await mongoose.connect(MONGO_URI, { serverSelectionTimeoutMS: 10000 });
  await admin.connection.dropDatabase().catch(() => undefined);
  await mongoose.disconnect();
});

test("well under the plan's messagesSent limit: sends normally, no soft-warn notification", async () => {
  await setUsageCount(seed.organizationId, 10);

  const { status } = await api(`/api/conversations/${conversationId}/messages`, {
    method: "POST",
    body: { content: "hello, well under the limit" },
    expectStatus: 201,
  });
  assert.equal(status, 201);

  await mongoose.connect(MONGO_URI, { serverSelectionTimeoutMS: 10000 });
  const warned = await Notification.exists({ workspaceId: seed.workspaceId, type: "usage.softWarn.messagesSent" });
  await mongoose.disconnect();
  assert.equal(warned, null);
});

test("at 80%+ of the plan's messagesSent limit: still sends (soft-warn does not block), and warns exactly once per period", async () => {
  // basic plan's messagesSent limit is 1000 - 800 is exactly the 80% soft-warn threshold.
  await setUsageCount(seed.organizationId, 800);

  const first = await api(`/api/conversations/${conversationId}/messages`, {
    method: "POST",
    body: { content: "crossing the soft-warn threshold" },
  });
  assert.equal(first.status, 201, "soft-warn must not block the send by default");

  // warnUsageSoftLimitOnce is fire-and-forget - give it a moment to land before reading it back.
  await new Promise((resolve) => setTimeout(resolve, 400));

  await mongoose.connect(MONGO_URI, { serverSelectionTimeoutMS: 10000 });
  const firstWarnings = await Notification.countDocuments({ workspaceId: seed.workspaceId, type: "usage.softWarn.messagesSent" });
  await mongoose.disconnect();
  assert.equal(firstWarnings, 1, "expected exactly one soft-warn notification, not one per request");

  const second = await api(`/api/conversations/${conversationId}/messages`, {
    method: "POST",
    body: { content: "a second send past the threshold, same period" },
  });
  assert.equal(second.status, 201);

  await new Promise((resolve) => setTimeout(resolve, 400));
  await mongoose.connect(MONGO_URI, { serverSelectionTimeoutMS: 10000 });
  const warningsAfterSecondSend = await Notification.countDocuments({ workspaceId: seed.workspaceId, type: "usage.softWarn.messagesSent" });
  await mongoose.disconnect();
  assert.equal(warningsAfterSecondSend, 1, "a second over-threshold send in the same period must not create a second notification");
});

test("even fully over the limit, the default config (usageLimitHardBlock off) still lets the send through", async () => {
  await setUsageCount(seed.organizationId, 5000);

  const { status } = await api(`/api/conversations/${conversationId}/messages`, {
    method: "POST",
    body: { content: "way over the limit, but hard-block is off by default" },
  });
  assert.equal(status, 201);
});

// A separate server process (own port/database) with FEATURE_USAGE_LIMIT_HARD_BLOCK=true, since
// the flag is read into services/featureFlags.js's in-memory cache at process start - this proves
// the actual blocking behavior the flag exists to gate, not just that it's wired to something.
test("with usageLimitHardBlock enabled, a fully-over-limit organization is blocked with 429 USAGE_LIMIT_EXCEEDED", async () => {
  const hardBlockPort = TEST_PORT + 1;
  const hardBlockMongoUri = `${MONGO_URI}_hardblock`;

  const admin = await mongoose.connect(hardBlockMongoUri, { serverSelectionTimeoutMS: 10000 });
  await admin.connection.dropDatabase().catch(() => undefined);
  await mongoose.disconnect();

  const hbSeed = await seedTestWorkspace({ mongoUri: hardBlockMongoUri, contactCount: 1 });
  await mongoose.connect(hardBlockMongoUri, { serverSelectionTimeoutMS: 10000 });
  await Organization.updateOne({ _id: hbSeed.organizationId }, { $set: { plan: "basic" } });
  await mongoose.disconnect();

  const hbServer = startTestServer({
    port: hardBlockPort,
    mongoUri: hardBlockMongoUri,
    extraEnv: { FEATURE_USAGE_LIMIT_HARD_BLOCK: "true" },
  });
  await hbServer.waitUntilReady();

  try {
    const hbBaseUrl = `http://127.0.0.1:${hardBlockPort}`;
    const loginResponse = await fetch(`${hbBaseUrl}/api/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: hbSeed.email, password: hbSeed.password }),
    });
    const login = await loginResponse.json();
    const hbToken = login.token;
    assert.ok(hbToken, "hard-block server login did not return a token");

    const conversationResponse = await fetch(`${hbBaseUrl}/api/conversations`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${hbToken}` },
      body: JSON.stringify({ contactId: hbSeed.contacts[0]._id.toString() }),
    });
    const conversationData = await conversationResponse.json();
    const hbConversationId = conversationData.data.id;

    await mongoose.connect(hardBlockMongoUri, { serverSelectionTimeoutMS: 10000 });
    await UsageCounter.findOneAndUpdate(
      { organizationId: hbSeed.organizationId, period: currentPeriod(), metric: "messagesSent" },
      { $set: { count: 1000 } },
      { upsert: true, setDefaultsOnInsert: true }
    );
    await mongoose.disconnect();

    const sendResponse = await fetch(`${hbBaseUrl}/api/conversations/${hbConversationId}/messages`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${hbToken}` },
      body: JSON.stringify({ content: "should be blocked" }),
    });
    const sendData = await sendResponse.json();
    assert.equal(sendResponse.status, 429);
    assert.equal(sendData.error, "USAGE_LIMIT_EXCEEDED");
    assert.equal(sendData.limit, 1000);
  } finally {
    await hbServer.stop();
    const cleanup = await mongoose.connect(hardBlockMongoUri, { serverSelectionTimeoutMS: 10000 });
    await cleanup.connection.dropDatabase().catch(() => undefined);
    await mongoose.disconnect();
  }
});
