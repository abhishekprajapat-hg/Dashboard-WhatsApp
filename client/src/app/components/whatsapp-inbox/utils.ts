import type { Attachment, Conversation, MessageStatus, PendingMedia, WhatsAppMessage } from "./types";

export function initials(name = "") {
  return name
    .split(" ")
    .map((part) => part[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();
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
