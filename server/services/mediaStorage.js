import crypto from "crypto";
import fs from "fs/promises";
import path from "path";
import { fileURLToPath } from "url";
import { PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { config } from "../config.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const uploadRoot = path.resolve(__dirname, "../uploads");
let s3Client;

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
  return config.publicBaseUrl || `${req.protocol}://${req.get("host")}`;
}

function cdnUrlFor(key, baseUrl) {
  if (config.cdnBaseUrl) return `${config.cdnBaseUrl.replace(/\/$/, "")}/${key}`;
  if (config.s3.enabled) return `https://${config.s3.bucket}.s3.${config.s3.region}.amazonaws.com/${key}`;
  return `${baseUrl}/api/uploads/${key}`;
}

function getS3Client() {
  if (!config.s3.enabled) return null;
  if (!s3Client) {
    s3Client = new S3Client({
      region: config.s3.region,
      endpoint: config.s3.endpoint || undefined,
      forcePathStyle: config.s3.forcePathStyle,
    });
  }
  return s3Client;
}

export async function saveMediaBuffer({ workspaceId, buffer, name = "attachment", mimeType = "application/octet-stream", baseUrl }) {
  const id = crypto.randomUUID();
  const fileName = `${Date.now()}-${id}${extensionFor(name, mimeType)}`;
  const key = `${workspaceId}/${fileName}`;
  const s3 = getS3Client();

  if (s3 && config.s3.bucket) {
    await s3.send(new PutObjectCommand({
      Bucket: config.s3.bucket,
      Key: key,
      Body: buffer,
      ContentType: mimeType,
      CacheControl: "public, max-age=604800, immutable",
    }));
  } else {
    const workspaceDir = path.join(uploadRoot, String(workspaceId));
    await fs.mkdir(workspaceDir, { recursive: true });
    await fs.writeFile(path.join(workspaceDir, fileName), buffer);
  }

  const publicPath = config.s3.enabled ? key : `/api/uploads/${workspaceId}/${fileName}`;
  return {
    id,
    name: String(name || "attachment").slice(0, 160),
    url: cdnUrlFor(config.s3.enabled ? key : `${workspaceId}/${fileName}`, baseUrl),
    path: publicPath,
    storage: config.s3.enabled ? "s3" : "local",
    type: mediaTypeFor(mimeType),
    mimeType,
    size: buffer.length,
  };
}
