import { Archive, Bell, BriefcaseBusiness, CheckCircle2, Clock3, Inbox, MessageSquareText, Search, Settings, Tag } from "lucide-react";
import type { InboxFilter } from "./types";
import { cn } from "./utils";

interface InboxSidebarProps {
  activeFilter: InboxFilter;
  search: string;
  unreadCount: number;
  onFilterChange: (filter: InboxFilter) => void;
  onSearchChange: (search: string) => void;
}

const filters: Array<{ id: InboxFilter; label: string; icon: typeof Inbox }> = [
  { id: "all", label: "Inbox", icon: Inbox },
  { id: "unread", label: "Unread", icon: Bell },
  { id: "assigned", label: "Mine", icon: BriefcaseBusiness },
  { id: "open", label: "Open", icon: Inbox },
  { id: "waiting", label: "Waiting", icon: Clock3 },
  { id: "resolved", label: "Resolved", icon: CheckCircle2 },
  { id: "archived", label: "Archived", icon: Archive },
  { id: "labels", label: "Labels", icon: Tag },
];

export function InboxSidebar({ activeFilter, search, unreadCount, onFilterChange, onSearchChange }: InboxSidebarProps) {
  return (
    <aside className="hidden w-[76px] shrink-0 flex-col border-r border-border/80 bg-sidebar/95 text-muted-foreground shadow-[1px_0_0_rgba(255,255,255,0.03)_inset] lg:flex">
      <div className="flex h-[76px] items-center justify-center border-b border-border/80">
        <div className="relative flex h-11 w-11 items-center justify-center rounded-xl bg-primary text-sm font-semibold text-primary-foreground shadow-[0_16px_38px_rgba(37,211,102,0.16)]">
          WA
          <span className="absolute -right-0.5 -top-0.5 h-3 w-3 rounded-full border-2 border-sidebar bg-primary" />
        </div>
      </div>

      <div className="space-y-1 p-2">
        {filters.map((item) => {
          const Icon = item.icon;
          return (
            <button
              key={item.id}
              title={item.label}
              className={cn(
                "relative flex h-11 w-full items-center justify-center rounded-lg transition-all duration-200 hover:bg-sidebar-accent hover:text-foreground",
                activeFilter === item.id && "bg-primary/12 text-primary shadow-[0_0_0_1px_rgba(37,211,102,0.22)_inset]"
              )}
              onClick={() => onFilterChange(item.id)}
            >
              <Icon size={19} />
              {item.id === "unread" && unreadCount > 0 ? (
                <span className="absolute right-1 top-1 min-w-4 rounded-full bg-primary px-1 text-[10px] font-bold leading-4 text-primary-foreground">
                  {unreadCount}
                </span>
              ) : null}
            </button>
          );
        })}
      </div>

      <div className="mt-auto space-y-1 p-2">
        <button title="Search" className="flex h-11 w-full items-center justify-center rounded-lg text-muted-foreground hover:bg-sidebar-accent hover:text-foreground">
          <Search size={19} />
        </button>
        <button title="Settings" className="flex h-11 w-full items-center justify-center rounded-lg text-muted-foreground hover:bg-sidebar-accent hover:text-foreground">
          <Settings size={19} />
        </button>
      </div>

      <label className="sr-only" htmlFor="whatsapp-sidebar-search">
        Search conversations
      </label>
      <input id="whatsapp-sidebar-search" className="sr-only" value={search} onChange={(event) => onSearchChange(event.target.value)} />
      <MessageSquareText className="sr-only" />
    </aside>
  );
}
