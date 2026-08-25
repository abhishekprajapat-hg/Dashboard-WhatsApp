import { config } from "../config.js";

// End-user identity login (Google/Facebook/Instagram) for the public signup/onboarding page - a
// different purpose from instagramProvider.js's OAuth (which connects a client's own Instagram
// *business* account to a workspace, with business-management scopes). This is identity-only:
// "who is this person," not "what business assets do they manage."

const PROVIDERS = ["google", "facebook", "instagram"];

export function isKnownProvider(provider) {
  return PROVIDERS.includes(provider);
}

async function parseOrThrow(response, errorCode) {
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || payload.error || payload.error_message) {
    const error = new Error(payload.error_message || payload.error?.message || payload.error_description || "OAuth request failed.");
    error.status = response.status || 502;
    error.code = errorCode;
    error.meta = payload;
    throw error;
  }
  return payload;
}

function redirectUriFor(provider) {
  if (provider === "google") return config.google.redirectUri;
  if (provider === "facebook") return config.facebookLogin.redirectUri;
  return config.instagram.loginRedirectUri;
}

export function isProviderConfigured(provider) {
  if (provider === "google") return Boolean(config.google.clientId && config.google.clientSecret && config.google.redirectUri);
  if (provider === "facebook") return Boolean(config.meta.appId && config.meta.appSecret && config.facebookLogin.redirectUri);
  return Boolean(config.instagram.appId && config.instagram.appSecret && config.instagram.loginRedirectUri);
}

export function buildAuthorizeUrl(provider, state) {
  const redirectUri = redirectUriFor(provider);

  if (provider === "google") {
    const url = new URL("https://accounts.google.com/o/oauth2/v2/auth");
    url.searchParams.set("client_id", config.google.clientId);
    url.searchParams.set("redirect_uri", redirectUri);
    url.searchParams.set("response_type", "code");
    url.searchParams.set("scope", "openid email profile");
    url.searchParams.set("state", state);
    return url.toString();
  }

  if (provider === "facebook") {
    const url = new URL(`https://www.facebook.com/${config.metaGraphApiVersion}/dialog/oauth`);
    url.searchParams.set("client_id", config.meta.appId);
    url.searchParams.set("redirect_uri", redirectUri);
    url.searchParams.set("response_type", "code");
    url.searchParams.set("scope", "email,public_profile");
    url.searchParams.set("state", state);
    return url.toString();
  }

  // instagram - same hosts as instagramProvider.js's business-connect flow, but identity-only
  // scope and its own redirect_uri (see config.instagram.loginRedirectUri's own comment).
  const url = new URL("https://www.instagram.com/oauth/authorize");
  url.searchParams.set("client_id", config.instagram.appId);
  url.searchParams.set("redirect_uri", redirectUri);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("scope", "instagram_business_basic");
  url.searchParams.set("state", state);
  return url.toString();
}

// Returns a normalized { providerId, email, name, avatarUrl } - email is genuinely null for
// Instagram (its OAuth has no email scope at all, confirmed via docs before building this), callers
// must handle that case rather than assume every provider fills it in.
export async function exchangeCodeForProfile(provider, code) {
  const redirectUri = redirectUriFor(provider);

  if (provider === "google") {
    const tokenResponse = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: config.google.clientId,
        client_secret: config.google.clientSecret,
        redirect_uri: redirectUri,
        grant_type: "authorization_code",
        code,
      }),
    });
    const tokenPayload = await parseOrThrow(tokenResponse, "GOOGLE_TOKEN_EXCHANGE_FAILED");

    const profileResponse = await fetch("https://www.googleapis.com/oauth2/v2/userinfo", {
      headers: { Authorization: `Bearer ${tokenPayload.access_token}` },
    });
    const profile = await parseOrThrow(profileResponse, "GOOGLE_PROFILE_FETCH_FAILED");
    return { providerId: profile.id, email: profile.email || null, name: profile.name || "", avatarUrl: profile.picture || "" };
  }

  if (provider === "facebook") {
    const tokenUrl = new URL(`https://graph.facebook.com/${config.metaGraphApiVersion}/oauth/access_token`);
    tokenUrl.searchParams.set("client_id", config.meta.appId);
    tokenUrl.searchParams.set("client_secret", config.meta.appSecret);
    tokenUrl.searchParams.set("redirect_uri", redirectUri);
    tokenUrl.searchParams.set("code", code);
    const tokenResponse = await fetch(tokenUrl.toString());
    const tokenPayload = await parseOrThrow(tokenResponse, "FACEBOOK_TOKEN_EXCHANGE_FAILED");

    const profileUrl = new URL(`https://graph.facebook.com/${config.metaGraphApiVersion}/me`);
    profileUrl.searchParams.set("fields", "id,name,email,picture");
    profileUrl.searchParams.set("access_token", tokenPayload.access_token);
    const profileResponse = await fetch(profileUrl.toString());
    const profile = await parseOrThrow(profileResponse, "FACEBOOK_PROFILE_FETCH_FAILED");
    return { providerId: profile.id, email: profile.email || null, name: profile.name || "", avatarUrl: profile.picture?.data?.url || "" };
  }

  // instagram - same two-step exchange as instagramProvider.js's exchangeInstagramCode, but this
  // is a deliberately separate code path (login scope, login redirect_uri), not a shared call.
  const tokenResponse = await fetch("https://api.instagram.com/oauth/access_token", {
    method: "POST",
    body: new URLSearchParams({
      client_id: config.instagram.appId,
      client_secret: config.instagram.appSecret,
      grant_type: "authorization_code",
      redirect_uri: redirectUri,
      code,
    }),
  });
  const tokenPayload = await parseOrThrow(tokenResponse, "INSTAGRAM_LOGIN_TOKEN_EXCHANGE_FAILED");
  const tokenEntry = Array.isArray(tokenPayload.data) ? tokenPayload.data[0] : tokenPayload;

  const profileUrl = new URL(`https://graph.instagram.com/${config.metaGraphApiVersion}/me`);
  profileUrl.searchParams.set("fields", "user_id,username,profile_picture_url");
  profileUrl.searchParams.set("access_token", tokenEntry.access_token);
  const profileResponse = await fetch(profileUrl.toString());
  const profile = await parseOrThrow(profileResponse, "INSTAGRAM_LOGIN_PROFILE_FETCH_FAILED");
  // Deliberately null, not a synthetic placeholder - Instagram Login never returns an email, the
  // caller (auth.js's oauth callback) has to ask the user directly before finishing signup.
  return { providerId: String(profile.user_id), email: null, name: profile.username || "", avatarUrl: profile.profile_picture_url || "" };
}
