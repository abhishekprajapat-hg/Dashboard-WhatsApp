import mongoose from "mongoose";

// One document per organization - the native (non-Vega) booking config an automation flow's
// check_office_hours/book_meeting nodes read when Organization.settings.meetingProvider is
// "native" (see automationExecutors.js). Mirrors Vega's own MeetingAvailability shape
// (src/models/MeetingAvailability.ts) so the slot-computation logic ported into
// lib/meetingSlots.js stays a drop-in match, just scoped per-organization instead of being one
// global config.
const weeklyWindowSchema = new mongoose.Schema(
  {
    dayOfWeek: { type: Number, required: true, min: 0, max: 6 },
    // "HH:MM" IST wall-clock, not a Date - see lib/meetingSlots.js for the conversion.
    startTime: { type: String, required: true, trim: true, maxlength: 5 },
    endTime: { type: String, required: true, trim: true, maxlength: 5 },
  },
  { _id: false }
);

const meetingAvailabilitySchema = new mongoose.Schema(
  {
    organizationId: { type: mongoose.Schema.Types.ObjectId, ref: "Organization", required: true, unique: true, index: true },
    weeklyWindows: { type: [weeklyWindowSchema], default: [] },
    slotDurationMinutes: { type: Number, default: 30, min: 5 },
    bufferMinutes: { type: Number, default: 0, min: 0 },
    maxConcurrentBookings: {
      online: { type: Number, default: 1, min: 1 },
      in_person: { type: Number, default: 1, min: 1 },
    },
    bookingWindowDays: { type: Number, default: 21, min: 1, max: 90 },
    minNoticeHours: { type: Number, default: 12, min: 0 },
    // "YYYY-MM-DD" IST date-key strings - see lib/meetingSlots.js.
    blackoutDates: { type: [String], default: [] },
    // Denormalized default for a booked event's `location` field - a fixed office address for
    // in_person, or a note like "Phone call" for online. Real per-booking location can still
    // override this later if a flow ever needs to.
    defaultLocation: { type: String, trim: true, default: "" },
  },
  { timestamps: true }
);

export const MeetingAvailability = mongoose.model("MeetingAvailability", meetingAvailabilitySchema);
