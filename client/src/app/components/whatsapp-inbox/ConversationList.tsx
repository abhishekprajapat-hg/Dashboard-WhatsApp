import { forwardRef, useState } from "react";
import { BellOff, Check, ChevronDown, Facebook, Instagram, ListFilter, MessageSquareText, Phone, Pin, Search, X } from "lucide-react";
import type { Conversation, InboxFilter } from "./types";
import { ContactAvatar } from "./ContactAvatar";
import { cn } from "./utils";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from "../ui/dropdown-menu";

interface ConversationListProps {
  conversations: Conversation[];
  channelCounts?: { whatsapp: number; instagram: number; facebook: number } | null;
  selectedId: string;
  filter: InboxFilter;
  search: string;
  currentUserId?: string;
  typingIds: string[];
  loading: boolean;
  error: string;
  hasMore?: boolean;
  loadingMore?: boolean;
  onLoadMore?: () => void;
  onFilterChange: (filter: InboxFilter) => void;
  onSearchChange: (search: string) => void;
  onSelect: (id: string) => void;
  onRetry: () => void;
}

function matchesFilter(conversation: Conversation, filter: InboxFilter, currentUserId?: string) {
  if (filter === "unread") return conversation.unread > 0;
  if (filter === "assigned") return Boolean(conversation.agentId) && (!currentUserId || conversation.agentId === currentUserId);
  if (filter === "unassigned") return !conversation.agentId && conversation.status !== "archived";
  if (filter === "open") return conversation.status === "open";
  if (filter === "waiting") return conversation.status === "waiting";
  if (filter === "resolved") return conversation.status === "resolved";
  if (filter === "archived") return conversation.status === "archived";
  if (filter === "labels") return conversation.tags.length > 0;
  return conversation.status !== "archived";
}

export function isInstagram(c: Conversation) {
  return c.channel === "instagram";
}
export function isFacebook(c: Conversation) {
  return c.channel === "facebook";
}

/** The list exactly as shown (filter + search), in display order: WhatsApp, Instagram, Facebook. */
export function visibleConversations(conversations: Conversation[], filter: InboxFilter, search: string, currentUserId?: string) {
  const q = search.toLowerCase();
  const filtered = conversations.filter((conversation) => {
    const text = `${conversation.name} ${conversation.phone} ${conversation.preview} ${conversation.tags.join(" ")}`.toLowerCase();
    return matchesFilter(conversation, filter, currentUserId) && (!q || text.includes(q));
  });
  return [
    ...filtered.filter((c) => !isInstagram(c) && !isFacebook(c)),
    ...filtered.filter(isInstagram),
    ...filtered.filter(isFacebook),
  ];
}

const QUEUES: { id: InboxFilter; label: string }[] = [
  { id: "all", label: "All" },
  { id: "assigned", label: "Mine" },
  { id: "unassigned", label: "Unassigned" },
];

const MORE_FILTERS: { id: InboxFilter; label: string }[] = [
  { id: "unread", label: "Unread" },
  { id: "waiting", label: "Waiting for reply" },
  { id: "open", label: "Open" },
  { id: "resolved", label: "Resolved" },
  { id: "archived", label: "Archived" },
  { id: "labels", label: "Has labels" },
];

const statusText: Record<Conversation["status"], string> = {
  open: "Open",
  waiting: "Waiting",
  resolved: "Resolved",
  bot: "Bot",
  archived: "Archived",
};

function prettyStage(value: string) {
  return value.replace(/[_-]+/g, " ").replace(/^\w/, (c) => c.toUpperCase());
}

