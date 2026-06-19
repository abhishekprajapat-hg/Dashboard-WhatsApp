import { Router } from "express";
import mongoose from "mongoose";
import { Campaign, Contact, Template, WhatsAppAccount } from "../models/index.js";

export const campaignsRouter = Router();

function serializeCampaign(campaign) {
  const metrics = campaign.metrics || {};
  const sent = Number(metrics.sent || 0);
  const delivered = Number(metrics.delivered || 0);
  const read = Number(metrics.read || 0);
  const replied = Number(metrics.replied || 0);
  const status = campaign.status === "sending" ? "running" : campaign.status;

  return {
    id: campaign._id.toString(),
    name: campaign.name,
    status,
    type: campaign.audienceFilter?.type || "broadcast",
    audience: campaign.audienceFilter?.label || "All Contacts",
    recipients: Number(metrics.recipients || 0),
    sent,
    delivered,
    read,
    replied,
    scheduledAt: campaign.scheduledAt ? campaign.scheduledAt.toLocaleString("en-US", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" }) : undefined,
    sentAt: campaign.sentAt ? campaign.sentAt.toLocaleString("en-US", { month: "short", day: "numeric" }) : undefined,
    template: campaign.templateId?.name || "No template",
  };
}

async function getCampaignDefaults(workspaceId) {
  const [account, template, recipients] = await Promise.all([
    WhatsAppAccount.findOne({ workspaceId, status: "connected" }).sort({ createdAt: -1 }),
    Template.findOne({ workspaceId, status: "approved" }).sort({ name: 1 }),
    Contact.countDocuments({ workspaceId }),
  ]);

  return { account, template, recipients };
}

campaignsRouter.get("/", async (req, res) => {
  if (mongoose.connection.readyState !== 1) {
    return res.json({ data: [], total: 0, summary: { totalSent: 0, deliveryRate: 0, readRate: 0, replyRate: 0 } });
  }

  const campaigns = await Campaign.find({ workspaceId: req.user.workspaceId })
    .populate("templateId")
    .sort({ createdAt: -1 })
    .limit(100);

  const summary = campaigns.reduce(
    (acc, campaign) => {
      const metrics = campaign.metrics || {};
      acc.totalSent += Number(metrics.sent || 0);
      acc.delivered += Number(metrics.delivered || 0);
      acc.read += Number(metrics.read || 0);
      acc.replied += Number(metrics.replied || 0);
      return acc;
    },
    { totalSent: 0, delivered: 0, read: 0, replied: 0 }
  );

  res.json({
    data: campaigns.map(serializeCampaign),
    total: campaigns.length,
    summary: {
      totalSent: summary.totalSent,
      deliveryRate: summary.totalSent ? Math.round((summary.delivered / summary.totalSent) * 100) : 0,
      readRate: summary.delivered ? Math.round((summary.read / summary.delivered) * 100) : 0,
      replyRate: summary.delivered ? Math.round((summary.replied / summary.delivered) * 100) : 0,
    },
  });
});

campaignsRouter.post("/", async (req, res) => {
  if (mongoose.connection.readyState !== 1) {
    return res.status(503).json({ error: "DATABASE_UNAVAILABLE", message: "MongoDB is required." });
  }

  const { name, type = "broadcast", audience = "All Contacts", status = "draft", scheduledAt } = req.body || {};
  if (!name?.trim()) {
    return res.status(400).json({ error: "VALIDATION_ERROR", message: "Campaign name is required." });
  }

  const { account, template, recipients } = await getCampaignDefaults(req.user.workspaceId);
  if (!account || !template) {
    return res.status(400).json({ error: "WHATSAPP_REQUIRED", message: "Connect WhatsApp and sync templates before creating campaigns." });
  }

  const dbStatus = status === "running" ? "sending" : status;
  const sent = dbStatus === "sent" || dbStatus === "sending" ? recipients : 0;

  const campaign = await Campaign.create({
    organizationId: req.user.organizationId,
    workspaceId: req.user.workspaceId,
    name: name.trim(),
    whatsappAccountId: account._id,
    templateId: template._id,
    audienceFilter: { type, label: audience },
    status: ["draft", "scheduled", "sending", "sent", "paused", "failed"].includes(dbStatus) ? dbStatus : "draft",
    scheduledAt: scheduledAt ? new Date(scheduledAt) : undefined,
    sentAt: dbStatus === "sent" ? new Date() : undefined,
    createdBy: req.user.sub,
    metrics: { recipients, sent, delivered: sent, read: 0, replied: 0 },
  });

  await campaign.populate("templateId");
  res.status(201).json({ data: serializeCampaign(campaign) });
});

campaignsRouter.patch("/:id", async (req, res) => {
  if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
    return res.status(404).json({ error: "NOT_FOUND", message: "Campaign not found." });
  }

  const updates = {};
  if (req.body?.name) updates.name = req.body.name.trim();
  if (req.body?.status) updates.status = req.body.status === "running" ? "sending" : req.body.status;
  if (req.body?.type || req.body?.audience) {
    updates.audienceFilter = { type: req.body.type || "broadcast", label: req.body.audience || "All Contacts" };
  }

  const campaign = await Campaign.findOneAndUpdate(
    { _id: req.params.id, workspaceId: req.user.workspaceId },
    updates,
    { new: true }
  ).populate("templateId");

  if (!campaign) return res.status(404).json({ error: "NOT_FOUND", message: "Campaign not found." });
  res.json({ data: serializeCampaign(campaign) });
});

campaignsRouter.delete("/:id", async (req, res) => {
  if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
    return res.status(404).json({ error: "NOT_FOUND", message: "Campaign not found." });
  }

  const campaign = await Campaign.findOneAndDelete({ _id: req.params.id, workspaceId: req.user.workspaceId });
  if (!campaign) return res.status(404).json({ error: "NOT_FOUND", message: "Campaign not found." });
  res.sendStatus(204);
});
