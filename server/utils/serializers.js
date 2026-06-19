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

export function serializeContact(contact, { conversationCount = 0 } = {}) {
  const tags = Array.isArray(contact.tagIds)
    ? contact.tagIds.map((tag) => tag?.name).filter(Boolean)
    : [];
  const crm = contact.customFields?.crm || {};
  const lifecycleStatus = contact.lifecycleStatus || "lead";

  return {
    id: contact._id.toString(),
    name: contact.name,
    phone: contact.phone,
    email: contact.email || "",
    tags,
    assignedTo: contact.ownerUserId?.name || "Unassigned",
    source: contact.source || "Manual",
    lastActivity: relativeTime(contact.lastMessageAt || contact.updatedAt),
    conversations: conversationCount,
    status: lifecycleStatus === "inactive" ? "inactive" : "active",
    lifecycleStatus,
    crmStage: crm.stage || lifecycleStatus,
    crmAddedAt: crm.addedToCrmAt,
  };
}

export function serializeMessage(message) {
  return {
    id: message._id.toString(),
    content: message.body || "",
    from: message.direction === "outbound" ? "agent" : "contact",
    time: shortTime(message.sentAt || message.receivedAt || message.createdAt),
    status: message.status,
  };
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
  const unread = userId ? Number(conversation.unreadCountByUser?.get?.(userId.toString()) || 0) : 0;
  const crm = contact.customFields?.crm || {};

  return {
    id: conversation._id.toString(),
    contactId: contact._id?.toString?.() || "",
    name: contact.name || "Unknown contact",
    phone: contact.phone || "",
    preview: lastMessage?.body || "No messages yet",
    time: relativeTime(conversation.lastMessageAt || conversation.updatedAt).replace(" ago", ""),
    unread,
    status: conversation.status === "pending" ? "waiting" : conversation.status,
    agent: conversation.assignedToUserId?.name,
    tags,
    source: contact.source || "WhatsApp",
    lifecycleStatus: contact.lifecycleStatus || "lead",
    crmStage: crm.stage || contact.lifecycleStatus || "lead",
    crmAddedAt: crm.addedToCrmAt,
    messages: messages.map(serializeMessage),
  };
}

