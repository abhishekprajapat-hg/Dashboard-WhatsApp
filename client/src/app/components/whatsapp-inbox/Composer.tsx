import { useEffect, useMemo, useRef, useState } from "react";
import { AlertTriangle, FileAudio, FileText, Image, LayoutTemplate, Loader2, MessageSquareText, Mic, Paperclip, Send, ShoppingBag, Sparkles, StickyNote, Video, X } from "lucide-react";
import { mediaCache } from "./services/mediaCache";
import type { PendingMedia, UploadState, WhatsAppMessage } from "./types";
import { cn, formatBytes } from "./utils";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "../ui/dropdown-menu";
import { Popover, PopoverContent, PopoverTrigger } from "../ui/popover";

type QuickReply = { id: string; name: string; body: string };

interface ComposerProps {
  value: string;
  mode: "reply" | "note";
  replyTo: WhatsAppMessage | null;
  pendingMedia: PendingMedia[];
  uploading: boolean;
  sendError?: string | null;
  uploadById: Record<string, UploadState>;
  recording: boolean;
  quickReplies?: QuickReply[];
  suggestingReply?: boolean;
  suggestReplyError?: string;
  sessionExpired?: boolean;
  onValueChange: (value: string) => void;
  onModeChange: (mode: "reply" | "note") => void;
  onSend: () => void;
  onPickFiles: (kind: "media" | "document" | "audio") => void;
  onPickProduct?: () => void;
  onOpenTemplatePicker?: () => void;
  onRemoveMedia: (index: number) => void;
  onClearContext: () => void;
  onToggleRecording: () => void;
  onQuickReplySelect?: (template: QuickReply, options?: { replace?: boolean }) => void;
  onSuggestReply?: () => void;
}

const iconButton = "flex size-9 shrink-0 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground disabled:opacity-50";

export const COMPOSER_ID = "inbox-composer";

