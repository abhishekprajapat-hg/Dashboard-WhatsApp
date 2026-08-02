import mongoose from "mongoose";

// Persists in-progress flow execution so a run can pause at a delay node and resume later from a
// queued job, instead of needing to complete synchronously within one request. See
// docs/AUTOMATION_ENGINE_PLAN.md §1.
const automationRunSchema = new mongoose.Schema(
  {
    organizationId: { type: mongoose.Schema.Types.ObjectId, ref: "Organization", required: true, index: true },
    workspaceId: { type: mongoose.Schema.Types.ObjectId, ref: "Workspace", required: true, index: true },
    flowId: { type: mongoose.Schema.Types.ObjectId, ref: "AutomationFlow", required: true, index: true },
    status: { type: String, enum: ["running", "waiting", "completed", "failed", "cancelled"], default: "running", index: true },
    testMode: { type: Boolean, default: false },
    // Seed context: inbound message/contact/conversation ids and trigger-match flags, so a
    // resumed job can re-fetch everything fresh from Mongo without trusting in-memory state.
    trigger: { type: mongoose.Schema.Types.Mixed, default: {} },
    // {trigger, steps: {[nodeId]: output}} - what powers {{trigger.x}}/{{steps.nodeId.x}}
    // interpolation between nodes.
    context: { type: mongoose.Schema.Types.Mixed, default: () => ({ trigger: {}, steps: {} }) },
    cursor: {
      nodeId: { type: String, default: null },
    },
    // Per-node revisit counter, a cycle guard alongside stepCount.
    visitCounts: { type: mongoose.Schema.Types.Mixed, default: {} },
    stepCount: { type: Number, default: 0 },
    resumeAt: { type: Date, default: null },
    resumeJobId: { type: String, default: null },
    history: { type: [mongoose.Schema.Types.Mixed], default: [] },
    error: { type: String, default: null },
  },
  { timestamps: true }
);

automationRunSchema.index({ workspaceId: 1, status: 1 });
// Backstop for a future sweep of any resume job lost to a Redis restart - BullMQ delayed jobs are
// Redis-persisted by default, so this is defensive, not required for correctness.
automationRunSchema.index({ status: 1, resumeAt: 1 });

export const AutomationRun = mongoose.model("AutomationRun", automationRunSchema);
