import { Router } from "express";
import mongoose from "mongoose";
import { conversations, dashboardSummary } from "../data/demoData.js";
import { Contact, Conversation, Message } from "../models/index.js";
import { relativeTime } from "../utils/serializers.js";

export const dashboardRouter = Router();

dashboardRouter.get("/summary", async (req, res) => {
  if (mongoose.connection.readyState === 1 && mongoose.Types.ObjectId.isValid(req.user?.workspaceId)) {
    const workspaceId = req.user.workspaceId;
    const now = new Date();
    const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate());

    const [
      openConversations,
      newContactsToday,
      totalConversations,
      resolvedConversations,
      recentConversations,
      inboundMessages,
      outboundMessages,
      pendingWarnings,
    ] = await Promise.all([
      Conversation.countDocuments({ workspaceId, status: "open" }),
      Contact.countDocuments({ workspaceId, createdAt: { $gte: startOfDay } }),
      Conversation.countDocuments({ workspaceId }),
      Conversation.countDocuments({ workspaceId, status: "resolved" }),
      Conversation.find({ workspaceId })
        .populate("contactId")
        .populate("assignedToUserId", "name")
        .populate("lastMessageId")
        .sort({ lastMessageAt: -1, updatedAt: -1 })
        .limit(5),
      Message.countDocuments({ workspaceId, direction: "inbound" }),
      Message.countDocuments({ workspaceId, direction: "outbound" }),
      Conversation.countDocuments({ workspaceId, status: "pending" }),
    ]);

    const resolutionRate = totalConversations ? Math.round((resolvedConversations / totalConversations) * 100) : 0;

    return res.json({
      kpis: [
        { label: "Open conversations", value: String(openConversations), delta: "+0%" },
        { label: "New contacts today", value: String(newContactsToday), delta: "+0%" },
        { label: "Avg. response time", value: "3.4 min", delta: "-0%" },
        { label: "Resolution rate", value: `${resolutionRate}%`, delta: "+0%" },
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
      agentPerformance: [
        { name: "Workspace", resolved: resolvedConversations, avg: 3.4 },
      ],
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
        onlineAgents: 1,
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
      time: `${conversation.time} ago`,
      preview: conversation.preview,
    })),
    health: {
      whatsapp: "connected",
      onlineAgents: 3,
      slaWarnings: 2,
    },
  });
});
