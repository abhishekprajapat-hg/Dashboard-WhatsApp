export type MessageKind =
  | "text"
  | "template"
  | "note"
  | "image"
  | "video"
  | "audio"
  | "document"
  | "pdf"
  | "sticker"
  | "gif"
  | "location"
  | "contact"
  | "system";

export type MessageStatus = "queued" | "sent" | "delivered" | "read" | "failed";

export interface Attachment {
  name: string;
  url: string;
  path?: string;
  storage?: string;
  providerMediaId?: string;
  metaMediaId?: string;
  type?: string;
  mimeType?: string;
  size?: number;
}

export interface WhatsAppMessage {
  id: string;
  content: string;
  from: "contact" | "agent";
  type?: MessageKind;
  time: string;
  status?: MessageStatus;
  clientMessageId?: string;
  attachments?: Attachment[];
  replyToMessageId?: string;
  internal?: boolean;
  pinned?: boolean;
  starred?: boolean;
  reaction?: string;
  providerMessageId?: string;
  sentAt?: string;
  deliveredAt?: string;
  readAt?: string;
  receivedAt?: string;
  createdAt?: string;
  updatedAt?: string;
}

export interface Conversation {
  id: string;
  name: string;
  phone: string;
  preview: string;
  time: string;
  unread: number;
  status: "open" | "waiting" | "resolved" | "bot" | "archived";
  agent?: string;
  agentId?: string;
  tags: string[];
  source?: string;
  lifecycleStatus?: string;
  crmStage?: string;
  leadScore?: number;
  crmAddedAt?: string;
  syncStatus?: { googleSheet?: { status?: string; lastSyncedAt?: string; error?: string } };
  campaign?: string;
  lastSeen?: string;
  lastMessageAt?: string;
  pinned?: boolean;
  muted?: boolean;
  messages: WhatsAppMessage[];
}

export interface TeamMember {
  id: string;
  userId: string;
  name: string;
  role: "admin" | "manager" | "agent";
  status: string;
}

export interface WhatsAppTemplate {
  id: string;
  name: string;
  language: string;
  category: string;
  status: "approved" | "pending" | "rejected";
}

export interface PendingMedia {
  file: File;
  previewUrl: string;
  kind: "image" | "video" | "audio" | "document";
}

export type InboxFilter = "all" | "unread" | "assigned" | "open" | "waiting" | "resolved" | "archived" | "labels";

export interface PageState {
  loading: boolean;
  hasMore: boolean;
  nextCursor: string | null;
}

export interface UploadState {
  id: string;
  fileName: string;
  progress: number;
  status: "uploading" | "uploaded" | "failed";
  error?: string;
}

export interface QueuedMessage {
  id: string;
  conversationId: string;
  content: string;
  replyToMessageId?: string;
  attachments: Attachment[];
  attempts: number;
  status: "queued" | "sending" | "failed";
}
