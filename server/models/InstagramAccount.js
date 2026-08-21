import mongoose from "mongoose";

const instagramAccountSchema = new mongoose.Schema(
  {
    organizationId: { type: mongoose.Schema.Types.ObjectId, ref: "Organization", required: true, index: true },
    workspaceId: { type: mongoose.Schema.Types.ObjectId, ref: "Workspace", required: true, index: true },
    instagramUserId: { type: String, required: true },
    username: { type: String, default: "" },
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

instagramAccountSchema.index({ workspaceId: 1, instagramUserId: 1 }, { unique: true });

export const InstagramAccount = mongoose.model("InstagramAccount", instagramAccountSchema);
