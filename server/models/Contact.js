import mongoose from "mongoose";

const contactSchema = new mongoose.Schema(
  {
    organizationId: { type: mongoose.Schema.Types.ObjectId, ref: "Organization", required: true, index: true },
    workspaceId: { type: mongoose.Schema.Types.ObjectId, ref: "Workspace", required: true, index: true },
    name: { type: String, required: true, trim: true },
    phone: { type: String, required: true, trim: true },
    email: { type: String, trim: true },
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

contactSchema.index({ workspaceId: 1, phone: 1 }, { unique: true });
contactSchema.index({ name: "text", phone: "text", email: "text" });

export const Contact = mongoose.model("Contact", contactSchema);
