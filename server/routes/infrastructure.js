import { Router } from "express";
import { requirePermission } from "../middleware/auth.js";
import { getFeatureFlags } from "../services/featureFlags.js";
import { healthSnapshot } from "../services/health.js";
import { enqueueJob, queueHealth } from "../services/jobs.js";
import { publishEvent } from "../services/messageBus.js";

export const infrastructureRouter = Router();

// No client UI calls this router at all - it's a backend-only ops/diagnostics surface (health,
// feature flags, queue status, test job/event triggers). Reuses admin:read/admin:write rather than
// inventing a dedicated infrastructure:* permission pair nothing else would reference.
infrastructureRouter.get("/status", requirePermission("admin:read"), async (req, res) => {
  const [health, flags, queues] = await Promise.all([
    healthSnapshot(),
    getFeatureFlags(req.user.workspaceId),
    queueHealth().catch((error) => ({ error: error.message })),
  ]);

  res.json({
    health,
    featureFlags: flags,
    queues,
    capabilities: [
      "Redis cache",
      "BullMQ retry queues",
      "RabbitMQ event bus",
      "Rate limiter",
      "S3 media storage",
      "CDN URLs",
      "Webhook jobs",
      "Audit logs",
      "Prometheus metrics",
      "OpenTelemetry",
      "Feature flags",
      "Horizontal scaling",
      "Health checks",
      "Zero downtime deployment",
    ],
  });
});

infrastructureRouter.post("/jobs/test", requirePermission("admin:write"), async (req, res) => {
  const result = await enqueueJob("maintenance", "infrastructure.test", {
    workspaceId: req.user.workspaceId,
    requestedBy: req.user.sub,
    requestedAt: new Date().toISOString(),
  });
  res.json({ data: result });
});

infrastructureRouter.post("/events/test", requirePermission("admin:write"), async (req, res) => {
  const result = await publishEvent("infrastructure.test", {
    workspaceId: req.user.workspaceId,
    requestedBy: req.user.sub,
  });
  res.json({ data: result });
});
