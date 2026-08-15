import { Router } from "express";
import { z } from "zod";
import { requirePermission } from "../middleware/auth.js";
import { validateBody } from "../middleware/validate.js";
import { trimmedString } from "../utils/zodHelpers.js";
import { absoluteBaseUrl, saveMediaBuffer } from "../services/mediaStorage.js";

export const mediaRouter = Router();

// mimeType allow-list, byte-length cap, and base64 decoding stay as manual business-logic checks
// below (they need the decoded buffer, not just the raw shape) - this schema only replaces the
// informal destructuring-with-defaults that was here before.
export const uploadMediaSchema = z.object({
  name: z.string().trim().optional().default("attachment"),
  mimeType: z.string().trim().optional().default("application/octet-stream"),
  data: trimmedString("File data is required."),
});

const maxUploadBytes = 10 * 1024 * 1024;

const allowedMimeTypes = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/gif",
  "video/mp4",
  "audio/mpeg",
  "audio/mp4",
  "audio/ogg",
  "application/pdf",
  "text/plain",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.ms-excel",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
]);

mediaRouter.post("/upload", requirePermission("media:write"), validateBody(uploadMediaSchema), async (req, res) => {
  const { name, mimeType, data } = req.body;

  if (!allowedMimeTypes.has(mimeType)) {
    return res.status(400).json({ error: "UNSUPPORTED_MEDIA", message: "This file type is not supported yet." });
  }

  const base64 = data.includes(",") ? data.split(",").pop() : data;
  const buffer = Buffer.from(base64, "base64");
  if (!buffer.length) {
    return res.status(400).json({ error: "VALIDATION_ERROR", message: "File data is invalid." });
  }
  if (buffer.length > maxUploadBytes) {
    return res.status(413).json({ error: "FILE_TOO_LARGE", message: "Maximum media upload size is 10 MB." });
  }

  res.status(201).json({
    data: await saveMediaBuffer({
      workspaceId: req.user.workspaceId,
      buffer,
      name,
      mimeType,
      baseUrl: absoluteBaseUrl(req),
    }),
  });
});
