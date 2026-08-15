import test from "node:test";
import assert from "node:assert/strict";
import mongoose from "mongoose";
import { startTestServer } from "./helpers/testServer.js";
import { seedTestWorkspace } from "./helpers/seedTestWorkspace.js";

// Covers the new GET /api/admin/audit-log/export and POST /api/admin/audit-log/prune routes end
// to end: real AuditLog documents inserted with deliberately old and recent createdAt timestamps,
// a configured retention window, then confirms export returns real CSV content and prune deletes
// only what's actually past the window. Own port/DB, same pattern as tasksCalendar.e2e.test.js.
const TEST_PORT = 4215;
const MONGO_URI = process.env.TEST_MONGODB_URI_AUDIT || "mongodb://127.0.0.1:27017/whatscrm_test_audit";

let server;
let token;
let seed;
let oldLogId;
let recentLogId;

async function api(path, { method = "GET", body, expectStatus, raw = false } = {}) {
  const response = await fetch(`${server.baseUrl}${path}`, {
    method,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = raw ? await response.text() : await response.json().catch(() => ({}));
  if (expectStatus && response.status !== expectStatus) {
    throw new Error(`Expected ${expectStatus} from ${method} ${path}, got ${response.status}: ${JSON.stringify(data)}`);
  }
  return { status: response.status, data };
}

test.before(async () => {
  const admin = await mongoose.connect(MONGO_URI, { serverSelectionTimeoutMS: 10000 });
  await admin.connection.dropDatabase().catch(() => undefined);

  seed = await seedTestWorkspace({ mongoUri: MONGO_URI, contactCount: 0 });

  // seedTestWorkspace disconnects Mongoose's global connection when it finishes - reconnect before
  // touching the DB again.
  await mongoose.connect(MONGO_URI, { serverSelectionTimeoutMS: 10000 });

  // Insert directly against the raw collection, bypassing the Mongoose timestamps plugin, so
  // createdAt is exactly what the test needs rather than "now".
  const oldDate = new Date(Date.now() - 400 * 24 * 60 * 60 * 1000); // 400 days ago
  const recentDate = new Date(Date.now() - 5 * 24 * 60 * 60 * 1000); // 5 days ago
  const orgId = new mongoose.Types.ObjectId(seed.organizationId);
  const workspaceId = new mongoose.Types.ObjectId(seed.workspaceId);

  const inserted = await mongoose.connection.collection("auditlogs").insertMany([
    {
      organizationId: orgId,
      workspaceId,
      action: "DELETE /api/contacts/old-record",
      entityType: "Contact",
      entityId: "old-record",
      after: { statusCode: 204 },
      createdAt: oldDate,
      updatedAt: oldDate,
    },
    {
      organizationId: orgId,
      workspaceId,
      action: "PUT /api/contacts/recent-record",
      entityType: "Contact",
      entityId: "recent-record",
      after: { statusCode: 200, query: {} },
      createdAt: recentDate,
      updatedAt: recentDate,
    },
  ]);
  oldLogId = inserted.insertedIds[0].toString();
  recentLogId = inserted.insertedIds[1].toString();

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

  // Retention window: 30 days - the "old" entry (400 days) is well past it, the "recent" entry
  // (5 days) is well within it.
  await api("/api/admin/settings", {
    method: "PUT",
    body: { security: { dataRetentionDays: 30 } },
    expectStatus: 200,
  });
});

test.after(async () => {
  await server?.stop();
  const admin = await mongoose.connect(MONGO_URI, { serverSelectionTimeoutMS: 10000 });
  await admin.connection.dropDatabase().catch(() => undefined);
  await mongoose.disconnect();
});

test("GET /audit-log/export returns real CSV content for both entries", async () => {
  const response = await fetch(`${server.baseUrl}/api/admin/audit-log/export`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type") || "", /text\/csv/);

  const csv = await response.text();
  const lines = csv.trim().split("\n");
  assert.equal(lines[0], "id,createdAt,actor,action,entityType,entityId,ipAddress,userAgent,before,after");
  assert.ok(csv.includes(oldLogId), "expected the old log entry in the export");
  assert.ok(csv.includes(recentLogId), "expected the recent log entry in the export");
  assert.ok(csv.includes("DELETE /api/contacts/old-record"));
  assert.ok(csv.includes("PUT /api/contacts/recent-record"));
});

test("POST /audit-log/prune deletes only entries past the configured retention window", async () => {
  const { status, data } = await api("/api/admin/audit-log/prune", { method: "POST", expectStatus: 200 });
  assert.equal(status, 200);
  assert.equal(data.data.retentionDays, 30);
  assert.equal(data.data.deletedCount, 1);

  const db = await mongoose.connect(MONGO_URI, { serverSelectionTimeoutMS: 10000 });
  const remaining = await db.connection.collection("auditlogs").find({ workspaceId: new mongoose.Types.ObjectId(seed.workspaceId) }).toArray();
  await mongoose.disconnect();

  // Not asserting an exact total count here - the audit middleware itself logs this test's own
  // PUT /settings (test.before) and POST /prune requests, adding real (recent, so un-pruned)
  // entries beyond the two seeded directly. What matters is the old one is gone and the
  // deliberately-recent one survives.
  const remainingIds = remaining.map((doc) => doc._id.toString());
  assert.ok(!remainingIds.includes(oldLogId), "expected the old log entry to be pruned");
  assert.ok(remainingIds.includes(recentLogId), "expected the recent log entry to survive pruning");
});
