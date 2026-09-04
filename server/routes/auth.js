import { Router } from "express";
import crypto from "crypto";
import jwt from "jsonwebtoken";
import mongoose from "mongoose";
import { z } from "zod";
import { config } from "../config.js";
import { demoUser, demoWorkspace } from "../data/demoData.js";
import { rateLimiter } from "../middleware/rateLimiter.js";
import { validateBody } from "../middleware/validate.js";
import { Membership, Organization, Role, User, Workspace } from "../models/index.js";
import { hashPassword, verifyPassword } from "../utils/password.js";
import { roleDefinitionFor } from "../utils/rbac.js";
import { isEmail, passwordPolicy } from "../utils/validation.js";
import { trimmedString } from "../utils/zodHelpers.js";
import { serializeUser, serializeWorkspace, signSession } from "../utils/session.js";
import { buildAuthorizeUrl, exchangeCodeForProfile, isKnownProvider, isProviderConfigured } from "../services/socialAuth.js";
import { generateAndSendOtp, verifyOtp } from "../services/otpService.js";

export const authRouter = Router();

// Public-signup abuse surface that doesn't exist anywhere else in this app - a tighter limit than
// the global default (config.rateLimitMax, applied app-wide in index.js) on top of it, not instead
// of it.
const signupRateLimiter = rateLimiter({ limit: 5, windowMs: 60_000, scope: "signup" });

// The global default (600 req/min/IP, config.rateLimitMax) is nowhere near tight enough to block
// password brute-forcing on login specifically - a real client's account is worth targeting in a
// way most other endpoints aren't. Same rate-limiter, same per-IP keying, just a tighter budget
// than signup since a real user retrying a mistyped password is a much more common case than a
// mistyped signup form.
const loginRateLimiter = rateLimiter({ limit: 10, windowMs: 60_000, scope: "login" });

export const loginSchema = z.object({
  email: z.string().trim().min(1, "Email is required.").email("Must be a valid email address."),
  password: z.string().min(1, "Password is required."),
});

export const registerSchema = z.object({
  name: trimmedString("Name is required."),
  email: z.string().refine(isEmail, "A valid email is required."),
  password: z.string().refine((value) => passwordPolicy(value).valid, (value) => ({ message: passwordPolicy(value).message })),
  workspaceName: trimmedString("Workspace name is required."),
});

export const oauthCompleteSchema = z.object({
  provider: z.enum(["google", "facebook", "instagram"]),
  providerId: trimmedString("Provider identity is required."),
  name: z.string().optional().default(""),
  avatarUrl: z.string().optional().default(""),
  email: z.string().refine(isEmail, "A valid email is required."),
});

export const whatsappOtpSendSchema = z.object({
  phone: trimmedString("A phone number is required."),
});

export const whatsappOtpVerifySchema = z.object({
  phone: trimmedString("A phone number is required."),
  code: trimmedString("A code is required."),
});

// Every new-account path (password register, each OAuth provider, WhatsApp OTP) converges here -
// same Organization+Workspace+admin-Role+Membership sequence workspace.js's POST / already uses
// for "an existing admin spins up another workspace", just starting from a freshly-created User
// instead of req.user.sub.
export async function provisionWorkspaceForNewUser(user, workspaceName) {
  const trimmedName = workspaceName.trim();
  const slug = trimmedName.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "workspace";

  const organization = await Organization.create({
    name: trimmedName,
    slug: `${slug}-${Date.now()}`,
    ownerUserId: user._id,
    plan: "basic",
    billingStatus: "trial",
  });

  const workspace = await Workspace.create({
    organizationId: organization._id,
    name: trimmedName,
    slug,
    timezone: "UTC",
    businessCategory: "Support",
    settings: { whatsappHealth: "disconnected" },
  });

  const role = await Role.create({
    organizationId: organization._id,
    workspaceId: workspace._id,
    key: "admin",
    ...roleDefinitionFor("admin"),
    isSystemRole: true,
  });

  await Membership.create({
    organizationId: organization._id,
    workspaceId: workspace._id,
    userId: user._id,
    roleId: role._id,
    status: "active",
    joinedAt: new Date(),
  });

  return { organization, workspace, role };
}

