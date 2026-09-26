import { useEffect, useMemo, useRef, useState } from "react";
import { ArrowLeft, CheckCircle2, FlaskConical, MoreVertical, PanelRight, Search, Star, UserPlus, X } from "lucide-react";
import { Composer } from "./Composer";
import { ContactAvatar } from "./ContactAvatar";
import { MessageBubble } from "./MessageBubble";
import type { Conversation, PendingMedia, UploadState, WhatsAppMessage } from "./types";
import { cn, messageTimestamp } from "./utils";
import { BrandMark } from "../shell/BrandMark";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "../ui/dropdown-menu";

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
  sessionExpired?: boolean;
  typing: boolean;
  crmSaving: boolean;
  isInCrm: boolean;
  profileOpen?: boolean;
  onToggleProfile?: () => void;
  onBack: () => void;
  onMessageSearchChange: (value: string) => void;
  onInputChange: (value: string) => void;
  onComposerModeChange: (mode: "reply" | "note") => void;
  onSend: () => void;
  onPickFiles: (kind: "media" | "document" | "audio") => void;
  onPickProduct?: () => void;
  onOpenTemplatePicker?: () => void;
  onRemoveMedia: (index: number) => void;
  onClearContext: () => void;
  onToggleRecording: () => void;
  onQuickReplySelect?: (template: { id: string; name: string; body: string }, options?: { replace?: boolean }) => void;
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

  return date.toLocaleDateString("en-IN", {
    day: "numeric",
    month: "long",
    year: date.getFullYear() === today.getFullYear() ? undefined : "numeric",
  });
}

// Same side and within five minutes of the previous message = same run (no tail, tighter spacing).
function startsRun(message: WhatsAppMessage, previous?: WhatsAppMessage) {
  if (!previous) return true;
  if (previous.from !== message.from || Boolean(previous.internal) !== Boolean(message.internal)) return true;
  const a = messageTimestamp(previous);
  const b = messageTimestamp(message);
  if (!a || !b) return false;
  return b.getTime() - a.getTime() > 5 * 60 * 1000;
}

