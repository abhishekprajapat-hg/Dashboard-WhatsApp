import test from "node:test";
import assert from "node:assert/strict";
import { Writable } from "stream";
import pino from "pino";
import { redactPaths } from "../services/logger.js";

// Builds a fresh pino instance using the exact redact config services/logger.js exports, writing
// to an in-memory stream instead of stdout so the output can be parsed and asserted on directly.
function makeTestLogger() {
  const lines = [];
  const destination = new Writable({
    write(chunk, _encoding, callback) {
      lines.push(chunk.toString());
      callback();
    },
  });
  const logger = pino({ redact: { paths: redactPaths, censor: "[Redacted]" } }, destination);
  return { logger, entries: () => lines.map((line) => JSON.parse(line)) };
}

test("redacts a top-level secret field", () => {
  const { logger, entries } = makeTestLogger();
  logger.info({ apiKey: "sk-real-secret-value" }, "provider config saved");
  const [entry] = entries();
  assert.equal(entry.apiKey, "[Redacted]");
  assert.ok(!JSON.stringify(entry).includes("sk-real-secret-value"));
});

test("redacts req.headers.authorization on a pino-http-shaped log object", () => {
  const { logger, entries } = makeTestLogger();
  logger.info({ req: { headers: { authorization: "Bearer real.jwt.token" } } }, "request completed");
  const [entry] = entries();
  assert.equal(entry.req.headers.authorization, "[Redacted]");
  assert.ok(!JSON.stringify(entry).includes("real.jwt.token"));
});

test("redacts secret fields nested one level deep via the wildcard path", () => {
  const { logger, entries } = makeTestLogger();
  logger.info({ account: { accessToken: "EAAreal-meta-token", accountSid: "ACreal" } }, "whatsapp account connected");
  const [entry] = entries();
  assert.equal(entry.account.accessToken, "[Redacted]");
  assert.equal(entry.account.accountSid, "[Redacted]");
});

test("does not redact unrelated fields", () => {
  const { logger, entries } = makeTestLogger();
  logger.info({ workspaceId: "abc123", statusCode: 200 }, "request completed");
  const [entry] = entries();
  assert.equal(entry.workspaceId, "abc123");
  assert.equal(entry.statusCode, 200);
});

test("redacts a raw .body property attached to a logged error (e.g. body-parser's malformed-JSON SyntaxError)", () => {
  const { logger, entries } = makeTestLogger();
  const error = new Error("Unexpected token");
  error.body = '{"password":"hunter2", "leaked-if-not-red';
  logger.error({ err: error }, "Unhandled route error");
  const [entry] = entries();
  assert.equal(entry.err.body, "[Redacted]");
  assert.ok(!JSON.stringify(entry).includes("hunter2"));
});

test("preserves the error stack trace via pino's standard err serializer", () => {
  const { logger, entries } = makeTestLogger();
  const error = new Error("boom");
  logger.error({ err: error }, "unhandled route error");
  const [entry] = entries();
  assert.equal(entry.err.message, "boom");
  assert.ok(entry.err.stack.includes("Error: boom"));
});