function ConversationRow({
  conversation,
  isSelected,
  isTyping,
  onSelect,
}: {
  conversation: Conversation;
  isSelected: boolean;
  isTyping: boolean;
  onSelect: (id: string) => void;
}) {
  const unread = conversation.unread > 0;
  const stage = conversation.crmStage || conversation.lifecycleStatus;
  const meta = [
    conversation.status === "waiting" || conversation.status === "bot" ? null : statusText[conversation.status],
    stage ? prettyStage(stage) : null,
    conversation.agent || "Unassigned",
  ].filter(Boolean);

  return (
    <button
      type="button"
      data-conversation-id={conversation.id}
      aria-current={isSelected ? "true" : undefined}
      className={cn(
        "relative flex w-full gap-3 px-3 py-2.5 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring/50",
        isSelected ? "bg-accent" : "hover:bg-foreground/[0.035]",
      )}
      onClick={() => onSelect(conversation.id)}
    >
      {isSelected && <span className="absolute inset-y-2 left-0 w-[3px] rounded-r-full bg-primary" />}
      <ContactAvatar name={conversation.name} channel={conversation.channel} />
      <span className="min-w-0 flex-1">
        <span className="flex items-baseline gap-2">
          <span className={cn("min-w-0 flex-1 truncate text-[14px] text-foreground", unread ? "font-semibold" : "font-medium")}>{conversation.name}</span>
          <span className={cn("shrink-0 text-[11px] tabular-nums", unread ? "font-semibold text-primary" : "text-muted-foreground")}>{conversation.time}</span>
        </span>
        <span className="mt-0.5 flex items-center gap-1.5">
          <span className={cn("min-w-0 flex-1 truncate text-[12.5px]", isTyping ? "font-medium text-primary" : unread ? "text-foreground" : "text-muted-foreground")}>
            {isTyping ? "typing…" : conversation.preview || "No messages yet"}
          </span>
          {conversation.pinned ? <Pin size={12} className="shrink-0 text-muted-foreground" aria-label="Pinned" /> : null}
          {conversation.muted ? <BellOff size={12} className="shrink-0 text-muted-foreground" aria-label="Muted" /> : null}
          {unread ? (
            <span className="min-w-5 shrink-0 rounded-full bg-primary px-1.5 text-center text-[10.5px] font-semibold leading-5 text-primary-foreground tabular-nums">{conversation.unread}</span>
          ) : null}
        </span>
        <span className="mt-1 flex items-center gap-1.5 overflow-hidden text-[11px] text-muted-foreground">
          {conversation.status === "waiting" && (
            <span className="flex shrink-0 items-center gap-1 font-medium text-warning">
              <span className="size-1.5 rounded-full bg-warning" />
              Waiting
            </span>
          )}
          {conversation.status === "bot" && <span className="shrink-0 font-medium text-info">Bot</span>}
          <span className="truncate">{meta.join(" · ")}</span>
          {conversation.tags.slice(0, 2).map((tag) => (
            <span key={tag} className="max-w-[84px] shrink-0 truncate rounded bg-secondary px-1 py-px text-[10.5px] text-secondary-foreground">
              {tag}
            </span>
          ))}
        </span>
      </span>
    </button>
  );
}

function ChannelSection({
  label,
  icon,
  conversations,
  count,
  selectedId,
  typingIds,
  open,
  onToggle,
  onSelect,
  emptyLabel,
}: {
  label: string;
  icon: React.ReactNode;
  conversations: Conversation[];
  // True server-side total for this channel, independent of how many conversations are actually
  // loaded/paginated client-side yet. Falls back to the loaded array's length when the server
  // count hasn't arrived - e.g. on first paint, or if the request failed.
  count?: number;
  selectedId: string;
  typingIds: string[];
  open: boolean;
  onToggle: () => void;
  onSelect: (id: string) => void;
  emptyLabel: string;
}) {
  return (
    <div>
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={open}
        className="sticky top-0 z-[1] flex w-full items-center gap-2 bg-card/95 px-3 pb-1 pt-3 text-left backdrop-blur"
      >
        <span className="text-muted-foreground">{icon}</span>
        <span className="flex-1 text-[10.5px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">{label}</span>
        <span className="text-[11px] text-muted-foreground tabular-nums">{count ?? conversations.length}</span>
        <ChevronDown size={13} className={cn("shrink-0 text-muted-foreground transition-transform", open ? "" : "-rotate-90")} />
      </button>
      {open ? (
        conversations.length === 0 ? (
          <div className="px-3 pb-3 pt-1 text-[12px] text-muted-foreground">{emptyLabel}</div>
        ) : (
          <div>
            {conversations.map((conversation) => (
              <ConversationRow
                key={conversation.id}
                conversation={conversation}
                isSelected={conversation.id === selectedId}
                isTyping={typingIds.includes(conversation.id)}
                onSelect={onSelect}
              />
            ))}
          </div>
        )
      ) : null}
    </div>
  );
}

