import mongoose from "mongoose";

const automationFlowSchema = new mongoose.Schema(
  {
    organizationId: { type: mongoose.Schema.Types.ObjectId, ref: "Organization", required: true, index: true },
    workspaceId: { type: mongoose.Schema.Types.ObjectId, ref: "Workspace", required: true, index: true },
    name: { type: String, required: true, trim: true },
    trigger: { type: mongoose.Schema.Types.Mixed, required: true },
    nodes: { type: [mongoose.Schema.Types.Mixed], default: [] },
    edges: { type: [mongoose.Schema.Types.Mixed], default: [] },
    status: { type: String, enum: ["draft", "published", "paused"], default: "draft", index: true },
    version: { type: Number, default: 1 },
    publishedAt: Date,
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
    updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
  },
  { timestamps: true }
);

automationFlowSchema.index({ workspaceId: 1, status: 1 });
automationFlowSchema.index({ workspaceId: 1, "trigger.type": 1 });

export const AutomationFlow = mongoose.model("AutomationFlow", automationFlowSchema);
