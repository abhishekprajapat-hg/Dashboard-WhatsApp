import mongoose from "mongoose";

const metaAdsAccountSchema = new mongoose.Schema(
  {
    organizationId: { type: mongoose.Schema.Types.ObjectId, ref: "Organization", required: true, index: true },
    workspaceId: { type: mongoose.Schema.Types.ObjectId, ref: "Workspace", required: true, index: true },
    adAccountId: { type: String, required: true, trim: true },
    pageId: { type: String, required: true, trim: true },
    whatsappPhoneNumber: { type: String, trim: true, default: "" },
    encryptedCredentials: { type: String, required: true },
    status: { type: String, enum: ["connected", "disconnected", "needs_attention"], default: "disconnected" },
    lastTestedAt: Date,
    lastError: { type: String, default: "" },
    credentialsUpdatedAt: Date,
  },
  { timestamps: true }
);

metaAdsAccountSchema.index({ workspaceId: 1, adAccountId: 1 }, { unique: true });

export const MetaAdsAccount = mongoose.model("MetaAdsAccount", metaAdsAccountSchema);
