import express from "express";
import { config } from "./config.js";
import { connectDatabase } from "./db.js";
import { requireAuth } from "./middleware/auth.js";
import { authRouter } from "./routes/auth.js";
import { automationRouter } from "./routes/automation.js";
import { campaignsRouter } from "./routes/campaigns.js";
import { contactsRouter } from "./routes/contacts.js";
import { conversationsRouter } from "./routes/conversations.js";
import { dashboardRouter } from "./routes/dashboard.js";
import { settingsRouter } from "./routes/settings.js";
import { teamRouter } from "./routes/team.js";
import { whatsappRouter, whatsappWebhookRouter } from "./routes/whatsapp.js";
import { workspaceRouter } from "./routes/workspace.js";
import { eventsRouter } from "./realtime/events.js";

const app = express();

app.use(express.json({ limit: "1mb" }));
app.use((req, res, next) => {
  res.setHeader("Access-Control-Allow-Origin", req.headers.origin || "*");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, PUT, PATCH, DELETE, OPTIONS");
  if (req.method === "OPTIONS") {
    return res.sendStatus(204);
  }
  next();
});

app.get("/health", (_req, res) => {
  res.json({ ok: true, service: "whatscrm-api", demoMode: config.demoMode });
});

app.use("/api/auth", authRouter);
app.use("/api/workspaces", requireAuth, workspaceRouter);
app.use("/api/dashboard", requireAuth, dashboardRouter);
app.use("/api/contacts", requireAuth, contactsRouter);
app.use("/api/conversations", requireAuth, conversationsRouter);
app.use("/api/campaigns", requireAuth, campaignsRouter);
app.use("/api/automation", requireAuth, automationRouter);
app.use("/api/team", requireAuth, teamRouter);
app.use("/api/events", eventsRouter);
app.use("/api/settings", requireAuth, settingsRouter);
app.use("/api/whatsapp", whatsappRouter);
app.use("/webhooks/whatsapp", whatsappWebhookRouter);

app.use((req, res) => {
  res.status(404).json({ error: "NOT_FOUND", message: `No route for ${req.method} ${req.path}` });
});

connectDatabase()
  .then(() => {
    app.listen(config.port, () => {
      console.log(`WhatsCRM API listening on http://localhost:${config.port}`);
    });
  })
  .catch((error) => {
    console.error("Failed to start API server.", error);
    process.exit(1);
  });
