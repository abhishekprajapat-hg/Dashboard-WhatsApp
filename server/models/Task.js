import mongoose from "mongoose";

const taskSchema = new mongoose.Schema(
  {
    organizationId: { type: mongoose.Schema.Types.ObjectId, ref: "Organization", required: true, index: true },
    workspaceId: { type: mongoose.Schema.Types.ObjectId, ref: "Workspace", required: true, index: true },
    title: { type: String, required: true, trim: true },
    description: { type: String, default: "" },
    status: { type: String, enum: ["open", "completed"], default: "open", index: true },
    dueAt: { type: Date, default: null },
    assignedToUserId: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null, index: true },
    contactId: { type: mongoose.Schema.Types.ObjectId, ref: "Contact", default: null, index: true },
    conversationId: { type: mongoose.Schema.Types.ObjectId, ref: "Conversation", default: null, index: true },
    source: { type: String, default: "automation" },
  },
  { timestamps: true }
);

taskSchema.index({ workspaceId: 1, status: 1, dueAt: 1 });

export const Task = mongoose.model("Task", taskSchema);
