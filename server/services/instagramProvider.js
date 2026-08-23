import crypto from "crypto";
import { config } from "../config.js";
import { decodeCredentials, encodeCredentials } from "./whatsappProvider.js";
import { logger } from "./logger.js";

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

// reach/follower_count/accounts_engaged/total_interactions - NOT impressions/profile_views, which
// Meta deprecated in v22.0 (confirmed via current docs before writing this, not assumed - several
// older guides/blog posts still reference the deprecated names). metric_type=total_value requests a
// single aggregate number per metric over the period rather than a daily time-series breakdown,
// which is what an at-a-glance account summary needs.
//
// Meta's own metric.title/description come back localized server-side (observed live: Russian, for
// an account/token with no language preference set on our side) - not something a request param
// here controls, so we supply our own fixed English labels rather than displaying whatever locale
// Meta happens to pick.
const INSTAGRAM_METRIC_LABELS = {
  reach: "Reach",
  follower_count: "Follower count",
  accounts_engaged: "Accounts engaged",
  total_interactions: "Total interactions",
};

export async function fetchInstagramInsights(account) {
  const credentials = decodeCredentials(account);
  const url = new URL(`${GRAPH_BASE}/${account.instagramUserId}/insights`);
  url.searchParams.set("metric", "reach,follower_count,accounts_engaged,total_interactions");
  url.searchParams.set("period", "day");
  url.searchParams.set("metric_type", "total_value");
  const response = await fetch(url.toString(), { headers: { Authorization: `Bearer ${credentials.accessToken}` } });
  const payload = await parseOrThrow(response, "INSTAGRAM_INSIGHTS_FAILED");
  return (payload.data || []).map((metric) => ({
    name: metric.name,
    title: INSTAGRAM_METRIC_LABELS[metric.name] || metric.name,
    value: metric.total_value?.value ?? null,
  }));
}

// The Messenger-Platform-derived message object Instagram messaging reuses is text OR attachment,
// never both in one call - unlike WhatsApp's media message, which carries a caption alongside the
// media in a single payload. Our own attachment `type` values (image/video/audio/document, set by
// conversations.js's cleanAttachments) map onto Instagram's attachment type enum; "document" has no
// direct match there, Instagram's equivalent is "file".
const INSTAGRAM_ATTACHMENT_TYPE = { image: "image", video: "video", audio: "audio", document: "file" };

// humanAgent (the HUMAN_AGENT message tag) extends the normal 24-hour messaging window to 7 days -
// but Meta explicitly prohibits it for automated/bot messages and detects misuse (penalty: that
// account's messaging capability gets suspended). Callers MUST only pass humanAgent: true from a
// real authenticated agent's own Inbox reply, never from an automation-triggered send - this is
// the actual safety-critical part of this feature, not the request shape. Confirmed via docs the
// tag exists and what it does; the exact request-body placement (a top-level field alongside
// recipient/message, matching the long-established Messenger Platform convention Instagram
// messaging is documented everywhere as reusing) was NOT confirmed via a literal example in current
// docs - if Meta rejects this shape, that rejection is the real answer, not another docs guess.
export async function sendInstagramMessage({ account, to, body, attachments = [], humanAgent = false }) {
  const credentials = decodeCredentials(account);
  const url = `${GRAPH_BASE}/${account.instagramUserId}/messages`;
  const attachment = attachments[0];

  async function post(message) {
    const response = await fetch(url, {
      method: "POST",
      headers: { Authorization: `Bearer ${credentials.accessToken}`, "Content-Type": "application/json" },
      body: JSON.stringify({ recipient: { id: to }, message, ...(humanAgent ? { tag: "HUMAN_AGENT" } : {}) }),
    });
    return parseOrThrow(response, "INSTAGRAM_SEND_FAILED");
  }

  let primaryPayload;
  if (attachment?.url) {
    primaryPayload = await post({
      attachment: {
        type: INSTAGRAM_ATTACHMENT_TYPE[attachment.type] || "file",
        payload: { url: attachment.url, is_reusable: true },
      },
    });
    // Best-effort only: the attachment is the primary content this call represents (it's what the
    // caller's Message.type reflects), and a real recipient having already gotten the attachment
    // is worth more than failing the whole send over a follow-up text call.
    if (body) {
      await post({ text: body }).catch((error) => {
        logger.warn({ err: error, instagramAccountId: account._id }, "Instagram: attachment sent, follow-up text message failed");
      });
    }
  } else {
    primaryPayload = await post({ text: body });
  }

  return { providerMessageId: primaryPayload.message_id || `ig_${Date.now()}`, status: "sent" };
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

// Reverse of INSTAGRAM_ATTACHMENT_TYPE above - Instagram's inbound attachment.type enum mapped back
// onto our own image/video/audio/document vocabulary. "file"/"story_mention"/anything else unknown
// falls back to "document" rather than being dropped.
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

// Real webhook shape confirmed via Meta's current docs: {object:"instagram", entry:[{id, time,
// messaging:[{sender:{id}, recipient:{id}, timestamp, message:{mid, text, attachments}}]}]}.
// Deliberately ignores messaging_postbacks/reactions/optins/referrals/seen for this first pass -
// only real text/attachment messages, same "minimum genuine feature" scope as everything else
// built today.
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
      attachments: normalizeInboundAttachments(message.attachments),
      providerMessageId: message.mid,
      raw: payload,
    };
  }

  // Comments use a structurally different shape from messaging - entry[].changes[] with
  // field:"comments", not entry[].messaging[] - confirmed via Meta's webhook reference docs before
  // writing this, not assumed from the messaging shape above. The owning account's ID lives at
  // entry.id here (there's no separate "recipient" object like messaging has).
  const change = entry?.changes?.find((item) => item.field === "comments");
  if (change?.value) {
    const value = change.value;
    return {
      type: "comment",
      idempotencyKey: value.id,
      instagramUserId: entry.id,
      commentId: value.id,
      mediaId: value.media?.id || "",
      parentId: value.parent_id || "",
      fromId: value.from?.id || "",
      fromUsername: value.from?.username || "",
      text: value.text || "",
      raw: payload,
    };
  }

  return { type: "unknown", idempotencyKey: `ig_unknown:${Date.now()}`, raw: payload };
}

