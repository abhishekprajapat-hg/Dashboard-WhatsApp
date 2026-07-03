import { motion } from "framer-motion";
import { Check, CheckCheck, Clock3, Copy, Download, FileText, Forward, MapPin, MoreVertical, Reply, RotateCcw, Star, Trash2 } from "lucide-react";
import type { WhatsAppMessage } from "./types";
import { cn, displayAttachmentUrl, primaryAttachment, visibleStatus } from "./utils";

interface MessageBubbleProps {
  message: WhatsAppMessage;
  replyLabel?: string;
  selected?: boolean;
  onAction: (action: "reply" | "copy" | "forward" | "star" | "delete" | "retry" | "download", message: WhatsAppMessage) => void;
}

function StatusIcon({ status }: { status?: WhatsAppMessage["status"] }) {
  if (status === "failed") return <RotateCcw size={13} className="text-red-400" />;
  if (status === "queued") return <Clock3 size={13} className="text-zinc-400" />;
  if (status === "read") return <CheckCheck size={13} className="text-sky-400" />;
  if (status === "delivered") return <CheckCheck size={13} className="text-zinc-400" />;
  return <Check size={13} className="text-zinc-400" />;
}

export function MessageBubble({ message, replyLabel, selected, onAction }: MessageBubbleProps) {
  const fromAgent = message.from === "agent";
  const attachment = primaryAttachment(message);
  const attachmentUrl = attachment ? displayAttachmentUrl(attachment) : "";
  const type = message.type || (attachment?.mimeType?.includes("pdf") ? "pdf" : "text");

  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: 8, scale: 0.98 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      transition={{ duration: 0.18 }}
      className={cn("group flex px-3 py-1.5 sm:px-5", fromAgent ? "justify-end" : "justify-start")}
    >
      <div
        className={cn(
          "relative max-w-[min(82%,720px)] rounded-2xl px-3 py-2 text-sm shadow-[0_10px_28px_rgba(0,0,0,0.12)] ring-1 ring-white/5",
          fromAgent
            ? "rounded-br-md bg-primary/90 text-primary-foreground"
            : "rounded-bl-md border border-border/80 bg-card text-foreground",
          message.internal && "border border-warning/35 bg-warning/10 text-warning",
          selected && "ring-2 ring-primary"
        )}
      >
        {replyLabel ? (
          <div className="mb-1 rounded-md border-l-2 border-primary bg-black/5 px-2 py-1 text-xs text-muted-foreground dark:bg-white/5">
            {replyLabel}
          </div>
        ) : null}

        {attachment ? (
          <div className="mb-2 overflow-hidden rounded-xl bg-black/10 ring-1 ring-black/5">
            {(type === "image" || attachment.mimeType?.startsWith("image/")) && (
              <img src={attachmentUrl} alt="" className="max-h-80 w-full object-cover" />
            )}
            {(type === "video" || attachment.mimeType?.startsWith("video/")) && (
              <video src={attachmentUrl} controls className="max-h-80 w-full bg-black" />
            )}
            {(type === "audio" || attachment.mimeType?.startsWith("audio/")) && (
              <div className="p-3">
                <audio src={attachmentUrl} controls className="w-full" />
              </div>
            )}
            {!(attachment.mimeType?.startsWith("image/") || attachment.mimeType?.startsWith("video/") || attachment.mimeType?.startsWith("audio/")) && (
              <a href={attachmentUrl} target="_blank" rel="noreferrer" className="flex items-center gap-3 p-3">
                <FileText size={22} className={fromAgent ? "text-primary-foreground" : "text-primary"} />
                <span className="min-w-0 flex-1 truncate">{attachment.name || (type === "pdf" ? "PDF document" : "Document")}</span>
                <Download size={16} />
              </a>
            )}
          </div>
        ) : null}

        {type === "location" ? (
          <div className="mb-1 flex items-center gap-2 rounded-lg bg-black/5 p-2 text-xs dark:bg-white/5">
            <MapPin size={16} className={fromAgent ? "text-primary-foreground" : "text-primary"} />
            Shared location
          </div>
        ) : null}

        {message.content ? <div className="whitespace-pre-wrap break-words leading-relaxed">{message.content}</div> : null}

        {message.reaction ? (
          <span className="absolute -bottom-3 right-4 rounded-full border border-border bg-card px-1.5 py-0.5 text-xs shadow">{message.reaction}</span>
        ) : null}

        <div className={cn("mt-1 flex items-center justify-end gap-1.5 text-[10px]", fromAgent ? "text-primary-foreground/75" : "text-muted-foreground")}>
          {message.starred ? <Star size={11} className="fill-amber-400 text-amber-400" /> : null}
          <span>{message.time}</span>
          {fromAgent ? <StatusIcon status={message.status} /> : null}
          {fromAgent ? <span className="sr-only">{visibleStatus(message.status)}</span> : null}
        </div>

        <div className={cn("absolute top-1 hidden items-center gap-0.5 rounded-lg border border-border/80 bg-popover/95 p-0.5 shadow-xl backdrop-blur group-hover:flex", fromAgent ? "left-0 -translate-x-full" : "right-0 translate-x-full")}>
          {[
            ["reply", Reply],
            ["copy", Copy],
            ["forward", Forward],
            ["star", Star],
            ["delete", Trash2],
            ["download", Download],
          ].map(([action, Icon]) => (
            <button
              key={String(action)}
              className="flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground hover:bg-secondary hover:text-primary"
              onClick={() => onAction(action as Parameters<MessageBubbleProps["onAction"]>[0], message)}
              title={String(action)}
            >
              <Icon size={14} />
            </button>
          ))}
          <MoreVertical size={14} className="text-zinc-400" />
        </div>
      </div>
    </motion.div>
  );
}