function newAccountSession(user, workspace, role, organization) {
  return {
    token: signSession({ user, workspace, role }),
    user: serializeUser(user, role, organization),
    workspace: serializeWorkspace(workspace),
    isNewAccount: true,
  };
}

// Shared popup-callback page for every OAuth provider on this router - one localStorage key/event
// type, a `provider` field inside the payload lets the single client-side listener tell them apart.
// Same "don't depend on window.opener" reasoning as instagram.js's oauth-callback (real COOP
// breakage already hit in production for that flow); this is a new, separate key from Instagram's
// own business-connect flow's "ig_oauth_result" since they serve different purposes.
function renderOAuthCallbackPage(res, payload) {
  const json = JSON.stringify({ type: "SOCIAL_AUTH_CALLBACK", at: Date.now(), ...payload });
  res.setHeader("Cross-Origin-Opener-Policy", "same-origin-allow-popups");
  res.set("Content-Type", "text/html").send(`<!doctype html><html><body>
<script>
  try { localStorage.setItem("social_auth_result", ${JSON.stringify(json)}); } catch (e) {}
  window.opener?.postMessage(JSON.parse(${JSON.stringify(json)}), window.location.origin);
  window.close();
</script>
${payload.error ? "Sign-in failed - you can close this window." : "Signed in - you can close this window."}
</body></html>`);
}

async function buildSessionForUser(user, workspaceId = "") {
  const filter = { userId: user._id, status: "active" };
  if (workspaceId && mongoose.Types.ObjectId.isValid(workspaceId)) filter.workspaceId = workspaceId;
  const membership = await Membership.findOne(filter).sort({ joinedAt: -1 });

  if (!membership) {
    return null;
  }

  const [workspace, role, organization] = await Promise.all([
    Workspace.findById(membership.workspaceId),
    Role.findById(membership.roleId),
    Organization.findById(membership.organizationId).select("isPlatformOwner"),
  ]);

  if (!workspace || !role) {
    return null;
  }

  return {
    token: signSession({ user, workspace, role }),
    user: serializeUser(user, role, organization),
    workspace: serializeWorkspace(workspace),
  };
}

authRouter.get("/me", async (req, res) => {
  const authHeader = req.headers.authorization || "";
  const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : "";

  if (!token) {
    return res.status(401).json({ error: "AUTH_REQUIRED", message: "Authentication is required." });
  }

  let payload;
  try {
    payload = jwt.verify(token, config.jwtSecret);
  } catch {
    return res.status(401).json({ error: "INVALID_TOKEN", message: "Session is invalid or expired." });
  }

  if (mongoose.connection.readyState !== 1) {
    if (config.demoMode && payload.sub === demoUser.id) {
      return res.json({ token, user: demoUser, workspace: demoWorkspace });
    }
    return res.status(503).json({ error: "DATABASE_UNAVAILABLE", message: "MongoDB is required." });
  }

  const user = await User.findOne({ _id: payload.sub, status: "active" });
  if (!user) {
    return res.status(401).json({ error: "INVALID_TOKEN", message: "Session user is no longer active." });
  }

  const session = await buildSessionForUser(user, payload.workspaceId);
  if (!session) {
    return res.status(403).json({ error: "NO_WORKSPACE", message: "No active workspace membership found." });
  }

  res.json(session);
});

authRouter.post("/login", loginRateLimiter, validateBody(loginSchema), async (req, res) => {
  const { email, password } = req.body;

  if (mongoose.connection.readyState === 1) {
    const user = await User.findOne({ email: email.toLowerCase(), status: "active" });

    if (!user || !verifyPassword(password, user.passwordHash)) {
      return res.status(401).json({ error: "INVALID_CREDENTIALS", message: "Invalid email or password." });
    }

    user.lastLoginAt = new Date();
    await User.updateOne({ _id: user._id }, { $set: { lastLoginAt: user.lastLoginAt } });

    const session = await buildSessionForUser(user);
    if (!session) {
      return res.status(403).json({ error: "NO_WORKSPACE", message: "No active workspace membership found." });
    }

    return res.json(session);
  }

  if (config.demoMode && email.toLowerCase() === demoUser.email && password.length > 0) {
    const token = jwt.sign(
      {
        sub: demoUser.id,
        email: demoUser.email,
        workspaceId: demoWorkspace.id,
        organizationId: "org_demo",
        role: demoUser.role,
        roleKey: demoUser.roleKey,
        permissions: demoUser.permissions,
      },
      config.jwtSecret,
      { expiresIn: config.jwtExpiresIn }
    );

    return res.json({
      token,
      user: demoUser,
      workspace: demoWorkspace,
    });
  }

  res.status(401).json({ error: "INVALID_CREDENTIALS", message: "Invalid email or password." });
});

