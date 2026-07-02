import mongoose from "mongoose";

const messageSchema = new mongoose.Schema(
  {
    organizationId: { type: mongoose.Schema.Types.ObjectId, ref: "Organization", required: true, index: true },
    workspaceId: { type: mongoose.Schema.Types.ObjectId, ref: "Workspace", required: true, index: true },
    conversationId: { type: mongoose.Schema.Types.ObjectId, ref: "Conversation", required: true, index: true },
    contactId: { type: mongoose.Schema.Types.ObjectId, ref: "Contact", required: true, index: true },
    whatsappAccountId: { type: mongoose.Schema.Types.ObjectId, ref: "WhatsAppAccount", index: true },
    direction: { type: String, enum: ["inbound", "outbound"], required: true },
    type: { type: String, enum: ["text", "template", "image", "document", "audio", "video", "location", "system", "note"], default: "text" },
    body: String,
    attachments: { type: [mongoose.Schema.Types.Mixed], default: [] },
    providerMessageId: { type: String, sparse: true },
    clientMessageId: { type: String, sparse: true },
    status: { type: String, enum: ["queued", "sent", "delivered", "read", "failed"], default: "queued", index: true },
    pinned: { type: Boolean, default: false, index: true },
    starred: { type: Boolean, default: false, index: true },
    deletedAt: Date,
    deletedByUserId: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
    deletedForUserIds: [{ type: mongoose.Schema.Types.ObjectId, ref: "User", index: true }],
    sentByUserId: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
    receivedAt: Date,
    sentAt: Date,
    deliveredAt: Date,
    readAt: Date,
    metadata: { type: mongoose.Schema.Types.Mixed, default: {} },
  },
  { timestamps: true }
);

messageSchema.index({ conversationId: 1, createdAt: 1 });
messageSchema.index({ conversationId: 1, createdAt: -1, _id: -1 });
messageSchema.index(
  { workspaceId: 1, providerMessageId: 1 },
  {
    unique: true,
    partialFilterExpression: { providerMessageId: { $type: "string" } },
  }
);
messageSchema.index(
  { workspaceId: 1, clientMessageId: 1 },
  {
    unique: true,
    partialFilterExpression: { clientMessageId: { $type: "string" } },
  }
);

export const Message = mongoose.model("Message", messageSchema);
