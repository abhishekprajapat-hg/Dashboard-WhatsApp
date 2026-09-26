import { useEffect, useState } from "react";
import { Bell, CheckCheck } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "./ui/popover";
import { getNotifications, markAllNotificationsRead, markNotificationRead } from "../lib/api";

interface NotificationItem {
  id: string;
  type: string;
  title: string;
  body: string;
  link: string | null;
  read: boolean;
  createdAt: string;
}

function timeAgo(iso: string) {
  const ms = Date.now() - new Date(iso).getTime();
  const minutes = Math.round(ms / 60000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.round(hours / 24)}d ago`;
}

export function NotificationsBell() {
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<NotificationItem[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [loading, setLoading] = useState(false);

  async function load() {
    setLoading(true);
    try {
      const response = await getNotifications<{ data: NotificationItem[]; unreadCount: number }>();
      setItems(response.data);
      setUnreadCount(response.unreadCount);
    } catch {
      // Best-effort - the bell degrading to "no badge" on a transient failure beats a nav-wide crash.
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, []);

  useEffect(() => {
    if (open) load();
  }, [open]);

  async function handleMarkRead(id: string) {
    setItems((current) => current.map((item) => (item.id === id ? { ...item, read: true } : item)));
    setUnreadCount((count) => Math.max(0, count - 1));
    try {
      await markNotificationRead(id);
    } catch {
      load();
    }
  }

  async function handleMarkAllRead() {
    setItems((current) => current.map((item) => ({ ...item, read: true })));
    setUnreadCount(0);
    try {
      await markAllNotificationsRead();
    } catch {
      load();
    }
  }

  const unreadLabel = unreadCount > 99 ? "99+" : String(unreadCount);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          aria-label="Notifications"
          title="Notifications"
          className="relative flex size-9 shrink-0 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-foreground/[0.06] hover:text-foreground"
          type="button"
        >
          <Bell size={18} />
          {unreadCount > 0 && (
            <span className="absolute right-0.5 top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full border-2 border-background bg-destructive px-1 text-[9px] font-bold leading-3 text-white tabular-nums">
              {unreadLabel}
            </span>
          )}
        </button>
      </PopoverTrigger>

      <PopoverContent side="bottom" align="end" className="w-[min(20rem,calc(100vw-1.5rem))] p-0">
        <div className="flex items-center justify-between border-b border-border px-3 py-2">
          <span className="text-sm font-semibold text-foreground">Notifications</span>
          {unreadCount > 0 && (
            <button
              type="button"
              onClick={handleMarkAllRead}
              className="flex items-center gap-1 text-xs text-muted-foreground transition hover:text-foreground"
            >
              <CheckCheck size={13} />
              Mark all read
            </button>
          )}
        </div>

        <div className="max-h-80 overflow-y-auto">
          {loading && items.length === 0 && <div className="px-3 py-6 text-center text-sm text-muted-foreground">Loading…</div>}
          {!loading && items.length === 0 && (
            <div className="px-3 py-6 text-center text-sm text-muted-foreground">No notifications yet.</div>
          )}
          {items.map((item) => (
            <button
              key={item.id}
              type="button"
              onClick={() => !item.read && handleMarkRead(item.id)}
              className={`flex w-full flex-col gap-0.5 border-b border-border/60 px-3 py-2.5 text-left last:border-b-0 hover:bg-sidebar-accent ${
                item.read ? "opacity-60" : ""
              }`}
            >
              <div className="flex items-center gap-2">
                {!item.read && <span className="size-1.5 shrink-0 rounded-full bg-primary" />}
                <span className="truncate text-sm font-medium text-foreground">{item.title}</span>
              </div>
              {item.body && <span className="text-xs text-muted-foreground">{item.body}</span>}
              <span className="text-[11px] text-muted-foreground/70">{timeAgo(item.createdAt)}</span>
            </button>
          ))}
        </div>
      </PopoverContent>
    </Popover>
  );
}
