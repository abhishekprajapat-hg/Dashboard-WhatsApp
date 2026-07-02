import { FileAudio, FileText, Image, Mic, Paperclip, Plus, Send, Smile, Video, X } from "lucide-react";
import type { PendingMedia, WhatsAppMessage } from "./types";
import { cn, formatBytes } from "./utils";

interface ComposerProps {
  value: string;
  mode: "reply" | "note";
  replyTo: WhatsAppMessage | null;
  pendingMedia: PendingMedia[];
  uploading: boolean;
  recording: boolean;
  onValueChange: (value: string) => void;
  onModeChange: (mode: "reply" | "note") => void;
  onSend: () => void;
  onPickFiles: (kind: "media" | "document" | "audio") => void;
  onRemoveMedia: (index: number) => void;
  onClearContext: () => void;
  onToggleRecording: () => void;
}

export function Composer({
  value,
  mode,
  replyTo,
  pendingMedia,
  uploading,
  recording,
  onValueChange,
  onModeChange,
  onSend,
  onPickFiles,
  onRemoveMedia,
  onClearContext,
  onToggleRecording,
}: ComposerProps) {
  const canSend = value.trim() || pendingMedia.length > 0;

  return (
    <div className="border-t border-zinc-200 bg-zinc-50 px-3 py-3 dark:border-zinc-800 dark:bg-[#182229]">
      {(replyTo || pendingMedia.length > 0 || recording) && (
        <div className="mb-2 rounded-md border border-zinc-200 bg-white p-2 text-xs text-zinc-600 shadow-sm dark:border-zinc-800 dark:bg-[#111b21] dark:text-zinc-300">
          <div className="flex items-center justify-between gap-2">
            <span className="min-w-0 truncate">
              {recording
                ? "Recording voice message"
                : replyTo
                  ? `Replying to: ${replyTo.content || replyTo.attachments?.[0]?.name || "message"}`
                  : `${pendingMedia.length} attachment${pendingMedia.length > 1 ? "s" : ""} ready`}
            </span>
            <button className="shrink-0 rounded p-1 hover:bg-zinc-100 dark:hover:bg-[#202c33]" onClick={onClearContext}>
              <X size={14} />
            </button>
          </div>
          {pendingMedia.length > 0 ? (
            <div className="mt-2 flex gap-2 overflow-x-auto pb-1">
              {pendingMedia.map((item, index) => (
                <div key={`${item.file.name}-${item.previewUrl}`} className="relative h-14 w-14 shrink-0 overflow-hidden rounded-md bg-zinc-100 dark:bg-[#202c33]">
                  {item.kind === "image" && <img src={item.previewUrl} alt={item.file.name} className="h-full w-full object-cover" />}
                  {item.kind === "video" && <video src={item.previewUrl} className="h-full w-full object-cover" />}
                  {item.kind === "audio" && <div className="flex h-full w-full items-center justify-center text-amber-500"><FileAudio size={18} /></div>}
                  {item.kind === "document" && (
                    <div className="flex h-full w-full flex-col items-center justify-center px-1 text-center text-sky-500">
                      <FileText size={17} />
                      <span className="mt-0.5 max-w-full truncate text-[9px] text-zinc-500">{formatBytes(item.file.size)}</span>
                    </div>
                  )}
                  <button className="absolute right-0.5 top-0.5 rounded-full bg-black/70 p-0.5 text-white" onClick={() => onRemoveMedia(index)}>
                    <X size={10} />
                  </button>
                </div>
              ))}
            </div>
          ) : null}
        </div>
      )}

      <div className="mb-2 flex items-center gap-1">
        {(["reply", "note"] as const).map((item) => (
          <button
            key={item}
            className={cn(
              "rounded px-2.5 py-1 text-xs font-medium capitalize",
              mode === item
                ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300"
                : "text-zinc-500 hover:bg-zinc-100 dark:text-zinc-400 dark:hover:bg-[#202c33]"
            )}
            onClick={() => onModeChange(item)}
          >
            {item}
          </button>
        ))}
      </div>

      <div className="flex items-end gap-2">
        <button className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-zinc-500 hover:bg-white hover:text-emerald-700 dark:text-zinc-400 dark:hover:bg-[#202c33]">
          <Smile size={19} />
        </button>
        <div className="relative">
          <button className="peer flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-zinc-500 hover:bg-white hover:text-emerald-700 dark:text-zinc-400 dark:hover:bg-[#202c33]">
            <Paperclip size={19} />
          </button>
          <div className="invisible absolute bottom-11 left-0 z-20 w-48 rounded-md border border-zinc-200 bg-white p-1 opacity-0 shadow-xl transition peer-focus:visible peer-focus:opacity-100 hover:visible hover:opacity-100 dark:border-zinc-800 dark:bg-[#111b21]">
            {[
              { label: "Photos & videos", icon: Image, action: () => onPickFiles("media") },
              { label: "Document / PDF", icon: FileText, action: () => onPickFiles("document") },
              { label: "Audio", icon: FileAudio, action: () => onPickFiles("audio") },
              { label: "GIF / Sticker", icon: Video, action: () => onPickFiles("media") },
            ].map((item) => {
              const Icon = item.icon;
              return (
                <button key={item.label} className="flex w-full items-center gap-2 rounded px-2 py-2 text-left text-xs text-zinc-700 hover:bg-zinc-100 dark:text-zinc-200 dark:hover:bg-[#202c33]" onClick={item.action}>
                  <Icon size={15} className="text-emerald-500" />
                  {item.label}
                </button>
              );
            })}
          </div>
        </div>
        <div className="min-w-0 flex-1 rounded-md bg-white px-3 py-2 shadow-sm ring-1 ring-zinc-200 dark:bg-[#202c33] dark:ring-zinc-800">
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
            className="max-h-32 w-full resize-none bg-transparent text-sm text-zinc-900 outline-none placeholder:text-zinc-400 dark:text-zinc-100"
          />
        </div>
        <button
          className={cn(
            "flex h-10 w-10 shrink-0 items-center justify-center rounded-full shadow-sm transition",
            recording ? "bg-red-500 text-white" : "bg-emerald-500 text-white hover:bg-emerald-600"
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
