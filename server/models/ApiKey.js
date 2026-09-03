import mongoose from "mongoose";

// A real server-to-server credential for a client's own external system (their CRM, billing
// software, etc.) to call into this app - distinct from the JWT session auth every other route
// uses, which requires a logged-in human and isn't a sane server-to-server pattern. Only the
// hash is ever stored; the plaintext key is shown to the user exactly once, at creation time.
const apiKeySchema = new mongoose.Schema(
  {
    organizationId: { type: mongoose.Schema.Types.ObjectId, ref: "Organization", required: true, index: true },
    workspaceId: { type: mongoose.Schema.Types.ObjectId, ref: "Workspace", required: true, index: true },
    name: { type: String, required: true, trim: true },
    keyPrefix: { type: String, required: true },
    keyHash: { type: String, required: true, unique: true },
    scopes: { type: [String], default: [] },
    createdByUserId: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
    lastUsedAt: Date,
    revokedAt: Date,
  },
  { timestamps: true }
);

apiKeySchema.index({ workspaceId: 1, revokedAt: 1 });

export const ApiKey = mongoose.model("ApiKey", apiKeySchema);