authRouter.post("/register", signupRateLimiter, validateBody(registerSchema), async (req, res) => {
  if (mongoose.connection.readyState !== 1) {
    return res.status(503).json({ error: "DATABASE_UNAVAILABLE", message: "MongoDB is required." });
  }

  const { name, email, password, workspaceName } = req.body;
  const normalizedEmail = email.toLowerCase();

  const existing = await User.findOne({ email: normalizedEmail });
  if (existing) {
    return res.status(409).json({ error: "EMAIL_TAKEN", message: "An account with this email already exists." });
  }

  const user = await User.create({ name, email: normalizedEmail, passwordHash: hashPassword(password), status: "active" });
  const { organization, workspace, role } = await provisionWorkspaceForNewUser(user, workspaceName);

  res.status(201).json(newAccountSession(user, workspace, role, organization));
});

authRouter.get("/oauth/:provider/authorize-url", (req, res) => {
  const { provider } = req.params;
  if (!isKnownProvider(provider)) {
    return res.status(404).json({ error: "UNKNOWN_PROVIDER", message: "Unknown login provider." });
  }
  if (!isProviderConfigured(provider)) {
    return res.status(400).json({
      error: "PROVIDER_NOT_CONFIGURED",
      message: `${provider} login is not configured yet. See server/.env.example for the required vars.`,
    });
  }
  const state = crypto.randomBytes(16).toString("hex");
  res.json({ url: buildAuthorizeUrl(provider, state), state });
});

// Public - the OAuth popup redirects here directly, carrying no JWT of ours. Does the full
// exchange+find-or-create in one shot (unlike instagram.js's business-connect callback, which only
// hands the raw code back to an already-authenticated client) since there's no session to attach
// this to yet.
authRouter.get("/oauth/:provider/callback", async (req, res) => {
  const { provider } = req.params;
  const code = String(req.query.code || "");
  const oauthError = String(req.query.error_description || req.query.error || "");

  if (!isKnownProvider(provider)) {
    return renderOAuthCallbackPage(res, { provider, error: "Unknown login provider." });
  }
  if (oauthError) {
    return renderOAuthCallbackPage(res, { provider, error: oauthError });
  }
  if (mongoose.connection.readyState !== 1) {
    return renderOAuthCallbackPage(res, { provider, error: "Service unavailable, please try again shortly." });
  }

  let profile;
  try {
    profile = await exchangeCodeForProfile(provider, code);
  } catch (error) {
    return renderOAuthCallbackPage(res, { provider, error: error.message || "Sign-in failed." });
  }

  const providerIdField = `${provider}Id`;
  let user = await User.findOne({ [providerIdField]: profile.providerId });

  if (!user && profile.email) {
    user = await User.findOne({ email: profile.email.toLowerCase() });
    if (user) {
      await User.updateOne({ _id: user._id }, { $set: { [providerIdField]: profile.providerId } });
    }
  }

  if (!user) {
    // Instagram's OAuth returns no email at all (confirmed via docs before building this) - can't
    // finish creating a real account without one, so hand identity back for a one-field follow-up
    // instead of inventing a synthetic placeholder email.
    if (!profile.email) {
      return renderOAuthCallbackPage(res, {
        provider,
        needsEmail: true,
        providerId: profile.providerId,
        name: profile.name,
        avatarUrl: profile.avatarUrl,
      });
    }

    user = await User.create({
      name: profile.name || profile.email.split("@")[0],
      email: profile.email.toLowerCase(),
      avatarUrl: profile.avatarUrl || "",
      [providerIdField]: profile.providerId,
      status: "active",
    });
    const { organization, workspace, role } = await provisionWorkspaceForNewUser(user, profile.name || profile.email.split("@")[0]);
    return renderOAuthCallbackPage(res, { provider, session: newAccountSession(user, workspace, role, organization) });
  }

  const session = await buildSessionForUser(user);
  if (!session) {
    return renderOAuthCallbackPage(res, { provider, error: "No active workspace membership found." });
  }
  return renderOAuthCallbackPage(res, { provider, session });
});

