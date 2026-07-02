import mongoose from "mongoose";

const leadSchema = new mongoose.Schema(
  {
    organizationId: { type: mongoose.Schema.Types.ObjectId, ref: "Organization", required: true, index: true },
    workspaceId: { type: mongoose.Schema.Types.ObjectId, ref: "Workspace", required: true, index: true },
    contactId: { type: mongoose.Schema.Types.ObjectId, ref: "Contact", required: true, index: true },
    conversationId: { type: mongoose.Schema.Types.ObjectId, ref: "Conversation", index: true },
    ownerUserId: { type: mongoose.Schema.Types.ObjectId, ref: "User", index: true },
    source: { type: String, default: "WhatsApp", index: true },
    campaign: String,
    stage: { type: String, default: "new_lead", index: true },
    score: { type: Number, default: 10, index: true },
    status: { type: String, enum: ["open", "won", "lost", "archived"], default: "open", index: true },
    firstMessage: String,
    firstMessageAt: Date,
    lastActivityAt: Date,
    followUpAt: Date,
    location: mongoose.Schema.Types.Mixed,
    customFields: { type: mongoose.Schema.Types.Mixed, default: {} },
    timeline: { type: [mongoose.Schema.Types.Mixed], default: [] },
  },
  { timestamps: true }
);

leadSchema.index({ workspaceId: 1, contactId: 1, status: 1 });
leadSchema.index(
  { workspaceId: 1, contactId: 1, status: 1 },
  {
    unique: true,
    partialFilterExpression: { status: "open" },
  }
);
leadSchema.index({ workspaceId: 1, stage: 1, lastActivityAt: -1 });

export const Lead = mongoose.model("Lead", leadSchema);
