import mongoose from "mongoose";

const campaignSchema = new mongoose.Schema(
  {
    organizationId: { type: mongoose.Schema.Types.ObjectId, ref: "Organization", required: true, index: true },
    workspaceId: { type: mongoose.Schema.Types.ObjectId, ref: "Workspace", required: true, index: true },
    name: { type: String, required: true, trim: true },
    whatsappAccountId: { type: mongoose.Schema.Types.ObjectId, ref: "WhatsAppAccount", required: true },
    templateId: { type: mongoose.Schema.Types.ObjectId, ref: "Template", required: true },
    audienceFilter: { type: mongoose.Schema.Types.Mixed, default: {} },
    status: { type: String, enum: ["draft", "scheduled", "sending", "sent", "paused", "failed"], default: "draft", index: true },
    scheduledAt: Date,
    sentAt: Date,
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
    metrics: { type: mongoose.Schema.Types.Mixed, default: {} },
    recipients: { type: [mongoose.Schema.Types.Mixed], default: [] },
  },
  { timestamps: true }
);

campaignSchema.index({ workspaceId: 1, status: 1, scheduledAt: 1 });

export const Campaign = mongoose.model("Campaign", campaignSchema);
