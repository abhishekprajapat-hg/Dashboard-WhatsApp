import test from "node:test";
import assert from "node:assert/strict";
import mongoose from "mongoose";
import { Membership, Role, User } from "../models/index.js";
import { hashPassword } from "../utils/password.js";
import { roleDefinitionFor } from "../utils/rbac.js";
import { startTestServer } from "./helpers/testServer.js";
import { seedTestWorkspace } from "./helpers/seedTestWorkspace.js";

// Covers the new GET/PUT/DELETE /api/admin/feature-flags[/:key] routes end to end: default
// values on a fresh DB, an override persisting and showing up as `source: "override"`, a reset
// reverting to `source: "env-default"`, an unknown key 404ing, and a viewer-role user getting 403
// on both read and write. Own port/DB, same pattern as auditLogRetention.e2e.test.js.
const TEST_PORT = 4216;
const MONGO_URI = process.env.TEST_MONGODB_URI_FEATURE_FLAGS || "mongodb://127.0.0.1:27017/whatscrm_test_feature_flags";

let server;
let token;
let viewerToken;
let seed;

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

  seed = await seedTestWorkspace({ mongoUri: MONGO_URI, contactCount: 0 });

  // seedTestWorkspace disconnects Mongoose's global connection internally - reconnect before
  // creating the extra viewer-role user below.
  await mongoose.connect(MONGO_URI, { serverSelectionTimeoutMS: 10000 });

  const viewerEmail = `integration-viewer-${Date.now()}@test.local`;
  const viewerPassword = "IntegrationTest123!";
  const viewerUser = await User.create({
    name: "Integration Viewer",
    email: viewerEmail,
    passwordHash: hashPassword(viewerPassword),
    status: "active",
  });
  const viewerRole = await Role.create({
    organizationId: seed.organizationId,
    workspaceId: seed.workspaceId,
    key: "viewer",
    ...roleDefinitionFor("viewer"),
    isSystemRole: true,
  });
  await Membership.create({
    organizationId: seed.organizationId,
    workspaceId: seed.workspaceId,
    userId: viewerUser._id,
    roleId: viewerRole._id,
    status: "active",
    joinedAt: new Date(),
  });

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
  assert.ok(token, "admin login did not return a token");

  const viewerLogin = await api("/api/auth/login", {
    method: "POST",
    body: { email: viewerEmail, password: viewerPassword },
    expectStatus: 200,
    authToken: null,
  });
  viewerToken = viewerLogin.data.token;
  assert.ok(viewerToken, "viewer login did not return a token");
});

test.after(async () => {
  await server?.stop();
  const admin = await mongoose.connect(MONGO_URI, { serverSelectionTimeoutMS: 10000 });
  await admin.connection.dropDatabase().catch(() => undefined);
  await mongoose.disconnect();
});

test("GET /feature-flags returns all 5 flags at their env defaults on a fresh DB", async () => {
  const { data } = await api("/api/admin/feature-flags", { expectStatus: 200 });
  assert.equal(data.data.length, 5);
  for (const flag of data.data) {
    assert.equal(flag.source, "env-default");
    assert.equal(flag.effective, flag.envDefault);
  }
  const queueFlag = data.data.find((flag) => flag.key === "queueProcessing");
  assert.equal(queueFlag.gatesRealBehavior, true);
});

test("PUT then DELETE a flag override round-trips through source/effective correctly", async () => {
  const before = await api("/api/admin/feature-flags", { expectStatus: 200 });
  const queueFlagBefore = before.data.data.find((flag) => flag.key === "queueProcessing");
  const flippedValue = !queueFlagBefore.effective;

  const updated = await api("/api/admin/feature-flags/queueProcessing", {
    method: "PUT",
    body: { enabled: flippedValue },
    expectStatus: 200,
  });
  const queueFlagAfterPut = updated.data.data.find((flag) => flag.key === "queueProcessing");
  assert.equal(queueFlagAfterPut.effective, flippedValue);
  assert.equal(queueFlagAfterPut.source, "override");
  assert.equal(queueFlagAfterPut.updatedByEmail, seed.email);

  const reread = await api("/api/admin/feature-flags", { expectStatus: 200 });
  const queueFlagReread = reread.data.data.find((flag) => flag.key === "queueProcessing");
  assert.equal(queueFlagReread.effective, flippedValue);
  assert.equal(queueFlagReread.source, "override");

  const reset = await api("/api/admin/feature-flags/queueProcessing", { method: "DELETE", expectStatus: 200 });
  const queueFlagAfterReset = reset.data.data.find((flag) => flag.key === "queueProcessing");
  assert.equal(queueFlagAfterReset.source, "env-default");
  assert.equal(queueFlagAfterReset.effective, queueFlagBefore.envDefault);
});

test("PUT rabbitmqEvents on does not crash even with no broker configured in this test env", async () => {
  const response = await api("/api/admin/feature-flags/rabbitmqEvents", {
    method: "PUT",
    body: { enabled: true },
    expectStatus: 200,
  });
  const rabbitFlag = response.data.data.find((flag) => flag.key === "rabbitmqEvents");
  assert.equal(rabbitFlag.effective, true);
  assert.equal(rabbitFlag.source, "override");

  // Clean up so later assertions/other test files aren't affected by this override.
  await api("/api/admin/feature-flags/rabbitmqEvents", { method: "DELETE", expectStatus: 200 });
});

test("an unknown flag key 404s on both PUT and DELETE", async () => {
  await api("/api/admin/feature-flags/notARealFlag", { method: "PUT", body: { enabled: true }, expectStatus: 404 });
  await api("/api/admin/feature-flags/notARealFlag", { method: "DELETE", expectStatus: 404 });
});

test("a viewer-role user gets 403 on both read and write routes", async () => {
  await api("/api/admin/feature-flags", { expectStatus: 403, authToken: viewerToken });
  await api("/api/admin/feature-flags/queueProcessing", {
    method: "PUT",
    body: { enabled: false },
    expectStatus: 403,
    authToken: viewerToken,
  });
});
