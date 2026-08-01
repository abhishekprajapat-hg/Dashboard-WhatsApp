import test from "node:test";
import assert from "node:assert/strict";
import mongoose from "mongoose";
import { startTestServer } from "./helpers/testServer.js";
import { seedTestWorkspace } from "./helpers/seedTestWorkspace.js";

const TEST_PORT = 4211;
const MONGO_URI = process.env.TEST_MONGODB_URI || "mongodb://127.0.0.1:27017/whatscrm_test_campaign";

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
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await response.json().catch(() => ({}));
  if (expectStatus && response.status !== expectStatus) {
    throw new Error(`Expected ${expectStatus} from ${method} ${path}, got ${response.status}: ${JSON.stringify(data)}`);
  }
  return { status: response.status, data };
}

async function waitForCampaignSent(campaignId, timeoutMs = 20000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const { data } = await api(`/api/campaigns/${campaignId}`);
    if (data.data?.status === "sent" || data.data?.status === "failed") return data.data;
    await new Promise((resolve) => setTimeout(resolve, 300));
  }
  throw new Error(`Campaign ${campaignId} did not finish sending within ${timeoutMs}ms.`);
}

test.before(async () => {
  const admin = await mongoose.connect(MONGO_URI, { serverSelectionTimeoutMS: 10000 });
  await admin.connection.dropDatabase().catch(() => undefined);
  await mongoose.disconnect();

  seed = await seedTestWorkspace({ mongoUri: MONGO_URI, contactCount: 6 });

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

test("creates a campaign against the seeded workspace", async () => {
  const { status, data } = await api("/api/campaigns", {
    method: "POST",
    body: { name: "Integration Test Campaign", audienceType: "all" },
  });

  assert.equal(status, 201);
  assert.equal(data.data.recipients, 6, "campaign should target all seeded contacts");
  assert.equal(data.data.status, "draft");
});

test("rejects a campaign with no name", async () => {
  const { status, data } = await api("/api/campaigns", {
    method: "POST",
    body: { audienceType: "all" },
  });

  assert.equal(status, 400);
  assert.equal(data.error, "VALIDATION_ERROR");
});

test("sending a campaign delivers to every recipient and records messages", async () => {
  const created = await api("/api/campaigns", {
    method: "POST",
    body: { name: "Send Path Campaign", audienceType: "all", rateLimit: { perMinute: 600 } },
    expectStatus: 201,
  });
  const campaignId = created.data.data.id;

  const sent = await api(`/api/campaigns/${campaignId}/send`, { method: "POST", body: {}, expectStatus: 200 });
  assert.ok(["queued", "inline", "mixed"].includes(sent.data.queueMode), `unexpected queueMode: ${sent.data.queueMode}`);

  const finalCampaign = await waitForCampaignSent(campaignId);
  assert.equal(finalCampaign.status, "sent");
  assert.equal(finalCampaign.sent, 6);
  assert.equal(finalCampaign.failed, 0);

  const detail = await api(`/api/campaigns/${campaignId}`, { expectStatus: 200 });
  const recipientStatuses = detail.data.data.recipients.map((recipient) => recipient.status);
  assert.deepEqual(recipientStatuses, new Array(6).fill("sent"));

  const uniquePhones = new Set(detail.data.data.timeline.map((entry) => entry.phone));
  assert.equal(detail.data.data.timeline.length, 6, "expected exactly one message per recipient, no duplicates");
  assert.equal(uniquePhones.size, 6);
});

// Only meaningful with a real queue: inline fallback (no Redis) processes the whole send
// synchronously within the request, so every recipient would already be "sent" by the time the
// pause call arrives, making this assertion flaky rather than a real check of pause behavior.
test("pausing a campaign mid-send stops further recipients from being sent", { skip: !process.env.REDIS_URL && "requires REDIS_URL for real async queuing" }, async () => {
  const created = await api("/api/campaigns", {
    method: "POST",
    body: { name: "Pause Path Campaign", audienceType: "all", rateLimit: { perMinute: 6 } },
    expectStatus: 201,
  });
  const campaignId = created.data.data.id;

  await api(`/api/campaigns/${campaignId}/send`, { method: "POST", body: {}, expectStatus: 200 });
  const paused = await api(`/api/campaigns/${campaignId}/action`, {
    method: "POST",
    body: { action: "pause" },
    expectStatus: 200,
  });

  assert.equal(paused.data.data.status, "paused");
  const stillSent = Number(paused.data.data.sent || 0);
  assert.ok(stillSent < 6, `expected pause to happen before all 6 recipients sent, got sent=${stillSent}`);
});
