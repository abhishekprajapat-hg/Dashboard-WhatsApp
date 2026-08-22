import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  addConversationToCrm,
  assignConversation,
  deleteConversationMessage,
  getApiBaseUrl,
  getConversationByContact,
  getConversationMessages,
  getConversations,
  getTeamMembers,
  getUnreadCount,
  markConversationRead,
  sendConversationNote,
  updateConversationSettings,
  updateConversationStatus,
  updateMessageActions,
  updateMessageReceipt,
} from "../../../lib/api";
import { mediaCache } from "../services/mediaCache";
import { messageQueue } from "../services/messageQueue";
import { whatsAppRealtimeService } from "../services/realtimeService";
import { useWhatsAppInboxStore } from "../store";
import type { Attachment, Conversation, PendingMedia, QueuedMessage, TeamMember, WhatsAppMessage } from "../types";
import { mediaKind, messageText, primaryAttachment, displayAttachmentUrl } from "../utils";

interface UseWhatsAppEngineOptions {
  openContactId?: string | null;
  currentUserId?: string;
  canWrite?: boolean;
  onUnreadCountChange?: (count: number) => void;
}

interface ConversationPage {
  data: Conversation[];
  page?: { hasMore?: boolean; nextCursor?: string | null };
}

interface MessagePage {
  data: WhatsAppMessage[];
  page?: { hasMore?: boolean; nextCursor?: string | null };
}

function clientMessageId() {
  return `client_${Date.now()}_${Math.random().toString(36).slice(2)}`;
}

