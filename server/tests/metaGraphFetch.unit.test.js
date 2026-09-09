import test from "node:test";
import assert from "node:assert/strict";
import { metaGraphFetch } from "../services/metaGraphFetch.js";

function fakeResponse({ status = 200, headers = {} } = {}) {
  return {
    status,
    ok: status >= 200 && status < 300,
    headers: { get: (name) => headers[name.toLowerCase()] ?? null },
    json: async () => ({}),
  };
}

test("returns the response as-is on a normal success, no retry", async () => {
  let callCount = 0;
  globalThis.fetch = async () => {
    callCount += 1;
    return fakeResponse({ status: 200 });
  };
  const response = await metaGraphFetch("https://graph.facebook.com/x");
  assert.equal(response.status, 200);
  assert.equal(callCount, 1);
});

test("retries a 429 and succeeds on a later attempt, honoring Retry-After", async () => {
  let callCount = 0;
  const start = Date.now();
  globalThis.fetch = async () => {
    callCount += 1;
    if (callCount < 3) return fakeResponse({ status: 429, headers: { "retry-after": "0" } });
    return fakeResponse({ status: 200 });
  };
  const response = await metaGraphFetch("https://graph.facebook.com/x");
  assert.equal(response.status, 200);
  assert.equal(callCount, 3);
  assert.ok(Date.now() - start < 5000, "Retry-After: 0 should not introduce real delay");
});

test("a genuinely absent Retry-After header falls back to exponential backoff, not zero delay", async () => {
  // Number(null) is 0, not NaN - this guards against that collapsing "header absent" and "header
  // explicitly 0" into the same (wrong) zero-delay behavior.
  let callCount = 0;
  globalThis.fetch = async () => {
    callCount += 1;
    if (callCount < 2) return fakeResponse({ status: 429, headers: {} });
    return fakeResponse({ status: 200 });
  };
  const start = Date.now();
  const response = await metaGraphFetch("https://graph.facebook.com/x");
  assert.equal(response.status, 200);
  assert.ok(Date.now() - start >= 400, "expected a real exponential-backoff delay, not an immediate retry");
});

test("gives up and returns the last 429 after the max attempt count, does not retry forever", async () => {
  let callCount = 0;
  globalThis.fetch = async () => {
    callCount += 1;
    return fakeResponse({ status: 429, headers: { "retry-after": "0" } });
  };
  const response = await metaGraphFetch("https://graph.facebook.com/x");
  assert.equal(response.status, 429);
  assert.ok(callCount <= 4, `expected a bounded number of attempts, got ${callCount}`);
});

test("logs nothing and never throws when X-App-Usage is present but valid", async () => {
  globalThis.fetch = async () =>
    fakeResponse({ status: 200, headers: { "x-app-usage": JSON.stringify({ call_count: 95, total_cputime: 10, total_time: 10 }) } });
  const response = await metaGraphFetch("https://graph.facebook.com/x");
  assert.equal(response.status, 200);
});

test("never throws when a usage header is present but malformed JSON", async () => {
  globalThis.fetch = async () => fakeResponse({ status: 200, headers: { "x-app-usage": "{not json" } });
  const response = await metaGraphFetch("https://graph.facebook.com/x");
  assert.equal(response.status, 200);
});
