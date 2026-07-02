import { io, type Socket } from "socket.io-client";
import { getEventStreamUrl, getStoredToken } from "../../../lib/api";
import type { Conversation } from "../types";

interface RealtimeHandlers {
  onConversation: (conversation: Conversation, unreadCount?: number) => void;
  onTyping: (conversationId: string, typing: boolean) => void;
  onPresence: (userIds: string[]) => void;
  onConnectionChange: (state: { connected?: boolean; reconnecting?: boolean }) => void;
}

export class WhatsAppRealtimeService {
  private socket: Socket | null = null;
  private events: EventSource | null = null;

  connect(baseUrl: string, handlers: RealtimeHandlers) {
    const token = getStoredToken();
    this.disconnect();

    this.socket = io(baseUrl, {
      auth: { token },
      transports: ["websocket", "polling"],
      reconnection: true,
      reconnectionAttempts: Infinity,
      reconnectionDelay: 500,
      reconnectionDelayMax: 5000,
    });

    this.socket.on("connect", () => handlers.onConnectionChange({ connected: true, reconnecting: false }));
    this.socket.io.on("reconnect_attempt", () => handlers.onConnectionChange({ connected: false, reconnecting: true }));
    this.socket.on("disconnect", () => handlers.onConnectionChange({ connected: false }));
    this.socket.on("conversation", (payload: { conversation?: Conversation; unreadCount?: number }) => {
      if (payload.conversation) handlers.onConversation(payload.conversation, payload.unreadCount);
    });
    this.socket.on("typing", (payload: { conversationId?: string; typing?: boolean }) => {
      if (payload.conversationId) handlers.onTyping(payload.conversationId, Boolean(payload.typing));
    });
    this.socket.on("presence:online", (payload: { userIds?: string[] }) => handlers.onPresence(payload.userIds || []));

    this.events = new EventSource(getEventStreamUrl());
    this.events.addEventListener("conversation", (event) => {
      const payload = JSON.parse((event as MessageEvent).data) as { conversation?: Conversation; unreadCount?: number };
      if (payload.conversation) handlers.onConversation(payload.conversation, payload.unreadCount);
    });
  }

  joinConversation(conversationId: string) {
    this.socket?.emit("conversation:join", { conversationId });
  }

  leaveConversation(conversationId: string) {
    this.socket?.emit("conversation:leave", { conversationId });
  }

  sendTyping(conversationId: string, typing: boolean) {
    this.socket?.emit("typing", { conversationId, typing });
  }

  disconnect() {
    this.events?.close();
    this.socket?.disconnect();
    this.events = null;
    this.socket = null;
  }
}

export const whatsAppRealtimeService = new WhatsAppRealtimeService();
