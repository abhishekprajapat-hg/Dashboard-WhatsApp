import test from "node:test";
import assert from "node:assert/strict";
import { config } from "../config.js";
import { notifyVega } from "../services/vegaIntegration.js";

// Same approach as notificationChannels.unit.test.js: stub globalThis.fetch, no real network
// access. config.vega is mutated directly and restored per-test since it's read at call time,
// not cached at module load.

test("notifyVega no-ops without hitting the network when unconfigured", async (t) => {
  const original = { ...config.vega };
  config.vega.apiUrl = "";
  config.vega.integrationSecret = "";
  let fetchCalled = false;
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => {
    fetchCalled = true;
    return { ok: true };
  };
  t.after(() => {
    Object.assign(config.vega, original);
    globalThis.fetch = originalFetch;
  });

  const result = await notifyVega("org_123", "plan_changed", { plan: "pro" });
  assert.deepEqual(result, { sent: false, reason: "not_configured" });
  assert.equal(fetchCalled, false);
});

test("notifyVega posts to Vega's integration endpoint with the shared secret header", async (t) => {
  const original = { ...config.vega };
  config.vega.apiUrl = "https://vega.example.test";
  config.vega.integrationSecret = "shh-secret";
  const calls = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url, options) => {
    calls.push({ url, options });
    return { ok: true, status: 200 };
  };
  t.after(() => {
    Object.assign(config.vega, original);
    globalThis.fetch = originalFetch;
  });

  const result = await notifyVega("org_123", "plan_changed", { plan: "pro", previousPlan: "basic" });
  assert.deepEqual(result, { sent: true });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, "https://vega.example.test/api/integrations/dashboard-events");
  assert.equal(calls[0].options.headers["x-integration-secret"], "shh-secret");
  const body = JSON.parse(calls[0].options.body);
  assert.deepEqual(body, {
    dashboardOrganizationId: "org_123",
    event: "plan_changed",
    data: { plan: "pro", previousPlan: "basic" },
  });
});

test("notifyVega swallows a non-2xx response instead of throwing", async (t) => {
  const original = { ...config.vega };
  config.vega.apiUrl = "https://vega.example.test";
  config.vega.integrationSecret = "shh-secret";
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => ({ ok: false, status: 401 });
  t.after(() => {
    Object.assign(config.vega, original);
    globalThis.fetch = originalFetch;
  });

  const result = await notifyVega("org_123", "plan_changed", { plan: "pro" });
  assert.deepEqual(result, { sent: false, reason: "http_401" });
});

test("notifyVega swallows a network error instead of throwing", async (t) => {
  const original = { ...config.vega };
  config.vega.apiUrl = "https://vega.example.test";
  config.vega.integrationSecret = "shh-secret";
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => {
    throw new Error("ECONNREFUSED");
  };
  t.after(() => {
    Object.assign(config.vega, original);
    globalThis.fetch = originalFetch;
  });

  const result = await notifyVega("org_123", "plan_changed", { plan: "pro" });
  assert.deepEqual(result, { sent: false, reason: "request_failed" });
});
