import mongoose from "mongoose";

const aiDocumentSchema = new mongoose.Schema(
  {
    organizationId: { type: mongoose.Schema.Types.ObjectId, ref: "Organization", required: true, index: true },
    workspaceId: { type: mongoose.Schema.Types.ObjectId, ref: "Workspace", required: true, index: true },
    uploadedByUserId: { type: mongoose.Schema.Types.ObjectId, ref: "User", index: true },
    name: { type: String, required: true, trim: true },
    mimeType: { type: String, default: "text/plain" },
    size: { type: Number, default: 0 },
    source: { type: String, default: "knowledge_base", index: true },
    status: { type: String, enum: ["indexed", "processing", "failed"], default: "indexed", index: true },
    content: { type: String, default: "" },
    chunks: { type: [mongoose.Schema.Types.Mixed], default: [] },
    metadata: { type: mongoose.Schema.Types.Mixed, default: {} },
  },
  { timestamps: true }
);

aiDocumentSchema.index({ workspaceId: 1, name: 1 });
aiDocumentSchema.index({ workspaceId: 1, source: 1, updatedAt: -1 });
aiDocumentSchema.index({ name: "text", content: "text" });

export const AiDocument = mongoose.model("AiDocument", aiDocumentSchema);
