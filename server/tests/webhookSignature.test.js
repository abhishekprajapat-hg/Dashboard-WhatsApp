import test from "node:test";
import assert from "node:assert/strict";
import crypto from "crypto";
import { hasValidMetaSignature } from "../routes/whatsapp.js";

function signedRequest(appSecret, body, { corruptSignature = false, header = true } = {}) {
  const rawBody = Buffer.from(body);
  const digest = crypto.createHmac("sha256", appSecret).update(rawBody).digest("hex");
  const signature = corruptSignature ? digest.replace(/.$/, digest.endsWith("0") ? "1" : "0") : digest;
  return {
    headers: header ? { "x-hub-signature-256": `sha256=${signature}` } : {},
    rawBody,
  };
}

test("accepts a request signed with the account's real app secret", () => {
  const req = signedRequest("real-secret", '{"entry":[]}');
  assert.equal(hasValidMetaSignature(req, "real-secret"), true);
});

test("rejects a request signed with the wrong app secret", () => {
  const req = signedRequest("attacker-secret", '{"entry":[]}');
  assert.equal(hasValidMetaSignature(req, "real-secret"), false);
});

test("rejects a tampered signature even when the body is unchanged", () => {
  const req = signedRequest("real-secret", '{"entry":[]}', { corruptSignature: true });
  assert.equal(hasValidMetaSignature(req, "real-secret"), false);
});

test("rejects a request with no signature header when a secret is configured", () => {
  const req = signedRequest("real-secret", '{"entry":[]}', { header: false });
  assert.equal(hasValidMetaSignature(req, "real-secret"), false);
});

test("rejects a request with no captured raw body", () => {
  const req = { headers: { "x-hub-signature-256": "sha256=deadbeef" } };
  assert.equal(hasValidMetaSignature(req, "real-secret"), false);
});

test("skips verification when the account has no app secret configured", () => {
  // Documented, intentional behavior for accounts that haven't set up signature
  // verification yet - not a bypass introduced accidentally by a future change.
  const req = { headers: {}, rawBody: Buffer.from("{}") };
  assert.equal(hasValidMetaSignature(req, ""), true);
});
