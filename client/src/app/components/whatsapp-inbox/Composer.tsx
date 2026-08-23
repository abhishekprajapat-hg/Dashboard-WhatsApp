import { AlertTriangle, FileAudio, FileText, Image, Loader2, MessageSquareText, Mic, Paperclip, Plus, Send, ShoppingBag, Smile, Sparkles, Video, X } from "lucide-react";
import { mediaCache } from "./services/mediaCache";
import type { PendingMedia, UploadState, WhatsAppMessage } from "./types";
import { cn, formatBytes } from "./utils";

interface ComposerProps {
  value: string;
  mode: "reply" | "note";
  replyTo: WhatsAppMessage | null;
  pendingMedia: PendingMedia[];
  uploading: boolean;
  sendError?: string | null;
  uploadById: Record<string, UploadState>;
  recording: boolean;
  quickReplies?: { id: string; name: string; body: string }[];
  suggestingReply?: boolean;
  suggestReplyError?: string;
  onValueChange: (value: string) => void;
  onModeChange: (mode: "reply" | "note") => void;
  onSend: () => void;
  onPickFiles: (kind: "media" | "document" | "audio") => void;
  onPickProduct?: () => void;
  onRemoveMedia: (index: number) => void;
  onClearContext: () => void;
  onToggleRecording: () => void;
  onQuickReplySelect?: (template: { id: string; name: string; body: string }) => void;
  onSuggestReply?: () => void;
}

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
  onValueChange,
  onModeChange,
  onSend,
  onPickFiles,
  onPickProduct,
  onRemoveMedia,
  onClearContext,
  onToggleRecording,
  onQuickReplySelect,
  onSuggestReply,
}: ComposerProps) {
  const canSend = value.trim() || pendingMedia.length > 0;

  return (
    <div className="relative z-10 border-t border-border/80 bg-card/82 px-3 py-3 shadow-[0_-18px_45px_rgba(0,0,0,0.18)] backdrop-blur-xl">
      {(replyTo || pendingMedia.length > 0 || recording) && (
        <div className="mb-2 rounded-lg border border-border/80 bg-surface-subtle/80 p-2 text-xs text-muted-foreground shadow-sm">
          <div className="flex items-center justify-between gap-2">
            <span className="min-w-0 truncate">
              {recording
                ? "Recording voice message"
                : replyTo
                  ? `Replying to: ${replyTo.content || replyTo.attachments?.[0]?.name || "message"}`
                  : `${pendingMedia.length} attachment${pendingMedia.length > 1 ? "s" : ""} ready`}
            </span>
            <button className="shrink-0 rounded-md p-1 hover:bg-secondary hover:text-foreground" onClick={onClearContext}>
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
                    title={failed ? upload?.error || "Upload failed" : undefined}
                    className={cn(
                      "relative h-14 w-14 shrink-0 overflow-hidden rounded-lg border bg-secondary",
                      failed ? "border-destructive" : "border-border/80"
                    )}
                  >
                    {item.kind === "image" && <img src={item.previewUrl} alt={item.file.name} className="h-full w-full object-cover" />}
                    {item.kind === "video" && <video src={item.previewUrl} className="h-full w-full object-cover" />}
                    {item.kind === "audio" && <div className="flex h-full w-full items-center justify-center text-warning"><FileAudio size={18} /></div>}
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
                    <button className="absolute right-0.5 top-0.5 rounded-full bg-black/70 p-0.5 text-white" onClick={() => onRemoveMedia(index)}>
                      <X size={10} />
                    </button>
                  </div>
                );
              })}
            </div>
          ) : null}
        </div>
      )}

      {sendError ? (
        <div className="mb-2 rounded-lg border border-destructive/40 bg-destructive/10 px-2 py-1.5 text-xs text-destructive">
          {sendError}
        </div>
      ) : null}

      <div className="mb-2 flex w-fit max-w-full items-center gap-1 overflow-x-auto rounded-lg border border-border/60 bg-surface-subtle/50 p-1">
        {(["reply", "note"] as const).map((item) => (
          <button
            key={item}
            className={cn(
              "rounded-md px-2.5 py-1 text-xs font-medium capitalize transition-colors",
              mode === item
                ? "bg-primary/12 text-primary"
                : "text-muted-foreground hover:bg-secondary hover:text-foreground"
            )}
            onClick={() => onModeChange(item)}
          >
            {item}
          </button>
        ))}
      </div>

      {suggestReplyError ? (
        <div className="mb-2 rounded-lg border border-warning/40 bg-warning/10 px-2 py-1.5 text-xs text-warning">
          {suggestReplyError}
        </div>
      ) : null}

      <div className="flex min-w-0 items-end gap-1.5 sm:gap-2">
        <button className="hidden h-10 w-10 shrink-0 items-center justify-center rounded-xl text-muted-foreground hover:bg-secondary hover:text-foreground sm:flex">
          <Smile size={19} />
        </button>
        {onSuggestReply ? (
          <button
            className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl text-muted-foreground hover:bg-secondary hover:text-primary disabled:opacity-60"
            title="Suggest a reply with AI"
            disabled={suggestingReply}
            onClick={onSuggestReply}
          >
            {suggestingReply ? <Loader2 size={19} className="animate-spin" /> : <Sparkles size={19} />}
          </button>
        ) : null}
        {quickReplies.length > 0 && (
          <div className="relative">
            <button className="peer flex h-10 w-10 shrink-0 items-center justify-center rounded-xl text-muted-foreground hover:bg-secondary hover:text-primary">
              <MessageSquareText size={19} />
            </button>
            <div className="invisible absolute bottom-11 left-0 z-20 max-h-64 w-[min(16rem,calc(100vw-2rem))] overflow-y-auto rounded-lg border border-border/80 bg-popover p-1 opacity-0 shadow-2xl shadow-black/30 transition peer-focus:visible peer-focus:opacity-100 hover:visible hover:opacity-100">
              {quickReplies.slice(0, 20).map((template) => (
                <button key={template.id} className="block w-full rounded-md px-2 py-2 text-left hover:bg-secondary" onClick={() => onQuickReplySelect?.(template)}>
                  <span className="block truncate text-xs font-medium text-foreground">{template.name}</span>
                  <span className="mt-0.5 line-clamp-2 text-[11px] text-muted-foreground">{template.body}</span>
                </button>
              ))}
            </div>
          </div>
        )}
        <div className="relative">
            <button className="peer flex h-10 w-10 shrink-0 items-center justify-center rounded-xl text-muted-foreground hover:bg-secondary hover:text-primary">
              <Paperclip size={19} />
            </button>
          <div className="invisible absolute bottom-11 left-0 z-20 w-[min(12rem,calc(100vw-2rem))] rounded-lg border border-border/80 bg-popover p-1 opacity-0 shadow-2xl shadow-black/30 transition peer-focus:visible peer-focus:opacity-100 hover:visible hover:opacity-100">
            {[
              { label: "Photos & videos", icon: Image, action: () => onPickFiles("media") },
              { label: "Document / PDF", icon: FileText, action: () => onPickFiles("document") },
              { label: "Audio", icon: FileAudio, action: () => onPickFiles("audio") },
              { label: "GIF / Sticker", icon: Video, action: () => onPickFiles("media") },
              ...(onPickProduct ? [{ label: "Product", icon: ShoppingBag, action: onPickProduct }] : []),
            ].map((item) => {
              const Icon = item.icon;
              return (
                <button key={item.label} className="flex w-full items-center gap-2 rounded-md px-2 py-2 text-left text-xs text-foreground hover:bg-secondary" onClick={item.action}>
                  <Icon size={15} className="text-primary" />
                  {item.label}
                </button>
              );
            })}
          </div>
        </div>
        <div className="min-w-0 flex-1 rounded-xl border border-input/80 bg-input-background px-3 py-2 shadow-[0_1px_0_rgba(255,255,255,0.03)_inset] focus-within:border-ring focus-within:ring-2 focus-within:ring-ring/20">
          <textarea
            value={value}
            rows={1}
            onChange={(event) => onValueChange(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter" && !event.shiftKey) {
                event.preventDefault();
                onSend();
              }
            }}
            placeholder={mode === "note" ? "Write an internal note" : "Type a message"}
            className="max-h-32 w-full resize-none bg-transparent text-sm text-foreground outline-none placeholder:text-muted-foreground/75"
          />
        </div>
        <button
          className={cn(
            "flex h-10 w-10 shrink-0 items-center justify-center rounded-xl shadow-sm transition",
            recording ? "bg-destructive text-white" : "bg-primary text-primary-foreground hover:bg-primary/90"
          )}
          disabled={uploading}
          onClick={canSend ? onSend : onToggleRecording}
        >
          {uploading ? <Plus size={16} className="animate-spin" /> : canSend ? <Send size={17} /> : <Mic size={18} />}
        </button>
      </div>
    </div>
  );
}
