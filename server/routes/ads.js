import { Router } from "express";
import mongoose from "mongoose";
import { z } from "zod";
import { MetaAdCampaign, MetaAdsAccount } from "../models/index.js";
import { requireEntitlement, requirePermission } from "../middleware/auth.js";
import { validateBody } from "../middleware/validate.js";
import { trimmedString } from "../utils/zodHelpers.js";
import {
  createClickToWhatsAppCampaign,
  decodeAdsCredentials,
  encodeAdsCredentials,
  testMetaAdsConnection,
  uploadAdImage,
} from "../services/metaAdsProvider.js";

export const adsRouter = Router();

function historyEvent(type, actorUserId, data = {}) {
  return { type, actorUserId, at: new Date(), ...data };
}

function serializeAccount(account) {
  const credentials = decodeAdsCredentials(account);
  return {
    id: account._id.toString(),
    adAccountId: account.adAccountId,
    pageId: account.pageId,
    whatsappPhoneNumber: account.whatsappPhoneNumber || "",
    status: account.status,
    lastTestedAt: account.lastTestedAt,
    lastError: account.lastError || "",
    hasAccessToken: Boolean(credentials.accessToken),
  };
}

function serializeCampaign(campaign) {
  return {
    id: campaign._id.toString(),
    metaAdsAccountId: campaign.metaAdsAccountId.toString(),
    name: campaign.name,
    dailyBudgetMinorUnits: campaign.dailyBudgetMinorUnits,
    message: campaign.message,
    status: campaign.status,
    metaCampaignId: campaign.metaCampaignId,
    metaAdSetId: campaign.metaAdSetId,
    metaAdId: campaign.metaAdId,
    lastError: campaign.lastError || "",
    createdAt: campaign.createdAt,
  };
}

export const connectAdsAccountSchema = z.object({
  adAccountId: trimmedString("Ad account ID is required."),
  pageId: trimmedString("Page ID is required."),
  whatsappPhoneNumber: z.string().optional().default(""),
  accessToken: z.string().optional().default("local-placeholder-token"),
});

export const createAdCampaignSchema = z.object({
  metaAdsAccountId: trimmedString("Ad account is required."),
  name: trimmedString("Campaign name is required."),
  dailyBudgetMinorUnits: z.coerce.number().int().min(1, "Daily budget must be at least 1."),
  message: trimmedString("Ad message is required."),
  imageBase64: trimmedString("An ad creative image is required."),
});

adsRouter.get("/accounts", requirePermission("ads:read"), requireEntitlement("ads"), async (req, res) => {
  const accounts = await MetaAdsAccount.find({ workspaceId: req.user.workspaceId }).sort({ createdAt: -1 });
  res.json({ data: accounts.map(serializeAccount), total: accounts.length });
});

adsRouter.post("/accounts", requirePermission("ads:write"), requireEntitlement("ads"), validateBody(connectAdsAccountSchema), async (req, res) => {
  const { adAccountId, pageId, whatsappPhoneNumber, accessToken } = req.body;

  const existingAccount = await MetaAdsAccount.findOne({ workspaceId: req.user.workspaceId, adAccountId });
  const existingCredentials = existingAccount ? decodeAdsCredentials(existingAccount) : {};
  const tokenValue = accessToken !== "local-placeholder-token" ? accessToken : existingCredentials.accessToken || accessToken;

  const account = await MetaAdsAccount.findOneAndUpdate(
    { workspaceId: req.user.workspaceId, adAccountId },
    {
      organizationId: req.user.organizationId,
      workspaceId: req.user.workspaceId,
      adAccountId,
      pageId,
      whatsappPhoneNumber: whatsappPhoneNumber || "",
      encryptedCredentials: encodeAdsCredentials({ accessToken: tokenValue }),
      status: "connected",
      lastError: "",
      credentialsUpdatedAt: new Date(),
    },
    { upsert: true, new: true, setDefaultsOnInsert: true }
  );

  res.status(201).json({ data: serializeAccount(account) });
});

