import { Router } from "express";
import mongoose from "mongoose";
import { demoWorkspace } from "../data/demoData.js";
import { Membership, Organization, Role, Workspace } from "../models/index.js";
import { serializeWorkspace } from "../utils/session.js";

export const workspaceRouter = Router();

workspaceRouter.get("/current", async (req, res) => {
  if (mongoose.connection.readyState === 1 && req.user?.workspaceId) {
    const workspace = await Workspace.findById(req.user.workspaceId);

    if (!workspace) {
      return res.status(404).json({ error: "NOT_FOUND", message: "Workspace not found." });
    }

    return res.json({ workspace: serializeWorkspace(workspace) });
  }

  res.json({ workspace: demoWorkspace });
});

workspaceRouter.post("/", async (req, res) => {
  if (mongoose.connection.readyState !== 1) {
    return res.status(503).json({ error: "DATABASE_UNAVAILABLE", message: "MongoDB is required to create workspaces." });
  }

  const { name, businessCategory = "Support", timezone = "UTC" } = req.body || {};

  if (!name?.trim()) {
    return res.status(400).json({ error: "VALIDATION_ERROR", message: "Workspace name is required." });
  }

  const slug = name.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  const organization = await Organization.create({
    name: name.trim(),
    slug: `${slug}-${Date.now()}`,
    ownerUserId: req.user.sub,
  });

  const workspace = await Workspace.create({
    organizationId: organization._id,
    name: name.trim(),
    slug,
    timezone,
    businessCategory,
    settings: { whatsappHealth: "disconnected" },
  });

  const role = await Role.create({
    organizationId: organization._id,
    workspaceId: workspace._id,
    name: "Workspace Admin",
    key: "workspace_admin",
    permissions: ["*"],
    isSystemRole: true,
  });

  await Membership.create({
    organizationId: organization._id,
    workspaceId: workspace._id,
    userId: req.user.sub,
    roleId: role._id,
    status: "active",
    joinedAt: new Date(),
  });

  res.status(201).json({ workspace: serializeWorkspace(workspace) });
});

workspaceRouter.put("/current", async (req, res) => {
  if (mongoose.connection.readyState !== 1 || !req.user?.workspaceId) {
    return res.status(503).json({ error: "DATABASE_UNAVAILABLE", message: "MongoDB is required to update workspaces." });
  }

  const { name, timezone, businessCategory } = req.body || {};
  const updates = {};
  if (name?.trim()) {
    updates.name = name.trim();
    updates.slug = name.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "workspace";
  }
  if (timezone?.trim()) updates.timezone = timezone.trim();
  if (businessCategory?.trim()) updates.businessCategory = businessCategory.trim();

  const workspace = await Workspace.findOneAndUpdate(
    { _id: req.user.workspaceId },
    updates,
    { new: true }
  );

  if (!workspace) {
    return res.status(404).json({ error: "NOT_FOUND", message: "Workspace not found." });
  }

  res.json({ workspace: serializeWorkspace(workspace) });
});
