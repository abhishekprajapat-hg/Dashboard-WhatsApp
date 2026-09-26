import { memo } from "react";
import { Check, CheckCheck, ChevronDown, Clock3, Copy, Download, FileText, Forward, MapPin, Reply, RotateCcw, Star, StickyNote, Trash2 } from "lucide-react";
import type { WhatsAppMessage } from "./types";
import { cn, displayAttachmentUrl, displayTime, primaryAttachment, visibleStatus } from "./utils";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "../ui/dropdown-menu";

type MessageAction = "reply" | "copy" | "forward" | "star" | "delete" | "retry" | "download";

interface MessageBubbleProps {
  message: WhatsAppMessage;
  replyLabel?: string;
  selected?: boolean;
  /** First message of a run from the same side - gets the tail and a little more space above. */
  first?: boolean;
  onAction: (action: MessageAction, message: WhatsAppMessage) => void;
}

function StatusIcon({ status }: { status?: WhatsAppMessage["status"] }) {
  if (status === "failed") return <RotateCcw size={13} className="text-destructive" />;
  if (status === "queued") return <Clock3 size={12} className="opacity-70" />;
  if (status === "read") return <CheckCheck size={15} className="text-tick-read" />;
  if (status === "delivered") return <CheckCheck size={15} className="opacity-60" />;
  return <Check size={14} className="opacity-60" />;
}

