import crypto from "crypto";
import fs from "fs/promises";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const uploadRoot = path.resolve(__dirname, "../uploads");

const extensionMap = {
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

export function extensionFor(name = "", mimeType = "") {
  const fromName = path.extname(name).toLowerCase().replace(/[^.\w]/g, "");
  if (fromName) return fromName;
  return extensionMap[mimeType] || ".bin";
}

export function mediaTypeFor(mimeType = "") {
  if (mimeType.startsWith("image/")) return "image";
  if (mimeType.startsWith("video/")) return "video";
  if (mimeType.startsWith("audio/")) return "audio";
  return "document";
}

export function absoluteBaseUrl(req) {
  return `${req.protocol}://${req.get("host")}`;
}

export async function saveMediaBuffer({ workspaceId, buffer, name = "attachment", mimeType = "application/octet-stream", baseUrl }) {
  const workspaceDir = path.join(uploadRoot, String(workspaceId));
  await fs.mkdir(workspaceDir, { recursive: true });

  const id = crypto.randomUUID();
  const fileName = `${Date.now()}-${id}${extensionFor(name, mimeType)}`;
  const filePath = path.join(workspaceDir, fileName);
  await fs.writeFile(filePath, buffer);

  const publicPath = `/api/uploads/${workspaceId}/${fileName}`;
  return {
    id,
    name: String(name || "attachment").slice(0, 160),
    url: `${baseUrl}${publicPath}`,
    path: publicPath,
    type: mediaTypeFor(mimeType),
    mimeType,
    size: buffer.length,
  };
}
