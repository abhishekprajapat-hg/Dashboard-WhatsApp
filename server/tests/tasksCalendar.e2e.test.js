import test from "node:test";
import assert from "node:assert/strict";
import mongoose from "mongoose";
import { startTestServer } from "./helpers/testServer.js";
import { seedTestWorkspace } from "./helpers/seedTestWorkspace.js";

// Covers the new /api/tasks and /api/calendar-events routes end to end: create -> list -> patch
// -> delete for both, the calendar range filter, and workspace scoping (a second seeded
// workspace never sees the first workspace's records). Own port/DB, same pattern as
// criticalPath.e2e.test.js.
const TEST_PORT = 4214;
const MONGO_URI = process.env.TEST_MONGODB_URI_TASKS || "mongodb://127.0.0.1:27017/whatscrm_test_tasks";

let server;
let token;
let seed;
let taskId;
let eventId;

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

  seed = await seedTestWorkspace({ mongoUri: MONGO_URI, contactCount: 0 });
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

test("creates, lists, patches, and deletes a task", async () => {
  const created = await api("/api/tasks", {
    method: "POST",
    body: { title: "Follow up with lead", description: "Call about pricing" },
    expectStatus: 201,
  });
  assert.equal(created.data.data.status, "open");
  taskId = created.data.data.id;

  const listed = await api("/api/tasks", { expectStatus: 200 });
  assert.ok(listed.data.data.some((task) => task.id === taskId));

  const patched = await api(`/api/tasks/${taskId}`, {
    method: "PATCH",
    body: { status: "completed" },
    expectStatus: 200,
  });
  assert.equal(patched.data.data.status, "completed");

  const filtered = await api("/api/tasks?status=open", { expectStatus: 200 });
  assert.ok(!filtered.data.data.some((task) => task.id === taskId));

  await api(`/api/tasks/${taskId}`, { method: "DELETE", expectStatus: 204 });
  const afterDelete = await api("/api/tasks", { expectStatus: 200 });
  assert.ok(!afterDelete.data.data.some((task) => task.id === taskId));
});

test("creates, lists with a date range, patches, and deletes a calendar event", async () => {
  const startAt = new Date("2026-09-15T10:00:00.000Z").toISOString();
  const created = await api("/api/calendar-events", {
    method: "POST",
    body: { title: "Client call", startAt },
    expectStatus: 201,
  });
  eventId = created.data.data.id;

  const inRange = await api(
    `/api/calendar-events?from=${encodeURIComponent("2026-09-01T00:00:00.000Z")}&to=${encodeURIComponent("2026-09-30T00:00:00.000Z")}`,
    { expectStatus: 200 }
  );
  assert.ok(inRange.data.data.some((event) => event.id === eventId));

  const outOfRange = await api(
    `/api/calendar-events?from=${encodeURIComponent("2026-10-01T00:00:00.000Z")}&to=${encodeURIComponent("2026-10-31T00:00:00.000Z")}`,
    { expectStatus: 200 }
  );
  assert.ok(!outOfRange.data.data.some((event) => event.id === eventId));

  const patched = await api(`/api/calendar-events/${eventId}`, {
    method: "PATCH",
    body: { title: "Client call (rescheduled)" },
    expectStatus: 200,
  });
  assert.equal(patched.data.data.title, "Client call (rescheduled)");

  await api(`/api/calendar-events/${eventId}`, { method: "DELETE", expectStatus: 204 });
});

test("tasks and calendar events are workspace-scoped", async () => {
  const otherSeed = await seedTestWorkspace({ mongoUri: MONGO_URI, contactCount: 0 });
  const otherLogin = await api("/api/auth/login", {
    method: "POST",
    body: { email: otherSeed.email, password: otherSeed.password },
    expectStatus: 200,
    authToken: null,
  });
  const otherToken = otherLogin.data.token;

  const created = await api("/api/tasks", {
    method: "POST",
    body: { title: "Workspace-scoped task" },
    expectStatus: 201,
    authToken: otherToken,
  });
  const otherTaskId = created.data.data.id;

  const listedAsFirstWorkspace = await api("/api/tasks", { expectStatus: 200 });
  assert.ok(!listedAsFirstWorkspace.data.data.some((task) => task.id === otherTaskId));

  const directFetch = await api(`/api/tasks/${otherTaskId}`, {
    method: "PATCH",
    body: { status: "completed" },
  });
  assert.equal(directFetch.status, 404);
});
