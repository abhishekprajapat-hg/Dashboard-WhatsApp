import { AuditLog } from "../models/index.js";

const auditedMethods = new Set(["POST", "PUT", "PATCH", "DELETE"]);

export function auditMiddleware(req, res, next) {
  if (!auditedMethods.has(req.method) || !req.path.startsWith("/api/")) return next();

  res.on("finish", () => {
    if (!req.user?.workspaceId || res.statusCode >= 500) return;
    AuditLog.create({
      organizationId: req.user.organizationId,
      workspaceId: req.user.workspaceId,
      actorUserId: req.user.sub,
      action: `${req.method} ${req.path}`,
      entityType: req.path.split("/").filter(Boolean)[1] || "api",
      entityId: req.params?.id || req.params?.conversationId || "",
      after: {
        statusCode: res.statusCode,
        query: req.query || {},
      },
      ipAddress: req.ip,
      userAgent: req.headers["user-agent"] || "",
    }).catch(() => undefined);
  });

  next();
}
