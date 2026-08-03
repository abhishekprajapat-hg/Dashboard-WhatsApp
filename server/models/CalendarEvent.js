import mongoose from "mongoose";

const calendarEventSchema = new mongoose.Schema(
  {
    organizationId: { type: mongoose.Schema.Types.ObjectId, ref: "Organization", required: true, index: true },
    workspaceId: { type: mongoose.Schema.Types.ObjectId, ref: "Workspace", required: true, index: true },
    title: { type: String, required: true, trim: true },
    description: { type: String, default: "" },
    startAt: { type: Date, required: true },
    endAt: { type: Date, default: null },
    assignedToUserId: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null, index: true },
    contactId: { type: mongoose.Schema.Types.ObjectId, ref: "Contact", default: null, index: true },
    conversationId: { type: mongoose.Schema.Types.ObjectId, ref: "Conversation", default: null, index: true },
    source: { type: String, default: "automation" },
  },
  { timestamps: true }
);

calendarEventSchema.index({ workspaceId: 1, startAt: 1 });

export const CalendarEvent = mongoose.model("CalendarEvent", calendarEventSchema);
