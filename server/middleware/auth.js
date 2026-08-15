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

// Separate from requirePermission on purpose: permission is "can this role do this", entitlement
// is "did this organization's plan even buy this". A dev-role user on a Basic-tier org should
// still be blocked from the automation builder, independent of their role.
export function requireEntitlement(capability) {
  return async (req, res, next) => {
    if (mongoose.connection.readyState !== 1) return next();

    const organization = await Organization.findById(req.user?.organizationId).select("plan");
    if (!organization) {
      return res.status(403).json({ error: "FORBIDDEN", message: "No active organization found." });
    }
    if (!hasEntitlement(organization.plan, capability)) {
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

  req.user = {
    ...payload,
    email: user.email,
    workspaceId: membership.workspaceId.toString(),
    organizationId: membership.organizationId.toString(),
    role: role.name,
    roleKey: normalizeRoleKey(role.key),
    permissions: role.permissions || [],
  };
  next();
}
