import jwt from "jsonwebtoken";
import mongoose from "mongoose";
import { config } from "../config.js";
import { Membership, Organization, Role, User } from "../models/index.js";
import { hasEntitlement } from "../services/entitlements.js";
import { normalizeRoleKey } from "../utils/rbac.js";

export function hasPermission(user, permission) {
  const permissions = Array.isArray(user?.permissions) ? user.permissions : [];
  return user?.roleKey === "super_admin" || permissions.includes("*") || permissions.includes(permission);
}

export function requireRole(...roles) {
  const allowed = roles.map(normalizeRoleKey);
  return (req, res, next) => {
    if (!allowed.includes(normalizeRoleKey(req.user?.roleKey))) {
      return res.status(403).json({ error: "FORBIDDEN", message: "Your role cannot access this resource." });
    }
    next();
  };
}

export function requirePermission(permission) {
  return (req, res, next) => {
    if (!hasPermission(req.user, permission)) {
      return res.status(403).json({ error: "FORBIDDEN", message: "You do not have permission to perform this action." });
    }
    next();
  };
}

// A workspace's own "admin" role carries wildcard permissions (rbac.js), same as "super_admin" -
// that's correct, a client should have full control of their own workspace. But some routes
// (global feature flags, direct plan overrides that bypass billing) affect the whole platform, not
// just the caller's own org, and must stay restricted to Nemnidhi's own organization regardless of
// the caller's role/permissions. Fails closed if isPlatformOwner is missing for any reason.
export function requirePlatformOwner(req, res, next) {
  if (!req.user?.isPlatformOwner) {
    return res.status(403).json({ error: "FORBIDDEN", message: "This action is restricted to the platform owner." });
  }
  next();
}

// Separate from requirePermission on purpose: permission is "can this role do this", entitlement
// is "did this organization's plan even buy this". A dev-role user on a Basic-tier org should
// still be blocked from the automation builder, independent of their role.
//
// The platform owner (Nemnidhi's own organization) always has every capability, regardless of
// its own plan field - direct instruction, not inferred. Without this, Nemnidhi's own org would
// need its plan manually kept in sync with "everything unlocked" forever, and a single wrong
// value there would lock the platform owner out of its own automation/AI tooling with no
// override. Exported so any route computing a *displayed* entitlement flag (not just gating an
// API call) can apply the exact same rule - see assistant.js's /overview.
export function hasEntitlementForActor(actor, plan, capability) {
  if (actor?.isPlatformOwner) return true;
  return hasEntitlement(plan, capability);
}

export function requireEntitlement(capability) {
  return async (req, res, next) => {
    if (mongoose.connection.readyState !== 1) return next();

    const organization = await Organization.findById(req.user?.organizationId).select("plan");
    if (!organization) {
      return res.status(403).json({ error: "FORBIDDEN", message: "No active organization found." });
    }
    if (!hasEntitlementForActor(req.user, organization.plan, capability)) {
      return res.status(403).json({
        error: "PLAN_LIMIT",
        message: `This workspace's plan does not include ${capability}.`,
      });
    }
    next();
  };
}

export async function requireAuth(req, res, next) {
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
    req.user = payload;
    return next();
  }

  const user = await User.findOne({ _id: payload.sub, status: "active" }).select("_id email status");
  if (!user) {
    return res.status(401).json({ error: "INVALID_TOKEN", message: "Session user is no longer active." });
  }

  const membership = await Membership.findOne({
    userId: user._id,
    workspaceId: payload.workspaceId,
    status: "active",
  });
  if (!membership) {
    return res.status(403).json({ error: "FORBIDDEN", message: "No active workspace membership found." });
  }

  const role = await Role.findById(membership.roleId);
  if (!role) {
    return res.status(403).json({ error: "FORBIDDEN", message: "No active role found for this workspace." });
  }

  const organization = await Organization.findById(membership.organizationId).select("isPlatformOwner");

  req.user = {
    ...payload,
    email: user.email,
    workspaceId: membership.workspaceId.toString(),
    organizationId: membership.organizationId.toString(),
    role: role.name,
    roleKey: normalizeRoleKey(role.key),
    permissions: role.permissions || [],
    isPlatformOwner: Boolean(organization?.isPlatformOwner),
  };
  next();
}
