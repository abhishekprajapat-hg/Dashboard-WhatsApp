import { useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { BellOff, CheckCheck, ChevronDown, Facebook, Instagram, MessageSquareText, Phone, Pin, Search } from "lucide-react";
import type { Conversation, InboxFilter } from "./types";
import { cn, initials } from "./utils";

interface ConversationListProps {
  conversations: Conversation[];
  selectedId: string;
  filter: InboxFilter;
  search: string;
  currentUserId?: string;
  typingIds: string[];
  loading: boolean;
  error: string;
  onSearchChange: (search: string) => void;
  onSelect: (id: string) => void;
  onRetry: () => void;
}

function matchesFilter(conversation: Conversation, filter: InboxFilter, currentUserId?: string) {
  if (filter === "unread") return conversation.unread > 0;
  if (filter === "assigned") return Boolean(conversation.agentId) && (!currentUserId || conversation.agentId === currentUserId);
  if (filter === "open") return conversation.status === "open";
  if (filter === "waiting") return conversation.status === "waiting";
  if (filter === "resolved") return conversation.status === "resolved";
  if (filter === "archived") return conversation.status === "archived";
  if (filter === "labels") return conversation.tags.length > 0;
  return conversation.status !== "archived";
}

const statusLabel = {
  open: "Open",
  waiting: "Waiting",
  resolved: "Resolved",
  bot: "Bot",
  archived: "Archived",
} as const;

const statusClass = {
  open: "border-primary/25 bg-primary/10 text-primary",
  waiting: "border-warning/25 bg-warning/10 text-warning",
  resolved: "border-border bg-secondary/70 text-muted-foreground",
  bot: "border-info/25 bg-info/10 text-info",
  archived: "border-border bg-secondary/40 text-muted-foreground",
} as const;

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
  const pinned = Boolean(conversation.pinned);
  const muted = Boolean(conversation.muted);
  return (
    <motion.button
      layout
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -8 }}
      transition={{ duration: 0.16 }}
      className={cn(
        "group flex w-full gap-3 border-b border-border/55 px-4 py-3.5 text-left transition-all duration-200",
        isSelected ? "bg-primary/10 shadow-[inset_3px_0_0_hsl(var(--primary))]" : "hover:bg-secondary/45"
      )}
      onClick={() => onSelect(conversation.id)}
    >
      <div className="relative h-12 w-12 shrink-0 overflow-hidden rounded-xl bg-gradient-to-br from-primary to-teal-700 text-primary-foreground shadow-[0_10px_24px_rgba(37,211,102,0.14)]">
        <div className="flex h-full w-full items-center justify-center text-sm font-semibold">{initials(conversation.name)}</div>
        {conversation.channel === "instagram" ? (
          <span className="absolute bottom-0 right-0 flex h-4 w-4 items-center justify-center rounded-full border-2 border-card bg-gradient-to-br from-fuchsia-500 to-amber-400 text-white">
            <Instagram size={9} />
          </span>
        ) : conversation.channel === "facebook" ? (
          <span className="absolute bottom-0 right-0 flex h-4 w-4 items-center justify-center rounded-full border-2 border-card bg-blue-500 text-white">
            <Facebook size={9} />
          </span>
        ) : (
          <span className="absolute bottom-0 right-0 h-3.5 w-3.5 rounded-full border-2 border-card bg-primary" />
        )}
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <div className="min-w-0 flex-1 truncate text-sm font-semibold text-foreground">
            {conversation.name}
          </div>
          <div className="shrink-0 text-[11px] text-muted-foreground">{conversation.time}</div>
        </div>
        <div className="mt-0.5 flex items-center gap-1 text-[11px] text-muted-foreground">
          {conversation.channel === "instagram" ? (
            <>
              <Instagram size={11} />
              <span className="truncate">Instagram DM</span>
            </>
          ) : conversation.channel === "facebook" ? (
            <>
              <Facebook size={11} />
              <span className="truncate">Facebook DM</span>
            </>
          ) : (
            <>
              <Phone size={11} />
              <span className="truncate">{conversation.phone || "No phone"}</span>
            </>
          )}
        </div>
        <div className="mt-1 flex items-center gap-1.5">
          {conversation.preview && conversation.preview !== "No messages yet" ? (
            <CheckCheck size={14} className="shrink-0 text-primary" />
          ) : null}
          <div className={cn("min-w-0 flex-1 truncate text-xs", isTyping ? "font-medium text-primary" : "text-muted-foreground")}>
            {isTyping ? "typing..." : conversation.preview || "No messages yet"}
          </div>
          {pinned ? <Pin size={13} className="shrink-0 text-muted-foreground" /> : null}
          {muted ? <BellOff size={13} className="shrink-0 text-muted-foreground" /> : null}
          {conversation.unread > 0 ? (
            <span className="min-w-5 rounded-full bg-primary px-1.5 text-center text-[11px] font-bold leading-5 text-primary-foreground shadow-[0_0_18px_rgba(37,211,102,0.35)]">
              {conversation.unread}
            </span>
          ) : null}
        </div>
        <div className="mt-2 flex items-center gap-1 overflow-hidden">
          <span className={cn("shrink-0 rounded-full border px-1.5 py-0.5 text-[10px] font-medium", statusClass[conversation.status])}>
            {statusLabel[conversation.status]}
          </span>
          {(conversation.crmStage || conversation.lifecycleStatus) ? (
            <span className="max-w-[92px] truncate rounded-full border border-info/20 bg-info/10 px-1.5 py-0.5 text-[10px] font-medium text-info">
              {conversation.crmStage || conversation.lifecycleStatus}
            </span>
          ) : null}
          {conversation.tags.slice(0, 2).map((tag) => (
            <span key={tag} className="max-w-[88px] truncate rounded-full border border-border bg-secondary/70 px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground">
              {tag}
            </span>
          ))}
          <span className="ml-auto max-w-[104px] truncate text-[10px] text-muted-foreground">{conversation.agent || "Unassigned"}</span>
        </div>
      </div>
    </motion.button>
  );
}

