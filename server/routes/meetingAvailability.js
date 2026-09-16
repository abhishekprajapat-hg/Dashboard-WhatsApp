import { Router } from "express";
import mongoose from "mongoose";
import { z } from "zod";
import { requirePermission } from "../middleware/auth.js";
import { validateBody } from "../middleware/validate.js";
import { MeetingAvailability } from "../models/index.js";

export const meetingAvailabilityRouter = Router();

const weeklyWindowSchema = z.object({
  dayOfWeek: z.number().int().min(0).max(6),
  startTime: z.string().regex(/^\d{2}:\d{2}$/, "Use HH:MM (24-hour)."),
  endTime: z.string().regex(/^\d{2}:\d{2}$/, "Use HH:MM (24-hour)."),
});

const availabilityBodySchema = z.object({
  weeklyWindows: z.array(weeklyWindowSchema).default([]),
  slotDurationMinutes: z.number().int().min(5).default(30),
  bufferMinutes: z.number().int().min(0).default(0),
  maxConcurrentBookings: z
    .object({ online: z.number().int().min(1).default(1), in_person: z.number().int().min(1).default(1) })
    .default({ online: 1, in_person: 1 }),
  bookingWindowDays: z.number().int().min(1).max(90).default(21),
  minNoticeHours: z.number().int().min(0).default(12),
  blackoutDates: z.array(z.string()).default([]),
  defaultLocation: z.string().trim().max(300).default(""),
});

function serialize(doc) {
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

meetingAvailabilityRouter.get("/", requirePermission("settings:read"), async (req, res) => {
  if (mongoose.connection.readyState !== 1) {
    return res.json({ data: null });
  }
  const doc = await MeetingAvailability.findOne({ organizationId: req.user.organizationId }).lean();
  res.json({ data: doc ? serialize(doc) : null });
});

meetingAvailabilityRouter.put("/", requirePermission("settings:write"), validateBody(availabilityBodySchema), async (req, res) => {
  const doc = await MeetingAvailability.findOneAndUpdate(
    { organizationId: req.user.organizationId },
    { $set: req.body },
    { new: true, upsert: true, setDefaultsOnInsert: true }
  ).lean();
  res.json({ data: serialize(doc) });
});
