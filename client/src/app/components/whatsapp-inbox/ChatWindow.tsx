import { useEffect, useMemo, useRef } from "react";
import { AnimatePresence } from "framer-motion";
import { ArrowLeft, CheckCircle2, Facebook, Info, Instagram, MoreVertical, Phone, Search, Star, Video } from "lucide-react";
import { Composer } from "./Composer";
import { MessageBubble } from "./MessageBubble";
import type { Conversation, PendingMedia, UploadState, WhatsAppMessage } from "./types";
import { cn, initials, messageTimestamp } from "./utils";

interface ChatWindowProps {
  conversation?: Conversation;
  messages: WhatsAppMessage[];
  messageSearch: string;
  inputText: string;
  composerMode: "reply" | "note";
  replyTo: WhatsAppMessage | null;
  pendingMedia: PendingMedia[];
  uploading: boolean;
  sendError?: string | null;
  uploadById: Record<string, UploadState>;
  recording: boolean;
  quickReplies?: { id: string; name: string; body: string }[];
  suggestingReply?: boolean;
  suggestReplyError?: string;
  typing: boolean;
  crmSaving: boolean;
  isInCrm: boolean;
  onBack: () => void;
  onMessageSearchChange: (value: string) => void;
  onInputChange: (value: string) => void;
  onComposerModeChange: (mode: "reply" | "note") => void;
  onSend: () => void;
  onPickFiles: (kind: "media" | "document" | "audio") => void;
  onPickProduct?: () => void;
  onRemoveMedia: (index: number) => void;
  onClearContext: () => void;
  onToggleRecording: () => void;
  onQuickReplySelect?: (template: { id: string; name: string; body: string }) => void;
  onSuggestReply?: () => void;
  onMessageAction: (action: "reply" | "copy" | "forward" | "star" | "delete" | "retry" | "download", message: WhatsAppMessage) => void;
  onAddToCrm: (stage?: string) => void;
  onResolve: () => void;
  onLoadOlder: () => void;
  onResetForTesting?: () => void;
}

function dateLabel(message: WhatsAppMessage, previous?: WhatsAppMessage) {
  const date = messageTimestamp(message);
  if (!date) return "";

  const previousDate = messageTimestamp(previous);
  if (previousDate && previousDate.toDateString() === date.toDateString()) return "";

  const today = new Date();
  if (date.toDateString() === today.toDateString()) return "Today";

  const yesterday = new Date(today);
  yesterday.setDate(yesterday.getDate() - 1);
  if (date.toDateString() === yesterday.toDateString()) return "Yesterday";

  return date.toLocaleDateString("en-US", {
    day: "numeric",
    month: "short",
    year: date.getFullYear() === today.getFullYear() ? undefined : "numeric",
  });
}

