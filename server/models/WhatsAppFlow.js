import mongoose from "mongoose";

const whatsAppFlowSchema = new mongoose.Schema(
  {
    organizationId: { type: mongoose.Schema.Types.ObjectId, ref: "Organization", required: true, index: true },
    workspaceId: { type: mongoose.Schema.Types.ObjectId, ref: "Workspace", required: true, index: true },
    whatsappAccountId: { type: mongoose.Schema.Types.ObjectId, ref: "WhatsAppAccount", required: true, index: true },
    name: { type: String, required: true },
    template: { type: String, required: true },
    categories: { type: [String], default: [] },
    flowJson: { type: mongoose.Schema.Types.Mixed, required: true },
    metaFlowId: { type: String, required: true, index: true },
    status: { type: String, enum: ["draft", "published", "deprecated"], default: "draft" },
    lastError: { type: String, default: "" },
  },
  { timestamps: true }
);

whatsAppFlowSchema.index({ workspaceId: 1, status: 1 });

export const WhatsAppFlow = mongoose.model("WhatsAppFlow", whatsAppFlowSchema);
