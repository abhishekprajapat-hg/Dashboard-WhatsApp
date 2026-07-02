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
  onMessageAction: (action: "reply" | "copy" | "forward" | "star" | "delete" | "retry" | "download", message: WhatsAppMessage) => void;
  onAddToCrm: () => void;
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
      <section className="hidden min-w-0 flex-1 items-center justify-center bg-[#efeae2] text-zinc-500 dark:bg-[#0b141a] md:flex">
        Select a conversation
      </section>
    );
  }

  return (
    <section className="flex min-w-0 flex-1 flex-col bg-[#efeae2] dark:bg-[#0b141a]">
      <header className="flex h-[72px] shrink-0 items-center gap-3 border-b border-zinc-200 bg-white px-3 dark:border-zinc-800 dark:bg-[#202c33] md:px-4">
        <button className="flex h-9 w-9 items-center justify-center rounded-full text-zinc-500 hover:bg-zinc-100 dark:text-zinc-300 dark:hover:bg-[#2a3942] md:hidden" onClick={onBack}>
          <ArrowLeft size={19} />
        </button>
        <div className="relative flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-emerald-500 to-teal-700 text-sm font-semibold text-white">
          {initials(conversation.name)}
          <span className="absolute bottom-0 right-0 h-3 w-3 rounded-full border-2 border-white bg-emerald-400 dark:border-[#202c33]" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-semibold text-zinc-950 dark:text-zinc-50">{conversation.name}</div>
          <div className="truncate text-xs text-zinc-500 dark:text-zinc-400">{typing ? "typing..." : conversation.agent ? `Assigned to ${conversation.agent}` : "Online on WhatsApp"}</div>
        </div>
        <button className="hidden h-8 items-center gap-1.5 rounded border border-emerald-200 px-2 text-xs font-medium text-emerald-700 hover:bg-emerald-50 disabled:opacity-60 dark:border-emerald-500/20 dark:text-emerald-300 dark:hover:bg-emerald-500/10 sm:flex" onClick={onAddToCrm} disabled={crmSaving || isInCrm}>
          {isInCrm ? <CheckCircle2 size={14} /> : null}
          {isInCrm ? "In CRM" : crmSaving ? "Saving" : "Add CRM"}
        </button>
        <button className="hidden h-8 rounded bg-emerald-500 px-3 text-xs font-semibold text-white hover:bg-emerald-600 sm:block" onClick={onResolve}>
          Resolve
        </button>
        {[Search, Phone, Video, Info, MoreVertical].map((Icon, index) => (
          <button key={index} className="flex h-9 w-9 items-center justify-center rounded-full text-zinc-500 hover:bg-zinc-100 dark:text-zinc-300 dark:hover:bg-[#2a3942]">
            <Icon size={18} />
          </button>
        ))}
      </header>

      {pinned.length > 0 ? (
        <div className="flex shrink-0 items-center gap-2 border-b border-amber-200 bg-amber-50 px-4 py-2 text-xs text-amber-800 dark:border-amber-500/20 dark:bg-amber-500/10 dark:text-amber-200">
          <Star size={14} className="fill-amber-400 text-amber-400" />
          <span className="min-w-0 truncate">{pinned[pinned.length - 1]?.content || "Starred attachment"}</span>
        </div>
      ) : null}

      <div className="shrink-0 border-b border-zinc-200 bg-white/80 px-4 py-2 backdrop-blur dark:border-zinc-800 dark:bg-[#111b21]/80">
        <input
          value={messageSearch}
          onChange={(event) => onMessageSearchChange(event.target.value)}
          placeholder="Search in conversation"
          className="h-8 w-full rounded-md border border-zinc-200 bg-white px-3 text-xs text-zinc-900 outline-none dark:border-zinc-800 dark:bg-[#202c33] dark:text-zinc-100"
        />
      </div>

      <div ref={scrollRef} className="no-scrollbar min-h-0 flex-1 overflow-y-auto py-4" onScroll={handleScroll}>
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
                    <span className="rounded bg-white/90 px-3 py-1 text-[11px] font-medium text-zinc-500 shadow-sm dark:bg-[#182229] dark:text-zinc-300">
                      {label}
                    </span>
                  </div>
                ) : null}
                <MessageBubble message={message} replyLabel={replyLabel} onAction={onMessageAction} />
              </div>
            );
          })}
        </AnimatePresence>
        {typing ? (
          <div className="px-4 py-2">
            <div className="inline-flex items-center gap-1 rounded-md bg-white px-3 py-2 shadow-sm dark:bg-[#202c33]">
              {[0, 1, 2].map((item) => (
                <span key={item} className={cn("h-1.5 w-1.5 rounded-full bg-emerald-500", item === 1 && "animate-pulse")} />
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
        onValueChange={onInputChange}
        onModeChange={onComposerModeChange}
        onSend={onSend}
        onPickFiles={onPickFiles}
        onRemoveMedia={onRemoveMedia}
        onClearContext={onClearContext}
        onToggleRecording={onToggleRecording}
      />
    </section>
  );
}
