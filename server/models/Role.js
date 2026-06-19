import mongoose from "mongoose";

const roleSchema = new mongoose.Schema(
  {
    organizationId: { type: mongoose.Schema.Types.ObjectId, ref: "Organization", required: true, index: true },
    workspaceId: { type: mongoose.Schema.Types.ObjectId, ref: "Workspace", required: true, index: true },
    name: { type: String, required: true, trim: true },
    key: { type: String, required: true, trim: true },
    description: String,
    permissions: { type: [String], default: [] },
    isSystemRole: { type: Boolean, default: false },
  },
  { timestamps: true }
);

roleSchema.index({ workspaceId: 1, key: 1 }, { unique: true });

export const Role = mongoose.model("Role", roleSchema);