export function Composer({
  value,
  mode,
  replyTo,
  pendingMedia,
  uploading,
  sendError,
  uploadById,
  recording,
  quickReplies = [],
  suggestingReply = false,
  suggestReplyError,
  sessionExpired = false,
  onValueChange,
  onModeChange,
  onSend,
  onPickFiles,
  onPickProduct,
  onOpenTemplatePicker,
  onRemoveMedia,
  onClearContext,
  onToggleRecording,
  onQuickReplySelect,
  onSuggestReply,
}: ComposerProps) {
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const [slashIndex, setSlashIndex] = useState(0);
  const [slashDismissed, setSlashDismissed] = useState(false);
  const canSend = value.trim() || pendingMedia.length > 0;
  const templateOnly = sessionExpired && mode === "reply";
  const note = mode === "note";

  // "/" at the start of an empty message opens saved replies, filtered as you type.
  const slashQuery = value.startsWith("/") && !value.includes("\n") ? value.slice(1).toLowerCase() : null;
  const slashMatches = useMemo(
    () =>
      slashQuery === null
        ? []
        : quickReplies.filter((t) => !slashQuery || t.name.toLowerCase().includes(slashQuery) || t.body.toLowerCase().includes(slashQuery)).slice(0, 8),
    [quickReplies, slashQuery],
  );
  const slashOpen = slashQuery !== null && !slashDismissed && quickReplies.length > 0 && Boolean(onQuickReplySelect);

  useEffect(() => {
    setSlashIndex(0);
    if (!value.startsWith("/")) setSlashDismissed(false);
  }, [value]);

  // Grow with the message up to ~6 lines, then scroll.
  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 160)}px`;
  }, [value]);

  function pickSlash(template: QuickReply) {
    onQuickReplySelect?.(template, { replace: true });
    window.requestAnimationFrame(() => textareaRef.current?.focus());
  }

  return (
    <div className={cn("relative z-10 border-t border-border px-3 pb-3 pt-2 sm:px-4", note ? "bg-bubble-note/60" : "bg-card")}>
      {(replyTo || pendingMedia.length > 0 || recording) && (
        <div className="mb-2 rounded-lg border-l-[3px] border-primary bg-secondary/70 p-2 text-[12.5px] text-muted-foreground">
          <div className="flex items-center justify-between gap-2">
            <span className="min-w-0 truncate">
              {recording
                ? "Recording voice message…"
                : replyTo
                  ? <>Replying to <span className="text-foreground">{replyTo.content || replyTo.attachments?.[0]?.name || "message"}</span></>
                  : `${pendingMedia.length} attachment${pendingMedia.length > 1 ? "s" : ""} ready to send`}
            </span>
            <button type="button" aria-label="Cancel" className="shrink-0 rounded-full p-1 hover:bg-card hover:text-foreground" onClick={onClearContext}>
              <X size={14} />
            </button>
          </div>
          {pendingMedia.length > 0 ? (
            <div className="mt-2 flex gap-2 overflow-x-auto pb-1">
              {pendingMedia.map((item, index) => {
                const upload = uploadById[mediaCache.fingerprint(item.file)];
                const failed = upload?.status === "failed";
                const inProgress = upload?.status === "uploading";
                return (
                  <div
                    key={`${item.file.name}-${item.previewUrl}`}
                    title={failed ? upload?.error || "Upload failed" : item.file.name}
                    className={cn("relative size-14 shrink-0 overflow-hidden rounded-lg border bg-card", failed ? "border-destructive" : "border-border")}
                  >
                    {item.kind === "image" && <img src={item.previewUrl} alt={item.file.name} className="h-full w-full object-cover" />}
                    {item.kind === "video" && <video src={item.previewUrl} className="h-full w-full object-cover" />}
                    {item.kind === "audio" && (
                      <div className="flex h-full w-full items-center justify-center text-warning">
                        <FileAudio size={18} />
                      </div>
                    )}
                    {item.kind === "document" && (
                      <div className="flex h-full w-full flex-col items-center justify-center px-1 text-center text-info">
                        <FileText size={17} />
                        <span className="mt-0.5 max-w-full truncate text-[9px] text-muted-foreground">{formatBytes(item.file.size)}</span>
                      </div>
                    )}
                    {inProgress && (
                      <div className="absolute inset-x-0 bottom-0 bg-black/60 px-1 py-0.5">
                        <div className="h-1 w-full overflow-hidden rounded-full bg-white/20">
                          <div className="h-full rounded-full bg-primary transition-all" style={{ width: `${upload.progress}%` }} />
                        </div>
                      </div>
                    )}
                    {failed && (
                      <div className="absolute inset-0 flex items-center justify-center bg-destructive/70">
                        <AlertTriangle size={18} className="text-white" />
                      </div>
                    )}
                    <button type="button" aria-label={`Remove ${item.file.name}`} className="absolute right-0.5 top-0.5 rounded-full bg-black/70 p-0.5 text-white" onClick={() => onRemoveMedia(index)}>
                      <X size={10} />
                    </button>
                  </div>
                );
              })}
            </div>
          ) : null}
        </div>
      )}

      {sendError ? <div className="mb-2 rounded-lg bg-problem-soft px-2.5 py-1.5 text-[12.5px] text-destructive">{sendError}</div> : null}

      {templateOnly ? (
        <div className="mb-2 flex flex-wrap items-center gap-2 rounded-lg bg-warning/10 px-2.5 py-2 text-[12.5px] text-foreground">
          <Clock24 />
          <span className="min-w-0 flex-1">No message from this customer in 24 hours, so WhatsApp only delivers an approved template.</span>
          {onOpenTemplatePicker && (
            <button type="button" className="flex shrink-0 items-center gap-1 rounded-md bg-card px-2 py-1 font-medium text-foreground shadow-card hover:bg-secondary" onClick={onOpenTemplatePicker}>
              <LayoutTemplate size={13} /> Send a template
            </button>
          )}
        </div>
      ) : null}

      {suggestReplyError ? <div className="mb-2 rounded-lg bg-warning/10 px-2.5 py-1.5 text-[12.5px] text-warning">{suggestReplyError}</div> : null}

      <div className="mb-1.5 flex items-center gap-3">
        <div role="tablist" aria-label="Message type" className="flex items-center gap-3">
          {(["reply", "note"] as const).map((item) => (
            <button
              key={item}
              type="button"
              role="tab"
              aria-selected={mode === item}
              className={cn(
                "flex items-center gap-1 border-b-2 pb-0.5 text-[12px] font-medium transition-colors",
                mode === item ? (item === "note" ? "border-warning text-foreground" : "border-primary text-foreground") : "border-transparent text-muted-foreground hover:text-foreground",
              )}
              onClick={() => onModeChange(item)}
            >
              {item === "note" && <StickyNote size={12} />}
              {item === "reply" ? "Reply" : "Internal note"}
            </button>
          ))}
        </div>
        {quickReplies.length > 0 && onQuickReplySelect && !note && (
          <span className="ml-auto hidden text-[11px] text-muted-foreground md:inline">
            Type <kbd className="rounded border border-border bg-card px-1 font-sans">/</kbd> for saved replies
          </span>
        )}
      </div>

      {slashOpen && (
        <div role="listbox" aria-label="Saved replies" className="absolute inset-x-3 bottom-full z-20 mb-1 max-h-72 overflow-y-auto rounded-xl border border-border bg-popover p-1 shadow-float sm:inset-x-4">
          <div className="px-2 pb-1 pt-1.5 text-[11px] font-medium text-muted-foreground">Saved replies · ↑ ↓ to choose, Enter to insert</div>
          {slashMatches.length ? (
            slashMatches.map((template, index) => (
              <button
                key={template.id}
                type="button"
                role="option"
                aria-selected={index === slashIndex}
                onMouseEnter={() => setSlashIndex(index)}
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => pickSlash(template)}
                className={cn("block w-full rounded-lg px-2.5 py-2 text-left", index === slashIndex ? "bg-accent" : "hover:bg-secondary")}
              >
                <span className="block truncate text-[13px] font-medium text-foreground">/{template.name}</span>
                <span className="mt-0.5 line-clamp-1 text-[12px] text-muted-foreground">{template.body}</span>
              </button>
            ))
          ) : (
            <div className="px-2.5 py-2 text-[12.5px] text-muted-foreground">No saved reply matches "{slashQuery}".</div>
          )}
        </div>
      )}

      <div className="flex min-w-0 items-end gap-1">
        {onSuggestReply ? (
          <button type="button" className={cn(iconButton, "hover:text-primary")} title="Draft a reply with AI" aria-label="Draft a reply with AI" disabled={suggestingReply} onClick={onSuggestReply}>
            {suggestingReply ? <Loader2 size={18} className="animate-spin" /> : <Sparkles size={18} />}
          </button>
        ) : null}

        {quickReplies.length > 0 && onQuickReplySelect && (
          <Popover>
            <PopoverTrigger asChild>
              <button type="button" className={iconButton} title="Saved replies" aria-label="Saved replies">
                <MessageSquareText size={18} />
              </button>
            </PopoverTrigger>
            <PopoverContent side="top" align="start" className="max-h-72 w-[min(18rem,calc(100vw-2rem))] overflow-y-auto p-1">
              {quickReplies.slice(0, 30).map((template) => (
                <button key={template.id} type="button" className="block w-full rounded-lg px-2.5 py-2 text-left hover:bg-secondary" onClick={() => onQuickReplySelect(template)}>
                  <span className="block truncate text-[13px] font-medium text-foreground">{template.name}</span>
                  <span className="mt-0.5 line-clamp-2 text-[12px] text-muted-foreground">{template.body}</span>
                </button>
              ))}
            </PopoverContent>
          </Popover>
        )}

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button type="button" className={iconButton} title="Attach" aria-label="Attach">
              <Paperclip size={18} />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent side="top" align="start" className="w-52">
            <DropdownMenuItem onSelect={() => onPickFiles("media")}>
              <Image /> Photos & videos
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => onPickFiles("document")}>
              <FileText /> Document or PDF
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => onPickFiles("audio")}>
              <FileAudio /> Audio
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => onPickFiles("media")}>
              <Video /> GIF or sticker
            </DropdownMenuItem>
            {onPickProduct && (
              <DropdownMenuItem onSelect={onPickProduct}>
                <ShoppingBag /> Product from catalogue
              </DropdownMenuItem>
            )}
            {onOpenTemplatePicker && (
              <DropdownMenuItem onSelect={onOpenTemplatePicker}>
                <LayoutTemplate /> Approved template
              </DropdownMenuItem>
            )}
          </DropdownMenuContent>
        </DropdownMenu>

        <div className={cn("min-w-0 flex-1 rounded-[20px] border bg-input-background px-3.5 py-2 transition-colors focus-within:ring-2", note ? "border-warning/40 focus-within:ring-warning/25" : "border-input focus-within:border-ring focus-within:ring-ring/20")}>
          <textarea
            id={COMPOSER_ID}
            ref={textareaRef}
            value={value}
            rows={1}
            onChange={(event) => onValueChange(event.target.value)}
            onKeyDown={(event) => {
              if (slashOpen && slashMatches.length) {
                if (event.key === "ArrowDown") {
                  event.preventDefault();
                  setSlashIndex((i) => (i + 1) % slashMatches.length);
                  return;
                }
                if (event.key === "ArrowUp") {
                  event.preventDefault();
                  setSlashIndex((i) => (i - 1 + slashMatches.length) % slashMatches.length);
                  return;
                }
                if (event.key === "Enter" || event.key === "Tab") {
                  event.preventDefault();
                  pickSlash(slashMatches[slashIndex]);
                  return;
                }
              }
              if (slashOpen && event.key === "Escape") {
                event.preventDefault();
                setSlashDismissed(true);
                return;
              }
              if (event.key === "Enter" && !event.shiftKey) {
                event.preventDefault();
                onSend();
              }
            }}
            aria-label={note ? "Internal note" : "Message"}
            placeholder={note ? "Note for your team - the customer won't see this" : "Type a message"}
            className="block max-h-40 w-full resize-none bg-transparent text-[14px] leading-[1.4] text-foreground outline-none placeholder:text-muted-foreground"
          />
        </div>

        <button
          type="button"
          className={cn(
            "flex size-10 shrink-0 items-center justify-center rounded-full shadow-sm transition-colors disabled:opacity-60",
            recording ? "bg-destructive text-white" : note ? "bg-warning text-white hover:bg-warning/90" : "bg-primary text-primary-foreground hover:bg-primary/90",
          )}
          disabled={uploading}
          aria-label={uploading ? "Uploading" : canSend ? (note ? "Save note" : "Send") : recording ? "Stop recording" : "Record voice message"}
          title={templateOnly && canSend ? "This reply won't be delivered - send a template instead" : undefined}
          onClick={() => {
            if (templateOnly && canSend) {
              onOpenTemplatePicker?.();
              return;
            }
            canSend ? onSend() : onToggleRecording();
          }}
        >
          {uploading ? <Loader2 size={17} className="animate-spin" /> : canSend ? <Send size={17} className="translate-x-px" /> : <Mic size={18} />}
        </button>
      </div>
    </div>
  );
}

function Clock24() {
  return (
    <span className="flex h-5 shrink-0 items-center rounded bg-warning/20 px-1 text-[10.5px] font-semibold text-warning tabular-nums" aria-hidden>
      24h
    </span>
  );
}
