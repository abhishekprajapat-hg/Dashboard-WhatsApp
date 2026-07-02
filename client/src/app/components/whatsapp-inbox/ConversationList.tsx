import { AnimatePresence, motion } from "framer-motion";
import { BellOff, CheckCheck, MessageSquareText, Pin, Search } from "lucide-react";
import type { Conversation, InboxFilter } from "./types";
import { cn, initials } from "./utils";

interface ConversationListProps {
  conversations: Conversation[];
  selectedId: string;
  filter: InboxFilter;
  search: string;
  currentUserId?: string;
  typingIds: string[];
  onSearchChange: (search: string) => void;
  onSelect: (id: string) => void;
}

function matchesFilter(conversation: Conversation, filter: InboxFilter, currentUserId?: string) {
  if (filter === "unread") return conversation.unread > 0;
  if (filter === "assigned") return Boolean(conversation.agentId) && (!currentUserId || conversation.agentId === currentUserId);
  if (filter === "archived") return conversation.status === "archived";
  if (filter === "labels") return conversation.tags.length > 0;
  return conversation.status !== "archived";
}

export function ConversationList({
  conversations,
  selectedId,
  filter,
  search,
  currentUserId,
  typingIds,
  onSearchChange,
  onSelect,
}: ConversationListProps) {
  const filtered = conversations.filter((conversation) => {
    const text = `${conversation.name} ${conversation.phone} ${conversation.preview} ${conversation.tags.join(" ")}`.toLowerCase();
    return matchesFilter(conversation, filter, currentUserId) && (!search || text.includes(search.toLowerCase()));
  });

  return (
    <section className="flex w-full shrink-0 flex-col border-r border-zinc-200 bg-white dark:border-zinc-800 dark:bg-[#111b21] md:w-[360px] xl:w-[400px]">
      <div className="border-b border-zinc-200 px-4 py-3 dark:border-zinc-800">
        <div className="mb-3 flex items-center justify-between gap-3">
          <div>
            <h1 className="text-lg font-semibold text-zinc-950 dark:text-zinc-50">Inbox</h1>
            <p className="text-xs text-zinc-500 dark:text-zinc-400">{filtered.length} conversations</p>
          </div>
          <div className="rounded-md bg-emerald-50 px-2 py-1 text-xs font-medium text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-300">
            Business
          </div>
        </div>
        <div className="flex h-10 items-center gap-2 rounded-md border border-zinc-200 bg-zinc-50 px-3 dark:border-zinc-800 dark:bg-[#202c33]">
          <Search size={16} className="shrink-0 text-zinc-400" />
          <input
            value={search}
            onChange={(event) => onSearchChange(event.target.value)}
            placeholder="Search"
            className="min-w-0 flex-1 bg-transparent text-sm text-zinc-900 outline-none placeholder:text-zinc-400 dark:text-zinc-100"
          />
        </div>
      </div>

      <div className="no-scrollbar min-h-0 flex-1 overflow-y-auto">
        <AnimatePresence initial={false}>
          {filtered.map((conversation, index) => {
            const isTyping = typingIds.includes(conversation.id);
            const isSelected = conversation.id === selectedId;
            const pinned = Boolean(conversation.pinned);
            const muted = Boolean(conversation.muted);
            return (
              <motion.button
                layout
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -8 }}
                transition={{ duration: 0.16 }}
                key={conversation.id}
                className={cn(
                  "group flex w-full gap-3 border-b border-zinc-100 px-4 py-3 text-left transition dark:border-zinc-800/80",
                  isSelected ? "bg-emerald-50/80 dark:bg-[#1f2c33]" : "hover:bg-zinc-50 dark:hover:bg-[#18252b]"
                )}
                onClick={() => onSelect(conversation.id)}
              >
                <div className="relative h-12 w-12 shrink-0 overflow-hidden rounded-full bg-gradient-to-br from-emerald-500 to-teal-700 text-white">
                  <div className="flex h-full w-full items-center justify-center text-sm font-semibold">{initials(conversation.name)}</div>
                  <span className="absolute bottom-0 right-0 h-3.5 w-3.5 rounded-full border-2 border-white bg-emerald-400 dark:border-[#111b21]" />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <div className="min-w-0 flex-1 truncate text-sm font-semibold text-zinc-950 dark:text-zinc-50">
                      {conversation.name}
                    </div>
                    <div className="shrink-0 text-[11px] text-zinc-500 dark:text-zinc-400">{conversation.time}</div>
                  </div>
                  <div className="mt-1 flex items-center gap-1.5">
                    {conversation.preview && conversation.preview !== "No messages yet" ? (
                      <CheckCheck size={14} className="shrink-0 text-emerald-500" />
                    ) : null}
                    <div className={cn("min-w-0 flex-1 truncate text-xs", isTyping ? "font-medium text-emerald-600 dark:text-emerald-300" : "text-zinc-500 dark:text-zinc-400")}>
                      {isTyping ? "typing..." : conversation.preview || "No messages yet"}
                    </div>
                    {pinned ? <Pin size={13} className="shrink-0 text-zinc-400" /> : null}
                    {muted ? <BellOff size={13} className="shrink-0 text-zinc-400" /> : null}
                    {conversation.unread > 0 ? (
                      <span className="min-w-5 rounded-full bg-emerald-500 px-1.5 text-center text-[11px] font-bold leading-5 text-white">
                        {conversation.unread}
                      </span>
                    ) : null}
                  </div>
                  <div className="mt-2 flex items-center gap-1 overflow-hidden">
                    {conversation.tags.slice(0, 2).map((tag) => (
                      <span key={tag} className="max-w-[96px] truncate rounded bg-zinc-100 px-1.5 py-0.5 text-[10px] font-medium text-zinc-600 dark:bg-[#2a3942] dark:text-zinc-300">
                        {tag}
                      </span>
                    ))}
                    <span className="ml-auto max-w-[112px] truncate text-[10px] text-zinc-400">{conversation.agent || "Unassigned"}</span>
                  </div>
                </div>
              </motion.button>
            );
          })}
        </AnimatePresence>

        {filtered.length === 0 ? (
          <div className="flex flex-col items-center justify-center gap-2 px-6 py-16 text-center text-zinc-500 dark:text-zinc-400">
            <MessageSquareText size={24} />
            <div className="text-sm font-medium">No conversations found</div>
          </div>
        ) : null}
      </div>
    </section>
  );
}
