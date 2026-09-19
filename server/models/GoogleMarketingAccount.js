import mongoose from "mongoose";

// Marketing pillar (Phase 1): a workspace's own Google identity, connected via its own OAuth
// consent (services/googleMarketingProvider.js) - not a shared Nemnidhi Google account, mirroring
// how a workspace connects its own WhatsApp number/Meta Page (FacebookAccount.js). One Google
// connection per workspace in v1; a connecting Google login can see multiple GA4 properties/Search
// Console sites, but the workspace explicitly picks exactly one of each (ga4PropertyId/
// searchConsoleSiteUrl start empty at "needs_attention" until the picker step completes) rather
// than everything visible being auto-ingested.
const googleMarketingAccountSchema = new mongoose.Schema(
  {
    organizationId: { type: mongoose.Schema.Types.ObjectId, ref: "Organization", required: true, index: true },
    // No field-level index: true here - the schema-level unique index below already covers
    // workspaceId alone (one Google connection per workspace in v1), so a second field-level index
    // declaration would be a genuine duplicate, not just cosmetic.
    workspaceId: { type: mongoose.Schema.Types.ObjectId, ref: "Workspace", required: true },
    googleEmail: { type: String, trim: true, default: "" },
    ga4PropertyId: { type: String, trim: true, default: "" },
    ga4PropertyName: { type: String, trim: true, default: "" },
    searchConsoleSiteUrl: { type: String, trim: true, default: "" },
    scopes: { type: [String], default: [] },
    // { accessToken, refreshToken, expiresAt } - AES-256-GCM, same encodeCredentials/decodeCredentials
    // shape whatsappProvider.js/facebookPagesProvider.js already use, own codec per
    // googleMarketingProvider.js (this codebase duplicates the codec per provider rather than
    // sharing one import - see that file's own comment).
    encryptedCredentials: { type: String, required: true },
    status: { type: String, enum: ["connected", "disconnected", "needs_attention"], default: "disconnected" },
    lastError: { type: String, default: "" },
    lastSyncedAt: Date,
    credentialsUpdatedAt: Date,
  },
  { timestamps: true }
);

googleMarketingAccountSchema.index({ workspaceId: 1 }, { unique: true });

export const GoogleMarketingAccount = mongoose.model("GoogleMarketingAccount", googleMarketingAccountSchema);