export async function replyToInstagramComment(account, commentId, message) {
  const credentials = decodeCredentials(account);
  const url = new URL(`${GRAPH_BASE}/${commentId}/replies`);
  const response = await fetch(url.toString(), {
    method: "POST",
    headers: { Authorization: `Bearer ${credentials.accessToken}`, "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ message }),
  });
  return parseOrThrow(response, "INSTAGRAM_COMMENT_REPLY_FAILED");
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Real three-call flow confirmed via Meta's current docs before writing this, not assumed: create a
// media container (image_url must be a real publicly-reachable JPEG - reuses this app's own
// mediaStorage.js upload URLs, the same mechanism WhatsApp/Instagram DM attachments already use),
// poll its status_code until FINISHED (Meta's own guidance: check once per minute for up to 5
// minutes for video; images finish far faster in practice, so this polls more tightly - every 2s,
// giving up after 20s - to keep this a synchronous request/response suitable for a settings-panel
// button rather than needing a background job for what's a "minimum genuine feature" demo, not a
// full scheduling/queue system), then publish the container.
export async function publishInstagramPost(account, { imageUrl, caption }) {
  const credentials = decodeCredentials(account);
  const authHeader = { Authorization: `Bearer ${credentials.accessToken}` };

  const containerUrl = new URL(`${GRAPH_BASE}/${account.instagramUserId}/media`);
  const containerResponse = await fetch(containerUrl.toString(), {
    method: "POST",
    headers: { ...authHeader, "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ image_url: imageUrl, ...(caption ? { caption } : {}) }),
  });
  const container = await parseOrThrow(containerResponse, "INSTAGRAM_PUBLISH_CONTAINER_FAILED");
  const containerId = container.id;

  let statusCode = "IN_PROGRESS";
  for (let attempt = 0; attempt < 10 && statusCode === "IN_PROGRESS"; attempt += 1) {
    if (attempt > 0) await sleep(2000);
    const statusUrl = new URL(`${GRAPH_BASE}/${containerId}`);
    statusUrl.searchParams.set("fields", "status_code");
    const statusResponse = await fetch(statusUrl.toString(), { headers: authHeader });
    const status = await parseOrThrow(statusResponse, "INSTAGRAM_PUBLISH_STATUS_FAILED");
    statusCode = status.status_code;
  }

  if (statusCode !== "FINISHED") {
    const error = new Error(`Instagram media container did not finish processing in time (status: ${statusCode}).`);
    error.code = "INSTAGRAM_PUBLISH_TIMEOUT";
    error.status = 502;
    throw error;
  }

  const publishUrl = new URL(`${GRAPH_BASE}/${account.instagramUserId}/media_publish`);
  const publishResponse = await fetch(publishUrl.toString(), {
    method: "POST",
    headers: { ...authHeader, "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ creation_id: containerId }),
  });
  return parseOrThrow(publishResponse, "INSTAGRAM_PUBLISH_FAILED");
}
