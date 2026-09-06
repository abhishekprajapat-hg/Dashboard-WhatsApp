import mongoose from "mongoose";

const conversationSchema = new mongoose.Schema(
  {
    organizationId: { type: mongoose.Schema.Types.ObjectId, ref: "Organization", required: true, index: true },
    workspaceId: { type: mongoose.Schema.Types.ObjectId, ref: "Workspace", required: true, index: true },
    contactId: { type: mongoose.Schema.Types.ObjectId, ref: "Contact", required: true, index: true },
    whatsappAccountId: { type: mongoose.Schema.Types.ObjectId, ref: "WhatsAppAccount", index: true },
    instagramAccountId: { type: mongoose.Schema.Types.ObjectId, ref: "InstagramAccount", index: true },
    facebookAccountId: { type: mongoose.Schema.Types.ObjectId, ref: "FacebookAccount", index: true },
    channel: { type: String, enum: ["whatsapp", "instagram", "facebook"], default: "whatsapp", index: true },
    assignedToUserId: { type: mongoose.Schema.Types.ObjectId, ref: "User", index: true },
    status: { type: String, enum: ["open", "pending", "resolved", "archived"], default: "open" },
    priority: { type: String, enum: ["low", "normal", "high", "urgent"], default: "normal" },
    tagIds: [{ type: mongoose.Schema.Types.ObjectId, ref: "Tag", index: true }],
    lastMessageId: { type: mongoose.Schema.Types.ObjectId, ref: "Message" },
    lastMessageAt: { type: Date, index: true },
    unreadCountByUser: { type: Map, of: Number, default: {} },
    pinnedByUserIds: [{ type: mongoose.Schema.Types.ObjectId, ref: "User", index: true }],
    mutedByUserIds: [{ type: mongoose.Schema.Types.ObjectId, ref: "User", index: true }],
    metadata: { type: mongoose.Schema.Types.Mixed, default: {} },
  },
  { timestamps: true }
);

conversationSchema.index({ workspaceId: 1, status: 1, lastMessageAt: -1 });
conversationSchema.index({ workspaceId: 1, assignedToUserId: 1, status: 1 });
conversationSchema.index({ workspaceId: 1, pinnedByUserIds: 1, lastMessageAt: -1 });

export const Conversation = mongoose.model("Conversation", conversationSchema);
