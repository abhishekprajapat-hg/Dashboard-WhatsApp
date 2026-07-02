import mongoose from "mongoose";

const aiMemorySchema = new mongoose.Schema(
  {
    organizationId: { type: mongoose.Schema.Types.ObjectId, ref: "Organization", required: true, index: true },
    workspaceId: { type: mongoose.Schema.Types.ObjectId, ref: "Workspace", required: true, index: true },
    contactId: { type: mongoose.Schema.Types.ObjectId, ref: "Contact", index: true },
    conversationId: { type: mongoose.Schema.Types.ObjectId, ref: "Conversation", index: true },
    key: { type: String, required: true, trim: true },
    value: { type: mongoose.Schema.Types.Mixed, default: {} },
    confidence: { type: Number, default: 0.7 },
    source: { type: String, default: "assistant" },
    expiresAt: Date,
  },
  { timestamps: true }
);

aiMemorySchema.index({ workspaceId: 1, contactId: 1, key: 1 }, { unique: true });
aiMemorySchema.index({ workspaceId: 1, conversationId: 1, updatedAt: -1 });

export const AiMemory = mongoose.model("AiMemory", aiMemorySchema);
