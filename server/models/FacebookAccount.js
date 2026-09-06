import mongoose from "mongoose";

// Mirrors InstagramAccount.js exactly - a connected Facebook Page's own Page Access Token
// (not the user token used to discover it), same encrypted-blob/status/lastError shape.
const facebookAccountSchema = new mongoose.Schema(
  {
    organizationId: { type: mongoose.Schema.Types.ObjectId, ref: "Organization", required: true, index: true },
    workspaceId: { type: mongoose.Schema.Types.ObjectId, ref: "Workspace", required: true, index: true },
    pageId: { type: String, required: true },
    pageName: { type: String, default: "" },
    profilePictureUrl: { type: String, default: "" },
    encryptedCredentials: { type: String, required: true },
    webhookStatus: { type: String, default: "pending" },
    status: { type: String, enum: ["connected", "disconnected", "needs_attention"], default: "connected" },
    lastTestedAt: Date,
    lastError: { type: String, default: "" },
    credentialsUpdatedAt: Date,
  },
  { timestamps: true }
);

facebookAccountSchema.index({ workspaceId: 1, pageId: 1 }, { unique: true });

export const FacebookAccount = mongoose.model("FacebookAccount", facebookAccountSchema);
