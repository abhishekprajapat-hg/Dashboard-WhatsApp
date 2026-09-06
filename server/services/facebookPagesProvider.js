import crypto from "crypto";
import { config } from "../config.js";
import { decodeCredentials, encodeCredentials } from "./whatsappProvider.js";

// Classic Facebook Login (facebook.com/dialog/oauth + graph.facebook.com), the same product
// family socialAuth.js's Facebook sign-in already uses - genuinely different from
// instagramProvider.js's "Instagram API with Instagram Login" (its own hosts, own App ID).
// Reuses config.meta's app id/secret, same app as WhatsApp/Ads/socialAuth's Facebook login.
const OAUTH_AUTHORIZE_URL = `https://www.facebook.com/${config.metaGraphApiVersion}/dialog/oauth`;
const GRAPH_BASE = `https://graph.facebook.com/${config.metaGraphApiVersion}`;

export function decodeFacebookCredentials(account) {
  return decodeCredentials(account);
}

export function encodeFacebookCredentials(credentials = {}) {
  return encodeCredentials(credentials);
}

export function buildFacebookPagesAuthorizeUrl(state) {
  const url = new URL(OAUTH_AUTHORIZE_URL);
  url.searchParams.set("client_id", config.meta.appId);
  url.searchParams.set("redirect_uri", config.facebookPages.redirectUri);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("scope", "pages_show_list,pages_messaging");
  url.searchParams.set("state", state);
  return url.toString();
}

async function parseOrThrow(response, errorCode) {
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || payload.error) {
    const error = new Error(payload.error?.message || "Facebook API request failed.");
    error.status = response.status || 502;
    error.code = errorCode;
    error.meta = payload;
    throw error;
  }
  return payload;
}

export async function exchangeFacebookCode(code) {
  const url = new URL(`${GRAPH_BASE}/oauth/access_token`);
  url.searchParams.set("client_id", config.meta.appId);
  url.searchParams.set("client_secret", config.meta.appSecret);
  url.searchParams.set("redirect_uri", config.facebookPages.redirectUri);
  url.searchParams.set("code", code);
  const response = await fetch(url.toString());
  const payload = await parseOrThrow(response, "FACEBOOK_TOKEN_EXCHANGE_FAILED");
  return { accessToken: payload.access_token };
}

// Same fb_exchange_token grant socialAuth.js's Instagram Business Discovery work already uses
// (commit ac3fe28) - a short-lived user token from the OAuth callback expires in ~1 hour, no good
// for a persisted Page connection. The Page access tokens fetched below (via /me/accounts) inherit
// this long-lived-ness from whichever user token requested them.
export async function exchangeForLongLivedUserToken(shortLivedToken) {
  const url = new URL(`${GRAPH_BASE}/oauth/access_token`);
  url.searchParams.set("grant_type", "fb_exchange_token");
  url.searchParams.set("client_id", config.meta.appId);
  url.searchParams.set("client_secret", config.meta.appSecret);
  url.searchParams.set("fb_exchange_token", shortLivedToken);
  const response = await fetch(url.toString());
  const payload = await parseOrThrow(response, "FACEBOOK_LONG_LIVED_TOKEN_FAILED");
  return { accessToken: payload.access_token };
}

// The pages_show_list-gated call - lists every Page the authorizing user manages, each with its
// own Page Access Token already included in the response (no separate per-page exchange needed).
export async function fetchManagedPages(userAccessToken) {
  const url = new URL(`${GRAPH_BASE}/me/accounts`);
  url.searchParams.set("fields", "id,name,access_token,picture{url}");
  url.searchParams.set("access_token", userAccessToken);
  const response = await fetch(url.toString());
  const payload = await parseOrThrow(response, "FACEBOOK_PAGES_FETCH_FAILED");
  return (payload.data || []).map((page) => ({
    id: page.id,
    name: page.name || "",
    accessToken: page.access_token,
    profilePictureUrl: page.picture?.data?.url || page.picture?.url || "",
  }));
}

export async function sendFacebookMessage({ account, to, body }) {
  const credentials = decodeCredentials(account);
  const url = new URL(`${GRAPH_BASE}/me/messages`);
  url.searchParams.set("access_token", credentials.accessToken);
  const response = await fetch(url.toString(), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ recipient: { id: to }, message: { text: body } }),
  });
  const payload = await parseOrThrow(response, "FACEBOOK_SEND_FAILED");
  return { providerMessageId: payload.message_id || `fb_${Date.now()}`, status: "sent" };
}

export function hasValidFacebookSignature(req) {
  const appSecret = config.meta.appSecret;
  if (!appSecret) return true;
  const header = String(req.headers["x-hub-signature-256"] || "");
  const expectedPrefix = "sha256=";
  if (!header.startsWith(expectedPrefix) || !req.rawBody) return false;

  const digest = `${expectedPrefix}${crypto.createHmac("sha256", appSecret).update(req.rawBody).digest("hex")}`;
  const headerBuffer = Buffer.from(header);
  const digestBuffer = Buffer.from(digest);
  return headerBuffer.length === digestBuffer.length && crypto.timingSafeEqual(headerBuffer, digestBuffer);
}

// Same entry[].messaging[] shape Meta's Messenger/Instagram messaging webhooks both share -
// confirmed via Meta's Messenger Platform webhook reference before writing this, not assumed from
// the Instagram shape alone. object is "page" here (vs "instagram"), and entry.id is the Page ID.
// Minimum genuine feature scope, same as instagramProvider's normalizer - text/attachment messages
// only, no postbacks/reactions/optins/referrals/seen for this first pass.
const INBOUND_ATTACHMENT_TYPE = { image: "image", video: "video", audio: "audio" };

function normalizeInboundAttachments(attachments) {
  if (!Array.isArray(attachments)) return [];
  return attachments
    .filter((attachment) => attachment?.payload?.url)
    .map((attachment) => ({
      name: "Attachment",
      url: attachment.payload.url,
      type: INBOUND_ATTACHMENT_TYPE[attachment.type] || "document",
    }));
}

export function normalizeFacebookWebhookPayload(payload) {
  const entry = payload?.entry?.[0];
  const messaging = entry?.messaging?.[0];
  const message = messaging?.message;

  if (messaging && message && !message.is_echo) {
    return {
      type: "message",
      pageId: messaging.recipient?.id || entry?.id,
      from: messaging.sender?.id,
      body: message.text || "",
      attachments: normalizeInboundAttachments(message.attachments),
      providerMessageId: message.mid,
      raw: payload,
    };
  }

  return { type: "unknown", raw: payload };
}