export const ConversationList = forwardRef<HTMLInputElement, ConversationListProps>(function ConversationList(
  {
    conversations,
    channelCounts,
    selectedId,
    filter,
    search,
    currentUserId,
    typingIds,
    loading,
    error,
    hasMore,
    loadingMore,
    onLoadMore,
    onFilterChange,
    onSearchChange,
    onSelect,
    onRetry,
  },
  searchRef,
) {
  const [openSections, setOpenSections] = useState({ whatsapp: true, instagram: true, facebook: false });

  const visible = visibleConversations(conversations, filter, search, currentUserId);
  const whatsappConversations = visible.filter((c) => !isInstagram(c) && !isFacebook(c));
  const instagramConversations = visible.filter(isInstagram);
  const facebookConversations = visible.filter(isFacebook);
  const anySocial = conversations.some((c) => isInstagram(c) || isFacebook(c)) || Boolean(channelCounts && (channelCounts.instagram || channelCounts.facebook));

  const queueCount = (id: InboxFilter) => conversations.filter((c) => matchesFilter(c, id, currentUserId)).length;
  const extraFilter = MORE_FILTERS.find((f) => f.id === filter);

  function toggleSection(key: keyof typeof openSections) {
    setOpenSections((current) => ({ ...current, [key]: !current[key] }));
  }

  return (
    <section className="@container flex h-full w-full min-w-0 shrink-0 flex-col border-r border-border bg-card">
      <div className="grid gap-2.5 border-b border-border px-3 pb-2.5 pt-3">
        <label className="flex h-9 items-center gap-2 rounded-lg bg-secondary/70 px-2.5 text-muted-foreground focus-within:bg-card focus-within:ring-2 focus-within:ring-ring/30">
          <Search size={15} className="shrink-0" />
          <input
            ref={searchRef}
            value={search}
            onChange={(event) => onSearchChange(event.target.value)}
            placeholder="Search name, phone or label"
            aria-label="Search conversations"
            className="min-w-0 flex-1 bg-transparent text-[13px] text-foreground outline-none placeholder:text-muted-foreground"
          />
          {search ? (
            <button type="button" onClick={() => onSearchChange("")} aria-label="Clear search" className="rounded p-0.5 hover:text-foreground">
              <X size={14} />
            </button>
          ) : (
            <kbd className="hidden rounded border border-border px-1 text-[10px] font-medium md:inline">/</kbd>
          )}
        </label>

        <div className="flex items-center gap-1">
          <div role="tablist" aria-label="Queue" className="flex min-w-0 flex-1 items-center gap-0.5 rounded-lg bg-secondary/70 p-0.5">
            {QUEUES.map((queue) => {
              const active = filter === queue.id;
              return (
                <button
                  key={queue.id}
                  type="button"
                  role="tab"
                  aria-selected={active}
                  onClick={() => onFilterChange(queue.id)}
                  className={cn(
                    "flex h-7 min-w-0 flex-auto items-center justify-center gap-1 rounded-md px-2 text-[12px] font-medium transition-colors",
                    active ? "bg-card text-foreground shadow-card" : "text-muted-foreground hover:text-foreground",
                  )}
                >
                  <span className="truncate">{queue.label}</span>
                  {!loading && queue.id !== "all" && <span className="hidden text-[10.5px] text-muted-foreground tabular-nums @[300px]:inline">{queueCount(queue.id)}</span>}
                </button>
              );
            })}
          </div>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button
                type="button"
                aria-label="More filters"
                className={cn(
                  "flex size-8 shrink-0 items-center justify-center rounded-lg transition-colors",
                  extraFilter ? "bg-accent text-primary" : "text-muted-foreground hover:bg-secondary hover:text-foreground",
                )}
              >
                <ListFilter size={15} />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-48">
              <DropdownMenuLabel className="text-xs font-medium text-muted-foreground">Show only</DropdownMenuLabel>
              {MORE_FILTERS.map((item) => (
                <DropdownMenuItem key={item.id} onSelect={() => onFilterChange(item.id)}>
                  <Check className={cn(filter === item.id ? "opacity-100" : "opacity-0")} />
                  {item.label}
                </DropdownMenuItem>
              ))}
              {extraFilter && (
                <>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem onSelect={() => onFilterChange("all")}>
                    <X />
                    Clear filter
                  </DropdownMenuItem>
                </>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>

        {extraFilter && (
          <div className="flex items-center gap-2 text-[12px] text-muted-foreground">
            <span>
              Showing <span className="font-medium text-foreground">{extraFilter.label.toLowerCase()}</span> · {visible.length}
              {hasMore ? "+" : ""}
            </span>
            <button type="button" onClick={() => onFilterChange("all")} className="ml-auto font-medium text-primary hover:underline">
              Clear
            </button>
          </div>
        )}
      </div>

      <div
        className="min-h-0 flex-1 overflow-y-auto pb-2"
        onScroll={(event) => {
          if (!hasMore || loadingMore || !onLoadMore) return;
          const target = event.currentTarget;
          if (target.scrollHeight - target.scrollTop - target.clientHeight < 200) onLoadMore();
        }}
      >
        {loading ? (
          <div className="grid gap-4 px-3 py-4" aria-busy="true">
            {[0, 1, 2, 3, 4, 5].map((item) => (
              <div key={item} className="flex gap-3">
                <div className="size-10 shrink-0 animate-pulse rounded-full bg-secondary" />
                <div className="min-w-0 flex-1 space-y-2 py-1">
                  <div className="h-3 w-1/2 animate-pulse rounded bg-secondary" />
                  <div className="h-3 w-5/6 animate-pulse rounded bg-secondary" />
                </div>
              </div>
            ))}
          </div>
        ) : error ? (
          <div className="flex flex-col items-center justify-center gap-3 px-6 py-16 text-center text-muted-foreground">
            <MessageSquareText size={22} />
            <div>
              <div className="text-sm font-medium text-foreground">The inbox didn't load</div>
              <p className="mt-1 text-xs">{error}</p>
            </div>
            <button type="button" className="h-8 rounded-lg border border-border px-3 text-xs font-medium text-foreground hover:bg-secondary" onClick={onRetry}>
              Try again
            </button>
          </div>
        ) : visible.length === 0 && !anySocial ? (
          <div className="px-6 py-14 text-center">
            <p className="text-sm font-medium text-foreground">{search || filter !== "all" ? "Nothing matches" : "No conversations yet"}</p>
            <p className="mt-1 text-xs text-muted-foreground">
              {search || filter !== "all" ? "Try another search or clear the filter." : "Chats appear here as soon as a customer messages you."}
            </p>
          </div>
        ) : (
          <>
            <ChannelSection
              label="WhatsApp"
              icon={<Phone size={12} />}
              conversations={whatsappConversations}
              count={channelCounts?.whatsapp}
              selectedId={selectedId}
              typingIds={typingIds}
              open={openSections.whatsapp}
              onToggle={() => toggleSection("whatsapp")}
              onSelect={onSelect}
              emptyLabel="No WhatsApp chats in this view."
            />
            {anySocial && (
              <>
                <ChannelSection
                  label="Instagram"
                  icon={<Instagram size={12} />}
                  conversations={instagramConversations}
                  count={channelCounts?.instagram}
                  selectedId={selectedId}
                  typingIds={typingIds}
                  open={openSections.instagram}
                  onToggle={() => toggleSection("instagram")}
                  onSelect={onSelect}
                  emptyLabel="No Instagram chats in this view."
                />
                <ChannelSection
                  label="Facebook"
                  icon={<Facebook size={12} />}
                  conversations={facebookConversations}
                  count={channelCounts?.facebook}
                  selectedId={selectedId}
                  typingIds={typingIds}
                  open={openSections.facebook}
                  onToggle={() => toggleSection("facebook")}
                  onSelect={onSelect}
                  emptyLabel="No Facebook chats in this view."
                />
              </>
            )}
            {hasMore ? (
              <div className="flex justify-center px-3 py-3">
                <button
                  type="button"
                  onClick={onLoadMore}
                  disabled={loadingMore}
                  className="h-8 rounded-lg px-3 text-xs font-medium text-muted-foreground hover:bg-secondary hover:text-foreground disabled:opacity-60"
                >
                  {loadingMore ? "Loading older chats…" : "Load older chats"}
                </button>
              </div>
            ) : null}
          </>
        )}
      </div>
    </section>
  );
});