const headerIcon = "flex size-9 shrink-0 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground";

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
  sessionExpired,
  typing,
  crmSaving,
  isInCrm,
  profileOpen,
  onToggleProfile,
  onBack,
  onMessageSearchChange,
  onInputChange,
  onComposerModeChange,
  onSend,
  onPickFiles,
  onPickProduct,
  onOpenTemplatePicker,
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
  const searchRef = useRef<HTMLInputElement | null>(null);
  const lastConversationIdRef = useRef<string | undefined>(conversation?.id);
  const [searchOpen, setSearchOpen] = useState(false);
  const filteredMessages = useMemo(
    () => messages.filter((message) => (messageSearch ? message.content.toLowerCase().includes(messageSearch.toLowerCase()) : true)),
    [messages, messageSearch],
  );
  const pinned = messages.filter((message) => message.pinned || message.starred).slice(-2);
  const showSearch = searchOpen || Boolean(messageSearch);

  useEffect(() => {
    setSearchOpen(false);
  }, [conversation?.id]);

  useEffect(() => {
    if (searchOpen) searchRef.current?.focus();
  }, [searchOpen]);

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

  function closeSearch() {
    onMessageSearchChange("");
    setSearchOpen(false);
  }

  if (!conversation) {
    return (
      <section className="hidden min-w-0 flex-1 flex-col items-center justify-center gap-3 bg-chat-wallpaper text-center md:flex">
        <BrandMark className="size-10 text-primary/35" />
        <div>
          <p className="text-sm font-medium text-foreground">Pick a conversation</p>
          <p className="mt-1 text-xs text-muted-foreground">
            Use <kbd className="rounded border border-border bg-card px-1">J</kbd> and <kbd className="rounded border border-border bg-card px-1">K</kbd> to move between chats.
          </p>
        </div>
      </section>
    );
  }

  const resolved = conversation.status === "resolved";
  const subline = typing
    ? "typing…"
    : [
        conversation.channel === "instagram" ? "Instagram" : conversation.channel === "facebook" ? "Facebook" : conversation.phone,
        conversation.agent ? `Assigned to ${conversation.agent}` : "Unassigned",
      ]
        .filter(Boolean)
        .join(" · ");

  return (
    <section className="@container relative flex min-w-0 flex-1 flex-col bg-chat-wallpaper">
      <header className="relative z-10 flex h-[60px] shrink-0 items-center gap-2.5 border-b border-border bg-card px-2 md:px-4">
        <button type="button" aria-label="Back to chats" className={cn(headerIcon, "md:hidden")} onClick={onBack}>
          <ArrowLeft size={19} />
        </button>
        <button type="button" onClick={onToggleProfile} className="flex min-w-0 flex-1 items-center gap-3 text-left" aria-label="Customer details">
          <ContactAvatar name={conversation.name} channel={conversation.channel} />
          <span className="min-w-0">
            <span className="block truncate text-[15px] font-semibold leading-tight text-foreground">{conversation.name}</span>
            <span className={cn("block truncate text-[12px]", typing ? "font-medium text-primary" : "text-muted-foreground")}>{subline}</span>
          </span>
        </button>

        <div className="hidden shrink-0 items-center gap-1.5 @[560px]:flex">
          {isInCrm ? (
            <span className="flex h-8 items-center gap-1 rounded-lg px-2 text-[12px] font-medium text-success">
              <CheckCircle2 size={14} /> In CRM
            </span>
          ) : (
            <button type="button" className="flex h-8 items-center gap-1.5 rounded-lg border border-border px-2.5 text-[12.5px] font-medium text-foreground hover:bg-secondary disabled:opacity-60" onClick={() => onAddToCrm()} disabled={crmSaving}>
              <UserPlus size={14} />
              {crmSaving ? "Saving…" : "Add to CRM"}
            </button>
          )}
          <button
            type="button"
            className={cn(
              "flex h-8 items-center gap-1.5 rounded-lg px-3 text-[12.5px] font-semibold transition-colors",
              resolved ? "bg-success/12 text-success" : "bg-primary text-primary-foreground hover:bg-primary/90",
            )}
            onClick={onResolve}
            disabled={resolved}
          >
            <CheckCircle2 size={14} />
            {resolved ? "Resolved" : "Resolve"}
          </button>
        </div>

        <button type="button" aria-label="Search in this chat" aria-pressed={showSearch} className={cn(headerIcon, showSearch && "bg-secondary text-foreground")} onClick={() => (showSearch ? closeSearch() : setSearchOpen(true))}>
          <Search size={17} />
        </button>
        {onToggleProfile && (
          <button type="button" aria-label={profileOpen ? "Hide customer details" : "Show customer details"} aria-pressed={profileOpen} className={cn(headerIcon, "hidden md:flex", profileOpen && "bg-secondary text-foreground")} onClick={onToggleProfile}>
            <PanelRight size={17} />
          </button>
        )}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button type="button" aria-label="More actions" className={headerIcon}>
              <MoreVertical size={17} />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-60">
            <DropdownMenuItem onSelect={onResolve} disabled={resolved}>
              <CheckCircle2 /> {resolved ? "Resolved" : "Resolve chat"}
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => onAddToCrm()} disabled={crmSaving || isInCrm}>
              <UserPlus /> {isInCrm ? "Already in CRM" : "Add to CRM"}
            </DropdownMenuItem>
            {onToggleProfile && (
              <DropdownMenuItem onSelect={onToggleProfile} className="md:hidden">
                <PanelRight /> Customer details
              </DropdownMenuItem>
            )}
            <DropdownMenuItem onSelect={() => setSearchOpen(true)}>
              <Search /> Search in this chat
            </DropdownMenuItem>
            {onResetForTesting ? (
              <>
                <DropdownMenuSeparator />
                <DropdownMenuItem variant="destructive" onSelect={onResetForTesting}>
                  <FlaskConical />
                  <span className="grid">
                    Reset for testing
                    <span className="text-[11px] font-normal text-muted-foreground">Deletes this contact so the number can message in as a new lead</span>
                  </span>
                </DropdownMenuItem>
              </>
            ) : null}
          </DropdownMenuContent>
        </DropdownMenu>
      </header>

      {showSearch && (
        <div className="relative z-10 flex shrink-0 items-center gap-2 border-b border-border bg-card px-3 py-2 md:px-4">
          <Search size={15} className="shrink-0 text-muted-foreground" />
          <input
            ref={searchRef}
            value={messageSearch}
            onChange={(event) => onMessageSearchChange(event.target.value)}
            onKeyDown={(event) => event.key === "Escape" && closeSearch()}
            placeholder="Search in this chat"
            aria-label="Search in this chat"
            className="h-7 min-w-0 flex-1 bg-transparent text-[13px] text-foreground outline-none placeholder:text-muted-foreground"
          />
          {messageSearch && <span className="shrink-0 text-[12px] text-muted-foreground tabular-nums">{filteredMessages.length} found</span>}
          <button type="button" aria-label="Close search" className="rounded-full p-1 text-muted-foreground hover:bg-secondary hover:text-foreground" onClick={closeSearch}>
            <X size={14} />
          </button>
        </div>
      )}

      {pinned.length > 0 ? (
        <div className="relative z-10 flex shrink-0 items-center gap-2 border-b border-border bg-card/90 px-4 py-1.5 text-[12.5px] text-muted-foreground backdrop-blur">
          <Star size={13} className="shrink-0 fill-money text-money" />
          <span className="min-w-0 truncate">{pinned[pinned.length - 1]?.content || "Starred attachment"}</span>
        </div>
      ) : null}

      <div ref={scrollRef} className="relative z-0 min-h-0 flex-1 overflow-y-auto pb-3 pt-2" onScroll={handleScroll}>
        {filteredMessages.map((message, index) => {
          const previous = filteredMessages[index - 1];
          const label = dateLabel(message, previous);
          const replyLabel = message.replyToMessageId ? messages.find((item) => item.id === message.replyToMessageId)?.content || "Reply" : "";
          return (
            <div key={message.id}>
              {label ? (
                <div className="flex justify-center py-2">
                  <span className="rounded-lg bg-card/90 px-2.5 py-1 text-[11.5px] font-medium text-muted-foreground shadow-[0_1px_0.5px_rgba(11,20,26,0.13)]">{label}</span>
                </div>
              ) : null}
              <MessageBubble message={message} replyLabel={replyLabel} first={Boolean(label) || startsRun(message, previous)} onAction={onMessageAction} />
            </div>
          );
        })}
        {filteredMessages.length === 0 && !typing ? (
          <div className="flex min-h-[240px] items-center justify-center px-6 text-center">
            <div className="rounded-lg bg-card/90 px-4 py-3 text-[13px] text-muted-foreground shadow-[0_1px_0.5px_rgba(11,20,26,0.13)]">
              {messageSearch ? "No messages match this search." : "No messages yet. Say hello."}
            </div>
          </div>
        ) : null}
        {typing ? (
          <div className="px-3 pt-2 sm:px-[6%]">
            <div className="inline-flex items-center gap-1 rounded-lg rounded-tl-none bg-bubble-in px-3 py-2.5 shadow-[0_1px_0.5px_rgba(11,20,26,0.13)]" aria-label="Customer is typing">
              {[0, 1, 2].map((item) => (
                <span key={item} className="size-1.5 animate-bounce rounded-full bg-muted-foreground/60" style={{ animationDelay: `${item * 120}ms` }} />
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
        sessionExpired={sessionExpired}
        onValueChange={onInputChange}
        onModeChange={onComposerModeChange}
        onSend={onSend}
        onPickFiles={onPickFiles}
        onPickProduct={onPickProduct}
        onOpenTemplatePicker={onOpenTemplatePicker}
        onRemoveMedia={onRemoveMedia}
        onClearContext={onClearContext}
        onToggleRecording={onToggleRecording}
        onQuickReplySelect={onQuickReplySelect}
        onSuggestReply={onSuggestReply}
      />
    </section>
  );
}
