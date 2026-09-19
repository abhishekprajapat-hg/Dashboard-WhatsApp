import mongoose from "mongoose";

// DEPRECATED as a schema constraint - kept only as the historical/default stage-key list (see
// services/pipelineStages.js's DEFAULT_PIPELINE_STAGES, which supersedes this for actual
// resolution). Lead.stage is no longer enum-validated against this array; a workspace's real
// stage list now lives in Workspace.settings.crm.pipelineStages (master plan "CRM
// industry-specificity").
export const leadStages = ["new_lead", "contacted", "qualified", "proposal_sent", "won", "lost"];

const leadSchema = new mongoose.Schema(
  {
    organizationId: { type: mongoose.Schema.Types.ObjectId, ref: "Organization", required: true, index: true },
    workspaceId: { type: mongoose.Schema.Types.ObjectId, ref: "Workspace", required: true, index: true },
    contactId: { type: mongoose.Schema.Types.ObjectId, ref: "Contact", required: true, index: true },
    conversationId: { type: mongoose.Schema.Types.ObjectId, ref: "Conversation", index: true },
    ownerUserId: { type: mongoose.Schema.Types.ObjectId, ref: "User", index: true },
    source: { type: String, default: "WhatsApp", index: true },
    campaign: String,
    metaCtwaClid: { type: String, trim: true, default: "" },
    // No hard enum, deliberately - a workspace's own configurable pipeline stage (see
    // services/pipelineStages.js). Same "loose, route-validated" pattern Conversation.
    // supportCategory already uses successfully, for the same reason: the valid set of values is
    // now per-workspace, not platform-wide, so a schema-level enum can't express it.
    stage: { type: String, trim: true, default: "new_lead", index: true },
    score: { type: Number, default: 10, index: true },
    status: { type: String, enum: ["open", "won", "lost", "archived"], default: "open", index: true },
    providerMessageId: { type: String, index: true },
    firstMessage: String,
    firstMessageAt: Date,
    lastActivityAt: Date,
    followUpAt: Date,
    dealValue: { type: Number, default: null },
    dealCurrency: { type: String, default: "INR" },
    location: mongoose.Schema.Types.Mixed,
    syncStatus: { type: mongoose.Schema.Types.Mixed, default: {} },
    syncLog: { type: [mongoose.Schema.Types.Mixed], default: [] },
    customFields: { type: mongoose.Schema.Types.Mixed, default: {} },
    timeline: { type: [mongoose.Schema.Types.Mixed], default: [] },
    // Deliberately separate from `timeline` - a private team-only discussion thread about the
    // lead (pricing strategy, internal risk notes) distinct from the customer-activity/note feed
    // that `timeline`'s "note" entries already cover. Never mixed into the same array.
    internalComments: { type: [mongoose.Schema.Types.Mixed], default: [] },
  },
  { timestamps: true }
);

leadSchema.index(
  { workspaceId: 1, contactId: 1, status: 1 },
  {
    unique: true,
    partialFilterExpression: { status: "open" },
  }
);
leadSchema.index({ workspaceId: 1, stage: 1, lastActivityAt: -1 });
leadSchema.index(
  { workspaceId: 1, providerMessageId: 1 },
  {
    unique: true,
    partialFilterExpression: { providerMessageId: { $type: "string" } },
  }
);

export const Lead = mongoose.model("Lead", leadSchema);
