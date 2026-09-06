import test from "node:test";
import assert from "node:assert/strict";
import mongoose from "mongoose";
import { startTestServer } from "./helpers/testServer.js";
import { seedTestWorkspace } from "./helpers/seedTestWorkspace.js";
import { Organization, WhatsAppAccount } from "../models/index.js";
import { encodeCredentials } from "../services/whatsappProvider.js";

// Regression coverage for a real production incident (2026-09-06): an account was connected
// without isSystemAccount ever being set, and there was no way to flip it afterward except a raw
// DB update - silently breaking both WhatsApp OTP signup and the deploy-health-check alert, with
// no obvious error pointing back to this flag. Covers the new PATCH
// /api/whatsapp/accounts/:id/system-account route: platform-owner-only (this flag is genuinely
// global, not workspace-scoped - otpService.js's own lookup has no workspace filter by design),
// and enforces at most one system account at a time.
const TEST_PORT = 4216;
const MONGO_URI = process.env.TEST_MONGODB_URI_SYSACCOUNT || "mongodb://127.0.0.1:27017/whatscrm_test_sysaccount";

let server;
let seedA;
let seedB;
let tokenA;
let tokenB;
let account1;
let account2;

async function api(path, { method = "GET", body, expectStatus, authToken } = {}) {
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

  // A: a regular client org. B: flagged as the platform owner (Nemnidhi's own org).
  seedA = await seedTestWorkspace({ mongoUri: MONGO_URI, contactCount: 0 });
  seedB = await seedTestWorkspace({ mongoUri: MONGO_URI, contactCount: 0 });

  await mongoose.connect(MONGO_URI, { serverSelectionTimeoutMS: 10000 });
  await Organization.updateOne({ _id: seedB.organizationId }, { $set: { isPlatformOwner: true } });

  account1 = await WhatsAppAccount.create({
    organizationId: seedB.organizationId,
    workspaceId: seedB.workspaceId,
    displayName: "Nemnidhi Number 1",
    phoneNumber: "+910000000101",
    phoneNumberId: `sysacct_e2e_1_${Date.now()}`,
    businessAccountId: "sysacct_e2e_business_1",
    provider: "local",
    encryptedCredentials: encodeCredentials({ provider: "local", accessToken: "local-placeholder-token" }),
    status: "connected",
    credentialsUpdatedAt: new Date(),
  });
  account2 = await WhatsAppAccount.create({
    organizationId: seedB.organizationId,
    workspaceId: seedB.workspaceId,
    displayName: "Nemnidhi Number 2",
    phoneNumber: "+910000000102",
    phoneNumberId: `sysacct_e2e_2_${Date.now()}`,
    businessAccountId: "sysacct_e2e_business_2",
    provider: "local",
    encryptedCredentials: encodeCredentials({ provider: "local", accessToken: "local-placeholder-token" }),
    isSystemAccount: true,
    status: "connected",
    credentialsUpdatedAt: new Date(),
  });
  await mongoose.disconnect();

  server = startTestServer({ port: TEST_PORT, mongoUri: MONGO_URI });
  await server.waitUntilReady();

  const loginA = await api("/api/auth/login", { method: "POST", body: { email: seedA.email, password: seedA.password }, expectStatus: 200 });
  const loginB = await api("/api/auth/login", { method: "POST", body: { email: seedB.email, password: seedB.password }, expectStatus: 200 });
  tokenA = loginA.data.token;
  tokenB = loginB.data.token;
  assert.ok(tokenA && tokenB, "login did not return tokens for both seeded orgs");
});

test.after(async () => {
  await server?.stop();
  const admin = await mongoose.connect(MONGO_URI, { serverSelectionTimeoutMS: 10000 });
  await admin.connection.dropDatabase().catch(() => undefined);
  await mongoose.disconnect();
});

test("a non-platform-owner cannot set the system account flag, even with settings:write on their own workspace", async () => {
  await api(`/api/whatsapp/accounts/${account1._id}/system-account`, {
    method: "PATCH",
    body: { isSystemAccount: true },
    authToken: tokenA,
    expectStatus: 403,
  });
});

test("a platform owner can set the flag, and it auto-unsets any previous system account", async () => {
  const result = await api(`/api/whatsapp/accounts/${account1._id}/system-account`, {
    method: "PATCH",
    body: { isSystemAccount: true },
    authToken: tokenB,
    expectStatus: 200,
  });
  assert.equal(result.data.data.isSystemAccount, true);

  const refreshedAccount2 = await WhatsAppAccount.findById(account2._id);
  assert.equal(refreshedAccount2.isSystemAccount, false, "the previously-set account should be auto-unset");

  const systemAccounts = await WhatsAppAccount.find({ isSystemAccount: true });
  assert.equal(systemAccounts.length, 1, "exactly one account should ever be flagged as the system account");
});

test("unsetting the flag on the current system account leaves zero system accounts (does not fall back to another)", async () => {
  const result = await api(`/api/whatsapp/accounts/${account1._id}/system-account`, {
    method: "PATCH",
    body: { isSystemAccount: false },
    authToken: tokenB,
    expectStatus: 200,
  });
  assert.equal(result.data.data.isSystemAccount, false);

  const systemAccounts = await WhatsAppAccount.find({ isSystemAccount: true });
  assert.equal(systemAccounts.length, 0);
});

test("404s for a malformed id or an account that doesn't exist", async () => {
  await api("/api/whatsapp/accounts/not-an-id/system-account", {
    method: "PATCH",
    body: { isSystemAccount: true },
    authToken: tokenB,
    expectStatus: 404,
  });
  await api(`/api/whatsapp/accounts/${new mongoose.Types.ObjectId()}/system-account`, {
    method: "PATCH",
    body: { isSystemAccount: true },
    authToken: tokenB,
    expectStatus: 404,
  });
});
