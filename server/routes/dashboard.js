import { Router } from "express";
import mongoose from "mongoose";
import { conversations, dashboardSummary } from "../data/demoData.js";
import { Contact, Conversation, Membership, Message } from "../models/index.js";
import { hasPermission, requirePermission } from "../middleware/auth.js";
import { relativeTime } from "../utils/serializers.js";

export const dashboardRouter = Router();

function startOfToday() {
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth(), now.getDate());
}

async function getTeamWorkload(workspaceId, today) {
  const memberships = await Membership.find({ workspaceId, status: "active" })
    .populate("userId", "name email status lastLoginAt")
    .populate("roleId", "key name")
    .sort({ createdAt: 1 });
  const userIds = memberships.map((membership) => membership.userId?._id).filter(Boolean);

  const [assignedCounts, openCounts, resolvedCounts] = await Promise.all([
    Conversation.aggregate([
      { $match: { workspaceId: new mongoose.Types.ObjectId(workspaceId), assignedToUserId: { $in: userIds }, status: { $ne: "archived" } } },
      { $group: { _id: "$assignedToUserId", count: { $sum: 1 } } },
    ]),
    Conversation.aggregate([
      { $match: { workspaceId: new mongoose.Types.ObjectId(workspaceId), assignedToUserId: { $in: userIds }, status: { $in: ["open", "pending"] } } },
      { $group: { _id: "$assignedToUserId", count: { $sum: 1 } } },
    ]),
    Conversation.aggregate([
      { $match: { workspaceId: new mongoose.Types.ObjectId(workspaceId), assignedToUserId: { $in: userIds }, status: "resolved", updatedAt: { $gte: today } } },
      { $group: { _id: "$assignedToUserId", count: { $sum: 1 } } },
    ]),
  ]);

  const assignedMap = new Map(assignedCounts.map((item) => [item._id.toString(), item.count]));
  const openMap = new Map(openCounts.map((item) => [item._id.toString(), item.count]));
  const resolvedMap = new Map(resolvedCounts.map((item) => [item._id.toString(), item.count]));

  return memberships.map((membership) => {
    const user = membership.userId || {};
    const key = user._id?.toString?.() || "";
    return {
      userId: key,
      name: user.name || user.email || "Team member",
      role: membership.roleId?.key === "workspace_admin" ? "admin" : membership.roleId?.key || "agent",
      status: user.status === "active" ? "online" : "offline",
      assigned: assignedMap.get(key) || 0,
      open: openMap.get(key) || 0,
      resolvedToday: resolvedMap.get(key) || 0,
      lastActive: relativeTime(user.lastLoginAt),
    };
  });
}

dashboardRouter.get("/summary", requirePermission("dashboard:read"), async (req, res) => {
  if (mongoose.connection.readyState === 1 && mongoose.Types.ObjectId.isValid(req.user?.workspaceId)) {
    const workspaceId = req.user.workspaceId;
    const today = startOfToday();
    const canMonitorTeam = hasPermission(req.user, "reports:read");
    const visibilityFilter = canMonitorTeam
      ? { workspaceId }
      : { workspaceId, $or: [{ assignedToUserId: req.user.sub }, { assignedToUserId: mongoose.trusted({ $exists: false }) }, { assignedToUserId: null }] };

    const [
      openConversations,
      newContactsToday,
      totalConversations,
      resolvedConversations,
      recentConversations,
      inboundMessages,
      outboundMessages,
      pendingWarnings,
      teamWorkload,
    ] = await Promise.all([
      Conversation.countDocuments({ ...visibilityFilter, status: "open" }),
      Contact.countDocuments({ workspaceId, createdAt: mongoose.trusted({ $gte: today }) }),
      Conversation.countDocuments(visibilityFilter),
      Conversation.countDocuments({ ...visibilityFilter, status: "resolved" }),
      Conversation.find(visibilityFilter)
        .populate("contactId")
        .populate("assignedToUserId", "name")
        .populate("lastMessageId")
        .sort({ lastMessageAt: -1, updatedAt: -1 })
        .limit(5),
      Message.countDocuments({ workspaceId, direction: "inbound" }),
      Message.countDocuments({ workspaceId, direction: "outbound" }),
      Conversation.countDocuments({ ...visibilityFilter, status: "pending" }),
      canMonitorTeam ? getTeamWorkload(workspaceId, today) : Promise.resolve([]),
    ]);

    const resolutionRate = totalConversations ? Math.round((resolvedConversations / totalConversations) * 100) : 0;

    return res.json({
      kpis: [
        { label: "Open conversations", value: String(openConversations), delta: "+0%" },
        { label: "New contacts today", value: String(newContactsToday), delta: "+0%" },
        { label: "Avg. response time", value: "3.4 min", delta: "-0%" },
        { label: "Resolution rate", value: String(resolutionRate) + "%", delta: "+0%" },
      ],
      messageVolume: [
        { day: "Mon", inbound: 0, outbound: 0 },
        { day: "Tue", inbound: 0, outbound: 0 },
        { day: "Wed", inbound: 0, outbound: 0 },
        { day: "Thu", inbound: 0, outbound: 0 },
        { day: "Fri", inbound: inboundMessages, outbound: outboundMessages },
        { day: "Sat", inbound: 0, outbound: 0 },
        { day: "Sun", inbound: 0, outbound: 0 },
      ],
      agentPerformance: teamWorkload.length
        ? teamWorkload.map((member) => ({ name: member.name.split(" ")[0], resolved: member.resolvedToday, avg: member.open }))
        : [{ name: "Workspace", resolved: resolvedConversations, avg: 3.4 }],
      teamWorkload,
      recentConversations: recentConversations.map((conversation) => ({
        name: conversation.contactId?.name || "Unknown contact",
        phone: conversation.contactId?.phone || "",
        status: conversation.status === "pending" ? "waiting" : conversation.status,
        agent: conversation.assignedToUserId?.name || "Unassigned",
        time: relativeTime(conversation.lastMessageAt || conversation.updatedAt),
        preview: conversation.lastMessageId?.body || "No messages yet",
      })),
      health: {
        whatsapp: "connected",
        onlineAgents: teamWorkload.length ? teamWorkload.filter((member) => member.status === "online").length : 1,
        slaWarnings: pendingWarnings,
      },
    });
  }

  res.json({
    ...dashboardSummary,
    recentConversations: conversations.map((conversation) => ({
      name: conversation.name,
      phone: conversation.phone,
      status: conversation.status,
      agent: conversation.agent || "Unassigned",
      time: String(conversation.time) + " ago",
      preview: conversation.preview,
    })),
    health: {
      whatsapp: "connected",
      onlineAgents: 3,
      slaWarnings: 2,
    },
  });
});
