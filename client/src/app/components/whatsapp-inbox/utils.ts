import type { Attachment, Conversation, MessageStatus, PendingMedia, WhatsAppMessage } from "./types";

// Timestamps come from the server as raw ISO strings on purpose - formatting them into
// display text happens here, in the browser, so it uses the viewer's own timezone instead
// of whatever timezone the server happens to run in.
export function messageTimestamp(message?: Pick<WhatsAppMessage, "sentAt" | "receivedAt" | "createdAt">) {
  const raw = message?.sentAt || message?.receivedAt || message?.createdAt;
  if (!raw) return null;
  const date = new Date(raw);
  return Number.isNaN(date.getTime()) ? null : date;
}

export function displayTime(message: Pick<WhatsAppMessage, "sentAt" | "receivedAt" | "createdAt" | "time">) {
  const date = messageTimestamp(message);
  if (date) return date.toLocaleTimeString("en-IN", { hour: "numeric", minute: "2-digit" });
  return message.time || "";
}

export function initials(name = "") {
  return name
    .split(" ")
    .map((part) => part[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();
}

// A fixed rotation of soft tints (not random - the same name always lands on the same one, so a
// contact's avatar colour stays stable across renders/reloads). Muted on purpose: in a list of forty
// chats, loud avatars compete with the unread badges that actually matter.
const AVATAR_TINTS = [
  "bg-[#d9ecea] text-[#0b5d66] dark:bg-[#14383b] dark:text-[#8fd6dc]",
  "bg-[#efe3cc] text-[#7a5a1c] dark:bg-[#3a2f1a] dark:text-[#e2c07e]",
  "bg-[#f1dcd5] text-[#8f3b26] dark:bg-[#3d2520] dark:text-[#eaa792]",
  "bg-[#dfe3ef] text-[#34466f] dark:bg-[#232a3b] dark:text-[#a9b8e0]",
  "bg-[#e6dff0] text-[#57407e] dark:bg-[#2e2640] dark:text-[#c3afe6]",
  "bg-[#dcebdc] text-[#2f6a3a] dark:bg-[#1f3424] dark:text-[#9fd3a8]",
];

export function avatarTint(name = "") {
  let hash = 0;
  for (let i = 0; i < name.length; i += 1) {
    hash = (hash * 31 + name.charCodeAt(i)) | 0;
  }
  return AVATAR_TINTS[Math.abs(hash) % AVATAR_TINTS.length];
}

export function cn(...classes: Array<string | false | null | undefined>) {
  return classes.filter(Boolean).join(" ");
}

export function mediaKind(file: File): PendingMedia["kind"] {
  if (file.type.startsWith("image/")) return "image";
  if (file.type.startsWith("video/")) return "video";
  if (file.type.startsWith("audio/")) return "audio";
  return "document";
}

export function formatBytes(size = 0) {
  if (!size) return "";
  if (size < 1024 * 1024) return `${Math.max(1, Math.round(size / 1024))} KB`;
  return `${(size / 1024 / 1024).toFixed(1)} MB`;
}

function apiBaseOrigin() {
  const rawUrl = String(import.meta.env.VITE_API_URL || "http://localhost:4000/api").trim();
  try {
    return new URL(rawUrl, window.location.origin).origin;
  } catch {
    return window.location.origin;
  }
}

export function displayAttachmentUrl(attachmentOrUrl: Attachment | string = "") {
  const attachment = typeof attachmentOrUrl === "string" ? null : attachmentOrUrl;
  const path = attachment?.path || "";
  const url = typeof attachmentOrUrl === "string" ? attachmentOrUrl : attachment?.url || "";

  if (typeof window === "undefined") return path || url;
  if (attachment?.storage === "local" && path.startsWith("/api/uploads/")) return `${apiBaseOrigin()}${path}`;
  if (path.startsWith("/api/uploads/")) return `${apiBaseOrigin()}${path}`;
  if (!url) return "";
  return url.replace(`${window.location.origin}/uploads/`, `${apiBaseOrigin()}/api/uploads/`);
}

export function primaryAttachment(message: WhatsAppMessage): Attachment | undefined {
  return message.attachments?.find((attachment) => attachment.url);
}

export function messageText(message: WhatsAppMessage) {
  const attachmentLinks = (message.attachments || []).map((attachment) => displayAttachmentUrl(attachment)).filter(Boolean);
  return [message.content, ...attachmentLinks].filter(Boolean).join("\n");
}

export function visibleStatus(status?: MessageStatus) {
  if (status === "queued") return "Queued";
  if (status === "read") return "Read";
  if (status === "delivered") return "Delivered";
  if (status === "failed") return "Failed";
  return "Sent";
}

export function conversationMeta(conversation: Conversation) {
  const hasLeadTag = conversation.tags?.includes("Lead");
  return {
    crmStage: conversation.crmStage || conversation.lifecycleStatus || (hasLeadTag ? "lead" : "new"),
    isInCrm: Boolean(conversation.crmAddedAt || hasLeadTag),
    lastSeen: conversation.lastSeen || "Recently active",
    campaign: conversation.campaign || "Organic WhatsApp",
  };
}