// Completes an Instagram signup that stalled on the "no email" case above - the popup already
// closed once, so this is a plain POST from the follow-up form, not another OAuth round trip.
authRouter.post("/oauth/complete", validateBody(oauthCompleteSchema), async (req, res) => {
  if (mongoose.connection.readyState !== 1) {
    return res.status(503).json({ error: "DATABASE_UNAVAILABLE", message: "MongoDB is required." });
  }

  const { provider, providerId, name, avatarUrl, email } = req.body;
  const providerIdField = `${provider}Id`;
  const normalizedEmail = email.toLowerCase();

  const existing = await User.findOne({ email: normalizedEmail });
  if (existing) {
    return res.status(409).json({ error: "EMAIL_TAKEN", message: "An account with this email already exists." });
  }

  const user = await User.create({
    name: name || normalizedEmail.split("@")[0],
    email: normalizedEmail,
    avatarUrl: avatarUrl || "",
    [providerIdField]: providerId,
    status: "active",
  });
  const { organization, workspace, role } = await provisionWorkspaceForNewUser(user, name || normalizedEmail.split("@")[0]);

  res.status(201).json(newAccountSession(user, workspace, role, organization));
});

authRouter.post("/whatsapp-otp/send", signupRateLimiter, validateBody(whatsappOtpSendSchema), async (req, res) => {
  if (mongoose.connection.readyState !== 1) {
    return res.status(503).json({ error: "DATABASE_UNAVAILABLE", message: "MongoDB is required." });
  }

  try {
    await generateAndSendOtp(req.body.phone);
    res.json({ sent: true });
  } catch (error) {
    res.status(error.status || 502).json({ error: error.code || "OTP_SEND_FAILED", message: error.message });
  }
});

authRouter.post("/whatsapp-otp/verify", validateBody(whatsappOtpVerifySchema), async (req, res) => {
  if (mongoose.connection.readyState !== 1) {
    return res.status(503).json({ error: "DATABASE_UNAVAILABLE", message: "MongoDB is required." });
  }

  const { phone, code } = req.body;
  const result = await verifyOtp(phone, code);
  if (!result.verified) {
    return res.status(400).json({ error: "INVALID_OTP", message: "That code is incorrect or has expired." });
  }

  const normalizedPhone = String(phone).replace(/[^\d]/g, "");
  let user = await User.findOne({ phone: normalizedPhone });

  if (!user) {
    // Deliberately different call from the Instagram no-email case above: there, a real email is
    // one easy follow-up field away and worth asking for. Here, requiring an extra field would
    // defeat the point of WhatsApp OTP being the lightest-friction signup path, and .local is a
    // reserved, non-routable TLD (never resolvable/deliverable) so this can never collide with or
    // impersonate a real address - a placeholder, not a synthetic real-looking email.
    user = await User.create({
      name: `WhatsApp ${normalizedPhone.slice(-4)}`,
      email: `wa_${normalizedPhone}@users.dashboard-whatsapp.local`,
      phone: normalizedPhone,
      phoneVerifiedAt: new Date(),
      status: "active",
    });
    const { organization, workspace, role } = await provisionWorkspaceForNewUser(user, user.name);
    return res.status(201).json(newAccountSession(user, workspace, role, organization));
  }

  if (!user.phoneVerifiedAt) {
    await User.updateOne({ _id: user._id }, { $set: { phoneVerifiedAt: new Date() } });
  }
  const session = await buildSessionForUser(user);
  if (!session) {
    return res.status(403).json({ error: "NO_WORKSPACE", message: "No active workspace membership found." });
  }
  res.json(session);
});

