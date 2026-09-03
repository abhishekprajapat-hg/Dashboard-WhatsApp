import mongoose from "mongoose";
import { ApiKey } from "../models/index.js";
import { hashApiKey } from "../utils/apiKey.js";

// Server-to-server auth for a client's own external system (their CRM, billing software, etc.) -
// a real alternative to requireAuth's JWT, which needs a logged-in human and isn't a sane
// server-to-server pattern. Sets req.apiKeyAuth (organizationId/workspaceId/scopes), mirroring the
// shape route handlers already read off req.user for JWT-authenticated requests.
export function requireApiKey(...requiredScopes) {
  return async (req, res, next) => {
    if (mongoose.connection.readyState !== 1) {
      return res.status(503).json({ error: "DATABASE_UNAVAILABLE", message: "MongoDB is required." });
    }

    const key = String(req.headers["x-api-key"] || "").trim();
    if (!key) {
      return res.status(401).json({ error: "API_KEY_REQUIRED", message: "An X-API-Key header is required." });
    }

    const record = await ApiKey.findOne({ keyHash: hashApiKey(key), revokedAt: mongoose.trusted({ $exists: false }) });
    if (!record) {
      return res.status(401).json({ error: "INVALID_API_KEY", message: "This API key is invalid or has been revoked." });
    }

    if (requiredScopes.length && !requiredScopes.some((scope) => record.scopes.includes(scope))) {
      return res.status(403).json({ error: "FORBIDDEN", message: "This API key does not have the required scope." });
    }

    // Fire-and-forget, same reasoning as other last-used/audit timestamps in this codebase - a
    // slow write here must never delay or fail the actual request.
    ApiKey.updateOne({ _id: record._id }, { $set: { lastUsedAt: new Date() } }).catch(() => undefined);

    req.apiKeyAuth = {
      apiKeyId: record._id.toString(),
      organizationId: record.organizationId.toString(),
      workspaceId: record.workspaceId.toString(),
      scopes: record.scopes,
    };
    next();
  };
}
