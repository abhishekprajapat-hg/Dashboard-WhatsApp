import { useEffect, useMemo, useRef } from "react";
import { AnimatePresence } from "framer-motion";
import { ArrowLeft, CheckCircle2, Info, MoreVertical, Phone, Search, Star, Video } from "lucide-react";
import { Composer } from "./Composer";
import { MessageBubble } from "./MessageBubble";
import type { Conversation, PendingMedia, WhatsAppMessage } from "./types";
import { cn, initials } from "./utils";

interface ChatWindowProps {
  conversation?: Conversation;
  messages: WhatsAppMessage[];
  messageSearch: string;
  inputText: string;
  composerMode: "reply" | "note";
  replyTo: WhatsAppMessage | null;
  pendingMedia: PendingMedia[];
  uploading: boolean;
  recording: boolean;
  quickReplies?: { id: string; name: string; body: string }[];
  typing: boolean;
  crmSaving: boolean;
  isInCrm: boolean;
  onBack: () => void;
  onMessageSearchChange: (value: string) => void;
  onInputChange: (value: string) => void;
  onComposerModeChange: (mode: "reply" | "note") => void;
  onSend: () => void;
  onPickFiles: (kind: "media" | "document" | "audio") => void;
  onRemoveMedia: (index: number) => void;
  onClearContext: () => void;
  onToggleRecording: () => void;
  onQuickReplySelect?: (template: { id: string; name: string; body: string }) => void;
  onMessageAction: (action: "reply" | "copy" | "forward" | "star" | "delete" | "retry" | "download", message: WhatsAppMessage) => void;
  onAddToCrm: (stage?: string) => void;
  onResolve: () => void;
  onLoadOlder: () => void;
}

function dateLabel(index: number, total: number) {
  if (index === 0) return "Today";
  if (total > 10 && index === Math.floor(total / 2)) return "Yesterday";
  return "";
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
  recording,
  quickReplies = [],
  typing,
  crmSaving,
  isInCrm,
  onBack,
  onMessageSearchChange,
  onInputChange,
  onComposerModeChange,
  onSend,
  onPickFiles,
  onRemoveMedia,
  onClearContext,
  onToggleRecording,
  onQuickReplySelect,
  onMessageAction,
  onAddToCrm,
  onResolve,
  onLoadOlder,
}: ChatWindowProps) {
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const filteredMessages = useMemo(
    () => messages.filter((message) => (messageSearch ? message.content.toLowerCase().includes(messageSearch.toLowerCase()) : true)),
    [messages, messageSearch]
  );
  const pinned = messages.filter((message) => message.pinned || message.starred).slice(-2);

  useEffect(() => {
    const node = scrollRef.current;
    if (!node) return;
    const nearBottom = node.scrollHeight - node.scrollTop - node.clientHeight < 220;
    if (nearBottom) node.scrollTop = node.scrollHeight;
  }, [filteredMessages.length, typing]);

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
          <span className="absolute bottom-0 right-0 h-3 w-3 rounded-full border-2 border-card bg-primary" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-semibold text-foreground">{conversation.name}</div>
          <div className="truncate text-xs text-muted-foreground">{typing ? "typing..." : conversation.agent ? `Assigned to ${conversation.agent}` : conversation.phone || "Online on WhatsApp"}</div>
        </div>
        <button className="hidden h-8 items-center gap-1.5 rounded-md border border-primary/25 bg-primary/10 px-2 text-xs font-medium text-primary hover:bg-primary/15 disabled:opacity-60 sm:flex" onClick={onAddToCrm} disabled={crmSaving || isInCrm}>
          {isInCrm ? <CheckCircle2 size={14} /> : null}
          {isInCrm ? "In CRM" : crmSaving ? "Saving" : "Add CRM"}
        </button>
        <button className="hidden h-8 rounded-md bg-primary px-3 text-xs font-semibold text-primary-foreground shadow-[0_10px_24px_rgba(37,211,102,0.16)] hover:bg-primary/90 sm:block" onClick={onResolve}>
          Resolve
        </button>
        {[Search, Phone, Video, Info, MoreVertical].map((Icon, index) => (
          <button key={index} className="flex h-9 w-9 items-center justify-center rounded-lg text-muted-foreground hover:bg-secondary hover:text-foreground">
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
            const label = dateLabel(index, filteredMessages.length);
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
        recording={recording}
        quickReplies={quickReplies}
        onValueChange={onInputChange}
        onModeChange={onComposerModeChange}
        onSend={onSend}
        onPickFiles={onPickFiles}
        onRemoveMedia={onRemoveMedia}
        onClearContext={onClearContext}
        onToggleRecording={onToggleRecording}
        onQuickReplySelect={onQuickReplySelect}
      />
    </section>
  );
}
