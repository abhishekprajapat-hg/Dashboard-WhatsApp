import mongoose from "mongoose";

// Marketing pillar (Phase 2): one document per audit RUN, not a mutable "latest" blob - keeps
// history so a client can see whether a fix actually moved the numbers, and so a later phase could
// chart trends without a schema change. pageSpeed/searchConsole are deliberately Mixed - trimmed
// third-party payload shapes (services/pageSpeedInsights.js, services/searchConsoleProvider.js),
// not worth a rigid schema for data this app only ever displays, never queries into.
const seoAuditSchema = new mongoose.Schema(
  {
    organizationId: { type: mongoose.Schema.Types.ObjectId, ref: "Organization", required: true, index: true },
    workspaceId: { type: mongoose.Schema.Types.ObjectId, ref: "Workspace", required: true, index: true },
    url: { type: String, required: true, trim: true },
    status: { type: String, enum: ["queued", "running", "completed", "failed"], default: "queued" },
    pageSpeed: { type: mongoose.Schema.Types.Mixed, default: null },
    // Only populated when the audited URL's domain matches/covers the workspace's own connected
    // GoogleMarketingAccount.searchConsoleSiteUrl - null (not an error) on a mismatch or no
    // connected account, see routes/marketing.js's POST /audits.
    searchConsole: { type: mongoose.Schema.Types.Mixed, default: null },
    findings: {
      type: [
        {
          severity: { type: String, enum: ["critical", "warning", "info"], required: true },
          category: { type: String, required: true },
          message: { type: String, required: true },
        },
      ],
      default: [],
    },
    // Populated on-demand only via POST /audits/:id/recommendation (services/aiAssistant.js's
    // draftSeoRecommendation) - never generated automatically on audit completion. See that route's
    // own comment for why this stays a deliberate human click, not a byproduct of running an audit.
    aiRecommendation: {
      summary: { type: String, default: "" },
      actions: {
        type: [
          {
            title: { type: String, required: true },
            detail: { type: String, required: true },
            priority: { type: String, enum: ["high", "medium", "low"], required: true },
          },
        ],
        default: [],
      },
      provider: { type: String, default: "" },
      generatedAt: Date,
    },
    triggeredByUserId: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
    error: { type: String, default: "" },
  },
  { timestamps: true }
);

seoAuditSchema.index({ workspaceId: 1, createdAt: -1 });

export const SeoAudit = mongoose.model("SeoAudit", seoAuditSchema);
