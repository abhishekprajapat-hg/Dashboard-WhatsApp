import jwt from "jsonwebtoken";
import { config } from "../config.js";

export function hasPermission(user, permission) {
  const permissions = Array.isArray(user?.permissions) ? user.permissions : [];
  return permissions.includes("*") || permissions.includes(permission);
}

export function requirePermission(permission) {
  return (req, res, next) => {
    if (!hasPermission(req.user, permission)) {
      return res.status(403).json({ error: "FORBIDDEN", message: "You do not have permission to perform this action." });
    }
    next();
  };
}

export function requireAuth(req, res, next) {
  const authHeader = req.headers.authorization || "";
  const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : "";

  if (!token) {
    return res.status(401).json({ error: "AUTH_REQUIRED", message: "Authentication is required." });
  }

  try {
    req.user = jwt.verify(token, config.jwtSecret);
    next();
  } catch {
    res.status(401).json({ error: "INVALID_TOKEN", message: "Session is invalid or expired." });
  }
}
