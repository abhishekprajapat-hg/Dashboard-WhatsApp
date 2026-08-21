import mongoose from "mongoose";

const contactSchema = new mongoose.Schema(
  {
    organizationId: { type: mongoose.Schema.Types.ObjectId, ref: "Organization", required: true, index: true },
    workspaceId: { type: mongoose.Schema.Types.ObjectId, ref: "Workspace", required: true, index: true },
    name: { type: String, required: true, trim: true },
    // Optional, not required: an Instagram-only contact has no phone number. Every WhatsApp
    // contact still always has one (still enforced at the route level for that channel).
    phone: { type: String, trim: true, default: "" },
    channel: { type: String, enum: ["whatsapp", "instagram"], default: "whatsapp", index: true },
    instagramScopedId: { type: String, trim: true, default: "" },
    email: { type: String, trim: true },
    waName: { type: String, trim: true },
    profilePhoto: String,
    source: { type: String, default: "Manual" },
    lifecycleStatus: { type: String, default: "lead" },
    ownerUserId: { type: mongoose.Schema.Types.ObjectId, ref: "User", index: true },
    tagIds: [{ type: mongoose.Schema.Types.ObjectId, ref: "Tag", index: true }],
    customFields: { type: mongoose.Schema.Types.Mixed, default: {} },
    optInStatus: { type: String, enum: ["unknown", "opted_in", "opted_out"], default: "unknown" },
    lastMessageAt: { type: Date, index: true },
  },
  { timestamps: true }
);

// Partial, not a plain unique index: multiple Instagram-only contacts in the same workspace all
// have phone === "" (the schema default), which a plain unique index would reject as duplicates.
contactSchema.index({ workspaceId: 1, phone: 1 }, { unique: true, partialFilterExpression: { phone: { $type: "string", $ne: "" } } });
contactSchema.index({ workspaceId: 1, instagramScopedId: 1 }, { unique: true, partialFilterExpression: { instagramScopedId: { $type: "string", $ne: "" } } });
contactSchema.index({ workspaceId: 1, waName: 1 });
contactSchema.index({ name: "text", phone: "text", email: "text" });

export const Contact = mongoose.model("Contact", contactSchema);
