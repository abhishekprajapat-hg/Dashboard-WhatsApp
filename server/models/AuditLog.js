import mongoose from "mongoose";

const auditLogSchema = new mongoose.Schema(
  {
    organizationId: { type: mongoose.Schema.Types.ObjectId, ref: "Organization", required: true, index: true },
    workspaceId: { type: mongoose.Schema.Types.ObjectId, ref: "Workspace", required: true, index: true },
    actorUserId: { type: mongoose.Schema.Types.ObjectId, ref: "User", index: true },
    action: { type: String, required: true, index: true },
    entityType: { type: String, required: true },
    entityId: String,
    before: mongoose.Schema.Types.Mixed,
    after: mongoose.Schema.Types.Mixed,
    ipAddress: String,
    userAgent: String,
  },
  { timestamps: true }
);

auditLogSchema.index({ workspaceId: 1, createdAt: -1 });
auditLogSchema.index({ workspaceId: 1, entityType: 1, entityId: 1 });

export const AuditLog = mongoose.model("AuditLog", auditLogSchema);
