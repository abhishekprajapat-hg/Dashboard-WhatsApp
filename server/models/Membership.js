import mongoose from "mongoose";

const membershipSchema = new mongoose.Schema(
  {
    organizationId: { type: mongoose.Schema.Types.ObjectId, ref: "Organization", required: true, index: true },
    workspaceId: { type: mongoose.Schema.Types.ObjectId, ref: "Workspace", required: true, index: true },
    userId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, index: true },
    roleId: { type: mongoose.Schema.Types.ObjectId, ref: "Role", required: true, index: true },
    status: { type: String, enum: ["invited", "active", "suspended"], default: "invited" },
    invitedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
    invitedAt: Date,
    joinedAt: Date,
  },
  { timestamps: true }
);

membershipSchema.index({ workspaceId: 1, userId: 1 }, { unique: true });

export const Membership = mongoose.model("Membership", membershipSchema);