export function ChatWindow({
  conversation,
  messages,
  messageSearch,
  inputText,
  composerMode,
  replyTo,
  pendingMedia,
  uploading,
  sendError,
  uploadById,
  recording,
  quickReplies = [],
  suggestingReply,
  suggestReplyError,
  typing,
  crmSaving,
  isInCrm,
  onBack,
  onMessageSearchChange,
  onInputChange,
  onComposerModeChange,
  onSend,
  onPickFiles,
  onPickProduct,
  onRemoveMedia,
  onClearContext,
  onToggleRecording,
  onQuickReplySelect,
  onSuggestReply,
  onMessageAction,
  onAddToCrm,
  onResolve,
  onLoadOlder,
  onResetForTesting,
}: ChatWindowProps) {
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const lastConversationIdRef = useRef<string | undefined>(conversation?.id);
  const filteredMessages = useMemo(
    () => messages.filter((message) => (messageSearch ? message.content.toLowerCase().includes(messageSearch.toLowerCase()) : true)),
    [messages, messageSearch]
  );
  const pinned = messages.filter((message) => message.pinned || message.starred).slice(-2);

  useEffect(() => {
    const node = scrollRef.current;
    if (!node || !conversation?.id) return;

    const scrollToLatest = () => {
      node.scrollTop = node.scrollHeight;
    };

    const frame = window.requestAnimationFrame(scrollToLatest);
    const timeout = window.setTimeout(scrollToLatest, 80);

    return () => {
      window.cancelAnimationFrame(frame);
      window.clearTimeout(timeout);
    };
  }, [conversation?.id]);

  useEffect(() => {
    const node = scrollRef.current;
    if (!node) return;
    const conversationChanged = lastConversationIdRef.current !== conversation?.id;
    lastConversationIdRef.current = conversation?.id;
    const nearBottom = node.scrollHeight - node.scrollTop - node.clientHeight < 220;
    if (conversationChanged || nearBottom) node.scrollTop = node.scrollHeight;
  }, [conversation?.id, filteredMessages.length, typing]);

  function handleScroll() {
    const node = scrollRef.current;
    if (!node || node.scrollTop > 80) return;
    onLoadOlder();
  }

  if (!conversation) {
    return (
      <section className="hidden min-w-0 flex-1 items-center justify-center bg-surface text-muted-foreground md:flex">
        <div className="rounded-xl border border-border/80 bg-card/80 px-5 py-4 text-sm shadow-2xl shadow-black/20">
          Select a conversation
        </div>
      </section>
    );
  }

  return (
    <section className="relative flex min-w-0 flex-1 flex-col bg-surface">
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_18%_0%,rgba(37,211,102,0.08),transparent_24rem),linear-gradient(135deg,rgba(255,255,255,0.018),transparent_38%)]" />
      <header className="relative z-10 flex min-h-[76px] shrink-0 items-center gap-3 border-b border-border/80 bg-card/82 px-3 shadow-[0_1px_0_rgba(255,255,255,0.03)_inset] backdrop-blur-xl md:px-4">
        <button className="flex h-9 w-9 items-center justify-center rounded-lg text-muted-foreground hover:bg-secondary hover:text-foreground md:hidden" onClick={onBack}>
          <ArrowLeft size={19} />
        </button>
        <div className="relative flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-primary to-teal-700 text-sm font-semibold text-primary-foreground shadow-[0_12px_26px_rgba(37,211,102,0.16)]">
          {initials(conversation.name)}
          {conversation.channel === "instagram" ? (
            <span className="absolute bottom-0 right-0 flex h-3.5 w-3.5 items-center justify-center rounded-full border-2 border-card bg-gradient-to-br from-fuchsia-500 to-amber-400 text-white">
              <Instagram size={8} />
            </span>
          ) : conversation.channel === "facebook" ? (
            <span className="absolute bottom-0 right-0 flex h-3.5 w-3.5 items-center justify-center rounded-full border-2 border-card bg-blue-500 text-white">
              <Facebook size={8} />
            </span>
          ) : (
            <span className="absolute bottom-0 right-0 h-3 w-3 rounded-full border-2 border-card bg-primary" />
          )}
        </div>
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-semibold text-foreground">{conversation.name}</div>
          <div className="truncate text-xs text-muted-foreground">
            {typing
              ? "typing..."
              : conversation.agent
                ? `Assigned to ${conversation.agent}`
                : conversation.channel === "instagram"
                  ? "Instagram DM"
                  : conversation.channel === "facebook"
                    ? "Facebook DM"
                    : conversation.phone || "Online on WhatsApp"}
          </div>
        </div>
        <button className="hidden h-8 items-center gap-1.5 rounded-md border border-primary/25 bg-primary/10 px-2 text-xs font-medium text-primary hover:bg-primary/15 disabled:opacity-60 sm:flex" onClick={() => onAddToCrm()} disabled={crmSaving || isInCrm}>
          {isInCrm ? <CheckCircle2 size={14} /> : null}
          {isInCrm ? "In CRM" : crmSaving ? "Saving" : "Add CRM"}
        </button>
        <button className="hidden h-8 rounded-md bg-primary px-3 text-xs font-semibold text-primary-foreground shadow-[0_10px_24px_rgba(37,211,102,0.16)] hover:bg-primary/90 sm:block" onClick={onResolve}>
          Resolve
        </button>
        {onResetForTesting ? (
          <button
            className="hidden h-8 items-center rounded-md border border-yellow-500/30 bg-yellow-500/10 px-2 text-xs font-medium text-yellow-300 hover:bg-yellow-500/15 sm:flex"
            title="Delete this contact/conversation so the same phone number can message in fresh as a brand-new lead"
            onClick={onResetForTesting}
          >
            Reset for testing
          </button>
        ) : null}
        {[Search, Phone, Video, Info, MoreVertical].map((Icon, index) => (
          <button key={index} className={`${index > 0 ? "hidden sm:flex" : "flex"} h-9 w-9 shrink-0 items-center justify-center rounded-lg text-muted-foreground hover:bg-secondary hover:text-foreground`}>
            <Icon size={18} />
          </button>
        ))}
      </header>

      {pinned.length > 0 ? (
        <div className="relative z-10 flex shrink-0 items-center gap-2 border-b border-warning/20 bg-warning/10 px-4 py-2 text-xs text-warning">
          <Star size={14} className="fill-warning text-warning" />
          <span className="min-w-0 truncate">{pinned[pinned.length - 1]?.content || "Starred attachment"}</span>
        </div>
      ) : null}

      <div className="relative z-10 shrink-0 border-b border-border/80 bg-card/65 px-4 py-2 backdrop-blur">
        <input
          value={messageSearch}
          onChange={(event) => onMessageSearchChange(event.target.value)}
          placeholder="Search in conversation"
          className="h-8 w-full rounded-md border border-input/80 bg-input-background px-3 text-xs text-foreground outline-none placeholder:text-muted-foreground/75 focus:border-ring focus:ring-2 focus:ring-ring/20"
        />
      </div>

      <div ref={scrollRef} className="relative z-10 no-scrollbar min-h-0 flex-1 overflow-y-auto px-1 py-4" onScroll={handleScroll}>
        <AnimatePresence initial={false}>
          {filteredMessages.map((message, index) => {
            const label = dateLabel(message, filteredMessages[index - 1]);
            const replyLabel = message.replyToMessageId
              ? messages.find((item) => item.id === message.replyToMessageId)?.content || "Reply"
              : "";
            return (
              <div key={message.id}>
                {label ? (
                  <div className="my-3 flex justify-center">
                    <span className="rounded-full border border-border/80 bg-card/90 px-3 py-1 text-[11px] font-medium text-muted-foreground shadow-sm backdrop-blur">
                      {label}
                    </span>
                  </div>
                ) : null}
                <MessageBubble message={message} replyLabel={replyLabel} onAction={onMessageAction} />
              </div>
            );
          })}
        </AnimatePresence>
        {filteredMessages.length === 0 && !typing ? (
          <div className="flex min-h-[280px] items-center justify-center px-6 text-center">
            <div className="rounded-lg border border-border/80 bg-card/90 px-4 py-3 text-sm text-muted-foreground shadow-sm backdrop-blur">
              {messageSearch ? "No messages match this search." : "No messages in this conversation yet."}
            </div>
          </div>
        ) : null}
        {typing ? (
          <div className="px-4 py-2">
            <div className="inline-flex items-center gap-1 rounded-lg border border-border/80 bg-card px-3 py-2 shadow-sm">
              {[0, 1, 2].map((item) => (
                <span key={item} className={cn("h-1.5 w-1.5 rounded-full bg-primary", item === 1 && "animate-pulse")} />
              ))}
            </div>
          </div>
        ) : null}
      </div>

      <Composer
        value={inputText}
        mode={composerMode}
        replyTo={replyTo}
        pendingMedia={pendingMedia}
        uploading={uploading}
        sendError={sendError}
        uploadById={uploadById}
        recording={recording}
        quickReplies={quickReplies}
        suggestingReply={suggestingReply}
        suggestReplyError={suggestReplyError}
        onValueChange={onInputChange}
        onModeChange={onComposerModeChange}
        onSend={onSend}
        onPickFiles={onPickFiles}
        onPickProduct={onPickProduct}
        onRemoveMedia={onRemoveMedia}
        onClearContext={onClearContext}
        onToggleRecording={onToggleRecording}
        onQuickReplySelect={onQuickReplySelect}
        onSuggestReply={onSuggestReply}
      />
    </section>
  );
}