function ChannelSection({
  label,
  icon,
  accentClass,
  conversations,
  selectedId,
  typingIds,
  open,
  onToggle,
  onSelect,
  emptyLabel,
  disabled,
}: {
  label: string;
  icon: React.ReactNode;
  accentClass: string;
  conversations: Conversation[];
  selectedId: string;
  typingIds: string[];
  open: boolean;
  onToggle: () => void;
  onSelect: (id: string) => void;
  emptyLabel: string;
  disabled?: boolean;
}) {
  return (
    <div className="border-b border-border/60">
      <button
        type="button"
        onClick={onToggle}
        className="flex w-full items-center gap-2 px-4 py-2.5 text-left transition-colors hover:bg-secondary/35"
      >
        <span className={cn("flex h-6 w-6 shrink-0 items-center justify-center rounded-md", accentClass)}>{icon}</span>
        <span className="flex-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">{label}</span>
        <span className="rounded-full border border-border bg-secondary/60 px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground">
          {conversations.length}
        </span>
        <ChevronDown size={14} className={cn("shrink-0 text-muted-foreground transition-transform", open ? "rotate-180" : "")} />
      </button>
      {open ? (
        disabled ? (
          <div className="px-4 pb-4 pt-1 text-xs text-muted-foreground">{emptyLabel}</div>
        ) : conversations.length === 0 ? (
          <div className="px-4 pb-4 pt-1 text-xs text-muted-foreground">{emptyLabel}</div>
        ) : (
          <AnimatePresence initial={false}>
            {conversations.map((conversation) => (
              <ConversationRow
                key={conversation.id}
                conversation={conversation}
                isSelected={conversation.id === selectedId}
                isTyping={typingIds.includes(conversation.id)}
                onSelect={onSelect}
              />
            ))}
          </AnimatePresence>
        )
      ) : null}
    </div>
  );
}

