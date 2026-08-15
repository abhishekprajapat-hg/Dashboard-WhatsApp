import { Router } from "express";
import mongoose from "mongoose";
import { z } from "zod";
import { demoWorkspace } from "../data/demoData.js";
import { requirePermission } from "../middleware/auth.js";
import { validateBody } from "../middleware/validate.js";
import { Membership, Organization, Role, Workspace } from "../models/index.js";
import { roleDefinitionFor } from "../utils/rbac.js";
import { serializeWorkspace } from "../utils/session.js";
import { trimmedString } from "../utils/zodHelpers.js";

export const workspaceRouter = Router();

export const createWorkspaceSchema = z.object({
  name: trimmedString("Workspace name is required."),
  businessCategory: z.string().trim().optional().default("Support"),
  timezone: z.string().trim().optional().default("UTC"),
});

export const updateWorkspaceSchema = z.object({
  name: z.string().trim().optional(),
  timezone: z.string().trim().optional(),
  businessCategory: z.string().trim().optional(),
});

workspaceRouter.get("/current", requirePermission("settings:read"), async (req, res) => {
  if (mongoose.connection.readyState === 1 && req.user?.workspaceId) {
    const workspace = await Workspace.findOne({ _id: req.user.workspaceId, organizationId: req.user.organizationId });

    if (!workspace) {
      return res.status(404).json({ error: "NOT_FOUND", message: "Workspace not found." });
    }

    return res.json({ workspace: serializeWorkspace(workspace) });
  }

  res.json({ workspace: demoWorkspace });
});

workspaceRouter.post("/", requirePermission("admin:write"), validateBody(createWorkspaceSchema), async (req, res) => {
  if (mongoose.connection.readyState !== 1) {
    return res.status(503).json({ error: "DATABASE_UNAVAILABLE", message: "MongoDB is required to create workspaces." });
  }

  const { name, businessCategory, timezone } = req.body;
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
    key: "admin",
    ...roleDefinitionFor("admin"),
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

workspaceRouter.put("/current", requirePermission("settings:write"), validateBody(updateWorkspaceSchema), async (req, res) => {
  if (mongoose.connection.readyState !== 1 || !req.user?.workspaceId) {
    return res.status(503).json({ error: "DATABASE_UNAVAILABLE", message: "MongoDB is required to update workspaces." });
  }

  const { name, timezone, businessCategory } = req.body;
  const updates = {};
  if (name?.trim()) {
    updates.name = name.trim();
    updates.slug = name.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "workspace";
  }
  if (timezone?.trim()) updates.timezone = timezone.trim();
  if (businessCategory?.trim()) updates.businessCategory = businessCategory.trim();

  const workspace = await Workspace.findOneAndUpdate(
    { _id: req.user.workspaceId, organizationId: req.user.organizationId },
    updates,
    { new: true }
  );

  if (!workspace) {
    return res.status(404).json({ error: "NOT_FOUND", message: "Workspace not found." });
  }

  res.json({ workspace: serializeWorkspace(workspace) });
});
