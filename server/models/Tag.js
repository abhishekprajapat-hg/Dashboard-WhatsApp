import mongoose from "mongoose";

const tagSchema = new mongoose.Schema(
  {
    organizationId: { type: mongoose.Schema.Types.ObjectId, ref: "Organization", required: true, index: true },
    workspaceId: { type: mongoose.Schema.Types.ObjectId, ref: "Workspace", required: true, index: true },
    name: { type: String, required: true, trim: true },
    color: { type: String, default: "#25D366" },
    description: String,
  },
  { timestamps: true }
);

tagSchema.index({ workspaceId: 1, name: 1 }, { unique: true });

export const Tag = mongoose.model("Tag", tagSchema);
