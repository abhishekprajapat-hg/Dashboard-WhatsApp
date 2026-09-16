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
    // The fields below are only ever set by a real customer-facing slot booking (source
    // "meeting_booking", via meetingService.js) - execCalendar's plain reminder-style events
    // never touch them, so they default away harmlessly for every pre-existing event.
    status: { type: String, enum: ["confirmed", "cancelled"], default: "confirmed", index: true },
    type: { type: String, enum: ["online", "in_person"], default: "online" },
    location: { type: String, trim: true, default: "" },
    contactPhone: { type: String, trim: true, default: "" },
    cancelledAt: { type: Date, default: null },
    cancelledReason: { type: String, trim: true, default: "" },
  },
  { timestamps: true }
);

calendarEventSchema.index({ workspaceId: 1, startAt: 1 });

export const CalendarEvent = mongoose.model("CalendarEvent", calendarEventSchema);
