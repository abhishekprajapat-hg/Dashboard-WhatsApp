import { Router } from "express";
import mongoose from "mongoose";
import {
  AutomationFlow,
  Campaign,
  Contact,
  Conversation,
  Lead,
  Membership,
  Message,
  Template,
  WebhookEvent,
} from "../models/index.js";
import { hasPermission } from "../middleware/auth.js";

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

function minutesBetween(start, end) {
  if (!start || !end) return 0;
  return Math.max(0, Math.round((new Date(end).getTime() - new Date(start).getTime()) / 60000));
}

function avg(values = []) {
  const valid = values.filter((value) => Number.isFinite(value) && value >= 0);
  return valid.length ? Math.round(valid.reduce((sum, value) => sum + value, 0) / valid.length) : 0;
}

function formatDuration(minutes) {
  if (!minutes) return "0m";
  if (minutes < 60) return `${minutes}m`;
  return `${Math.floor(minutes / 60)}h ${minutes % 60}m`;
}

function jsonCsv(rows = []) {
  if (!rows.length) return "metric,value\nNo data,0\n";
  const keys = Object.keys(rows[0]);
  const escape = (value) => `"${String(value ?? "").replace(/"/g, '""')}"`;
  return [keys.join(","), ...rows.map((row) => keys.map((key) => escape(row[key])).join(","))].join("\n");
}

function makeSimplePdf(title, lines = []) {
  const content = [
    "BT",
    "/F1 18 Tf",
    "50 780 Td",
    `(${title.replace(/[()]/g, "")}) Tj`,
    "/F1 10 Tf",
    ...lines.slice(0, 42).map((line, index) => `50 ${750 - index * 16} Td (${String(line).replace(/[()]/g, "").slice(0, 95)}) Tj`),
    "ET",
  ].join("\n");
  const objects = [
    "1 0 obj << /Type /Catalog /Pages 2 0 R >> endobj",
    "2 0 obj << /Type /Pages /Kids [3 0 R] /Count 1 >> endobj",
    "3 0 obj << /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >> endobj",
    "4 0 obj << /Type /Font /Subtype /Type1 /BaseFont /Helvetica >> endobj",
    `5 0 obj << /Length ${Buffer.byteLength(content)} >> stream\n${content}\nendstream endobj`,
  ];
  const body = objects.join("\n");
  return Buffer.from(`%PDF-1.4\n${body}\ntrailer << /Root 1 0 R >>\n%%EOF`);
}

function emptyPayload() {
  return {
    kpis: [],
    messageVolume: [],
    agentPerformance: [],
    sourceBreakdown: [],
    campaignPerformance: [],
    automationPerformance: [],
    templatePerformance: [],
    deliveryFailures: [],
    webhookHealth: { processed: 0, failed: 0, failureRate: 0 },
    leadAnalytics: { byStage: [], bySource: [], conversions: 0, revenue: 0 },
    conversion: { rate: 0, wonLeads: 0, openLeads: 0 },
    revenue: { total: 0, pipeline: 0, won: 0 },
    responseTime: { averageMinutes: 0, label: "0m", trend: [] },
    resolutionTime: { averageMinutes: 0, label: "0m", resolved: 0 },
    peakHours: [],
    heatMap: [],
    realtimeCharts: { refreshedAt: new Date(), lastHour: [] },
    customReports: [],
    roleBasedAnalytics: { scope: "none", canViewTeam: false },
  };
}

