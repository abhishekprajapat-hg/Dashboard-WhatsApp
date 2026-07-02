import { create } from "zustand";
import type { Conversation, InboxFilter, PageState, QueuedMessage, UploadState, WhatsAppMessage } from "./types";

interface InboxState {
  conversationIds: string[];
  conversationById: Record<string, Conversation>;
  messagesByConversationId: Record<string, WhatsAppMessage[]>;
  messagePageByConversationId: Record<string, PageState>;
  selectedId: string;
  filter: InboxFilter;
  search: string;
  mobileChatOpen: boolean;
  typingConversationIds: string[];
  onlineUserIds: string[];
  unreadTotal: number;
  connected: boolean;
  reconnecting: boolean;
  loading: boolean;
  error: string;
  uploadById: Record<string, UploadState>;
  queueById: Record<string, QueuedMessage>;
  setConversations: (conversations: Conversation[], page?: { hasMore?: boolean; nextCursor?: string | null }) => void;
  upsertConversation: (conversation: Conversation) => void;
  updateConversation: (id: string, patch: Partial<Conversation>) => void;
  appendOptimisticMessage: (conversationId: string, message: WhatsAppMessage) => void;
  replaceMessage: (conversationId: string, localId: string, message: WhatsAppMessage) => void;
  removeMessage: (conversationId: string, messageId: string) => void;
  prependMessages: (conversationId: string, messages: WhatsAppMessage[], page?: Partial<PageState>) => void;
  setMessagePage: (conversationId: string, page: Partial<PageState>) => void;
  selectConversation: (id: string) => void;
  setFilter: (filter: InboxFilter) => void;
  setSearch: (search: string) => void;
  setMobileChatOpen: (open: boolean) => void;
  setTyping: (conversationId: string, typing: boolean) => void;
  setOnlineUsers: (userIds: string[]) => void;
  setConnectionState: (state: { connected?: boolean; reconnecting?: boolean }) => void;
  setLoadingState: (state: { loading?: boolean; error?: string }) => void;
  setUpload: (upload: UploadState) => void;
  removeUpload: (id: string) => void;
  upsertQueuedMessage: (message: QueuedMessage) => void;
  removeQueuedMessage: (id: string) => void;
}

