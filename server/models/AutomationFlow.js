import mongoose from "mongoose";

// Every node ever written by any existing creation path (canvas save, simple-builder synthesis)
// already matches this shape - see docs/AUTOMATION_ENGINE_PLAN.md §1. `config` stays Mixed:
// 25+ node kinds makes a fully-typed discriminated union not worth it, each kind validates its
// own config at execution time instead.
const automationNodeSchema = new mongoose.Schema(
  {
    id: { type: String, required: true },
    type: { type: String, required: true },
    position: { type: mongoose.Schema.Types.Mixed },
    config: { type: mongoose.Schema.Types.Mixed, default: {} },
  },
  { _id: false }
);

// sourceHandle/targetHandle default to null, which the engine treats as "the single default
// edge" - old edges (written before branching existed) already round-trip as null.
const automationEdgeSchema = new mongoose.Schema(
  {
    id: { type: String, required: true },
    source: { type: String, required: true },
    target: { type: String, required: true },
    sourceHandle: { type: String, default: null },
    targetHandle: { type: String, default: null },
  },
  { _id: false }
);

const automationFlowSchema = new mongoose.Schema(
  {
    organizationId: { type: mongoose.Schema.Types.ObjectId, ref: "Organization", required: true, index: true },
    workspaceId: { type: mongoose.Schema.Types.ObjectId, ref: "Workspace", required: true, index: true },
    name: { type: String, required: true, trim: true },
    trigger: { type: mongoose.Schema.Types.Mixed, required: true },
    conditions: { type: [mongoose.Schema.Types.Mixed], default: [] },
    actions: { type: [mongoose.Schema.Types.Mixed], default: [] },
    nodes: { type: [automationNodeSchema], default: [] },
    edges: { type: [automationEdgeSchema], default: [] },
    status: { type: String, enum: ["draft", "published", "paused"], default: "draft", index: true },
    runLogs: { type: [mongoose.Schema.Types.Mixed], default: [] },
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
