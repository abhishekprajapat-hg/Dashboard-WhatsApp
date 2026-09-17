import mongoose from "mongoose";

// Workspace-scoped, not per-user - same visibility model notifyWorkspace() (services/notifications.js)
// already uses for the email side of these same events (one recipientEmail per workspace, not
// per-user). Keeps this consistent with its email counterpart rather than inventing a separate,
// finer-grained read model that nothing calling into this yet actually needs.
const notificationSchema = new mongoose.Schema(
  {
    organizationId: { type: mongoose.Schema.Types.ObjectId, ref: "Organization", required: true, index: true },
    workspaceId: { type: mongoose.Schema.Types.ObjectId, ref: "Workspace", required: true, index: true },
    type: { type: String, required: true, trim: true },
    title: { type: String, required: true, trim: true },
    body: { type: String, default: "" },
    link: { type: String, default: null },
    read: { type: Boolean, default: false, index: true },
    readAt: { type: Date, default: null },
  },
  { timestamps: true }
);

notificationSchema.index({ workspaceId: 1, read: 1, createdAt: -1 });

export const Notification = mongoose.model("Notification", notificationSchema);
