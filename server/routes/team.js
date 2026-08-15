import { Router } from "express";
import mongoose from "mongoose";
import { z } from "zod";
import { Conversation, Membership, Role, User } from "../models/index.js";
import { hasPermission, requirePermission } from "../middleware/auth.js";
import { validateBody } from "../middleware/validate.js";
import { hashPassword } from "../utils/password.js";
import { normalizeRoleKey, roleDefinitionFor } from "../utils/rbac.js";
import { relativeTime } from "../utils/serializers.js";
import { isEmail, passwordPolicy, requiredString } from "../utils/validation.js";

export const teamRouter = Router();

export const updateMemberSchema = z.object({
  role: z.string().trim().optional(),
});

function initials(name) {
  return name
    .split(" ")
    .map((part) => part[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();
}

function roleKeyToClient(key = "agent") {
  return normalizeRoleKey(key);
}

async function ensureRole({ organizationId, workspaceId, key }) {
  const normalized = normalizeRoleKey(key);
  const next = roleDefinitionFor(normalized);
  return Role.findOneAndUpdate(
    { workspaceId, key: normalized },
    { organizationId, workspaceId, key: normalized, ...next, isSystemRole: true },
    { upsert: true, new: true, setDefaultsOnInsert: true }
  );
}

function serializeMember(membership, metrics = {}) {
  const user = membership.userId || {};
  const role = membership.roleId || {};

  return {
    id: membership._id.toString(),
    userId: user._id?.toString(),
    name: user.name || "Invited user",
    email: user.email || "",
    role: roleKeyToClient(role.key),
    status: user.status === "active" ? "online" : "offline",
    assignedConversations: metrics.assignedConversations || 0,
    resolvedToday: metrics.resolvedToday || 0,
    joinedAt: membership.joinedAt ? membership.joinedAt.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }) : "Invited",
    lastActive: user.lastLoginAt ? relativeTime(user.lastLoginAt) : "Never",
    avatar: initials(user.name || user.email || "U"),
  };
}

teamRouter.get("/", requirePermission("team:read"), async (req, res) => {
  if (mongoose.connection.readyState !== 1) {
    return res.json({ data: [], total: 0 });
  }

  const memberships = await Membership.find({ workspaceId: req.user.workspaceId })
    .populate("userId")
    .populate("roleId")
    .sort({ createdAt: 1 });

  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const userIds = memberships.map((membership) => membership.userId?._id).filter(Boolean);
  const [assignedCounts, resolvedCounts] = await Promise.all([
    Conversation.aggregate([
      { $match: { workspaceId: new mongoose.Types.ObjectId(req.user.workspaceId), assignedToUserId: { $in: userIds }, status: { $ne: "archived" } } },
      { $group: { _id: "$assignedToUserId", count: { $sum: 1 } } },
    ]),
    Conversation.aggregate([
      { $match: { workspaceId: new mongoose.Types.ObjectId(req.user.workspaceId), assignedToUserId: { $in: userIds }, status: "resolved", updatedAt: { $gte: today } } },
      { $group: { _id: "$assignedToUserId", count: { $sum: 1 } } },
    ]),
  ]);
  const assignedMap = new Map(assignedCounts.map((item) => [item._id.toString(), item.count]));
  const resolvedMap = new Map(resolvedCounts.map((item) => [item._id.toString(), item.count]));
  const data = memberships.map((membership) => {
    const key = membership.userId?._id?.toString?.() || "";
    return serializeMember(membership, {
      assignedConversations: assignedMap.get(key) || 0,
      resolvedToday: resolvedMap.get(key) || 0,
    });
  });

  res.json({ data, total: memberships.length });
});

teamRouter.post("/", requirePermission("team:write"), async (req, res) => {
  if (mongoose.connection.readyState !== 1) {
    return res.status(503).json({ error: "DATABASE_UNAVAILABLE", message: "MongoDB is required." });
  }

  const { name, email, role = "agent", password = "" } = req.body || {};
  const normalizedEmail = String(email || "").toLowerCase().trim();
  if (!isEmail(normalizedEmail)) {
    return res.status(400).json({ error: "VALIDATION_ERROR", message: "A valid email is required." });
  }
  const passwordCheck = passwordPolicy(password);
  if (!passwordCheck.valid) {
    return res.status(400).json({ error: "VALIDATION_ERROR", message: passwordCheck.message });
  }

  const roleDoc = await ensureRole({
    organizationId: req.user.organizationId,
    workspaceId: req.user.workspaceId,
    key: role,
  });

  const user = await User.findOneAndUpdate(
    { email: normalizedEmail },
    {
      name: requiredString(name, 120) || normalizedEmail.split("@")[0],
      email: normalizedEmail,
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

teamRouter.patch("/:id", requirePermission("team:write"), validateBody(updateMemberSchema), async (req, res) => {
  if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
    return res.status(404).json({ error: "NOT_FOUND", message: "Member not found." });
  }

  const membership = await Membership.findOne({ _id: req.params.id, workspaceId: req.user.workspaceId });
  if (!membership) return res.status(404).json({ error: "NOT_FOUND", message: "Member not found." });

  if (req.body?.role) {
    const roleDoc = await Role.findOne({
      workspaceId: req.user.workspaceId,
      key: normalizeRoleKey(req.body.role),
    });
    if (roleDoc) membership.roleId = roleDoc._id;
    else membership.roleId = (await ensureRole({ organizationId: req.user.organizationId, workspaceId: req.user.workspaceId, key: req.body.role }))._id;
  }

  await membership.save();
  await membership.populate("userId");
  await membership.populate("roleId");
  res.json({ data: serializeMember(membership) });
});

teamRouter.delete("/:id", requirePermission("team:write"), async (req, res) => {
  if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
    return res.status(404).json({ error: "NOT_FOUND", message: "Member not found." });
  }

  const membership = await Membership.findOneAndDelete({ _id: req.params.id, workspaceId: req.user.workspaceId });
  if (!membership) return res.status(404).json({ error: "NOT_FOUND", message: "Member not found." });
  res.sendStatus(204);
});

