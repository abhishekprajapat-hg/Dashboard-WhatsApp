import mongoose from "mongoose";

const webhookEventSchema = new mongoose.Schema(
  {
    organizationId: { type: mongoose.Schema.Types.ObjectId, ref: "Organization", index: true },
    workspaceId: { type: mongoose.Schema.Types.ObjectId, ref: "Workspace", index: true },
    provider: { type: String, default: "meta" },
    eventType: { type: String, required: true },
    idempotencyKey: { type: String, required: true, unique: true },
    payload: { type: mongoose.Schema.Types.Mixed, default: {} },
    status: { type: String, enum: ["received", "processed", "failed"], default: "received", index: true },
    processedAt: Date,
    error: String,
  },
  { timestamps: true }
);

webhookEventSchema.index({ workspaceId: 1, provider: 1, createdAt: -1 });

export const WebhookEvent = mongoose.model("WebhookEvent", webhookEventSchema);
