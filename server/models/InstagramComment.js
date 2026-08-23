import mongoose from "mongoose";

const instagramCommentSchema = new mongoose.Schema(
  {
    organizationId: { type: mongoose.Schema.Types.ObjectId, ref: "Organization", required: true, index: true },
    workspaceId: { type: mongoose.Schema.Types.ObjectId, ref: "Workspace", required: true, index: true },
    instagramAccountId: { type: mongoose.Schema.Types.ObjectId, ref: "InstagramAccount", required: true, index: true },
    commentId: { type: String, required: true },
    mediaId: { type: String, default: "" },
    parentId: { type: String, default: "" },
    fromUsername: { type: String, default: "" },
    fromId: { type: String, default: "" },
    text: { type: String, default: "" },
    repliedAt: Date,
    replyText: { type: String, default: "" },
  },
  { timestamps: true }
);

instagramCommentSchema.index({ workspaceId: 1, commentId: 1 }, { unique: true });

export const InstagramComment = mongoose.model("InstagramComment", instagramCommentSchema);
