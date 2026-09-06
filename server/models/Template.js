import mongoose from "mongoose";

const templateSchema = new mongoose.Schema(
  {
    organizationId: { type: mongoose.Schema.Types.ObjectId, ref: "Organization", required: true, index: true },
    workspaceId: { type: mongoose.Schema.Types.ObjectId, ref: "Workspace", required: true, index: true },
    whatsappAccountId: { type: mongoose.Schema.Types.ObjectId, ref: "WhatsAppAccount", index: true },
    providerTemplateId: String,
    name: { type: String, required: true },
    slug: { type: String, trim: true, index: true },
    type: {
      type: String,
      enum: ["whatsapp", "quick_reply", "automation", "campaign", "follow_up", "lead_stage"],
      default: "whatsapp",
      index: true,
    },
    language: { type: String, default: "en" },
    category: {
      type: String,
      enum: ["marketing", "utility", "authentication", "support", "sales", "payment", "appointment", "general", "MARKETING", "UTILITY", "AUTHENTICATION"],
      default: "utility",
      index: true,
    },
    body: { type: String, default: "" },
    variables: { type: [String], default: [] },
    components: { type: [mongoose.Schema.Types.Mixed], default: [] },
    status: { type: String, enum: ["draft", "active", "archived", "approved", "pending", "rejected"], default: "pending", index: true },
    usageCount: { type: Number, default: 0 },
    lastUsedAt: Date,
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
    updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
    lastSyncedAt: Date,
  },
  { timestamps: true }
);

templateSchema.index(
  { workspaceId: 1, whatsappAccountId: 1, name: 1, language: 1 },
  { unique: true, partialFilterExpression: { whatsappAccountId: { $type: "objectId" } } }
);
templateSchema.index({ workspaceId: 1, slug: 1 }, { unique: true, partialFilterExpression: { slug: { $type: "string" } } });
templateSchema.index({ workspaceId: 1, type: 1, status: 1, updatedAt: -1 });

export const Template = mongoose.model("Template", templateSchema);