export function ConversationList({
  conversations,
  selectedId,
  filter,
  search,
  currentUserId,
  typingIds,
  loading,
  error,
  onSearchChange,
  onSelect,
  onRetry,
}: ConversationListProps) {
  const [openSections, setOpenSections] = useState({ whatsapp: true, instagram: true, facebook: false });

  const filtered = conversations.filter((conversation) => {
    const text = `${conversation.name} ${conversation.phone} ${conversation.preview} ${conversation.tags.join(" ")}`.toLowerCase();
    return matchesFilter(conversation, filter, currentUserId) && (!search || text.includes(search.toLowerCase()));
  });

  const whatsappConversations = filtered.filter((conversation) => conversation.channel !== "instagram" && conversation.channel !== "facebook");
  const instagramConversations = filtered.filter((conversation) => conversation.channel === "instagram");
  const facebookConversations = filtered.filter((conversation) => conversation.channel === "facebook");

  function toggleSection(key: keyof typeof openSections) {
    setOpenSections((current) => ({ ...current, [key]: !current[key] }));
  }

  return (
    <section className="flex h-full w-full min-w-0 shrink-0 flex-col border-r border-border/80 bg-card/75 shadow-[1px_0_0_rgba(255,255,255,0.03)_inset] backdrop-blur-xl">
      <div className="border-b border-border/80 px-4 py-4">
        <div className="mb-3 flex items-center justify-between gap-3">
          <div>
            <h1 className="text-lg font-semibold text-foreground">Inbox</h1>
            <p className="text-xs text-muted-foreground">{filtered.length} conversations</p>
          </div>
          <div className="rounded-full border border-primary/20 bg-primary/10 px-3 py-1 text-xs font-medium text-primary">
            Business
          </div>
        </div>
        <div className="flex h-10 items-center gap-2 rounded-lg border border-input/80 bg-input-background px-3 shadow-[0_1px_0_rgba(255,255,255,0.03)_inset]">
          <Search size={16} className="shrink-0 text-muted-foreground" />
          <input
            value={search}
            onChange={(event) => onSearchChange(event.target.value)}
            placeholder="Search contacts, phone, tags..."
            className="min-w-0 flex-1 bg-transparent text-sm text-foreground outline-none placeholder:text-muted-foreground/75"
          />
        </div>
      </div>

      <div className="no-scrollbar min-h-0 flex-1 overflow-y-auto">
        {loading ? (
          <div className="space-y-3 px-4 py-4">
            {[0, 1, 2, 3, 4].map((item) => (
              <div key={item} className="flex gap-3">
                <div className="h-12 w-12 shrink-0 rounded-xl bg-secondary/80" />
                <div className="min-w-0 flex-1 space-y-2 py-1">
                  <div className="h-3 w-2/3 rounded bg-secondary/80" />
                  <div className="h-3 w-full rounded bg-secondary/80" />
                </div>
              </div>
            ))}
          </div>
        ) : error ? (
          <div className="flex flex-col items-center justify-center gap-3 px-6 py-16 text-center text-muted-foreground">
            <MessageSquareText size={24} />
            <div>
              <div className="text-sm font-medium text-foreground">Inbox could not load</div>
              <p className="mt-1 text-xs">{error}</p>
            </div>
            <button className="h-8 rounded-md border border-border px-3 text-xs text-foreground hover:border-primary/40 hover:text-primary" onClick={onRetry}>
              Retry
            </button>
          </div>
        ) : (
          <>
            <ChannelSection
              label="WhatsApp"
              icon={<Phone size={13} className="text-primary" />}
              accentClass="bg-primary/10"
              conversations={whatsappConversations}
              selectedId={selectedId}
              typingIds={typingIds}
              open={openSections.whatsapp}
              onToggle={() => toggleSection("whatsapp")}
              onSelect={onSelect}
              emptyLabel="No WhatsApp conversations match this view."
            />
            <ChannelSection
              label="Instagram"
              icon={<Instagram size={13} className="text-fuchsia-400" />}
              accentClass="bg-fuchsia-500/10"
              conversations={instagramConversations}
              selectedId={selectedId}
              typingIds={typingIds}
              open={openSections.instagram}
              onToggle={() => toggleSection("instagram")}
              onSelect={onSelect}
              emptyLabel="No Instagram conversations match this view."
            />
            <ChannelSection
              label="Facebook"
              icon={<Facebook size={13} className="text-blue-400" />}
              accentClass="bg-blue-500/10"
              conversations={facebookConversations}
              selectedId={selectedId}
              typingIds={typingIds}
              open={openSections.facebook}
              onToggle={() => toggleSection("facebook")}
              onSelect={onSelect}
              emptyLabel="No Facebook conversations match this view."
            />
          </>
        )}
      </div>
    </section>
  );
}
