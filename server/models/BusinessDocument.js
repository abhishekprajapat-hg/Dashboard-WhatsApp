import mongoose from "mongoose";

// A generated, customer-facing document - v1 scope is AI-drafted proposals (platform master plan,
// Phase 3 Documentation pillar). Distinct from AiDocument.js, which is internal knowledge-base
// content the assistant retrieves from, not something generated to send to a customer.
const businessDocumentSchema = new mongoose.Schema(
  {
    organizationId: { type: mongoose.Schema.Types.ObjectId, ref: "Organization", required: true, index: true },
    workspaceId: { type: mongoose.Schema.Types.ObjectId, ref: "Workspace", required: true, index: true },
    contactId: { type: mongoose.Schema.Types.ObjectId, ref: "Contact", required: true, index: true },
    type: { type: String, enum: ["proposal"], default: "proposal" },
    title: { type: String, required: true, trim: true },
    content: { type: String, required: true },
    status: { type: String, enum: ["draft", "finalized"], default: "draft" },
    // Which AI provider produced the current content - "local_rules" when no provider was
    // configured/available, "manual" once a user edits the content by hand (see routes/documents.js).
    aiProvider: { type: String, default: "" },
    createdByUserId: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
  },
  { timestamps: true }
);

businessDocumentSchema.index({ workspaceId: 1, contactId: 1, createdAt: -1 });
businessDocumentSchema.index({ workspaceId: 1, type: 1 });

export const BusinessDocument = mongoose.model("BusinessDocument", businessDocumentSchema);
