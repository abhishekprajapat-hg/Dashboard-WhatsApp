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

export function displayAttachmentUrl(url = "") {
  if (!url || typeof window === "undefined") return url;
  return url.replace(`${window.location.origin}/uploads/`, `${window.location.origin}/api/uploads/`);
}

export function primaryAttachment(message: WhatsAppMessage): Attachment | undefined {
  return message.attachments?.find((attachment) => attachment.url);
}

export function messageText(message: WhatsAppMessage) {
  const attachmentLinks = (message.attachments || []).map((attachment) => displayAttachmentUrl(attachment.url)).filter(Boolean);
  return [message.content, ...attachmentLinks].filter(Boolean).join("\n");
}

export function visibleStatus(status?: MessageStatus) {
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
