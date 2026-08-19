import crypto from "crypto";
import { config } from "../config.js";

// The three server-to-server calls every Tech Provider makes after a customer completes the
// Embedded Signup popup - the popup itself only ever hands back an authorization code plus the
// customer's WABA/phone IDs, none of it usable until exchanged/registered/subscribed here.

async function graphRequest(path, { method = "GET", accessToken, params, body } = {}) {
  const url = new URL(`https://graph.facebook.com/${config.metaGraphApiVersion}/${path}`);
  if (params) {
    for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);
  }

  const init = { method, headers: {} };
  if (accessToken) init.headers.Authorization = `Bearer ${accessToken}`;
  if (body) {
    init.headers["Content-Type"] = "application/json";
    init.body = JSON.stringify(body);
  }

  const response = await fetch(url, init);
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || payload.error) {
    const error = new Error(payload.error?.message || "Meta Embedded Signup request failed.");
    error.status = response.status || 502;
    error.code = payload.error?.code || "EMBEDDED_SIGNUP_REQUEST_FAILED";
    error.meta = payload;
    throw error;
  }
  return payload;
}

// Exchanges the popup's short-lived authorization code for a Business Integration System User
// access token, scoped to exactly the assets (this WABA) the customer just authorized - not a
// general user token, and it doesn't expire the way a personal login token does.
export async function exchangeEmbeddedSignupCode(code) {
  if (!config.meta.appId || !config.meta.appSecret) {
    const error = new Error("META_APP_ID and WHATSAPP_APP_SECRET must both be configured for Embedded Signup.");
    error.code = "EMBEDDED_SIGNUP_NOT_CONFIGURED";
    throw error;
  }

  const payload = await graphRequest("oauth/access_token", {
    params: { client_id: config.meta.appId, client_secret: config.meta.appSecret, code },
  });
  return payload.access_token;
}

// A brand-new number has no two-step verification PIN yet, so one is generated here rather than
// asking the customer for one mid-flow - this mirrors how most Tech Provider Embedded Signup
// implementations handle first-time registration. Returned once so the caller can show it to the
// customer; never persisted in plaintext.
export async function registerEmbeddedSignupPhoneNumber(phoneNumberId, accessToken) {
  const pin = String(crypto.randomInt(0, 1000000)).padStart(6, "0");
  await graphRequest(`${phoneNumberId}/register`, {
    method: "POST",
    accessToken,
    body: { messaging_product: "whatsapp", pin },
  });
  return pin;
}

// Subscribes this app to webhook events on the customer's WABA - without this, inbound messages
// and status updates for their number never reach this app's /webhooks/whatsapp endpoint at all.
export async function subscribeEmbeddedSignupWebhooks(wabaId, accessToken) {
  return graphRequest(`${wabaId}/subscribed_apps`, { method: "POST", accessToken });
}

export async function completeEmbeddedSignup({ code, wabaId, phoneNumberId }) {
  const accessToken = await exchangeEmbeddedSignupCode(code);
  const pin = await registerEmbeddedSignupPhoneNumber(phoneNumberId, accessToken);
  await subscribeEmbeddedSignupWebhooks(wabaId, accessToken);
  return { accessToken, pin };
}
