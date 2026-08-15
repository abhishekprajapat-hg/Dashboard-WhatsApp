import { Router } from "express";
import mongoose from "mongoose";
import { z } from "zod";
import { requirePermission } from "../middleware/auth.js";
import { validateBody, validateQuery } from "../middleware/validate.js";
import { Task } from "../models/index.js";
import { optionalDateString, optionalObjectIdString, trimmedString } from "../utils/zodHelpers.js";

export const tasksRouter = Router();

const listTasksQuerySchema = z.object({
  status: z.enum(["open", "completed", ""]).optional().default(""),
  assignedToUserId: optionalObjectIdString,
});

const taskBodySchema = z.object({
  title: trimmedString("Title is required."),
  description: z.string().optional().default(""),
  dueAt: optionalDateString(),
  assignedToUserId: optionalObjectIdString,
  contactId: optionalObjectIdString,
  conversationId: optionalObjectIdString,
});

const patchTaskSchema = taskBodySchema.partial().extend({
  status: z.enum(["open", "completed"]).optional(),
});

function serializeTask(task) {
  return {
    id: task._id.toString(),
    title: task.title,
    description: task.description || "",
    status: task.status,
    dueAt: task.dueAt,
    assignedToUserId: task.assignedToUserId?._id
      ? { id: task.assignedToUserId._id.toString(), name: task.assignedToUserId.name }
      : null,
    contactId: task.contactId ? task.contactId.toString() : null,
    conversationId: task.conversationId ? task.conversationId.toString() : null,
    source: task.source || "manual",
    createdAt: task.createdAt,
    updatedAt: task.updatedAt,
  };
}

tasksRouter.get("/", requirePermission("tasks:read"), validateQuery(listTasksQuerySchema), async (req, res) => {
  if (mongoose.connection.readyState !== 1) {
    return res.json({ data: [], total: 0 });
  }

  const filter = { workspaceId: req.user.workspaceId };
  if (req.query.status) filter.status = req.query.status;
  if (req.query.assignedToUserId) filter.assignedToUserId = req.query.assignedToUserId;

  const tasks = await Task.find(filter)
    .populate("assignedToUserId", "name")
    .sort({ status: 1, dueAt: 1, createdAt: -1 });

  res.json({ data: tasks.map(serializeTask), total: tasks.length });
});

tasksRouter.post("/", requirePermission("tasks:write"), validateBody(taskBodySchema), async (req, res) => {
  if (mongoose.connection.readyState !== 1) {
    return res.status(503).json({ error: "DATABASE_UNAVAILABLE", message: "MongoDB is required." });
  }

  const task = await Task.create({
    organizationId: req.user.organizationId,
    workspaceId: req.user.workspaceId,
    title: req.body.title,
    description: req.body.description,
    dueAt: req.body.dueAt || null,
    assignedToUserId: req.body.assignedToUserId || null,
    contactId: req.body.contactId || null,
    conversationId: req.body.conversationId || null,
    source: "manual",
  });

  await task.populate("assignedToUserId", "name");
  res.status(201).json({ data: serializeTask(task) });
});

tasksRouter.patch("/:id", requirePermission("tasks:write"), validateBody(patchTaskSchema), async (req, res) => {
  if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
    return res.status(404).json({ error: "NOT_FOUND", message: "Task not found." });
  }

  const task = await Task.findOne({ _id: req.params.id, workspaceId: req.user.workspaceId });
  if (!task) return res.status(404).json({ error: "NOT_FOUND", message: "Task not found." });

  const nullableFields = ["dueAt", "assignedToUserId", "contactId", "conversationId"];
  for (const field of nullableFields) {
    if (req.body[field] === undefined) continue;
    task[field] = req.body[field] || null;
  }

  if (req.body.title !== undefined) task.title = req.body.title;
  if (req.body.description !== undefined) task.description = req.body.description;
  if (req.body.status !== undefined) task.status = req.body.status;

  await task.save();
  await task.populate("assignedToUserId", "name");
  res.json({ data: serializeTask(task) });
});

tasksRouter.delete("/:id", requirePermission("tasks:write"), async (req, res) => {
  if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
    return res.status(404).json({ error: "NOT_FOUND", message: "Task not found." });
  }

  const task = await Task.findOneAndDelete({ _id: req.params.id, workspaceId: req.user.workspaceId });
  if (!task) return res.status(404).json({ error: "NOT_FOUND", message: "Task not found." });
  res.sendStatus(204);
});
