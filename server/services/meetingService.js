import { CalendarEvent, MeetingAvailability } from "../models/index.js";
import { computeOpenSlots, formatSlotLabel, getMeetingDateKey, istWallTimeToUtc, timeKeyToMinutes, dayOfWeekForDateKey } from "../utils/meetingSlots.js";
import { logger } from "./logger.js";

// The native (non-Vega) counterpart to vegaIntegration.js's checkVegaOfficeHours/
// fetchVegaMeetingSlots/bookVegaMeeting/cancelVegaMeeting - same {ok, ...}-or-{ok:false, reason}
// return shape and the same "never throws, degrades to closed/no slots" spirit, so
// automationExecutors.js can dispatch to either implementation without its own branches caring
// which one ran. Scoped per organization via MeetingAvailability.organizationId, unlike Vega's
// single global config - this is what actually makes a second client's own booking hours
// independent of Nemnidhi's.

export { formatSlotLabel };

async function loadAvailability(organizationId) {
  const doc = await MeetingAvailability.findOne({ organizationId }).lean();
  if (!doc) return null;
  return {
    weeklyWindows: doc.weeklyWindows || [],
    slotDurationMinutes: doc.slotDurationMinutes,
    bufferMinutes: doc.bufferMinutes,
    maxConcurrentBookings: doc.maxConcurrentBookings,
    bookingWindowDays: doc.bookingWindowDays,
    minNoticeHours: doc.minNoticeHours,
    blackoutDates: doc.blackoutDates || [],
    defaultLocation: doc.defaultLocation || "",
  };
}

export async function checkOfficeHoursNow(organizationId) {
  const availability = await loadAvailability(organizationId);
  if (!availability) return { ok: false, reason: "not_configured" };

  const now = new Date();
  const dateKey = getMeetingDateKey(now);
  const dow = dayOfWeekForDateKey(dateKey);
  const nowMinutes = timeKeyToMinutes(
    new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Kolkata", hour: "2-digit", minute: "2-digit", hour12: false })
      .format(now)
      .replace(/^24:/, "00:")
  );

  const open = availability.weeklyWindows.some((window) => {
    if (window.dayOfWeek !== dow) return false;
    return nowMinutes >= timeKeyToMinutes(window.startTime) && nowMinutes < timeKeyToMinutes(window.endTime);
  });

  return { ok: true, open };
}

export async function fetchOpenSlots({ organizationId, type = "online", days } = {}) {
  const availability = await loadAvailability(organizationId);
  if (!availability) return { ok: false, reason: "not_configured" };
  if (!availability.weeklyWindows.length) return { ok: false, reason: "no_availability" };

  const now = new Date();
  const windowDays = Math.min(days ?? availability.bookingWindowDays, availability.bookingWindowDays);
  const rangeEnd = new Date(now.getTime() + (windowDays + 1) * 24 * 60 * 60 * 1000);

  const existingMeetings = await CalendarEvent.find({
    organizationId,
    source: "meeting_booking",
    status: "confirmed",
    startAt: { $gte: now, $lte: rangeEnd },
  })
    .select("startAt")
    .lean();

  const slots = computeOpenSlots({ availability, type, existingMeetings, now, days: windowDays });
  return { ok: true, slots };
}

export async function bookSlot({ organizationId, workspaceId, contactId, conversationId, contactName, contactPhone, type = "online", dateKey, timeKey }) {
  const availability = await loadAvailability(organizationId);
  if (!availability) return { ok: false, reason: "not_configured" };

  const startAt = istWallTimeToUtc(dateKey, timeKey);
  const endAt = new Date(startAt.getTime() + availability.slotDurationMinutes * 60000);

  // Re-check capacity at booking time, not just when the slot list was generated - two customers
  // could be offered the same slot and both tap it before either books.
  const capacity = availability.maxConcurrentBookings?.[type] ?? 1;
  const alreadyBooked = await CalendarEvent.countDocuments({
    organizationId,
    source: "meeting_booking",
    status: "confirmed",
    startAt,
  });
  if (alreadyBooked >= capacity) {
    return { ok: false, reason: "slot_no_longer_available" };
  }

  const event = await CalendarEvent.create({
    organizationId,
    workspaceId,
    title: `Appointment - ${contactName || "WhatsApp lead"}`,
    description: `Booked via WhatsApp automation (${type}).`,
    startAt,
    endAt,
    contactId: contactId || null,
    conversationId: conversationId || null,
    source: "meeting_booking",
    status: "confirmed",
    type,
    location: availability.defaultLocation || "",
    contactPhone: contactPhone || "",
  });

  return {
    ok: true,
    meetingId: event._id.toString(),
    durationMinutes: availability.slotDurationMinutes,
    location: availability.defaultLocation || "",
  };
}

export async function cancelSlot({ organizationId, meetingId, reason }) {
  const event = await CalendarEvent.findOne({ _id: meetingId, organizationId, source: "meeting_booking" });
  if (!event) return { ok: false, reason: "not_found" };
  if (event.status === "cancelled") return { ok: true };

  event.status = "cancelled";
  event.cancelledAt = new Date();
  event.cancelledReason = reason || "";
  await event.save();

  logger.info({ organizationId: organizationId?.toString?.(), meetingId }, "meetingService: cancelled a native booking");
  return { ok: true };
}
