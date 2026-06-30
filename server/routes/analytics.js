import { Router } from "express";
import mongoose from "mongoose";
import { AutomationFlow, Campaign, Contact, Conversation, Membership, Message, WebhookEvent } from "../models/index.js";

export const analyticsRouter = Router();

function daysAgo(days) {
  const date = new Date();
  date.setDate(date.getDate() - days);
  date.setHours(0, 0, 0, 0);
  return date;
}

function dayKey(date) {
  return new Date(date).toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

function percent(part, total) {
  return total ? Math.round((part / total) * 100) : 0;
}

analyticsRouter.get("/summary", async (req, res) => {
  if (mongoose.connection.readyState !== 1 || !mongoose.Types.ObjectId.isValid(req.user?.workspaceId)) {
    return res.json({
      kpis: [],
      messageVolume: [],
      agentPerformance: [],
      sourceBreakdown: [],
      campaignPerformance: [],
      automationPerformance: [],
      deliveryFailures: [],
      webhookHealth: { processed: 0, failed: 0, failureRate: 0 },
    });
  }

  const workspaceId = new mongoose.Types.ObjectId(req.user.workspaceId);
  const since = daysAgo(Number(req.query.days || 14));
  const today = daysAgo(0);

  const [
    totalMessages,
    inboundMessages,
    outboundMessages,
    failedMessages,
    newContacts,
    totalConversations,
    resolvedConversations,
    dailyMessages,
    sourceCounts,
    campaigns,
    automations,
    memberships,
    assignedCounts,
    assignedResolved,
    webhookCounts,
    deliveryFailures,
  ] = await Promise.all([
    Message.countDocuments({ workspaceId, createdAt: { $gte: since } }),
    Message.countDocuments({ workspaceId, direction: "inbound", createdAt: { $gte: since } }),
    Message.countDocuments({ workspaceId, direction: "outbound", createdAt: { $gte: since } }),
    Message.countDocuments({ workspaceId, status: "failed", createdAt: { $gte: since } }),
    Contact.countDocuments({ workspaceId, createdAt: { $gte: since } }),
    Conversation.countDocuments({ workspaceId, createdAt: { $gte: since } }),
    Conversation.countDocuments({ workspaceId, status: "resolved", updatedAt: { $gte: since } }),
    Message.aggregate([
      { $match: { workspaceId, createdAt: { $gte: since } } },
      {
        $group: {
          _id: { day: { $dateToString: { format: "%Y-%m-%d", date: "$createdAt" } }, direction: "$direction" },
          count: { $sum: 1 },
        },
      },
      { $sort: { "_id.day": 1 } },
    ]),
    Contact.aggregate([
      { $match: { workspaceId } },
      { $group: { _id: "$source", count: { $sum: 1 } } },
      { $sort: { count: -1 } },
      { $limit: 6 },
    ]),
    Campaign.find({ workspaceId }).populate("templateId").sort({ updatedAt: -1 }).limit(8),
    AutomationFlow.find({ workspaceId }).sort({ updatedAt: -1 }).limit(8),
    Membership.find({ workspaceId, status: "active" }).populate("userId", "name email").populate("roleId", "key"),
    Conversation.aggregate([
      { $match: { workspaceId, status: { $ne: "archived" }, assignedToUserId: { $ne: null } } },
      { $group: { _id: "$assignedToUserId", assigned: { $sum: 1 } } },
    ]),
    Conversation.aggregate([
      { $match: { workspaceId, status: "resolved", updatedAt: { $gte: today }, assignedToUserId: { $ne: null } } },
      { $group: { _id: "$assignedToUserId", resolved: { $sum: 1 } } },
    ]),
    WebhookEvent.aggregate([
      { $match: { workspaceId, createdAt: { $gte: since } } },
      { $group: { _id: "$status", count: { $sum: 1 } } },
    ]),
    Message.find({ workspaceId, status: "failed" })
      .populate("contactId", "name phone")
      .sort({ createdAt: -1 })
      .limit(10),
  ]);

  const volumeByDay = new Map();
  for (let index = 13; index >= 0; index -= 1) {
    const date = daysAgo(index);
    volumeByDay.set(date.toISOString().slice(0, 10), { date: dayKey(date), inbound: 0, outbound: 0, resolved: 0 });
  }
  for (const row of dailyMessages) {
    const item = volumeByDay.get(row._id.day);
    if (item) item[row._id.direction] = row.count;
  }

  const webhookMap = new Map(webhookCounts.map((item) => [item._id, item.count]));
  const webhookProcessed = webhookMap.get("processed") || 0;
  const webhookFailed = webhookMap.get("failed") || 0;
  const assignedMap = new Map(assignedCounts.map((item) => [item._id.toString(), item.assigned]));
  const resolvedMap = new Map(assignedResolved.map((item) => [item._id.toString(), item.resolved]));

  res.json({
    kpis: [
      { label: "Total messages", value: String(totalMessages), delta: "+0%", up: true },
      { label: "New contacts", value: String(newContacts), delta: "+0%", up: true },
      { label: "Delivery failure rate", value: `${percent(failedMessages, outboundMessages)}%`, delta: "+0%", up: failedMessages === 0 },
      { label: "Resolution rate", value: `${percent(resolvedConversations, totalConversations)}%`, delta: "+0%", up: true },
    ],
    messageVolume: Array.from(volumeByDay.values()),
    agentPerformance: memberships.map((membership) => ({
      name: membership.userId?.name || membership.userId?.email || "Team member",
      role: membership.roleId?.key || "agent",
      resolved: resolvedMap.get(membership.userId?._id?.toString?.() || "") || 0,
      assigned: assignedMap.get(membership.userId?._id?.toString?.() || "") || 0,
      avg: 0,
      csat: 0,
    })),
    sourceBreakdown: sourceCounts.map((item, index) => ({
      name: item._id || "Unknown",
      value: item.count,
      color: ["#25D366", "#128C7E", "#3b82f6", "#f59e0b", "#ef4444", "#a855f7"][index] || "#8b949e",
    })),
    campaignPerformance: campaigns.map((campaign) => {
      const metrics = campaign.metrics || {};
      return {
        id: campaign._id.toString(),
        name: campaign.name,
        template: campaign.templateId?.name || "No template",
        status: campaign.status === "sending" ? "running" : campaign.status,
        sent: Number(metrics.sent || 0),
        delivered: Number(metrics.delivered || 0),
        failed: Number(metrics.failed || 0),
        deliveryRate: percent(Number(metrics.delivered || 0), Number(metrics.sent || 0)),
      };
    }),
    automationPerformance: automations.map((flow) => ({
      id: flow._id.toString(),
      name: flow.name,
      status: flow.status,
      trigger: flow.trigger?.label || flow.trigger?.type || "Manual",
      runs: Number(flow.trigger?.runs || 0),
      lastRunAt: flow.trigger?.lastRunAt || null,
    })),
    deliveryFailures: deliveryFailures.map((message) => ({
      id: message._id.toString(),
      contact: message.contactId?.name || "Unknown",
      phone: message.contactId?.phone || "",
      body: message.body || "",
      error: message.metadata?.error || "Delivery failed",
      time: message.createdAt,
    })),
    totals: { inboundMessages, outboundMessages, failedMessages },
    webhookHealth: {
      processed: webhookProcessed,
      failed: webhookFailed,
      failureRate: percent(webhookFailed, webhookProcessed + webhookFailed),
    },
  });
});