adsRouter.post("/accounts/:id/test", requirePermission("ads:write"), requireEntitlement("ads"), async (req, res) => {
  if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
    return res.status(404).json({ error: "NOT_FOUND", message: "Meta Ads account not found." });
  }

  const account = await MetaAdsAccount.findOne({ _id: req.params.id, workspaceId: req.user.workspaceId });
  if (!account) {
    return res.status(404).json({ error: "NOT_FOUND", message: "Meta Ads account not found." });
  }

  try {
    const result = await testMetaAdsConnection(account);
    account.status = "connected";
    account.lastTestedAt = new Date();
    account.lastError = "";
    await account.save();
    res.json({ result, account: serializeAccount(account) });
  } catch (error) {
    account.status = "needs_attention";
    account.lastTestedAt = new Date();
    account.lastError = error.message || "Connection test failed.";
    await account.save();
    res.status(error.status || 502).json({
      error: error.code || "CONNECTION_TEST_FAILED",
      message: error.message || "Connection test failed.",
      account: serializeAccount(account),
    });
  }
});

adsRouter.delete("/accounts/:id", requirePermission("ads:write"), requireEntitlement("ads"), async (req, res) => {
  if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
    return res.status(404).json({ error: "NOT_FOUND", message: "Meta Ads account not found." });
  }

  const account = await MetaAdsAccount.findOneAndDelete({ _id: req.params.id, workspaceId: req.user.workspaceId });
  if (!account) {
    return res.status(404).json({ error: "NOT_FOUND", message: "Meta Ads account not found." });
  }

  res.sendStatus(204);
});

adsRouter.get("/campaigns", requirePermission("ads:read"), requireEntitlement("ads"), async (req, res) => {
  const campaigns = await MetaAdCampaign.find({ workspaceId: req.user.workspaceId }).sort({ createdAt: -1 });
  res.json({ data: campaigns.map(serializeCampaign), total: campaigns.length });
});

adsRouter.get("/campaigns/:id", requirePermission("ads:read"), requireEntitlement("ads"), async (req, res) => {
  if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
    return res.status(404).json({ error: "NOT_FOUND", message: "Ad campaign not found." });
  }

  const campaign = await MetaAdCampaign.findOne({ _id: req.params.id, workspaceId: req.user.workspaceId });
  if (!campaign) {
    return res.status(404).json({ error: "NOT_FOUND", message: "Ad campaign not found." });
  }

  res.json({ data: serializeCampaign(campaign) });
});

adsRouter.post("/campaigns", requirePermission("ads:write"), requireEntitlement("ads"), validateBody(createAdCampaignSchema), async (req, res) => {
  const { metaAdsAccountId, name, dailyBudgetMinorUnits, message, imageBase64 } = req.body;

  if (!mongoose.Types.ObjectId.isValid(metaAdsAccountId)) {
    return res.status(404).json({ error: "NOT_FOUND", message: "Meta Ads account not found." });
  }

  const account = await MetaAdsAccount.findOne({ _id: metaAdsAccountId, workspaceId: req.user.workspaceId });
  if (!account) {
    return res.status(404).json({ error: "NOT_FOUND", message: "Meta Ads account not found." });
  }

  const campaign = await MetaAdCampaign.create({
    organizationId: req.user.organizationId,
    workspaceId: req.user.workspaceId,
    metaAdsAccountId: account._id,
    name,
    dailyBudgetMinorUnits,
    message,
    status: "creating",
    createdBy: req.user.sub,
    history: [historyEvent("created", req.user.sub, { dailyBudgetMinorUnits })],
  });

  try {
    const imageBuffer = Buffer.from(imageBase64.replace(/^data:image\/\w+;base64,/, ""), "base64");
    const imageHash = await uploadAdImage(account, imageBuffer);

    const { metaCampaignId, metaAdSetId, metaAdId } = await createClickToWhatsAppCampaign(account, {
      name,
      dailyBudgetMinorUnits,
      message,
      imageHash,
    });

    campaign.imageHash = imageHash;
    campaign.metaCampaignId = metaCampaignId;
    campaign.metaAdSetId = metaAdSetId;
    campaign.metaAdId = metaAdId;
    campaign.status = "paused";
    campaign.history.push(historyEvent("created_on_meta", req.user.sub, { metaCampaignId, metaAdSetId, metaAdId }));
    await campaign.save();

    res.status(201).json({ data: serializeCampaign(campaign) });
  } catch (error) {
    campaign.status = "failed";
    campaign.lastError = error.message || "Failed to create the campaign on Meta.";
    campaign.history.push(historyEvent("create_failed", req.user.sub, { error: campaign.lastError }));
    await campaign.save();

    res.status(error.status || 502).json({
      error: error.code || "META_ADS_CAMPAIGN_CREATE_FAILED",
      message: campaign.lastError,
      data: serializeCampaign(campaign),
    });
  }
});
