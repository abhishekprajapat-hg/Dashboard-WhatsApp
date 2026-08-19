import mongoose from "mongoose";

const campaignSchema = new mongoose.Schema(
  {
    organizationId: { type: mongoose.Schema.Types.ObjectId, ref: "Organization", required: true, index: true },
    workspaceId: { type: mongoose.Schema.Types.ObjectId, ref: "Workspace", required: true, index: true },
    name: { type: String, required: true, trim: true },
    whatsappAccountId: { type: mongoose.Schema.Types.ObjectId, ref: "WhatsAppAccount", required: true },
    templateId: { type: mongoose.Schema.Types.ObjectId, ref: "Template", required: true },
    templateIds: [{ type: mongoose.Schema.Types.ObjectId, ref: "Template" }],
    templateName: { type: String, trim: true },
    language: { type: String, default: "en" },
    audienceFilter: { type: mongoose.Schema.Types.Mixed, default: {} },
    audienceFilters: { type: mongoose.Schema.Types.Mixed, default: {} },
    type: { type: String, enum: ["template", "bulk", "scheduled", "recurring", "ab_test"], default: "template", index: true },
    // Routes sends through Meta's /marketing_messages endpoint instead of /messages -
    // send-time optimization/frequency-cap handling for MARKETING-category templates only.
    // No new permission needed, reuses whatsapp_business_messaging (already approved).
    useMarketingMessagesLite: { type: Boolean, default: false },
    status: {
      type: String,
      enum: ["draft", "pending_approval", "approved", "rejected", "scheduled", "queued", "sending", "sent", "paused", "cancelled", "failed"],
      default: "draft",
      index: true,
    },
    approval: { type: mongoose.Schema.Types.Mixed, default: {} },
    schedule: { type: mongoose.Schema.Types.Mixed, default: {} },
    rateLimit: { type: mongoose.Schema.Types.Mixed, default: { perMinute: 60, batchSize: 50 } },
    queue: { type: mongoose.Schema.Types.Mixed, default: { queued: 0, processing: 0, completed: 0, failed: 0, retries: 0 } },
    abTest: { type: mongoose.Schema.Types.Mixed, default: {} },
    scheduledAt: Date,
    sentAt: Date,
    pausedAt: Date,
    cancelledAt: Date,
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
    approvedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
    metrics: { type: mongoose.Schema.Types.Mixed, default: {} },
    recipients: { type: [mongoose.Schema.Types.Mixed], default: [] },
    deliveryResults: { type: [mongoose.Schema.Types.Mixed], default: [] },
    imports: { type: [mongoose.Schema.Types.Mixed], default: [] },
    history: { type: [mongoose.Schema.Types.Mixed], default: [] },
  },
  { timestamps: true }
);

campaignSchema.index({ workspaceId: 1, status: 1, scheduledAt: 1 });
campaignSchema.index({ workspaceId: 1, type: 1, createdAt: -1 });

export const Campaign = mongoose.model("Campaign", campaignSchema);