function uniqueMessages(messages: WhatsAppMessage[]) {
  const seen = new Set<string>();
  return messages.filter((message) => {
    const key = message.providerMessageId || message.clientMessageId || message.id;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function sortConversationIds(ids: string[], byId: Record<string, Conversation>) {
  return [...new Set(ids)].sort((a, b) => {
    const left = byId[a];
    const right = byId[b];
    if (Boolean(left?.pinned) !== Boolean(right?.pinned)) return left?.pinned ? -1 : 1;
    return new Date(right?.lastMessageAt || 0).getTime() - new Date(left?.lastMessageAt || 0).getTime();
  });
}

export const useWhatsAppInboxStore = create<InboxState>((set) => ({
  conversationIds: [],
  conversationById: {},
  messagesByConversationId: {},
  messagePageByConversationId: {},
  selectedId: "",
  filter: "all",
  search: "",
  mobileChatOpen: false,
  typingConversationIds: [],
  onlineUserIds: [],
  unreadTotal: 0,
  connected: false,
  reconnecting: false,
  loading: false,
  error: "",
  uploadById: {},
  queueById: {},
  setConversations: (conversations) =>
    set((state) => {
      if (!conversations.length) {
        return {
          conversationIds: [],
          conversationById: {},
          messagesByConversationId: {},
          messagePageByConversationId: {},
          selectedId: "",
          unreadTotal: 0,
        };
      }
      const conversationById = { ...state.conversationById };
      const messagesByConversationId = { ...state.messagesByConversationId };
      for (const conversation of conversations) {
        conversationById[conversation.id] = { ...conversation, messages: [] };
        messagesByConversationId[conversation.id] = uniqueMessages([
          ...(messagesByConversationId[conversation.id] || []),
          ...(conversation.messages || []),
        ]);
      }
      const conversationIds = sortConversationIds([...state.conversationIds, ...conversations.map((item) => item.id)], conversationById);
      return {
        conversationById,
        messagesByConversationId,
        conversationIds,
        selectedId: state.selectedId || conversationIds[0] || "",
        unreadTotal: conversationIds.reduce((sum, id) => sum + Number(conversationById[id]?.unread || 0), 0),
      };
    }),
  upsertConversation: (conversation) =>
    set((state) => {
      const existingMessages = state.messagesByConversationId[conversation.id] || [];
      const incomingMessages = conversation.messages || [];
      const conversationById = {
        ...state.conversationById,
        [conversation.id]: { ...(state.conversationById[conversation.id] || conversation), ...conversation, messages: [] },
      };
      const messagesByConversationId = {
        ...state.messagesByConversationId,
        [conversation.id]: uniqueMessages([...existingMessages, ...incomingMessages]),
      };
      const conversationIds = sortConversationIds([...state.conversationIds, conversation.id], conversationById);
      return {
        conversationById,
        messagesByConversationId,
        conversationIds,
        selectedId: state.selectedId || conversation.id,
        unreadTotal: conversationIds.reduce((sum, id) => sum + Number(conversationById[id]?.unread || 0), 0),
      };
    }),
  updateConversation: (id, patch) =>
    set((state) => {
      const conversationById = {
        ...state.conversationById,
        [id]: { ...state.conversationById[id], ...patch },
      };
      return {
        conversationById,
        conversationIds: sortConversationIds(state.conversationIds, conversationById),
        unreadTotal: state.conversationIds.reduce((sum, conversationId) => sum + Number(conversationById[conversationId]?.unread || 0), 0),
      };
    }),
  appendOptimisticMessage: (conversationId, message) =>
    set((state) => ({
      messagesByConversationId: {
        ...state.messagesByConversationId,
        [conversationId]: uniqueMessages([...(state.messagesByConversationId[conversationId] || []), message]),
      },
    })),
  replaceMessage: (conversationId, localId, message) =>
    set((state) => ({
      messagesByConversationId: {
        ...state.messagesByConversationId,
        [conversationId]: uniqueMessages(
          (state.messagesByConversationId[conversationId] || []).map((item) =>
            item.id === localId || item.clientMessageId === message.clientMessageId ? message : item
          )
        ),
      },
    })),
  removeMessage: (conversationId, messageId) =>
    set((state) => ({
      messagesByConversationId: {
        ...state.messagesByConversationId,
        [conversationId]: (state.messagesByConversationId[conversationId] || []).filter((message) => message.id !== messageId),
      },
    })),
  prependMessages: (conversationId, messages, page) =>
    set((state) => ({
      messagesByConversationId: {
        ...state.messagesByConversationId,
        [conversationId]: uniqueMessages([...messages, ...(state.messagesByConversationId[conversationId] || [])]),
      },
      messagePageByConversationId: {
        ...state.messagePageByConversationId,
        [conversationId]: {
          loading: false,
          hasMore: page?.hasMore ?? state.messagePageByConversationId[conversationId]?.hasMore ?? false,
          nextCursor: page?.nextCursor ?? state.messagePageByConversationId[conversationId]?.nextCursor ?? null,
        },
      },
    })),
  setMessagePage: (conversationId, page) =>
    set((state) => ({
      messagePageByConversationId: {
        ...state.messagePageByConversationId,
        [conversationId]: {
          loading: page.loading ?? state.messagePageByConversationId[conversationId]?.loading ?? false,
          hasMore: page.hasMore ?? state.messagePageByConversationId[conversationId]?.hasMore ?? true,
          nextCursor: page.nextCursor ?? state.messagePageByConversationId[conversationId]?.nextCursor ?? null,
        },
      },
    })),
  selectConversation: (id) => set({ selectedId: id, mobileChatOpen: true }),
  setFilter: (filter) => set({ filter }),
  setSearch: (search) => set({ search }),
  setMobileChatOpen: (mobileChatOpen) => set({ mobileChatOpen }),
  setTyping: (conversationId, typing) =>
    set((state) => ({
      typingConversationIds: typing
        ? Array.from(new Set([...state.typingConversationIds, conversationId]))
        : state.typingConversationIds.filter((id) => id !== conversationId),
    })),
  setOnlineUsers: (onlineUserIds) => set({ onlineUserIds }),
  setConnectionState: (connectionState) => set(connectionState),
  setLoadingState: (loadingState) => set(loadingState),
  setUpload: (upload) => set((state) => ({ uploadById: { ...state.uploadById, [upload.id]: upload } })),
  removeUpload: (id) =>
    set((state) => {
      const { [id]: _removed, ...uploadById } = state.uploadById;
      return { uploadById };
    }),
  upsertQueuedMessage: (message) => set((state) => ({ queueById: { ...state.queueById, [message.id]: message } })),
  removeQueuedMessage: (id) =>
    set((state) => {
      const { [id]: _removed, ...queueById } = state.queueById;
      return { queueById };
    }),
}));
