import jwt from "jsonwebtoken";
import { config } from "../config.js";
import { normalizeRoleKey } from "./rbac.js";

export function signSession({ user, workspace, role }) {
  const roleKey = normalizeRoleKey(role.key);
  return jwt.sign(
    {
      sub: user._id.toString(),
      email: user.email,
      workspaceId: workspace._id.toString(),
      organizationId: workspace.organizationId.toString(),
      role: role.name,
      roleKey,
      permissions: role.permissions,
    },
    config.jwtSecret,
    { expiresIn: config.jwtExpiresIn }
  );
}

// A short-lived, server-signed continuation for the "provider gave no email" OAuth follow-up step
// (server/routes/auth.js's /oauth/complete). Binds the identity /oauth/:provider/callback already
// verified against the real provider (provider+providerId+name+avatarUrl) so /oauth/complete can
// trust it without re-accepting those fields as free-form, client-supplied JSON - accepting them
// directly let anyone plant a User row under an arbitrary providerId they don't control, which a
// later real login for that identity would then silently match into (account takeover).
const OAUTH_CONTINUATION_PURPOSE = "oauth_complete";

export function signOAuthContinuationToken({ provider, providerId, name, avatarUrl }) {
  return jwt.sign(
    { purpose: OAUTH_CONTINUATION_PURPOSE, provider, providerId, name: name || "", avatarUrl: avatarUrl || "" },
    config.jwtSecret,
    { expiresIn: "10m" }
  );
}

// Returns the verified identity payload, or null if the token is missing/expired/tampered/not
// actually an oauth-continuation token (e.g. someone tries to reuse a real session JWT here).
export function verifyOAuthContinuationToken(token) {
  try {
    const payload = jwt.verify(String(token || ""), config.jwtSecret);
    if (payload.purpose !== OAUTH_CONTINUATION_PURPOSE || !payload.provider || !payload.providerId) return null;
    return payload;
  } catch {
    return null;
  }
}

export function serializeUser(user, role, organization = null) {
  const roleKey = normalizeRoleKey(role.key);
  return {
    id: user._id.toString(),
    name: user.name,
    email: user.email,
    role: role.name,
    roleKey,
    permissions: role.permissions || [],
    isPlatformOwner: Boolean(organization?.isPlatformOwner),
  };
}

export function serializeWorkspace(workspace) {
  return {
    id: workspace._id.toString(),
    name: workspace.name,
    slug: workspace.slug,
    timezone: workspace.timezone,
    whatsappHealth: workspace.settings?.whatsappHealth || "disconnected",
  };
}
