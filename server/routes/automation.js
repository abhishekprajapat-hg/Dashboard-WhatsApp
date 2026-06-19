import { Router } from "express";
import mongoose from "mongoose";
import { AutomationFlow } from "../models/index.js";
import { relativeTime } from "../utils/serializers.js";

export const automationRouter = Router();

function toClientStatus(status) {
  if (status === "published") return "active";
  if (status === "paused") return "inactive";
  return "draft";
}

function toDbStatus(status) {
  if (status === "active") return "published";
  if (status === "inactive") return "paused";
  return "draft";
}

function serializeFlow(flow) {
  return {
    id: flow._id.toString(),
    name: flow.name,
    description: flow.trigger?.description || "",
    trigger: flow.trigger?.label || flow.trigger?.type || "Manual",
    actions: flow.nodes?.length || 0,
    status: toClientStatus(flow.status),
    runs: Number(flow.trigger?.runs || 0),
    lastRun: relativeTime(flow.trigger?.lastRunAt),
    category: flow.trigger?.category || "General",
  };
}

automationRouter.get("/", async (req, res) => {
  if (mongoose.connection.readyState !== 1) {
    return res.json({ data: [], total: 0, summary: { runsToday: 0, automatedMessages: 0, handoffs: 0 } });
  }

  const flows = await AutomationFlow.find({ workspaceId: req.user.workspaceId }).sort({ updatedAt: -1 }).limit(100);
  const runsToday = flows.reduce((sum, flow) => sum + Number(flow.trigger?.runs || 0), 0);

  res.json({
    data: flows.map(serializeFlow),
    total: flows.length,
    summary: {
      runsToday,
      automatedMessages: runsToday,
      handoffs: 0,
    },
  });
});

automationRouter.post("/", async (req, res) => {
  if (mongoose.connection.readyState !== 1) {
    return res.status(503).json({ error: "DATABASE_UNAVAILABLE", message: "MongoDB is required." });
  }

  const {
    name,
    description = "Automation flow",
    trigger = "New conversation",
    category = "General",
    status = "draft",
  } = req.body || {};

  if (!name?.trim()) {
    return res.status(400).json({ error: "VALIDATION_ERROR", message: "Flow name is required." });
  }

  const flow = await AutomationFlow.create({
    organizationId: req.user.organizationId,
    workspaceId: req.user.workspaceId,
    name: name.trim(),
    trigger: {
      type: trigger.toLowerCase().replace(/\s+/g, "_"),
      label: trigger,
      description,
      category,
      runs: 0,
    },
    nodes: [{ id: "trigger", type: "trigger" }, { id: "reply", type: "send_message" }],
    edges: [{ source: "trigger", target: "reply" }],
    status: toDbStatus(status),
    publishedAt: status === "active" ? new Date() : undefined,
    createdBy: req.user.sub,
    updatedBy: req.user.sub,
  });

  res.status(201).json({ data: serializeFlow(flow) });
});

automationRouter.patch("/:id", async (req, res) => {
  if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
    return res.status(404).json({ error: "NOT_FOUND", message: "Flow not found." });
  }

  const updates = { updatedBy: req.user.sub };
  if (req.body?.name) updates.name = req.body.name.trim();
  if (req.body?.status) {
    updates.status = toDbStatus(req.body.status);
    if (updates.status === "published") updates.publishedAt = new Date();
  }

  const flow = await AutomationFlow.findOneAndUpdate(
    { _id: req.params.id, workspaceId: req.user.workspaceId },
    updates,
    { new: true }
  );

  if (!flow) return res.status(404).json({ error: "NOT_FOUND", message: "Flow not found." });
  res.json({ data: serializeFlow(flow) });
});

automationRouter.delete("/:id", async (req, res) => {
  if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
    return res.status(404).json({ error: "NOT_FOUND", message: "Flow not found." });
  }

  const flow = await AutomationFlow.findOneAndDelete({ _id: req.params.id, workspaceId: req.user.workspaceId });
  if (!flow) return res.status(404).json({ error: "NOT_FOUND", message: "Flow not found." });
  res.sendStatus(204);
});
