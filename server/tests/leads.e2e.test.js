import test from "node:test";
import assert from "node:assert/strict";
import mongoose from "mongoose";
import { startTestServer } from "./helpers/testServer.js";
import { seedTestWorkspace } from "./helpers/seedTestWorkspace.js";
import { Lead } from "../models/index.js";

// Covers the new /api/leads read/list/patch surface end to end (HANDOFF.md's 2026-09-06 "PLAN
// OF ACTION" Phase 1): pagination, stage/owner/source filtering, detail with timeline, and the
// stage/owner/followUpAt PATCH each appending a real timeline entry. Own port/DB, same pattern
// as tasksCalendar.e2e.test.js.
const TEST_PORT = 4215;
const MONGO_URI = process.env.TEST_MONGODB_URI_LEADS || "mongodb://127.0.0.1:27017/whatscrm_test_leads";

let server;
let token;
let seed;
let leadIds = [];

async function api(path, { method = "GET", body, expectStatus, authToken = token } = {}) {
  const response = await fetch(`${server.baseUrl}${path}`, {
    method,
    headers: {
      "Content-Type": "application/json",
      ...(authToken ? { Authorization: `Bearer ${authToken}` } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
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

  await mongoose.connect(MONGO_URI, { serverSelectionTimeoutMS: 10000 });
  const leads = await Lead.insertMany(
    seed.contacts.map((contact, index) => ({
      organizationId: seed.organizationId,
      workspaceId: seed.workspaceId,
      contactId: contact._id,
      source: index === 0 ? "Meta Ad" : "WhatsApp",
      stage: index === 0 ? "qualified" : "new_lead",
      score: 10,
      status: "open",
      firstMessage: `Hi, interested lead ${index + 1}`,
      lastActivityAt: new Date(),
      timeline: [{ id: `seed:${index}`, type: "whatsapp_message", title: "First WhatsApp message received", at: new Date(), source: "whatsapp" }],
    }))
  );
  leadIds = leads.map((lead) => lead._id.toString());
  await mongoose.disconnect();

  server = startTestServer({ port: TEST_PORT, mongoUri: MONGO_URI });
  await server.waitUntilReady();

  const login = await api("/api/auth/login", {
    method: "POST",
    body: { email: seed.email, password: seed.password },
    expectStatus: 200,
    authToken: null,
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

test("lists leads with contact/owner populated and total count", async () => {
  const listed = await api("/api/leads", { expectStatus: 200 });
  assert.equal(listed.data.total, 3);
  assert.equal(listed.data.data.length, 3);
  const first = listed.data.data.find((lead) => lead.id === leadIds[0]);
  assert.ok(first);
  assert.equal(first.contactName, seed.contacts[0].name);
  assert.equal(first.ownerName, "Unassigned");
});

test("filters by stage and source", async () => {
  const byStage = await api("/api/leads?stage=qualified", { expectStatus: 200 });
  assert.equal(byStage.data.total, 1);
  assert.equal(byStage.data.data[0].id, leadIds[0]);

  const bySource = await api(`/api/leads?${new URLSearchParams({ source: "meta" })}`, { expectStatus: 200 });
  assert.equal(bySource.data.total, 1);
  assert.equal(bySource.data.data[0].id, leadIds[0]);
});

test("paginates with skip/limit", async () => {
  const page = await api("/api/leads?limit=2&skip=0", { expectStatus: 200 });
  assert.equal(page.data.data.length, 2);
  assert.equal(page.data.total, 3);

  const nextPage = await api("/api/leads?limit=2&skip=2", { expectStatus: 200 });
  assert.equal(nextPage.data.data.length, 1);
});

test("returns full detail including timeline", async () => {
  const detail = await api(`/api/leads/${leadIds[0]}`, { expectStatus: 200 });
  assert.equal(detail.data.data.id, leadIds[0]);
  assert.ok(Array.isArray(detail.data.data.timeline));
  assert.equal(detail.data.data.timeline.length, 1);
  assert.equal(detail.data.data.timeline[0].type, "whatsapp_message");
});

test("404s for a lead outside the workspace or a malformed id", async () => {
  await api(`/api/leads/${new mongoose.Types.ObjectId()}`, { expectStatus: 404 });
  await api("/api/leads/not-an-id", { expectStatus: 404 });
});

test("PATCH stage validates through normalizeLeadStage and appends a timeline entry", async () => {
  const patched = await api(`/api/leads/${leadIds[1]}`, {
    method: "PATCH",
    body: { stage: "not_a_real_stage" },
    expectStatus: 200,
  });
  // normalizeLeadStage() falls back to "new_lead" for anything unrecognized - already "new_lead"
  // here, so this is a no-op: no timeline entry, same as the codebase's other loose-string stage
  // fields (see conversations.js's addToCrmSchema comment).
  assert.equal(patched.data.data.stage, "new_lead");
  assert.equal(patched.data.data.timeline.length, 1);

  const advanced = await api(`/api/leads/${leadIds[1]}`, {
    method: "PATCH",
    body: { stage: "won" },
    expectStatus: 200,
  });
  assert.equal(advanced.data.data.stage, "won");
  assert.equal(advanced.data.data.status, "won");
  const stageEvent = advanced.data.data.timeline.find((event) => event.type === "stage_change");
  assert.ok(stageEvent);
  assert.equal(stageEvent.from, "new_lead");
  assert.equal(stageEvent.to, "won");
});

test("PATCH ownerUserId and followUpAt append their own timeline entries", async () => {
  await api(`/api/leads/${leadIds[2]}`, {
    method: "PATCH",
    body: { ownerUserId: "not-an-id" },
    expectStatus: 400,
  });

  const newOwnerId = new mongoose.Types.ObjectId().toString();
  const owned = await api(`/api/leads/${leadIds[2]}`, {
    method: "PATCH",
    body: { ownerUserId: newOwnerId },
    expectStatus: 200,
  });
  assert.equal(owned.data.data.ownerUserId, newOwnerId);
  assert.ok(owned.data.data.timeline.some((event) => event.type === "owner_change"));

  const followUpAt = new Date(Date.now() + 86400000).toISOString();
  const patched = await api(`/api/leads/${leadIds[2]}`, {
    method: "PATCH",
    body: { followUpAt },
    expectStatus: 200,
  });
  assert.equal(new Date(patched.data.data.followUpAt).toISOString(), followUpAt);
  assert.ok(patched.data.data.timeline.some((event) => event.type === "follow_up_set"));
});

test("rejects an empty PATCH body", async () => {
  await api(`/api/leads/${leadIds[2]}`, { method: "PATCH", body: {}, expectStatus: 400 });
});

test("workspace scoping: a second workspace's leads never appear", async () => {
  const otherSeed = await seedTestWorkspace({ mongoUri: MONGO_URI, contactCount: 1 });
  await mongoose.connect(MONGO_URI, { serverSelectionTimeoutMS: 10000 });
  await Lead.create({
    organizationId: otherSeed.organizationId,
    workspaceId: otherSeed.workspaceId,
    contactId: otherSeed.contacts[0]._id,
    source: "WhatsApp",
    stage: "new_lead",
    status: "open",
  });
  await mongoose.disconnect();

  const listed = await api("/api/leads", { expectStatus: 200 });
  assert.equal(listed.data.total, 3);
});
