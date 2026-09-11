import { config } from "../config.js";
import { AuditLog } from "../models/index.js";
import { logger } from "../services/logger.js";
import { verifyPassword } from "../utils/password.js";
import { rateLimiter } from "./rateLimiter.js";

// Step-up authentication for actions that destroy or re-bill a paying client's account.
//
// Why a SECOND secret rather than re-prompting for the login password: the platform is currently
// operated from a shared admin login whose credentials were submitted to Meta for App Review, so
// reviewers legitimately hold them. Re-asking for the login password would prove nothing - whoever
// is holding those credentials already knows it. This secret is deliberately NOT the login password
// and there is deliberately NO UI to set or change it: it lives only in server/.env on the VPS, so
// holding the login cannot rotate it. Anything that lets the app change it from inside would hand
// that power straight back to whoever we are guarding against.
//
// Generate the hash with: node scripts/hashActionPassword.mjs "<your password>"
// then put the result in server/.env as DESTRUCTIVE_ACTION_PASSWORD_HASH.

const HEADER = "x-action-password";

// Fails CLOSED when unconfigured. An unset secret means destructive routes are refused outright
// rather than silently running unprotected - if this control is going to fail it must fail in the
// direction that keeps client data intact, and a visible 503 gets fixed while a silent bypass does
// not. The message says exactly how to configure it so this is self-resolving.
export function requireActionPassword(req, res, next) {
  const storedHash = config.destructiveActionPasswordHash;

  if (!storedHash) {
    logger.error("requireActionPassword: DESTRUCTIVE_ACTION_PASSWORD_HASH is not set - refusing a destructive action");
    return res.status(503).json({
      error: "ACTION_PASSWORD_NOT_CONFIGURED",
      message:
        "This action needs the destructive-action password, which is not configured on the server. Generate a hash with `node scripts/hashActionPassword.mjs \"<password>\"` and set DESTRUCTIVE_ACTION_PASSWORD_HASH in server/.env.",
    });
  }

  const supplied = String(req.get(HEADER) || req.body?.actionPassword || "");

  // 428 Precondition Required, deliberately NOT 401. The client's request() treats every 401 as a
  // dead session - it calls clearToken() and fires auth:invalid - so answering 401 here would log
  // the operator out instead of asking them for the second secret. 428 also says the right thing:
  // the session is valid, a precondition simply has not been met yet.
  if (!supplied) {
    return res.status(428).json({
      error: "ACTION_PASSWORD_REQUIRED",
      message: "This action requires the destructive-action password.",
    });
  }

  // verifyPassword uses timingSafeEqual internally, so this comparison is already constant-time.
  const ok = verifyPassword(supplied, storedHash);

  // Logged on BOTH paths, deliberately. A failure here is a far more interesting signal than a
  // success - it means someone with a valid session tried to reach a destructive action and could
  // not produce the second secret, which is exactly the event worth being able to find later. Never
  // record the supplied value.
  recordAttempt(req, ok).catch((error) => {
    logger.error("requireActionPassword: could not write audit entry", { error: error.message });
  });

  if (!ok) {
    logger.warn("requireActionPassword: rejected", { userId: req.user?.sub, path: req.originalUrl });
    return res.status(403).json({
      error: "ACTION_PASSWORD_INVALID",
      message: "That destructive-action password is not correct.",
    });
  }

  return next();
}

// Export the guard as a rate-limiter + check pair rather than the bare check, so no call site can
// mount the password check without a brute-force budget by forgetting to add one. Express spreads
// an array of middleware, so `router.delete(path, ...actionPasswordGuard, handler)` works.
//
// The scope is distinct from every other limiter: rateLimiter's own comment records a real incident
// where a route-specific budget was being drained by unrelated traffic sharing the default scope.
// 10 attempts per 15 minutes is generous for a human typing a password they know and hostile to
// anyone guessing one, and it is per IP+tenant, so one attacker cannot lock out a real operator on
// a different address.
export const actionPasswordGuard = [
  rateLimiter({ limit: 10, windowMs: 15 * 60 * 1000, scope: "action-password" }),
  requireActionPassword,
];

async function recordAttempt(req, ok) {
  if (!req.user?.organizationId || !req.user?.workspaceId) return;

  await AuditLog.create({
    organizationId: req.user.organizationId,
    workspaceId: req.user.workspaceId,
    actorUserId: req.user.sub,
    action: ok ? "security.action_password_accepted" : "security.action_password_rejected",
    entityType: "Security",
    entityId: "",
    after: { method: req.method, path: req.originalUrl },
    ipAddress: req.ip,
    userAgent: req.get("user-agent") || "",
  });
}
