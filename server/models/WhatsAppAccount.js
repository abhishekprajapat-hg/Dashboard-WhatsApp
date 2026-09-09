import mongoose from "mongoose";

const whatsAppAccountSchema = new mongoose.Schema(
  {
    organizationId: { type: mongoose.Schema.Types.ObjectId, ref: "Organization", required: true, index: true },
    workspaceId: { type: mongoose.Schema.Types.ObjectId, ref: "Workspace", required: true, index: true },
    displayName: { type: String, required: true },
    phoneNumber: { type: String, required: true },
    phoneNumberId: { type: String, required: true },
    businessAccountId: { type: String, required: true },
    provider: { type: String, default: "meta" },
    providerConfig: { type: mongoose.Schema.Types.Mixed, default: {} },
    encryptedCredentials: { type: String, required: true },
    conversionsDatasetId: { type: String, trim: true, default: "" },
    conversionsTestEventCode: { type: String, trim: true, default: "" },
    catalogId: { type: String, trim: true, default: "" },
    // Marks this as Nemnidhi's own platform WhatsApp number, usable to send system messages (e.g.
    // signup OTP codes) that aren't tied to any client workspace's own traffic - toggled manually
    // in Settings -> WhatsApp rather than a hardcoded account id, matching this project's existing
    // "no special-cased 'this is us' logic" discipline (see HANDOFF.md's Workspace #1 provisioning
    // note).
    isSystemAccount: { type: Boolean, default: false },
    webhookStatus: { type: String, default: "pending" },
    templateSyncStatus: { type: String, default: "pending" },
    // Written by the phone_number_quality_update webhook handler (whatsapp.js) - "GREEN"/"YELLOW"/
    // "RED"/"" (unknown, e.g. before the first event ever arrives). marketingPaused auto-flips true
    // when quality drops away from GREEN, protecting the number from a further-worsening spiral;
    // an admin clears it manually once the rating recovers rather than it auto-clearing, since
    // Meta's own quality-recovery signal isn't itself pushed via webhook.
    qualityRating: { type: String, default: "" },
    qualityRatingUpdatedAt: Date,
    marketingPaused: { type: Boolean, default: false },
    marketingPausedReason: { type: String, default: "" },
    status: { type: String, enum: ["connected", "disconnected", "needs_attention"], default: "disconnected" },
    lastSyncedAt: Date,
    lastTestedAt: Date,
    lastError: { type: String, default: "" },
    credentialsUpdatedAt: Date,
  },
  { timestamps: true }
);

whatsAppAccountSchema.index({ workspaceId: 1, phoneNumberId: 1 }, { unique: true });
whatsAppAccountSchema.index({ workspaceId: 1, status: 1 });

export const WhatsAppAccount = mongoose.model("WhatsAppAccount", whatsAppAccountSchema);
