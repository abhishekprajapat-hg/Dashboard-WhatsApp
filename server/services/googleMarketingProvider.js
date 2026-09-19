import crypto from "crypto";
import { config } from "../config.js";

// Marketing pillar (Phase 1) - a workspace's own Google OAuth connection (Analytics + Search
// Console, read-only), genuinely new ground: nothing in this codebase talks to the real Google
// Analytics/Search Console APIs today (services/googleSheets.js is a webhook-URL indirection to an
// Apps Script, not real Google API OAuth). Modeled on facebookPagesProvider.js's redirect-based
// OAuth shape (NOT embeddedSignup.js's JS-SDK popup - Google's consent flow is a real page
// redirect), with its own AES-256-GCM credential codec duplicated per this codebase's own
// convention (whatsappProvider.js/facebookPagesProvider.js each have their own, not a shared
// import) since the encrypted payload shape here (access+refresh token+expiry) differs from
// WhatsApp/Facebook's single-token shape.

const OAUTH_AUTHORIZE_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const TOKEN_URL = "https://oauth2.googleapis.com/token";
const GOOGLE_SCOPES = "https://www.googleapis.com/auth/analytics.readonly https://www.googleapis.com/auth/webmasters.readonly";

const encryptedCredentialPrefix = "v1";

function credentialEncryptionKey() {
  return crypto.createHash("sha256").update(config.credentialEncryptionSecret).digest();
}

export function encodeGoogleCredentials(credentials = {}) {
  const safeCredentials = Object.fromEntries(
    Object.entries(credentials).filter(([, value]) => value !== undefined && value !== null)
  );
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", credentialEncryptionKey(), iv);
  const encrypted = Buffer.concat([cipher.update(JSON.stringify(safeCredentials), "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [encryptedCredentialPrefix, iv.toString("base64"), tag.toString("base64"), encrypted.toString("base64")].join(":");
}

export function decodeGoogleCredentials(account) {
  const stored = account?.encryptedCredentials || "";
  if (!stored.startsWith(`${encryptedCredentialPrefix}:`)) return {};
  try {
    const [, ivValue, tagValue, encryptedValue] = stored.split(":");
    if (!ivValue || !tagValue || !encryptedValue) return {};
    const decipher = crypto.createDecipheriv("aes-256-gcm", credentialEncryptionKey(), Buffer.from(ivValue, "base64"));
    decipher.setAuthTag(Buffer.from(tagValue, "base64"));
    const raw = Buffer.concat([decipher.update(Buffer.from(encryptedValue, "base64")), decipher.final()]).toString("utf8");
    return JSON.parse(raw);
  } catch {
    return {};
  }
}

export function buildGoogleMarketingAuthorizeUrl(state) {
  const url = new URL(OAUTH_AUTHORIZE_URL);
  url.searchParams.set("client_id", config.googleMarketing.clientId);
  url.searchParams.set("redirect_uri", config.googleMarketing.redirectUri);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("scope", GOOGLE_SCOPES);
  // Google only returns a refresh_token on the FIRST consent, or when prompt=consent forces
  // re-consent - a disconnect+reconnect must go through this same forced-consent path, not a
  // silent re-authorize, or the reconnected account would be left without a refresh_token.
  url.searchParams.set("access_type", "offline");
  url.searchParams.set("prompt", "consent");
  url.searchParams.set("include_granted_scopes", "true");
  url.searchParams.set("state", state);
  return url.toString();
}

async function parseOrThrow(response, errorCode) {
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || payload.error) {
    const error = new Error(payload.error_description || payload.error?.message || payload.error || "Google API request failed.");
    error.status = response.status || 502;
    error.code = errorCode;
    error.meta = payload;
    throw error;
  }
  return payload;
}

export async function exchangeGoogleMarketingCode(code) {
  const response = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: config.googleMarketing.clientId,
      client_secret: config.googleMarketing.clientSecret,
      redirect_uri: config.googleMarketing.redirectUri,
      code,
      grant_type: "authorization_code",
    }),
  });
  const payload = await parseOrThrow(response, "GOOGLE_MARKETING_TOKEN_EXCHANGE_FAILED");
  return {
    accessToken: payload.access_token,
    refreshToken: payload.refresh_token || "",
    expiresAt: new Date(Date.now() + Number(payload.expires_in || 3600) * 1000).toISOString(),
    scope: payload.scope || "",
  };
}

export async function refreshGoogleMarketingToken(refreshToken) {
  const response = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: config.googleMarketing.clientId,
      client_secret: config.googleMarketing.clientSecret,
      refresh_token: refreshToken,
      grant_type: "refresh_token",
    }),
  });
  const payload = await parseOrThrow(response, "GOOGLE_MARKETING_TOKEN_REFRESH_FAILED");
  return {
    accessToken: payload.access_token,
    expiresAt: new Date(Date.now() + Number(payload.expires_in || 3600) * 1000).toISOString(),
  };
}