async function buildAnalytics(req, days = 14) {
  const workspaceId = new mongoose.Types.ObjectId(req.user.workspaceId);
  const userId = req.user.sub;
  const canViewTeam = hasPermission(req.user, "team:read") || hasPermission(req.user, "reports:read");
  const since = daysAgo(days);
  const today = daysAgo(0);
  const conversationScope = { workspaceId };
  if (!canViewTeam) {
    conversationScope.$or = [{ assignedToUserId: userId }, { assignedToUserId: { $exists: false } }, { assignedToUserId: null }];
  }

  const scopedConversations = await Conversation.find(conversationScope).select("_id assignedToUserId createdAt updatedAt status metadata");
  const conversationIds = scopedConversations.map((conversation) => conversation._id);
  const messageScope = { workspaceId, ...(canViewTeam ? {} : { conversationId: { $in: conversationIds } }) };

  const [
    totalMessages,
    inboundMessages,
    outboundMessages,
    failedMessages,
    newContacts,
    totalCustomers,
    totalConversations,
    resolvedConversations,
    dailyMessages,
    sourceCounts,
    campaigns,
    automations,
    templates,
    memberships,
    assignedCounts,
    assignedResolved,
    webhookCounts,
    deliveryFailures,
    leads,
    hourlyMessages,
    heatRows,
    recentMessages,
  ] = await Promise.all([
    Message.countDocuments({ ...messageScope, createdAt: { $gte: since } }),
    Message.countDocuments({ ...messageScope, direction: "inbound", createdAt: { $gte: since } }),
    Message.countDocuments({ ...messageScope, direction: "outbound", createdAt: { $gte: since } }),
    Message.countDocuments({ ...messageScope, status: "failed", createdAt: { $gte: since } }),
    Contact.countDocuments({ workspaceId, createdAt: { $gte: since } }),
    Contact.countDocuments({ workspaceId }),
    scopedConversations.filter((conversation) => conversation.createdAt >= since).length,
    scopedConversations.filter((conversation) => conversation.status === "resolved" && conversation.updatedAt >= since).length,
    Message.aggregate([
      { $match: { ...messageScope, createdAt: { $gte: since } } },
      { $group: { _id: { day: { $dateToString: { format: "%Y-%m-%d", date: "$createdAt" } }, direction: "$direction" }, count: { $sum: 1 } } },
      { $sort: { "_id.day": 1 } },
    ]),
    Contact.aggregate([
      { $match: { workspaceId } },
      { $group: { _id: "$source", count: { $sum: 1 } } },
      { $sort: { count: -1 } },
      { $limit: 8 },
    ]),
    Campaign.find({ workspaceId }).populate("templateId").sort({ updatedAt: -1 }).limit(12),
    AutomationFlow.find({ workspaceId }).sort({ updatedAt: -1 }).limit(12),
    Template.find({ workspaceId }).sort({ updatedAt: -1 }).limit(16),
    Membership.find({ workspaceId, status: "active" }).populate("userId", "name email").populate("roleId", "key"),
    Conversation.aggregate([
      { $match: { ...conversationScope, status: { $ne: "archived" }, assignedToUserId: { $ne: null } } },
      { $group: { _id: "$assignedToUserId", assigned: { $sum: 1 } } },
    ]),
    Conversation.aggregate([
      { $match: { ...conversationScope, status: "resolved", updatedAt: { $gte: today }, assignedToUserId: { $ne: null } } },
      { $group: { _id: "$assignedToUserId", resolved: { $sum: 1 } } },
    ]),
    WebhookEvent.aggregate([
      { $match: { workspaceId, createdAt: { $gte: since } } },
      { $group: { _id: "$status", count: { $sum: 1 } } },
    ]),
    Message.find({ ...messageScope, status: "failed" }).populate("contactId", "name phone").sort({ createdAt: -1 }).limit(10),
    Lead.find({ workspaceId, updatedAt: { $gte: since } }).populate("contactId", "name phone source").sort({ updatedAt: -1 }).limit(300),
    Message.aggregate([
      { $match: { ...messageScope, createdAt: { $gte: since } } },
      { $group: { _id: { hour: { $hour: "$createdAt" } }, count: { $sum: 1 } } },
      { $sort: { "_id.hour": 1 } },
    ]),
    Message.aggregate([
      { $match: { ...messageScope, createdAt: { $gte: since } } },
      { $group: { _id: { day: { $dayOfWeek: "$createdAt" }, hour: { $hour: "$createdAt" } }, count: { $sum: 1 } } },
    ]),
    Message.find({ ...messageScope, createdAt: { $gte: new Date(Date.now() - 60 * 60 * 1000) } }).sort({ createdAt: 1 }).limit(200),
  ]);

  const volumeByDay = new Map();
  for (let index = days - 1; index >= 0; index -= 1) {
    const date = daysAgo(index);
    volumeByDay.set(date.toISOString().slice(0, 10), { date: dayKey(date), inbound: 0, outbound: 0, resolved: 0 });
  }
  for (const row of dailyMessages) {
    const item = volumeByDay.get(row._id.day);
    if (item) item[row._id.direction] = row.count;
  }

  const inboundByConversation = await Message.find({ ...messageScope, direction: "inbound", createdAt: { $gte: since } })
    .select("conversationId createdAt")
    .sort({ createdAt: 1 })
    .limit(2000);
  const outboundByConversation = await Message.find({ ...messageScope, direction: "outbound", createdAt: { $gte: since } })
    .select("conversationId createdAt")
    .sort({ createdAt: 1 })
    .limit(2000);
  const outboundMap = new Map();
  outboundByConversation.forEach((message) => {
    const key = message.conversationId.toString();
    outboundMap.set(key, [...(outboundMap.get(key) || []), message.createdAt]);
  });
  const responseDurations = inboundByConversation.map((message) => {
    const nextOutbound = (outboundMap.get(message.conversationId.toString()) || []).find((date) => date > message.createdAt);
    return nextOutbound ? minutesBetween(message.createdAt, nextOutbound) : null;
  }).filter((value) => value !== null);
  const avgResponse = avg(responseDurations);
  const resolutionDurations = scopedConversations
    .filter((conversation) => conversation.status === "resolved")
    .map((conversation) => minutesBetween(conversation.createdAt, conversation.updatedAt));
  const avgResolution = avg(resolutionDurations);

  const webhookMap = new Map(webhookCounts.map((item) => [item._id, item.count]));
  const webhookProcessed = webhookMap.get("processed") || 0;
  const webhookFailed = webhookMap.get("failed") || 0;
  const assignedMap = new Map(assignedCounts.map((item) => [item._id.toString(), item.assigned]));
  const resolvedMap = new Map(assignedResolved.map((item) => [item._id.toString(), item.resolved]));

  const leadByStage = Array.from(leads.reduce((map, lead) => map.set(lead.stage || "unknown", (map.get(lead.stage || "unknown") || 0) + 1), new Map()))
    .map(([stage, count]) => ({ stage, count }));
  const leadBySource = Array.from(leads.reduce((map, lead) => map.set(lead.source || "Unknown", (map.get(lead.source || "Unknown") || 0) + 1), new Map()))
    .map(([source, count]) => ({ source, count }));
  const wonLeads = leads.filter((lead) => lead.status === "won" || lead.stage === "won").length;
  const revenueWon = leads
    .filter((lead) => lead.status === "won" || lead.stage === "won")
    .reduce((sum, lead) => sum + Number(lead.customFields?.revenue || lead.customFields?.dealValue || lead.customFields?.value || 0), 0);
  const pipeline = leads.reduce((sum, lead) => sum + Number(lead.customFields?.dealValue || lead.customFields?.value || 0), 0);

  const campaignPerformance = campaigns.map((campaign) => {
    const metrics = campaign.metrics || {};
    const sent = Number(metrics.sent || campaign.queue?.completed || 0);
    const delivered = Number(metrics.delivered || 0);
    const read = Number(metrics.read || 0);
    const replies = Number(metrics.replies || 0);
    const clicks = Number(metrics.clicks || 0);
    const conversions = Number(metrics.conversions || 0);
    const failed = Number(metrics.failed || campaign.queue?.failed || 0);
    return {
      id: campaign._id.toString(),
      name: campaign.name,
      template: campaign.templateId?.name || "No template",
      status: campaign.status === "sending" ? "running" : campaign.status,
      sent,
      delivered,
      read,
      replies,
      clicks,
      conversions,
      failed,
      deliveryRate: percent(delivered, sent),
      readRate: percent(read, delivered),
      conversionRate: percent(conversions, sent),
    };
  });

  const campaignByTemplate = new Map();
  campaignPerformance.forEach((campaign) => {
    const current = campaignByTemplate.get(campaign.template) || { sent: 0, delivered: 0, read: 0, failed: 0 };
    campaignByTemplate.set(campaign.template, {
      sent: current.sent + campaign.sent,
      delivered: current.delivered + campaign.delivered,
      read: current.read + campaign.read,
      failed: current.failed + campaign.failed,
    });
  });

  return {
    kpis: [
      { label: "Messages", value: String(totalMessages), delta: "+0%", up: true },
      { label: "Customers", value: String(totalCustomers), delta: `${newContacts} new`, up: true },
      { label: "Response Time", value: formatDuration(avgResponse), delta: "avg", up: true },
      { label: "Conversion", value: `${percent(wonLeads, leads.length)}%`, delta: `${wonLeads} won`, up: true },
    ],
    messageVolume: Array.from(volumeByDay.values()),
    agentPerformance: memberships.map((membership) => ({
      name: membership.userId?.name || membership.userId?.email || "Team member",
      role: membership.roleId?.key || "agent",
      resolved: resolvedMap.get(membership.userId?._id?.toString?.() || "") || 0,
      assigned: assignedMap.get(membership.userId?._id?.toString?.() || "") || 0,
      avg: avgResponse,
      csat: 0,
    })),
    sourceBreakdown: sourceCounts.map((item, index) => ({
      name: item._id || "Unknown",
      value: item.count,
      color: ["#25D366", "#3b82f6", "#f59e0b", "#ef4444", "#a855f7", "#14b8a6", "#64748b", "#eab308"][index] || "#8b949e",
    })),
    campaignPerformance,
    automationPerformance: automations.map((flow) => ({
      id: flow._id.toString(),
      name: flow.name,
      status: flow.status,
      trigger: flow.trigger?.label || flow.trigger?.type || "Manual",
      runs: Number(flow.trigger?.runs || 0),
      lastRunAt: flow.trigger?.lastRunAt || null,
      conversionRate: percent(Number(flow.trigger?.conversions || 0), Number(flow.trigger?.runs || 0)),
      nodes: flow.nodes?.length || 0,
    })),
    templatePerformance: templates.map((template) => {
      const aggregate = campaignByTemplate.get(template.name) || { sent: 0, delivered: 0, read: 0, failed: 0 };
      return {
        id: template._id.toString(),
        name: template.name,
        category: template.category,
        language: template.language,
        status: template.status,
        sent: aggregate.sent,
        delivered: aggregate.delivered,
        read: aggregate.read,
        failed: aggregate.failed,
        readRate: percent(aggregate.read, aggregate.delivered),
      };
    }),
    deliveryFailures: deliveryFailures.map((message) => ({
      id: message._id.toString(),
      contact: message.contactId?.name || "Unknown",
      phone: message.contactId?.phone || "",
      body: message.body || "",
      error: message.metadata?.error || "Delivery failed",
      time: message.createdAt,
    })),
    totals: { inboundMessages, outboundMessages, failedMessages },
    webhookHealth: { processed: webhookProcessed, failed: webhookFailed, failureRate: percent(webhookFailed, webhookProcessed + webhookFailed) },
    leadAnalytics: { byStage: leadByStage, bySource: leadBySource, conversions: wonLeads, revenue: revenueWon },
    conversion: { rate: percent(wonLeads, leads.length), wonLeads, openLeads: leads.filter((lead) => lead.status === "open").length },
    revenue: { total: revenueWon, pipeline, won: revenueWon },
    responseTime: { averageMinutes: avgResponse, label: formatDuration(avgResponse), trend: Array.from(volumeByDay.values()).map((item) => ({ date: item.date, minutes: avgResponse })) },
    resolutionTime: { averageMinutes: avgResolution, label: formatDuration(avgResolution), resolved: resolvedConversations },
    peakHours: Array.from({ length: 24 }, (_, hour) => {
      const row = hourlyMessages.find((item) => item._id.hour === hour);
      return { hour, label: `${String(hour).padStart(2, "0")}:00`, messages: row?.count || 0 };
    }),
    heatMap: heatRows.map((row) => ({ day: row._id.day, hour: row._id.hour, value: row.count })),
    realtimeCharts: {
      refreshedAt: new Date(),
      lastHour: recentMessages.map((message) => ({ time: message.createdAt, direction: message.direction, status: message.status })),
    },
    customReports: [
      { id: "executive", name: "Executive Summary", metrics: ["Messages", "Conversion", "Revenue", "Response Time"] },
      { id: "agent", name: "Agent Productivity", metrics: ["Assigned", "Resolved", "Response Time"] },
      { id: "campaign", name: "Campaign ROI", metrics: ["Delivered", "Read", "Replies", "Conversions"] },
      { id: "automation", name: "Automation Performance", metrics: ["Runs", "Conversion Rate", "Failures"] },
    ],
    roleBasedAnalytics: {
      scope: canViewTeam ? "workspace" : "assigned_conversations",
      canViewTeam,
      permissions: req.user.permissions || [],
    },
  };
}

