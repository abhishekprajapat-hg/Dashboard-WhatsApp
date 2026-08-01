import mongoose from "mongoose";
import { z } from "zod";

export const objectIdString = z.string().refine((value) => mongoose.Types.ObjectId.isValid(value), {
  message: "Must be a valid id.",
});

export const optionalObjectIdString = z
  .string()
  .refine((value) => value === "" || mongoose.Types.ObjectId.isValid(value), { message: "Must be a valid id." })
  .optional();

export const trimmedString = (message = "This field is required.") => z.string().trim().min(1, message);

function isHttpUrl(value) {
  try {
    const parsed = new URL(value);
    return parsed.protocol === "http:" || parsed.protocol === "https:";
  } catch {
    return false;
  }
}

export const httpUrlString = (message = "Must be a valid http(s) URL.") =>
  z.string().trim().refine(isHttpUrl, { message });

// Allows an empty string (webhook not configured yet) but validates format when non-empty.
export const optionalHttpUrlString = (message = "Must be a valid http(s) URL.") =>
  z
    .string()
    .trim()
    .refine((value) => value === "" || isHttpUrl(value), { message })
    .optional()
    .default("");

export const optionalDateString = (message = "Must be a valid date.") =>
  z
    .string()
    .trim()
    .refine((value) => value === "" || !Number.isNaN(new Date(value).getTime()), { message })
    .optional();
