import mongoose from "mongoose";

const workspaceSchema = new mongoose.Schema(
  {
    organizationId: { type: mongoose.Schema.Types.ObjectId, ref: "Organization", required: true, index: true },
    name: { type: String, required: true, trim: true },
    slug: { type: String, required: true, trim: true },
    timezone: { type: String, default: "UTC" },
    businessCategory: String,
    settings: { type: mongoose.Schema.Types.Mixed, default: {} },
  },
  { timestamps: true }
);

workspaceSchema.index({ organizationId: 1, slug: 1 }, { unique: true });

export const Workspace = mongoose.model("Workspace", workspaceSchema);
