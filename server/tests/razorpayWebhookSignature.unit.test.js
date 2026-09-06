import test from "node:test";
import assert from "node:assert/strict";
import crypto from "crypto";
import { config } from "../config.js";
import { isValidRazorpayWebhookSignature } from "../services/razorpayProvider.js";

// Regression coverage for a real hardening fix: this used to fail OPEN (treat the request as
// authentic) whenever RAZORPAY_WEBHOOK_SECRET was unset, so a misconfigured deployment would
// accept a completely unauthenticated, forged billing webhook. It must now fail CLOSED.

function withWebhookSecret(secret, fn) {
  const original = config.razorpay.webhookSecret;
  config.razorpay.webhookSecret = secret;
  try {
    return fn();
  } finally {
    config.razorpay.webhookSecret = original;
  }
}

test("accepts a request signed with the account's real webhook secret", () => {
  withWebhookSecret("real-secret", () => {
    const rawBody = Buffer.from('{"event":"subscription.charged"}');
    const signature = crypto.createHmac("sha256", "real-secret").update(rawBody).digest("hex");
    assert.equal(isValidRazorpayWebhookSignature(rawBody, signature), true);
  });
});

test("rejects a forged signature", () => {
  withWebhookSecret("real-secret", () => {
    const rawBody = Buffer.from('{"event":"subscription.charged"}');
    const signature = crypto.createHmac("sha256", "attacker-secret").update(rawBody).digest("hex");
    assert.equal(isValidRazorpayWebhookSignature(rawBody, signature), false);
  });
});

test("fails CLOSED (rejects, does not accept) when no webhook secret is configured", () => {
  withWebhookSecret("", () => {
    const rawBody = Buffer.from('{"event":"subscription.charged"}');
    // Even a plausible-looking signature must be rejected - there's no secret to verify against.
    const signature = crypto.createHmac("sha256", "whatever").update(rawBody).digest("hex");
    assert.equal(isValidRazorpayWebhookSignature(rawBody, signature), false);
    assert.equal(isValidRazorpayWebhookSignature(rawBody, ""), false);
    assert.equal(isValidRazorpayWebhookSignature(rawBody, undefined), false);
  });
});

test("rejects when no signature header is present, even with a real secret configured", () => {
  withWebhookSecret("real-secret", () => {
    assert.equal(isValidRazorpayWebhookSignature(Buffer.from("{}"), ""), false);
    assert.equal(isValidRazorpayWebhookSignature(Buffer.from("{}"), undefined), false);
  });
});
