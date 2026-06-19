import mongoose from "mongoose";

const templateSchema = new mongoose.Schema(
  {
    organizationId: { type: mongoose.Schema.Types.ObjectId, ref: "Organization", required: true, index: true },
    workspaceId: { type: mongoose.Schema.Types.ObjectId, ref: "Workspace", required: true, index: true },
    whatsappAccountId: { type: mongoose.Schema.Types.ObjectId, ref: "WhatsAppAccount", required: true, index: true },
    providerTemplateId: String,
    name: { type: String, required: true },
    language: { type: String, default: "en" },
    category: { type: String, default: "UTILITY" },
    components: { type: [mongoose.Schema.Types.Mixed], default: [] },
    status: { type: String, enum: ["approved", "pending", "rejected"], default: "pending", index: true },
    lastSyncedAt: Date,
  },
  { timestamps: true }
);

templateSchema.index({ workspaceId: 1, whatsappAccountId: 1, name: 1, language: 1 }, { unique: true });

export const Template = mongoose.model("Template", templateSchema);
