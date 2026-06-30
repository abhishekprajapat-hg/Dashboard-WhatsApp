import { Router } from "express";
import { absoluteBaseUrl, saveMediaBuffer } from "../services/mediaStorage.js";

export const mediaRouter = Router();

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

mediaRouter.post("/upload", async (req, res) => {
  const { name = "attachment", mimeType = "application/octet-stream", data = "" } = req.body || {};
  if (!data || typeof data !== "string") {
    return res.status(400).json({ error: "VALIDATION_ERROR", message: "File data is required." });
  }

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