export async function fetchGoogleProfile(accessToken) {
  const response = await fetch("https://www.googleapis.com/oauth2/v2/userinfo", {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  const payload = await parseOrThrow(response, "GOOGLE_MARKETING_PROFILE_FETCH_FAILED");
  return { email: payload.email || "" };
}

// Analytics Admin API - lists every GA4 property the connecting account can see, across every
// account it belongs to, flattened into one list for the picker (routes/marketing.js's
// POST /google/connect response).
export async function listGa4Properties(accessToken) {
  const response = await fetch("https://analyticsadmin.googleapis.com/v1beta/accountSummaries?pageSize=200", {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  const payload = await parseOrThrow(response, "GOOGLE_MARKETING_GA4_LIST_FAILED");
  const properties = [];
  for (const account of payload.accountSummaries || []) {
    for (const property of account.propertySummaries || []) {
      properties.push({ propertyId: property.property, displayName: property.displayName || property.property });
    }
  }
  return properties;
}

// Search Console API - sites.list only returns sites the connecting account has ALREADY verified
// ownership of in Search Console itself; this app cannot verify a site on a client's behalf (see
// the plan's "real external/business dependencies" section - the UI must say so on an empty list).
export async function listSearchConsoleSites(accessToken) {
  const response = await fetch("https://www.googleapis.com/webmasters/v3/sites", {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  const payload = await parseOrThrow(response, "GOOGLE_MARKETING_SEARCH_CONSOLE_LIST_FAILED");
  return (payload.siteEntry || [])
    .filter((site) => site.permissionLevel && site.permissionLevel !== "siteUnverifiedUser")
    .map((site) => ({ siteUrl: site.siteUrl, permissionLevel: site.permissionLevel }));
}

// Called before every Analytics/Search Console/audit call that needs a live access token - Google
// access tokens last ~1hr, refreshed lazily when within 5 minutes of expiry rather than on a timer.
// Mutates and saves the passed Mongoose document in place (same "re-encrypt and persist" pattern as
// every other credential refresh in this codebase) and returns the usable access token.
export async function getValidAccessToken(account) {
  const credentials = decodeGoogleCredentials(account);
  const expiresAt = credentials.expiresAt ? new Date(credentials.expiresAt).getTime() : 0;
  const needsRefresh = !credentials.accessToken || expiresAt - Date.now() < 5 * 60 * 1000;

  if (!needsRefresh) return credentials.accessToken;
  if (!credentials.refreshToken) {
    const error = new Error("Google account needs to be reconnected.");
    error.status = 409;
    error.code = "GOOGLE_MARKETING_REFRESH_TOKEN_MISSING";
    throw error;
  }

  const refreshed = await refreshGoogleMarketingToken(credentials.refreshToken);
  account.encryptedCredentials = encodeGoogleCredentials({ ...credentials, ...refreshed });
  account.credentialsUpdatedAt = new Date();
  await account.save();
  return refreshed.accessToken;
}

// GA4 Data API - a 28-day summary (sessions/users/conversions + a daily trend + top channels) for
// the workspace's own connected ga4PropertyId. Used by GET /analytics/summary.
export async function queryGa4Summary(account) {
  const accessToken = await getValidAccessToken(account);
  const response = await fetch(`https://analyticsdata.googleapis.com/v1beta/${account.ga4PropertyId}:runReport`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${accessToken}` },
    body: JSON.stringify({
      dateRanges: [{ startDate: "28daysAgo", endDate: "today" }],
      dimensions: [{ name: "date" }, { name: "sessionDefaultChannelGroup" }],
      metrics: [{ name: "sessions" }, { name: "totalUsers" }, { name: "conversions" }],
      orderBys: [{ dimension: { dimensionName: "date" } }],
    }),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || payload.error) {
    const error = new Error(payload.error?.message || "GA4 Data API request failed.");
    error.status = response.status || 502;
    error.code = "GA4_REPORT_REQUEST_FAILED";
    throw error;
  }

  const rows = payload.rows || [];
  const byDate = new Map();
  const byChannel = new Map();
  let sessions = 0;
  let users = 0;
  let conversions = 0;

  for (const row of rows) {
    const date = row.dimensionValues?.[0]?.value || "";
    const channel = row.dimensionValues?.[1]?.value || "Unassigned";
    const rowSessions = Number(row.metricValues?.[0]?.value || 0);
    const rowUsers = Number(row.metricValues?.[1]?.value || 0);
    const rowConversions = Number(row.metricValues?.[2]?.value || 0);

    sessions += rowSessions;
    users += rowUsers;
    conversions += rowConversions;
    byDate.set(date, (byDate.get(date) || 0) + rowSessions);
    byChannel.set(channel, (byChannel.get(channel) || 0) + rowSessions);
  }

  return {
    totals: { sessions, users, conversions },
    dailySessions: [...byDate.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([date, value]) => ({ date, sessions: value })),
    topChannels: [...byChannel.entries()].sort(([, a], [, b]) => b - a).slice(0, 8).map(([channel, value]) => ({ channel, sessions: value })),
    periodDays: 28,
  };
}
