import { Archive, Bell, BriefcaseBusiness, Inbox, MessageSquareText, Search, Settings, Tag, Users } from "lucide-react";
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
  { id: "assigned", label: "Assigned", icon: BriefcaseBusiness },
  { id: "teams", label: "Teams", icon: Users },
  { id: "archived", label: "Archived", icon: Archive },
  { id: "labels", label: "Labels", icon: Tag },
];

export function InboxSidebar({ activeFilter, search, unreadCount, onFilterChange, onSearchChange }: InboxSidebarProps) {
  return (
    <aside className="hidden w-[76px] shrink-0 flex-col border-r border-zinc-200 bg-zinc-50/95 text-zinc-700 dark:border-zinc-800 dark:bg-[#101a20] dark:text-zinc-300 lg:flex">
      <div className="flex h-[72px] items-center justify-center border-b border-zinc-200 dark:border-zinc-800">
        <div className="relative flex h-11 w-11 items-center justify-center rounded-full bg-emerald-600 text-sm font-semibold text-white shadow-sm">
          WA
          <span className="absolute bottom-0 right-0 h-3 w-3 rounded-full border-2 border-zinc-50 bg-emerald-400 dark:border-[#101a20]" />
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
                "relative flex h-11 w-full items-center justify-center rounded-md text-zinc-500 transition hover:bg-white hover:text-emerald-700 dark:text-zinc-400 dark:hover:bg-[#1d2a31] dark:hover:text-emerald-300",
                activeFilter === item.id && "bg-white text-emerald-700 shadow-sm dark:bg-[#223139] dark:text-emerald-300"
              )}
              onClick={() => onFilterChange(item.id)}
            >
              <Icon size={19} />
              {item.id === "unread" && unreadCount > 0 ? (
                <span className="absolute right-1.5 top-1.5 min-w-4 rounded-full bg-emerald-500 px-1 text-[10px] font-bold leading-4 text-white">
                  {unreadCount}
                </span>
              ) : null}
            </button>
          );
        })}
      </div>

      <div className="mt-auto space-y-1 p-2">
        <button title="Search" className="flex h-11 w-full items-center justify-center rounded-md text-zinc-500 hover:bg-white hover:text-emerald-700 dark:text-zinc-400 dark:hover:bg-[#1d2a31]">
          <Search size={19} />
        </button>
        <button title="Settings" className="flex h-11 w-full items-center justify-center rounded-md text-zinc-500 hover:bg-white hover:text-emerald-700 dark:text-zinc-400 dark:hover:bg-[#1d2a31]">
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
