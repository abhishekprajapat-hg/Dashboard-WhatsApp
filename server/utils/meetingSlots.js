// Ported from Vega's src/lib/meetings/{date,slots}.ts, which this codebase's native (non-Vega)
// meeting booking deliberately mirrors rather than re-deriving - same pure, DB-free computation,
// just living in Dashboard-WhatsApp now so a client's own automation flow (e.g. Sundrishti's)
// doesn't have to book into Nemnidhi's Vega calendar. India observes no DST, so a fixed +5:30
// offset is always safe.

export const MEETING_TIME_ZONE = "Asia/Kolkata";
const IST_OFFSET_MINUTES = 330;

function readPart(parts, type) {
  return parts.find((part) => part.type === type)?.value ?? "";
}

/** IST calendar-date key ("YYYY-MM-DD") for a given instant. */
export function getMeetingDateKey(date = new Date()) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: MEETING_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  return `${readPart(parts, "year")}-${readPart(parts, "month")}-${readPart(parts, "day")}`;
}

/** IST wall-clock "HH:MM" for a given instant. */
export function getMeetingTimeKey(date) {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: MEETING_TIME_ZONE,
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(date);
  return `${readPart(parts, "hour")}:${readPart(parts, "minute")}`;
}

/** dayOfWeek (0=Sun..6=Sat) of an IST calendar date, given only its "YYYY-MM-DD" key. */
export function dayOfWeekForDateKey(dateKey) {
  return new Date(`${dateKey}T00:00:00.000Z`).getUTCDay();
}

/** The core conversion: an IST wall-clock day+time -> the real UTC instant. */
export function istWallTimeToUtc(dateKey, timeHHMM) {
  const [year, month, day] = dateKey.split("-").map(Number);
  const [hour, minute] = timeHHMM.split(":").map(Number);
  const naiveUtcMs = Date.UTC(year, month - 1, day, hour, minute, 0);
  return new Date(naiveUtcMs - IST_OFFSET_MINUTES * 60 * 1000);
}

/** IST date key `days` calendar-days after `dateKey`. */
export function addDaysToDateKey(dateKey, days) {
  const base = new Date(`${dateKey}T00:00:00.000Z`);
  base.setUTCDate(base.getUTCDate() + days);
  return getMeetingDateKey(base);
}

/** Minutes since midnight, from an "HH:MM" string. */
export function timeKeyToMinutes(timeHHMM) {
  const [hour, minute] = timeHHMM.split(":").map(Number);
  return hour * 60 + minute;
}

export function minutesToTimeKey(totalMinutes) {
  const hour = Math.floor(totalMinutes / 60).toString().padStart(2, "0");
  const minute = (totalMinutes % 60).toString().padStart(2, "0");
  return `${hour}:${minute}`;
}

/**
 * @param {object} params
 * @param {object} params.availability - MeetingAvailability doc (weeklyWindows, slotDurationMinutes, bufferMinutes, maxConcurrentBookings, bookingWindowDays, minNoticeHours, blackoutDates)
 * @param {"online"|"in_person"} params.type
 * @param {Array<{startAt: Date}>} params.existingMeetings - already-booked instants to exclude for capacity
 * @param {Date} [params.now]
 * @param {number} [params.days]
 * @returns {Array<{dateKey: string, timeKey: string, startAtUtc: Date, type: string}>}
 */
export function computeOpenSlots(params) {
  const { availability, type, existingMeetings, now = new Date() } = params;
  const days = Math.min(params.days ?? availability.bookingWindowDays, availability.bookingWindowDays);
  const capacity = availability.maxConcurrentBookings?.[type] ?? 1;
  const stepMinutes = availability.slotDurationMinutes + availability.bufferMinutes;
  const minNoticeMs = availability.minNoticeHours * 60 * 60 * 1000;
  const blackoutSet = new Set(availability.blackoutDates || []);

  const bookedCountByInstant = new Map();
  for (const meeting of existingMeetings) {
    const key = meeting.startAt.getTime();
    bookedCountByInstant.set(key, (bookedCountByInstant.get(key) ?? 0) + 1);
  }

  const todayKey = getMeetingDateKey(now);
  const slots = [];

  for (let d = 0; d <= days; d++) {
    const dateKey = addDaysToDateKey(todayKey, d);
    if (blackoutSet.has(dateKey)) continue;

    const dow = dayOfWeekForDateKey(dateKey);
    const windowsForDay = (availability.weeklyWindows || []).filter((w) => w.dayOfWeek === dow);

    for (const window of windowsForDay) {
      const windowStart = timeKeyToMinutes(window.startTime);
      const windowEnd = timeKeyToMinutes(window.endTime);

      for (let t = windowStart; t + availability.slotDurationMinutes <= windowEnd; t += stepMinutes) {
        const timeKey = minutesToTimeKey(t);
        const startAtUtc = istWallTimeToUtc(dateKey, timeKey);

        if (startAtUtc.getTime() < now.getTime() + minNoticeMs) continue;
        if ((bookedCountByInstant.get(startAtUtc.getTime()) ?? 0) >= capacity) continue;

        slots.push({ dateKey, timeKey, startAtUtc, type });
      }
    }
  }

  return slots;
}

/** "2026-09-08"/"11:00" -> "Tue 8 Sep, 11:00 AM" for a WhatsApp list row / confirmation text. */
export function formatSlotLabel(dateKey, timeKey) {
  const [year, month, day] = dateKey.split("-").map(Number);
  const [hour, minute] = timeKey.split(":").map(Number);
  const weekday = new Date(Date.UTC(year, month - 1, day)).toLocaleDateString("en-US", { weekday: "short", timeZone: "UTC" });
  const monthLabel = new Date(Date.UTC(year, month - 1, day)).toLocaleDateString("en-US", { month: "short", timeZone: "UTC" });
  const period = hour >= 12 ? "PM" : "AM";
  const hour12 = hour % 12 || 12;
  return `${weekday} ${day} ${monthLabel}, ${hour12}:${String(minute).padStart(2, "0")} ${period}`;
}
