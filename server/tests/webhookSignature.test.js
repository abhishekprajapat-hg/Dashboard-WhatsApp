import test from "node:test";
import assert from "node:assert/strict";
import crypto from "crypto";
import { config } from "../config.js";
import { hasValidMetaSignature, hasValidTwilioSignature, hasValidWatiSecret } from "../routes/whatsapp.js";

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

// Twilio's own documented scheme: HMAC-SHA1 over (full URL + sorted key+value POST params
// concatenated with no separator), base64-encoded. https://www.twilio.com/docs/usage/webhooks/webhooks-security
// absoluteBaseUrl(req) (used internally by hasValidTwilioSignature) prefers config.publicBaseUrl
// over req.protocol/req.get("host") whenever it's set - matching that here, rather than a
// hardcoded fake origin, so this test is correct regardless of the environment's PUBLIC_BASE_URL.
function twilioRequest(authToken, { path = "/webhooks/whatsapp/twilio", body = { To: "+1555", From: "+1444", Body: "hi" }, corrupt = false, header = true } = {}) {
  const origin = config.publicBaseUrl || "http://localhost:4000";
  const url = `${origin}${path}`;
  const dataString = Object.keys(body)
    .sort()
    .reduce((acc, key) => acc + key + body[key], url);
  const digest = crypto.createHmac("sha1", authToken).update(Buffer.from(dataString, "utf-8")).digest("base64");
  const signature = corrupt ? `${digest.slice(0, -1)}${digest.endsWith("A") ? "B" : "A"}` : digest;
  const parsedOrigin = new URL(origin);
  return {
    headers: header ? { "x-twilio-signature": signature } : {},
    originalUrl: path,
    protocol: parsedOrigin.protocol.replace(":", ""),
    get: (name) => (name === "host" ? parsedOrigin.host : undefined),
    body,
  };
}

test("Twilio: accepts a request signed with the account's real auth token", () => {
  const req = twilioRequest("real-token");
  assert.equal(hasValidTwilioSignature(req, "real-token"), true);
});

test("Twilio: rejects a request signed with the wrong auth token", () => {
  const req = twilioRequest("attacker-token");
  assert.equal(hasValidTwilioSignature(req, "real-token"), false);
});

test("Twilio: rejects a forged body even if a signature header is present", () => {
  const req = twilioRequest("real-token", { corrupt: true });
  assert.equal(hasValidTwilioSignature(req, "real-token"), false);
});

test("Twilio: rejects a request with no signature header when an auth token is configured", () => {
  const req = twilioRequest("real-token", { header: false });
  assert.equal(hasValidTwilioSignature(req, "real-token"), false);
});

test("Twilio: skips verification when the account has no auth token configured", () => {
  const req = twilioRequest("real-token", { header: false });
  assert.equal(hasValidTwilioSignature(req, ""), true);
});

function watiRequest({ header = "wati-secret", asXApiKey = false } = {}) {
  return { headers: asXApiKey ? { "x-api-key": header } : { authorization: `Bearer ${header}` } };
}

test("Wati: accepts a request presenting the account's real apiKey as a Bearer token", () => {
  assert.equal(hasValidWatiSecret(watiRequest({ header: "wati-secret" }), "wati-secret"), true);
});

test("Wati: accepts a request presenting the account's real apiKey via x-api-key", () => {
  assert.equal(hasValidWatiSecret(watiRequest({ header: "wati-secret", asXApiKey: true }), "wati-secret"), true);
});

test("Wati: rejects a request presenting the wrong secret", () => {
  assert.equal(hasValidWatiSecret(watiRequest({ header: "attacker-secret" }), "wati-secret"), false);
});

test("Wati: rejects a request with no credential header when an apiKey is configured", () => {
  assert.equal(hasValidWatiSecret({ headers: {} }, "wati-secret"), false);
});

test("Wati: skips verification when the account has no apiKey configured", () => {
  assert.equal(hasValidWatiSecret({ headers: {} }, ""), true);
});
