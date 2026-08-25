import crypto from "crypto";
import { config } from "../config.js";

// Direct fetch against Razorpay's REST API, same style every other provider in this codebase uses
// (see whatsappCommerce.js) rather than pulling in the `razorpay` npm package.
const RAZORPAY_BASE_URL = "https://api.razorpay.com/v1";

function authHeader() {
  const token = Buffer.from(`${config.razorpay.keyId}:${config.razorpay.keySecret}`).toString("base64");
  return `Basic ${token}`;
}

export function isRazorpayConfigured() {
  return Boolean(config.razorpay.keyId && config.razorpay.keySecret);
}

async function razorpayRequest(path, { method = "GET", body } = {}) {
  const response = await fetch(`${RAZORPAY_BASE_URL}${path}`, {
    method,
    headers: {
      Authorization: authHeader(),
      "Content-Type": "application/json",
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const payload = await response.json().catch(() => ({}));

  if (!response.ok) {
    const error = new Error(payload?.error?.description || "Razorpay request failed.");
    error.meta = payload;
    error.code = payload?.error?.code || "RAZORPAY_REQUEST_FAILED";
    error.status = response.status;
    throw error;
  }

  return payload;
}

// Create-subscription deliberately does NOT take a customer_id - confirmed against Razorpay's own
// docs, the Customer entity is auto-created/matched from Checkout's prefill contact/email only
// once the subscriber actually authorizes the mandate, not at subscription-creation time. notes
// carries our own organizationId/workspaceId so the webhook handler (which has no session/auth
// context) can find the right Organization from the payload alone.
export async function createRazorpaySubscription({ planId, notes = {} }) {
  return razorpayRequest("/subscriptions", {
    method: "POST",
    body: {
      plan_id: planId,
      // Razorpay requires total_count (no "indefinite" option) - 120 monthly cycles is the
      // documented workaround for an effectively-open-ended subscription (~10 years).
      total_count: 120,
      customer_notify: 1,
      notes,
    },
  });
}

export async function cancelRazorpaySubscription(subscriptionId) {
  return razorpayRequest(`/subscriptions/${subscriptionId}/cancel`, {
    method: "POST",
    // Client keeps access through the cycle they already paid for rather than losing it
    // immediately - Razorpay confirms the actual end via a later subscription.cancelled webhook.
    body: { cancel_at_cycle_end: 1 },
  });
}

// Confirmed via Razorpay's own docs: HMAC-SHA256(payment_id + "|" + subscription_id, key_secret),
// hex digest. The subscriptionId passed in must be the one *we* stored server-side
// (Organization.razorpaySubscriptionId), never the client-submitted value taken on faith - the
// docs explicitly warn against trusting the request's own subscription_id for this computation.
export function verifySubscriptionSignature({ paymentId, subscriptionId, signature }) {
  if (!paymentId || !subscriptionId || !signature) return false;
  const digest = crypto.createHmac("sha256", config.razorpay.keySecret).update(`${paymentId}|${subscriptionId}`).digest("hex");
  const digestBuffer = Buffer.from(digest);
  const signatureBuffer = Buffer.from(String(signature));
  return digestBuffer.length === signatureBuffer.length && crypto.timingSafeEqual(digestBuffer, signatureBuffer);
}

// Confirmed via Razorpay's own docs: x-razorpay-signature is HMAC-SHA256 hex over the *raw* body,
// keyed with the webhook secret - no "sha256=" prefix, unlike Meta's x-hub-signature-256, so this
// is deliberately not a copy-paste of hasValidMetaSignature despite the same overall shape.
export function isValidRazorpayWebhookSignature(rawBody, signatureHeader) {
  if (!config.razorpay.webhookSecret) return true;
  const header = String(signatureHeader || "");
  if (!header || !rawBody) return false;

  const digest = crypto.createHmac("sha256", config.razorpay.webhookSecret).update(rawBody).digest("hex");
  const digestBuffer = Buffer.from(digest);
  const headerBuffer = Buffer.from(header);
  return digestBuffer.length === headerBuffer.length && crypto.timingSafeEqual(digestBuffer, headerBuffer);
}
