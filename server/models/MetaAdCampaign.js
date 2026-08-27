import mongoose from "mongoose";

const metaAdCampaignSchema = new mongoose.Schema(
  {
    organizationId: { type: mongoose.Schema.Types.ObjectId, ref: "Organization", required: true, index: true },
    workspaceId: { type: mongoose.Schema.Types.ObjectId, ref: "Workspace", required: true, index: true },
    metaAdsAccountId: { type: mongoose.Schema.Types.ObjectId, ref: "MetaAdsAccount", required: true, index: true },
    name: { type: String, required: true, trim: true },
    dailyBudgetMinorUnits: { type: Number, required: true, min: 1 },
    message: { type: String, required: true, trim: true },
    imageHash: { type: String, trim: true, default: "" },
    metaCampaignId: { type: String, trim: true, default: "" },
    metaAdSetId: { type: String, trim: true, default: "" },
    metaAdId: { type: String, trim: true, default: "" },
    status: { type: String, enum: ["creating", "paused", "active", "failed"], default: "creating", index: true },
    lastError: { type: String, default: "" },
    history: { type: [mongoose.Schema.Types.Mixed], default: [] },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
  },
  { timestamps: true }
);

metaAdCampaignSchema.index({ workspaceId: 1, status: 1, createdAt: -1 });

export const MetaAdCampaign = mongoose.model("MetaAdCampaign", metaAdCampaignSchema);
