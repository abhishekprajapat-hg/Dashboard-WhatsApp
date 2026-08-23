export function relativeTime(date) {
  if (!date) return "Never";

  const diffMs = Date.now() - new Date(date).getTime();
  const diffMinutes = Math.max(0, Math.floor(diffMs / 60000));

  if (diffMinutes < 1) return "Just now";
  if (diffMinutes < 60) return `${diffMinutes}m ago`;

  const diffHours = Math.floor(diffMinutes / 60);
  if (diffHours < 24) return `${diffHours}h ago`;

  return `${Math.floor(diffHours / 24)}d ago`;
}

export function shortTime(date) {
  if (!date) return "";
  return new Date(date).toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit" });
}

export function serializeInstagramComment(comment) {
  return {
    id: comment._id.toString(),
    mediaId: comment.mediaId || "",
    fromUsername: comment.fromUsername || "",
    text: comment.text || "",
    repliedAt: comment.repliedAt || null,
    replyText: comment.replyText || "",
    createdAt: comment.createdAt,
  };
}

export function serializeContact(contact, { conversationCount = 0 } = {}) {
  const tags = Array.isArray(contact.tagIds)
    ? contact.tagIds.map((tag) => tag?.name).filter(Boolean)
    : [];
  const crm = contact.customFields?.crm || {};
  const googleSheet = contact.customFields?.googleSheet || {};
  const lifecycleStatus = contact.lifecycleStatus || "lead";

  return {
    id: contact._id.toString(),
    name: contact.name,
    phone: contact.phone,
    email: contact.email || "",
    waName: contact.waName || "",
    profilePhoto: contact.profilePhoto || "",
    tags,
    assignedTo: contact.ownerUserId?.name || "Unassigned",
    source: contact.source || "Manual",
    lastActivity: relativeTime(contact.lastMessageAt || contact.updatedAt),
    conversations: conversationCount,
    status: lifecycleStatus === "inactive" ? "inactive" : "active",
    lifecycleStatus,
    crmStage: crm.stage || lifecycleStatus,
    leadScore: crm.leadScore || 0,
    followUpAt: crm.followUpAt,
    crmAddedAt: crm.addedToCrmAt,
    syncStatus: {
      googleSheet: {
        status: googleSheet.status || (googleSheet.syncedAt ? "synced" : googleSheet.error ? "failed" : "pending"),
        lastSyncedAt: googleSheet.syncedAt,
        error: googleSheet.error || "",
      },
    },
    customFields: contact.customFields || {},
  };
}

export function serializeMessage(message) {
  return {
    id: message._id.toString(),
    content: message.body || "",
    from: message.direction === "outbound" ? "agent" : "contact",
    type: message.type || "text",
    channel: message.channel || "whatsapp",
    time: shortTime(message.sentAt || message.receivedAt || message.createdAt),
    status: message.status,
    attachments: message.attachments || [],
    replyToMessageId: message.metadata?.replyToMessageId || "",
    internal: Boolean(message.metadata?.internal),
    pinned: Boolean(message.pinned),
    starred: Boolean(message.starred),
    providerMessageId: message.providerMessageId || "",
    clientMessageId: message.clientMessageId || message.metadata?.clientMessageId || "",
    sentAt: message.sentAt,
    deliveredAt: message.deliveredAt,
    readAt: message.readAt,
    receivedAt: message.receivedAt,
    createdAt: message.createdAt,
  };
}

function messagePreview(message) {
  if (!message) return "No messages yet";
  if (message.body) return message.body;
  const attachment = message.attachments?.[0];
  if (!attachment) return "No messages yet";
  if (attachment.type === "image" || attachment.mimeType?.startsWith?.("image/")) return "Photo";
  if (attachment.type === "video" || attachment.mimeType?.startsWith?.("video/")) return "Video";
  if (attachment.type === "audio" || attachment.mimeType?.startsWith?.("audio/")) return "Audio";
  return attachment.name || "Document";
}

export function serializeConversation(conversation, messages = [], { userId } = {}) {
  const contact = conversation.contactId || {};
  const conversationTags = Array.isArray(conversation.tagIds)
    ? conversation.tagIds.map((tag) => tag?.name).filter(Boolean)
    : [];
  const contactTags = Array.isArray(contact.tagIds)
    ? contact.tagIds.map((tag) => tag?.name).filter(Boolean)
    : [];
  const tags = Array.from(new Set([...conversationTags, ...contactTags]));
  const lastMessage = conversation.lastMessageId;
  const lastVisibleMessage = messages[messages.length - 1];
  const unread = userId ? Number(conversation.unreadCountByUser?.get?.(userId.toString()) || 0) : 0;
  const crm = contact.customFields?.crm || {};
  const googleSheet = contact.customFields?.googleSheet || {};
  const currentUserId = userId?.toString?.() || userId || "";
  const pinnedByUserIds = conversation.pinnedByUserIds || [];
  const mutedByUserIds = conversation.mutedByUserIds || [];

  return {
    id: conversation._id.toString(),
    contactId: contact._id?.toString?.() || "",
    channel: conversation.channel || "whatsapp",
    name: contact.name || "Unknown contact",
    waName: contact.waName || "",
    profilePhoto: contact.profilePhoto || "",
    phone: contact.phone || "",
    preview: messagePreview(lastVisibleMessage),
    time: relativeTime(conversation.lastMessageAt || conversation.updatedAt).replace(" ago", ""),
    unread,
    status: conversation.status === "pending" ? "waiting" : conversation.status,
    agent: conversation.assignedToUserId?.name,
    agentId: conversation.assignedToUserId?._id?.toString?.() || "",
    tags,
    source: contact.source || "WhatsApp",
    lifecycleStatus: contact.lifecycleStatus || "lead",
    crmStage: crm.stage || contact.lifecycleStatus || "lead",
    leadScore: crm.leadScore || 0,
    followUpAt: crm.followUpAt,
    crmAddedAt: crm.addedToCrmAt,
    syncStatus: {
      googleSheet: {
        status: googleSheet.status || (googleSheet.syncedAt ? "synced" : googleSheet.error ? "failed" : "pending"),
        lastSyncedAt: googleSheet.syncedAt,
        error: googleSheet.error || "",
      },
    },
    customFields: contact.customFields || {},
    pinned: currentUserId ? pinnedByUserIds.some((id) => id?.toString?.() === currentUserId) : false,
    muted: currentUserId ? mutedByUserIds.some((id) => id?.toString?.() === currentUserId) : false,
    lastMessageAt: conversation.lastMessageAt,
    messages: messages.map(serializeMessage),
  };
}