// WhatsApp-style bubbles: incoming on the left in white, outgoing on the right in the jewel tint,
// a small tail on the first bubble of each run, time and ticks tucked into the bottom-right corner.
// Internal notes (never sent to the customer) are amber and labelled so they can't be mistaken for
// a real reply.
export const MessageBubble = memo(function MessageBubble({ message, replyLabel, selected, first = true, onAction }: MessageBubbleProps) {
  const fromAgent = message.from === "agent";
  const note = Boolean(message.internal);
  const attachment = primaryAttachment(message);
  const attachmentUrl = attachment ? displayAttachmentUrl(attachment) : "";
  const type = message.type || (attachment?.mimeType?.includes("pdf") ? "pdf" : "text");
  const failed = fromAgent && message.status === "failed";

  const actions: { id: MessageAction; label: string; icon: typeof Reply; danger?: boolean }[] = [
    { id: "reply", label: "Reply", icon: Reply },
    { id: "copy", label: "Copy", icon: Copy },
    { id: "forward", label: "Forward", icon: Forward },
    { id: "star", label: message.starred ? "Unstar" : "Star", icon: Star },
    ...(attachment ? [{ id: "download" as const, label: "Download", icon: Download }] : []),
    ...(failed ? [{ id: "retry" as const, label: "Retry", icon: RotateCcw }] : []),
    { id: "delete", label: "Delete", icon: Trash2, danger: true },
  ];

  return (
    <div className={cn("group flex px-3 sm:px-[6%]", fromAgent ? "justify-end" : "justify-start", first ? "pt-2" : "pt-0.5")}>
      <div
        className={cn(
          "relative flow-root max-w-[min(85%,640px)] break-words rounded-lg px-2.5 pb-1.5 pt-1.5 text-[14px] leading-[1.4] shadow-[0_1px_0.5px_rgba(11,20,26,0.13)]",
          note
            ? "bg-bubble-note text-foreground ring-1 ring-warning/30"
            : fromAgent
              ? "bg-bubble-out text-bubble-out-foreground"
              : "bg-bubble-in text-foreground",
          first && (fromAgent ? "rounded-tr-none" : "rounded-tl-none"),
          selected && "ring-2 ring-primary",
          failed && "ring-1 ring-destructive/50",
        )}
      >
        {first && !note && (
          <svg
            aria-hidden
            viewBox="0 0 8 13"
            className={cn("absolute top-0 h-[13px] w-2", fromAgent ? "-right-2 text-bubble-out" : "-left-2 -scale-x-100 text-bubble-in")}
          >
            <path fill="currentColor" d="M0 0h8L1.4 9.2C.9 9.9 0 9.6 0 8.7V0z" />
          </svg>
        )}

        {note && (
          <div className="mb-0.5 flex items-center gap-1 text-[11px] font-semibold text-warning">
            <StickyNote size={11} />
            Internal note · only your team sees this
          </div>
        )}

        {replyLabel ? (
          <div className={cn("mb-1 line-clamp-2 rounded-md border-l-[3px] border-primary px-2 py-1 text-[12.5px]", fromAgent ? "bg-black/[0.05] dark:bg-white/[0.07]" : "bg-secondary")}>
            {replyLabel}
          </div>
        ) : null}

        {attachment ? (
          <div className="-mx-1 mb-1 overflow-hidden rounded-md bg-black/[0.04] dark:bg-white/[0.05]">
            {(type === "image" || attachment.mimeType?.startsWith("image/")) && <img src={attachmentUrl} alt="" loading="lazy" className="max-h-80 w-full object-cover" />}
            {(type === "video" || attachment.mimeType?.startsWith("video/")) && <video src={attachmentUrl} controls className="max-h-80 w-full bg-black" />}
            {(type === "audio" || attachment.mimeType?.startsWith("audio/")) && (
              <div className="p-2">
                <audio src={attachmentUrl} controls className="h-9 w-full min-w-[220px]" />
              </div>
            )}
            {!(attachment.mimeType?.startsWith("image/") || attachment.mimeType?.startsWith("video/") || attachment.mimeType?.startsWith("audio/")) && (
              <a href={attachmentUrl} target="_blank" rel="noreferrer" className="flex min-w-[220px] items-center gap-3 p-2.5 hover:bg-black/[0.03]">
                <span className="flex size-9 shrink-0 items-center justify-center rounded-md bg-destructive/10 text-destructive">
                  <FileText size={18} />
                </span>
                <span className="min-w-0 flex-1 truncate text-[13px] font-medium">{attachment.name || (type === "pdf" ? "PDF document" : "Document")}</span>
                <Download size={16} className="shrink-0 opacity-60" />
              </a>
            )}
          </div>
        ) : null}

        {type === "location" ? (
          <div className="mb-1 flex items-center gap-2 rounded-md bg-black/[0.04] p-2 text-[12.5px] dark:bg-white/[0.05]">
            <MapPin size={16} className="text-primary" />
            Shared location
          </div>
        ) : null}

        {/* The trailing spacer reserves room so the time never sits on top of the last line. */}
        {message.content ? (
          <div className="whitespace-pre-wrap break-words pr-1">
            {message.content}
            <span aria-hidden className={cn("inline-block", fromAgent ? "w-[72px]" : "w-[52px]")} />
          </div>
        ) : null}

        <div className={cn("float-right -mt-[15px] ml-2 flex items-center gap-1 text-[11px] leading-none tabular-nums", fromAgent && !note ? "text-bubble-out-foreground/60" : "text-muted-foreground", !message.content && "mt-0")}>
          {message.starred ? <Star size={10} className="fill-current" /> : null}
          <span>{displayTime(message)}</span>
          {fromAgent && !note ? <StatusIcon status={message.status} /> : null}
          {fromAgent ? <span className="sr-only">{visibleStatus(message.status)}</span> : null}
        </div>

        {message.reaction ? (
          <span className={cn("absolute -bottom-3 rounded-full border border-border bg-card px-1 py-0.5 text-[13px] leading-none shadow-sm", fromAgent ? "right-2" : "left-2")}>{message.reaction}</span>
        ) : null}

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              aria-label="Message actions"
              className={cn(
                "absolute right-1 top-1 flex size-6 items-center justify-center rounded-full opacity-0 transition-opacity focus-visible:opacity-100 group-hover:opacity-100 data-[state=open]:opacity-100",
                fromAgent && !note ? "bg-bubble-out text-bubble-out-foreground/70" : note ? "bg-bubble-note text-muted-foreground" : "bg-bubble-in text-muted-foreground",
              )}
            >
              <ChevronDown size={15} />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align={fromAgent ? "end" : "start"} className="w-40">
            {actions.map((action, index) => {
              const Icon = action.icon;
              return (
                <div key={action.id}>
                  {action.danger && index > 0 && <DropdownMenuSeparator />}
                  <DropdownMenuItem variant={action.danger ? "destructive" : "default"} onSelect={() => onAction(action.id, message)}>
                    <Icon />
                    {action.label}
                  </DropdownMenuItem>
                </div>
              );
            })}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </div>
  );
});