analyticsRouter.get("/summary", async (req, res) => {
  if (mongoose.connection.readyState !== 1 || !mongoose.Types.ObjectId.isValid(req.user?.workspaceId)) {
    return res.json(emptyPayload());
  }

  const days = Math.max(1, Math.min(365, Number(req.query.days || 14)));
  res.json(await buildAnalytics(req, days));
});

analyticsRouter.get("/export/excel", async (req, res) => {
  if (mongoose.connection.readyState !== 1 || !mongoose.Types.ObjectId.isValid(req.user?.workspaceId)) return res.status(503).send("MongoDB is required.");
  const analytics = await buildAnalytics(req, Math.max(1, Math.min(365, Number(req.query.days || 30))));
  const rows = [
    ...analytics.kpis.map((item) => ({ section: "KPI", metric: item.label, value: item.value, detail: item.delta })),
    ...analytics.campaignPerformance.map((item) => ({ section: "Campaign", metric: item.name, value: item.sent, detail: `${item.deliveryRate}% delivery` })),
    ...analytics.agentPerformance.map((item) => ({ section: "Agent", metric: item.name, value: item.resolved, detail: `${item.assigned} assigned` })),
    ...analytics.templatePerformance.map((item) => ({ section: "Template", metric: item.name, value: item.sent, detail: `${item.readRate}% read` })),
  ];
  res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
  res.setHeader("Content-Disposition", "attachment; filename=enterprise-analytics.csv");
  res.send(jsonCsv(rows));
});

analyticsRouter.get("/export/pdf", async (req, res) => {
  if (mongoose.connection.readyState !== 1 || !mongoose.Types.ObjectId.isValid(req.user?.workspaceId)) return res.status(503).send("MongoDB is required.");
  const analytics = await buildAnalytics(req, Math.max(1, Math.min(365, Number(req.query.days || 30))));
  const lines = [
    ...analytics.kpis.map((item) => `${item.label}: ${item.value} ${item.delta}`),
    `Revenue: ${analytics.revenue.total}`,
    `Pipeline: ${analytics.revenue.pipeline}`,
    `Response Time: ${analytics.responseTime.label}`,
    `Resolution Time: ${analytics.resolutionTime.label}`,
    `Role Scope: ${analytics.roleBasedAnalytics.scope}`,
  ];
  res.setHeader("Content-Type", "application/pdf");
  res.setHeader("Content-Disposition", "attachment; filename=enterprise-analytics.pdf");
  res.send(makeSimplePdf("Enterprise Analytics Report", lines));
});