export function useWhatsAppEngine({ openContactId, currentUserId, canWrite = false, onUnreadCountChange }: UseWhatsAppEngineOptions) {
  const store = useWhatsAppInboxStore();
  const [members, setMembers] = useState<TeamMember[]>([]);
  const [messageSearch, setMessageSearch] = useState("");
  const [inputText, setInputText] = useState("");
  const [composerMode, setComposerMode] = useState<"reply" | "note">("reply");
  const [replyTo, setReplyTo] = useState<WhatsAppMessage | null>(null);
  const [pendingMedia, setPendingMedia] = useState<PendingMedia[]>([]);
  const [uploading, setUploading] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);
  const [recording, setRecording] = useState(false);
  const [crmSaving, setCrmSaving] = useState(false);
  const [assigning, setAssigning] = useState(false);
  const currentTypingId = useRef("");

  const conversations = useMemo(
    () =>
      store.conversationIds.map((id) => ({
        ...store.conversationById[id],
        messages: store.messagesByConversationId[id] || [],
      })),
    [store.conversationById, store.conversationIds, store.messagesByConversationId]
  );
  const selected = conversations.find((conversation) => conversation.id === store.selectedId) || conversations[0];
  const selectedMessages = selected ? store.messagesByConversationId[selected.id] || [] : [];

  const loadConversations = useCallback(async () => {
    store.setLoadingState({ loading: true, error: "" });
    const status = ["open", "waiting", "resolved", "archived"].includes(store.filter) ? store.filter : undefined;
    try {
      const response = await getConversations<ConversationPage>({
        limit: 50,
        search: store.search,
        status,
        unread: store.filter === "unread",
      });
      store.setConversations(response.data, response.page);
      store.setLoadingState({ loading: false, error: "" });
    } catch (error) {
      store.setLoadingState({
        loading: false,
        error: error instanceof Error ? error.message : "Could not load conversations.",
      });
    }
  }, [store.filter, store.search]);

  useEffect(() => {
    getTeamMembers<{ data: TeamMember[]; total: number }>()
      .then((response) => setMembers(response.data.filter((member) => member.userId)))
      .catch(() => undefined);
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      loadConversations();
    }, store.search ? 250 : 0);
    return () => window.clearTimeout(timer);
  }, [loadConversations, store.search]);

  useEffect(() => {
    whatsAppRealtimeService.connect(getApiBaseUrl().replace(/\/api\/?$/, ""), {
      onConversation: (conversation, unreadCount) => {
        store.upsertConversation(conversation);
        if (typeof unreadCount === "number") onUnreadCountChange?.(unreadCount);
      },
      onTyping: store.setTyping,
      onPresence: store.setOnlineUsers,
      onConnectionChange: store.setConnectionState,
    });
    return () => whatsAppRealtimeService.disconnect();
  }, [onUnreadCountChange]);

  useEffect(() => {
    if (!selected?.id) return;
    whatsAppRealtimeService.joinConversation(selected.id);
    return () => whatsAppRealtimeService.leaveConversation(selected.id);
  }, [selected?.id]);

  useEffect(() => {
    if (!openContactId) return;
    getConversationByContact<{ data: Conversation }>(openContactId)
      .then((response) => {
        store.upsertConversation(response.data);
        store.selectConversation(response.data.id);
        store.setFilter("all");
      })
      .catch(() => undefined);
  }, [openContactId]);

  useEffect(() => {
    if (!store.selectedId || !canWrite) return;
    markConversationRead<{ unread: number }>(store.selectedId)
      .then(() => {
        store.updateConversation(store.selectedId, { unread: 0 });
        return getUnreadCount<{ unread: number }>();
      })
      .then((response) => onUnreadCountChange?.(response.unread))
      .catch(() => undefined);
  }, [store.selectedId, canWrite, onUnreadCountChange]);

  useEffect(() => {
    if (!canWrite) return;
    const outbound = selectedMessages.filter((message) => message.from === "agent" && message.status !== "read");
    for (const message of outbound) {
      if (!selected?.id || message.id.startsWith("local_")) continue;
      updateMessageReceipt(selected.id, message.id, "read").catch(() => undefined);
    }
  }, [selected?.id, selectedMessages, canWrite]);

  const loadOlderMessages = useCallback(async () => {
    if (!selected?.id) return;
    const page = store.messagePageByConversationId[selected.id];
    if (page?.loading || page?.hasMore === false) return;
    store.setMessagePage(selected.id, { loading: true });
    try {
      const response = await getConversationMessages<MessagePage>(selected.id, {
        before: page?.nextCursor || selectedMessages[0]?.createdAt,
        limit: 50,
      });
      store.prependMessages(selected.id, response.data, {
        loading: false,
        hasMore: Boolean(response.page?.hasMore),
        nextCursor: response.page?.nextCursor || null,
      });
    } catch {
      store.setMessagePage(selected.id, { loading: false });
    }
  }, [selected?.id, selectedMessages, store.messagePageByConversationId]);

  const addMediaFiles = useCallback((files: File[]) => {
    if (!files.length) return;
    setPendingMedia((current) => [
      ...current,
      ...files.map((file) => ({
        file,
        previewUrl: mediaCache.preview(file),
        kind: mediaKind(file),
      })),
    ].slice(0, 6));
  }, []);

  const removePendingMedia = useCallback((index: number) => {
    setPendingMedia((current) => current.filter((_, itemIndex) => itemIndex !== index));
    setSendError(null);
  }, []);

  const clearDraftContext = useCallback(() => {
    setPendingMedia([]);
    setReplyTo(null);
    setRecording(false);
  }, []);

  const uploadPendingMedia = useCallback(async () => {
    const attachments: Attachment[] = [];
    for (const item of pendingMedia) {
      const uploadId = mediaCache.fingerprint(item.file);
      store.setUpload({ id: uploadId, fileName: item.file.name, progress: 0, status: "uploading" });
      try {
        const attachment = await mediaCache.upload(item.file, (progress) => {
          store.setUpload({ id: uploadId, fileName: item.file.name, progress, status: "uploading" });
        });
        store.setUpload({ id: uploadId, fileName: item.file.name, progress: 100, status: "uploaded" });
        attachments.push(attachment);
      } catch (error) {
        store.setUpload({
          id: uploadId,
          fileName: item.file.name,
          progress: 0,
          status: "failed",
          error: error instanceof Error ? error.message : "Upload failed",
        });
        throw error;
      }
    }
    return attachments;
  }, [pendingMedia]);

  const handleSend = useCallback(async () => {
    if (!selected || uploading || (!inputText.trim() && pendingMedia.length === 0)) return;

    const content = inputText.trim();
    setUploading(true);
    setSendError(null);
    try {
      const attachments = await uploadPendingMedia();
      const id = clientMessageId();
      const optimistic: WhatsAppMessage = {
        id: `local_${id}`,
        clientMessageId: id,
        content,
        from: "agent",
        type: composerMode === "note" ? "note" : attachments[0]?.type === "audio" ? "audio" : "text",
        time: new Date().toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit" }),
        status: "sent",
        attachments,
        replyToMessageId: replyTo?.id,
        internal: composerMode === "note",
      };
      store.appendOptimisticMessage(selected.id, optimistic);
      store.updateConversation(selected.id, {
        preview: composerMode === "note" ? selected.preview : optimistic.content || "Media",
        unread: 0,
        lastMessageAt: new Date().toISOString(),
      });
      setInputText("");
      clearDraftContext();

      if (composerMode === "note") {
        const response = await sendConversationNote<{ data: WhatsAppMessage }>(selected.id, content || "Voice note / attachment note");
        store.replaceMessage(selected.id, optimistic.id, response.data);
      } else {
        messageQueue.enqueue(
          {
            conversationId: selected.id,
            content,
            replyToMessageId: replyTo?.id,
            attachments,
            clientMessageId: id,
          },
          {
            onQueued: store.upsertQueuedMessage,
            onSending: store.upsertQueuedMessage,
            onSent: (queued, response) => {
              store.replaceMessage(selected.id, `local_${queued.id}`, response);
              store.removeQueuedMessage(queued.id);
            },
            onFailed: (queued) => {
              store.upsertQueuedMessage(queued);
              store.replaceMessage(selected.id, `local_${queued.id}`, { ...optimistic, status: "failed" });
            },
          }
        );
      }
    } catch (error) {
      // uploadPendingMedia throwing (a real upload failure, e.g. a file too large) previously
      // propagated out of this function uncaught - setUploading(false) still ran via finally, so
      // the button stopped spinning, but nothing ever told the user it failed. pendingMedia is
      // deliberately left as-is (not cleared) so the failed attachment stays visible for the user
      // to see (via the per-item "failed" state uploadById already tracked but nothing rendered)
      // and remove or retry.
      setSendError(error instanceof Error ? error.message : "Failed to send. Please try again.");
    } finally {
      setUploading(false);
    }
  }, [clearDraftContext, composerMode, inputText, pendingMedia.length, replyTo?.id, selected, uploadPendingMedia, uploading]);

  const handleTyping = useCallback((value: string) => {
    setInputText(value);
    if (!selected?.id) return;
    whatsAppRealtimeService.sendTyping(selected.id, true);
    currentTypingId.current = selected.id;
    window.setTimeout(() => {
      if (currentTypingId.current === selected.id) whatsAppRealtimeService.sendTyping(selected.id, false);
    }, 900);
  }, [selected?.id]);

  const handleMessageAction = useCallback(async (
    action: "reply" | "copy" | "forward" | "star" | "delete" | "retry" | "download",
    message: WhatsAppMessage
  ) => {
    if (!selected) return;
    if (action === "reply") setReplyTo(message);
    if (action === "copy") await navigator.clipboard?.writeText(messageText(message));
    if (action === "forward") setInputText(`Forwarded:\n${messageText(message)}`);
    if (action === "download") {
      const attachment = primaryAttachment(message);
      const link = document.createElement("a");
      link.href = attachment ? displayAttachmentUrl(attachment.url) : `data:text/plain;charset=utf-8,${encodeURIComponent(messageText(message))}`;
      link.download = attachment?.name || `message-${message.id}.txt`;
      link.click();
    }
    if (action === "retry") setInputText(message.content);
    if (action === "star") {
      store.replaceMessage(selected.id, message.id, { ...message, starred: !message.starred });
      if (!message.id.startsWith("local_")) updateMessageActions(selected.id, message.id, { starred: !message.starred }).catch(() => undefined);
    }
    if (action === "delete") {
      store.removeMessage(selected.id, message.id);
      if (!message.id.startsWith("local_")) deleteConversationMessage(selected.id, message.id, "everyone").catch(() => undefined);
    }
  }, [selected]);

  const handleAssign = useCallback(async (userId: string) => {
    if (!selected) return;
    setAssigning(true);
    const member = members.find((item) => item.userId === userId);
    store.updateConversation(selected.id, { agentId: userId, agent: member?.name || "Unassigned" });
    assignConversation<{ data: Conversation }>(selected.id, userId)
      .then((response) => store.upsertConversation(response.data))
      .finally(() => setAssigning(false));
  }, [members, selected]);

  const handleStatusChange = useCallback(async (status: Conversation["status"]) => {
    if (!selected) return;
    store.updateConversation(selected.id, { status });
    updateConversationStatus<{ data: Conversation }>(selected.id, status)
      .then((response) => store.upsertConversation(response.data))
      .catch(() => undefined);
  }, [selected]);

  const handleConversationSetting = useCallback((settings: { pinned?: boolean; muted?: boolean }) => {
    if (!selected) return;
    store.updateConversation(selected.id, settings);
    updateConversationSettings<{ data: Conversation }>(selected.id, settings)
      .then((response) => store.upsertConversation(response.data))
      .catch(() => undefined);
  }, [selected]);

  const handleAddToCrm = useCallback(async (stage?: string) => {
    if (!selected) return;
    setCrmSaving(true);
    addConversationToCrm<{ data: Conversation }>(selected.id, stage)
      .then((response) => store.upsertConversation(response.data))
      .finally(() => setCrmSaving(false));
  }, [selected]);

  return {
    conversations,
    selected,
    selectedMessages,
    members,
    messageSearch,
    inputText,
    composerMode,
    replyTo,
    pendingMedia,
    uploading,
    sendError,
    recording,
    crmSaving,
    assigning,
    loadOlderMessages,
    loadConversations,
    addMediaFiles,
    removePendingMedia,
    clearDraftContext,
    handleSend,
    handleTyping,
    setComposerMode,
    setMessageSearch,
    setRecording,
    handleMessageAction,
    handleAssign,
    handleStatusChange,
    handleConversationSetting,
    handleAddToCrm,
    currentUserId,
    store,
  };
}
