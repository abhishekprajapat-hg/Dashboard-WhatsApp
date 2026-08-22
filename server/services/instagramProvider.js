import crypto from "crypto";
import { config } from "../config.js";
import { decodeCredentials, encodeCredentials } from "./whatsappProvider.js";

// "Instagram API with Instagram Login" is a genuinely separate system from the Facebook Login flow
// WhatsApp/Ads use - its own OAuth hosts, its own Graph host (graph.instagram.com), and its own
// App ID/Secret issued only after adding the Instagram product in App Dashboard. The authorize step
// (browser-facing) and the token exchange step (server-to-server) use two *different* hosts -
// confirmed for real against this app's own generated "Embed URL" on the API Setup with Instagram
// Login page, not just docs (which pointed at the wrong host for the authorize step specifically).
const OAUTH_AUTHORIZE_URL = "https://www.instagram.com/oauth/authorize";
const OAUTH_TOKEN_URL = "https://api.instagram.com/oauth/access_token";
const GRAPH_BASE = `https://graph.instagram.com/${config.metaGraphApiVersion}`;

export function decodeInstagramCredentials(account) {
  return decodeCredentials(account);
}

export function encodeInstagramCredentials(credentials = {}) {
  return encodeCredentials(credentials);
}

export function buildInstagramAuthorizeUrl(state) {
  const url = new URL(OAUTH_AUTHORIZE_URL);
  url.searchParams.set("client_id", config.instagram.appId);
  url.searchParams.set("redirect_uri", config.instagram.redirectUri);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("scope", "instagram_business_basic,instagram_business_manage_messages");
  url.searchParams.set("state", state);
  return url.toString();
}

async function parseOrThrow(response, errorCode) {
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || payload.error || payload.error_message) {
    const error = new Error(payload.error_message || payload.error?.message || "Instagram API request failed.");
    error.status = response.status || 502;
    error.code = errorCode;
    error.meta = payload;
    throw error;
  }
  return payload;
}

export async function exchangeInstagramCode(code) {
  const body = new URLSearchParams({
    client_id: config.instagram.appId,
    client_secret: config.instagram.appSecret,
    grant_type: "authorization_code",
    redirect_uri: config.instagram.redirectUri,
    code,
  });
  const response = await fetch(OAUTH_TOKEN_URL, { method: "POST", body });
  const payload = await parseOrThrow(response, "INSTAGRAM_TOKEN_EXCHANGE_FAILED");
  // The short-lived token response is inconsistently documented as either a bare object or
  // {data: [...]}. Handle both rather than assume one shape.
  const entry = Array.isArray(payload.data) ? payload.data[0] : payload;
  return { accessToken: entry.access_token, instagramUserId: String(entry.user_id) };
}

export async function exchangeForLongLivedToken(shortLivedToken) {
  const url = new URL(`${GRAPH_BASE.replace(`/${config.metaGraphApiVersion}`, "")}/access_token`);
  url.searchParams.set("grant_type", "ig_exchange_token");
  url.searchParams.set("client_secret", config.instagram.appSecret);
  url.searchParams.set("access_token", shortLivedToken);
  const response = await fetch(url.toString());
  const payload = await parseOrThrow(response, "INSTAGRAM_LONG_LIVED_TOKEN_FAILED");
  return { accessToken: payload.access_token, expiresInSeconds: payload.expires_in };
}

export async function fetchInstagramAccountInfo(accessToken) {
  const url = new URL(`${GRAPH_BASE}/me`);
  url.searchParams.set("fields", "user_id,username,profile_picture_url");
  url.searchParams.set("access_token", accessToken);
  const response = await fetch(url.toString());
  return parseOrThrow(response, "INSTAGRAM_ACCOUNT_INFO_FAILED");
}

export async function sendInstagramMessage({ account, to, body }) {
  const credentials = decodeCredentials(account);
  const url = `${GRAPH_BASE}/${account.instagramUserId}/messages`;
  const response = await fetch(url, {
    method: "POST",
    headers: { Authorization: `Bearer ${credentials.accessToken}`, "Content-Type": "application/json" },
    body: JSON.stringify({ recipient: { id: to }, message: { text: body } }),
  });
  const payload = await parseOrThrow(response, "INSTAGRAM_SEND_FAILED");
  return { providerMessageId: payload.message_id || `ig_${Date.now()}`, status: "sent" };
}

export function hasValidInstagramSignature(req) {
  const appSecret = config.instagram.appSecret;
  if (!appSecret) return true;
  const header = String(req.headers["x-hub-signature-256"] || "");
  const expectedPrefix = "sha256=";
  if (!header.startsWith(expectedPrefix) || !req.rawBody) return false;

  const digest = `${expectedPrefix}${crypto.createHmac("sha256", appSecret).update(req.rawBody).digest("hex")}`;
  const headerBuffer = Buffer.from(header);
  const digestBuffer = Buffer.from(digest);
  return headerBuffer.length === digestBuffer.length && crypto.timingSafeEqual(headerBuffer, digestBuffer);
}

// Real webhook shape confirmed via Meta's current docs: {object:"instagram", entry:[{id, time,
// messaging:[{sender:{id}, recipient:{id}, timestamp, message:{mid, text}}]}]}. Deliberately
// ignores messaging_postbacks/reactions/optins/referrals/seen for this first pass - only real
// text messages, same "minimum genuine feature" scope as everything else built today.
export function normalizeInstagramWebhookPayload(payload) {
  const entry = payload?.entry?.[0];
  const messaging = entry?.messaging?.[0];
  const message = messaging?.message;

  if (messaging && message && !message.is_echo) {
    return {
      type: "message",
      idempotencyKey: message.mid,
      instagramUserId: messaging.recipient?.id,
      from: messaging.sender?.id,
      body: message.text || "",
      providerMessageId: message.mid,
      raw: payload,
    };
  }

  return { type: "unknown", idempotencyKey: `ig_unknown:${Date.now()}`, raw: payload };
}
