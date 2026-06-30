import crypto from "crypto";
import fs from "fs/promises";
import path from "path";
import { fileURLToPath } from "url";
import { Router } from "express";

export const mediaRouter = Router();

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const uploadRoot = path.resolve(__dirname, "../uploads");
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

function extensionFor(name = "", mimeType = "") {
  const fromName = path.extname(name).toLowerCase().replace(/[^.\w]/g, "");
  if (fromName) return fromName;
  const map = {
    "image/jpeg": ".jpg",
    "image/png": ".png",
    "image/webp": ".webp",
    "image/gif": ".gif",
    "video/mp4": ".mp4",
    "audio/mpeg": ".mp3",
    "audio/mp4": ".m4a",
    "audio/ogg": ".ogg",
    "application/pdf": ".pdf",
    "text/plain": ".txt",
  };
  return map[mimeType] || ".bin";
}

function mediaTypeFor(mimeType = "") {
  if (mimeType.startsWith("image/")) return "image";
  if (mimeType.startsWith("video/")) return "video";
  if (mimeType.startsWith("audio/")) return "audio";
  return "document";
}

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

  const workspaceDir = path.join(uploadRoot, String(req.user.workspaceId));
  await fs.mkdir(workspaceDir, { recursive: true });

  const id = crypto.randomUUID();
  const ext = extensionFor(name, mimeType);
  const fileName = `${Date.now()}-${id}${ext}`;
  const filePath = path.join(workspaceDir, fileName);
  await fs.writeFile(filePath, buffer);

  const publicPath = `/uploads/${req.user.workspaceId}/${fileName}`;
  const absoluteUrl = `${req.protocol}://${req.get("host")}${publicPath}`;

  res.status(201).json({
    data: {
      id,
      name: String(name).slice(0, 160),
      url: absoluteUrl,
      path: publicPath,
      type: mediaTypeFor(mimeType),
      mimeType,
      size: buffer.length,
    },
  });
});
