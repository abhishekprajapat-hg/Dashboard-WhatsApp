import express from "express";
import helmet from "helmet";
import http from "http";
import { config, validateProductionConfig } from "./config.js";
import { connectDatabase } from "./db.js";
import { auditMiddleware } from "./middleware/audit.js";
import { requireAuth } from "./middleware/auth.js";
import { requireWorkspaceContext } from "./middleware/workspace.js";
import { rateLimiter } from "./middleware/rateLimiter.js";
import { authRouter } from "./routes/auth.js";
import { analyticsRouter } from "./routes/analytics.js";
import { adminRouter } from "./routes/admin.js";
import { assistantRouter } from "./routes/assistant.js";
import { automationRouter } from "./routes/automation.js";
import { calendarEventsRouter } from "./routes/calendarEvents.js";
import { campaignsRouter } from "./routes/campaigns.js";
import { contactsRouter } from "./routes/contacts.js";
import { conversationsRouter } from "./routes/conversations.js";
import { dashboardRouter } from "./routes/dashboard.js";
import { settingsRouter } from "./routes/settings.js";
import { tasksRouter } from "./routes/tasks.js";
import { teamRouter } from "./routes/team.js";
import { templatesRouter } from "./routes/templates.js";
import { mediaRouter } from "./routes/media.js";
import { infrastructureRouter } from "./routes/infrastructure.js";
import { legalRouter } from "./routes/legal.js";
import { whatsappRouter, whatsappWebhookRouter } from "./routes/whatsapp.js";
import { workspaceRouter } from "./routes/workspace.js";
import { eventsRouter } from "./realtime/events.js";
import { createRealtimeServer } from "./realtime/socket.js";
import { connectRedis } from "./services/cache.js";
import { loadFeatureFlagsFromDb } from "./services/featureFlags.js";
import { healthSnapshot } from "./services/health.js";
import { startWorkers } from "./services/jobs.js";
import { uploadRoot } from "./services/mediaStorage.js";
import { connectRabbitMQ } from "./services/messageBus.js";
import { metricsContentType, metricsMiddleware, metricsText } from "./services/monitoring.js";
import { shutdownTelemetry, startTelemetry } from "./services/telemetry.js";

const app = express();
const httpServer = http.createServer(app);
createRealtimeServer(httpServer);
validateProductionConfig();
startTelemetry();

app.set("trust proxy", 1);
app.use(helmet({
  crossOriginResourcePolicy: { policy: "cross-origin" },
  contentSecurityPolicy: false,
}));
app.use(express.json({
  limit: "16mb",
  verify: (req, _res, buffer) => {
    req.rawBody = buffer;
  },
}));
app.use(express.urlencoded({ extended: false }));
app.use((req, res, next) => {
  const origin = req.headers.origin || "";
  const allowOrigin = !config.corsOrigins.length || config.corsOrigins.includes(origin) ? origin || "*" : config.corsOrigins[0];
  res.setHeader("Access-Control-Allow-Origin", allowOrigin);
  res.setHeader("Vary", "Origin");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, PUT, PATCH, DELETE, OPTIONS");
  if (req.method === "OPTIONS") {
    return res.sendStatus(204);
  }
  next();
});
app.use(rateLimiter());
app.use(metricsMiddleware);
app.use(auditMiddleware);

app.get("/health", (_req, res) => {
  res.json({ ok: true, service: "whatscrm-api", demoMode: config.demoMode });
});
app.get("/ready", async (_req, res) => {
  const health = await healthSnapshot();
  res.status(health.ok ? 200 : 503).json(health);
});
app.get("/metrics", async (_req, res) => {
  res.setHeader("Content-Type", metricsContentType());
  res.send(await metricsText());
});
app.use("/legal", legalRouter);

app.use("/api/auth", authRouter);
app.use("/api/analytics", requireAuth, requireWorkspaceContext, analyticsRouter);
app.use("/api/admin", requireAuth, requireWorkspaceContext, adminRouter);
app.use("/api/assistant", requireAuth, requireWorkspaceContext, assistantRouter);
app.use("/api/infrastructure", requireAuth, requireWorkspaceContext, infrastructureRouter);
app.use("/api/workspaces", requireAuth, requireWorkspaceContext, workspaceRouter);
app.use("/api/dashboard", requireAuth, requireWorkspaceContext, dashboardRouter);
app.use("/api/contacts", requireAuth, requireWorkspaceContext, contactsRouter);
app.use("/api/conversations", requireAuth, requireWorkspaceContext, conversationsRouter);
app.use("/api/campaigns", requireAuth, requireWorkspaceContext, campaignsRouter);
app.use("/api/automation", requireAuth, requireWorkspaceContext, automationRouter);
app.use("/api/team", requireAuth, requireWorkspaceContext, teamRouter);
app.use("/api/tasks", requireAuth, requireWorkspaceContext, tasksRouter);
app.use("/api/calendar-events", requireAuth, requireWorkspaceContext, calendarEventsRouter);
app.use("/api/templates", requireAuth, requireWorkspaceContext, templatesRouter);
app.use("/api/events", eventsRouter);
app.use("/api/settings", requireAuth, requireWorkspaceContext, settingsRouter);
app.use("/api/media", requireAuth, requireWorkspaceContext, mediaRouter);
app.use("/api/whatsapp", whatsappRouter);
app.use("/webhooks/whatsapp", whatsappWebhookRouter);
app.use("/api/uploads", express.static(uploadRoot, {
  maxAge: "7d",
  immutable: true,
}));
app.use("/uploads", express.static(uploadRoot, {
  maxAge: "7d",
  immutable: true,
}));

app.use((req, res) => {
  res.status(404).json({ error: "NOT_FOUND", message: `No route for ${req.method} ${req.path}` });
});

app.use((error, _req, res, _next) => {
  console.error(error);
  res.status(500).json({ error: "SERVER_ERROR", message: "Something went wrong." });
});

connectDatabase()
  .then(async () => {
    await loadFeatureFlagsFromDb();
    await connectRedis();
    await connectRabbitMQ();
    startWorkers();
    httpServer.on("error", (error) => {
      if (error.code === "EADDRINUSE") {
        console.error(`Port ${config.port} is already in use. Stop the existing server or run with PORT=<free-port>.`);
        process.exit(1);
      }
      throw error;
    });
    httpServer.listen(config.port, () => {
      console.log(`WhatsCRM API listening on http://localhost:${config.port}`);
    });
  })
  .catch((error) => {
    console.error("Failed to start API server.", error);
    process.exit(1);
  });

async function shutdown(signal) {
  console.log(`${signal} received. Draining server...`);
  httpServer.close(async () => {
    await shutdownTelemetry().catch(() => undefined);
    process.exit(0);
  });
  setTimeout(() => process.exit(1), 30000).unref();
}

process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));

