import test from "node:test";
import assert from "node:assert/strict";
import { sendBillstackOrder } from "../services/billstackIntegration.js";

// Regression coverage for a real SSRF vulnerability: sendBillstackOrder used to do a raw
// fetch(`${baseUrl}/api/integrations/orders`) with baseUrl coming straight from a tenant-authored
// automation flow node's own config - no SSRF guard. A workspace member with ordinary
// flow-builder access could point baseUrl at an internal-only address and have limited response
// data (status/reason fields) reflected back via the flow's own Run History. Now routed through
// the codebase's safeFetch/assertPublicUrl guard, same as every other tenant-configurable
// outbound URL.

test("refuses a private/internal baseUrl instead of making the request", async () => {
  const result = await sendBillstackOrder({
    baseUrl: "http://169.254.169.254",
    apiKey: "attacker-key",
    order: { externalOrderId: "test" },
  });
  // safeFetch's assertPublicUrl rejects before any request is made; sendBillstackOrder's own
  // try/catch turns that into a clean "request_failed" result, never real fetched bytes.
  assert.equal(result.ok, false);
  assert.equal(result.reason, "request_failed");
});

test("refuses a non-http(s) baseUrl scheme", async () => {
  const result = await sendBillstackOrder({
    baseUrl: "file:///etc/passwd",
    apiKey: "attacker-key",
    order: {},
  });
  assert.equal(result.ok, false);
  assert.equal(result.reason, "request_failed");
});

test("reports not_configured when neither baseUrl nor apiKey is set", async () => {
  const result = await sendBillstackOrder({ baseUrl: "", apiKey: "", order: {} });
  assert.equal(result.ok, false);
  assert.equal(result.reason, "not_configured");
});
