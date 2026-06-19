import { Router } from "express";
import mongoose from "mongoose";
import { Membership, Role, User } from "../models/index.js";
import { hashPassword } from "../utils/password.js";
import { relativeTime } from "../utils/serializers.js";

export const teamRouter = Router();

function initials(name) {
  return name
    .split(" ")
    .map((part) => part[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();
}

function serializeMember(membership) {
  const user = membership.userId || {};
  const role = membership.roleId || {};

  return {
    id: membership._id.toString(),
    userId: user._id?.toString(),
    name: user.name || "Invited user",
    email: user.email || "",
    role: role.key === "workspace_admin" ? "admin" : role.key || "agent",
    status: user.status === "active" ? "online" : "offline",
    assignedConversations: 0,
    resolvedToday: 0,
    joinedAt: membership.joinedAt ? membership.joinedAt.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }) : "Invited",
    lastActive: user.lastLoginAt ? relativeTime(user.lastLoginAt) : "Never",
    avatar: initials(user.name || user.email || "U"),
  };
}

teamRouter.get("/", async (req, res) => {
  if (mongoose.connection.readyState !== 1) {
    return res.json({ data: [], total: 0 });
  }

  const memberships = await Membership.find({ workspaceId: req.user.workspaceId })
    .populate("userId")
    .populate("roleId")
    .sort({ createdAt: 1 });

  res.json({ data: memberships.map(serializeMember), total: memberships.length });
});

teamRouter.post("/", async (req, res) => {
  if (mongoose.connection.readyState !== 1) {
    return res.status(503).json({ error: "DATABASE_UNAVAILABLE", message: "MongoDB is required." });
  }

  const { name, email, role = "agent", password = "123456" } = req.body || {};
  if (!email?.trim()) {
    return res.status(400).json({ error: "VALIDATION_ERROR", message: "Email is required." });
  }

  const roleDoc = await Role.findOne({
    workspaceId: req.user.workspaceId,
    key: role === "admin" ? "workspace_admin" : "agent",
  });
  if (!roleDoc) return res.status(400).json({ error: "ROLE_NOT_FOUND", message: "Role is not available." });

  const user = await User.findOneAndUpdate(
    { email: email.toLowerCase().trim() },
    {
      name: name?.trim() || email.split("@")[0],
      email: email.toLowerCase().trim(),
      passwordHash: hashPassword(password),
      status: "active",
    },
    { upsert: true, new: true, setDefaultsOnInsert: true }
  );

  const membership = await Membership.findOneAndUpdate(
    { workspaceId: req.user.workspaceId, userId: user._id },
    {
      organizationId: req.user.organizationId,
      workspaceId: req.user.workspaceId,
      userId: user._id,
      roleId: roleDoc._id,
      status: "active",
      invitedBy: req.user.sub,
      invitedAt: new Date(),
      joinedAt: new Date(),
    },
    { upsert: true, new: true, setDefaultsOnInsert: true }
  )
    .populate("userId")
    .populate("roleId");

  res.status(201).json({ data: serializeMember(membership) });
});

teamRouter.patch("/:id", async (req, res) => {
  if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
    return res.status(404).json({ error: "NOT_FOUND", message: "Member not found." });
  }

  const membership = await Membership.findOne({ _id: req.params.id, workspaceId: req.user.workspaceId });
  if (!membership) return res.status(404).json({ error: "NOT_FOUND", message: "Member not found." });

  if (req.body?.role) {
    const roleDoc = await Role.findOne({
      workspaceId: req.user.workspaceId,
      key: req.body.role === "admin" ? "workspace_admin" : "agent",
    });
    if (roleDoc) membership.roleId = roleDoc._id;
  }

  await membership.save();
  await membership.populate("userId");
  await membership.populate("roleId");
  res.json({ data: serializeMember(membership) });
});

teamRouter.delete("/:id", async (req, res) => {
  if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
    return res.status(404).json({ error: "NOT_FOUND", message: "Member not found." });
  }

  const membership = await Membership.findOneAndDelete({ _id: req.params.id, workspaceId: req.user.workspaceId });
  if (!membership) return res.status(404).json({ error: "NOT_FOUND", message: "Member not found." });
  res.sendStatus(204);
});
