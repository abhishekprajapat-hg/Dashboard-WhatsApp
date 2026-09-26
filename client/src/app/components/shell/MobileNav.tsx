import { useState } from "react";
import { LogOut, Menu } from "lucide-react";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "../ui/sheet";
import { cn } from "../ui/utils";
import { ALL_NAV_ITEMS, MOBILE_TABS, NAV_GROUPS, SETTINGS_ITEM, type ViewId } from "./nav";

interface MobileNavProps {
  activeView: ViewId;
  onViewChange: (view: ViewId) => void;
  visibleViews: ViewId[];
  unreadCount: number;
  onLogout: () => void;
}

/**
 * Phone navigation: a bottom tab bar with the four screens field staff use most (only those the
 * person can see) plus "More", which opens every other screen, grouped like the desktop sidebar.
 */
export function MobileNav({ activeView, onViewChange, visibleViews, unreadCount, onLogout }: MobileNavProps) {
  const [moreOpen, setMoreOpen] = useState(false);
  const allowed = new Set(visibleViews);
  const tabs = MOBILE_TABS.filter((id) => allowed.has(id)).map((id) => ALL_NAV_ITEMS.find((i) => i.id === id)!);
  const moreActive = !tabs.some((t) => t.id === activeView);

  function go(view: ViewId) {
    setMoreOpen(false);
    onViewChange(view);
  }

  return (
    <>
      <nav
        aria-label="Main navigation"
        className="fixed inset-x-0 bottom-0 z-40 flex border-t border-border bg-card/95 px-1 pb-[env(safe-area-inset-bottom)] shadow-[0_-12px_32px_-20px_rgba(16,18,22,0.35)] backdrop-blur-xl md:hidden"
      >
        {tabs.map((tab) => {
          const Icon = tab.icon;
          const active = activeView === tab.id;
          return (
            <button
              key={tab.id}
              type="button"
              onClick={() => go(tab.id)}
              aria-current={active ? "page" : undefined}
              className={cn("relative flex h-16 flex-1 flex-col items-center justify-center gap-1 text-[11px] font-medium", active ? "text-primary" : "text-muted-foreground")}
            >
              <Icon size={20} strokeWidth={active ? 2.2 : 1.9} />
              {tab.label}
              {tab.id === "inbox" && unreadCount > 0 && (
                <span className="absolute left-1/2 top-2 ml-2 rounded-full bg-primary px-1.5 text-[10px] font-semibold leading-4 text-primary-foreground tabular-nums">
                  {unreadCount > 99 ? "99+" : unreadCount}
                </span>
              )}
            </button>
          );
        })}
        <button
          type="button"
          onClick={() => setMoreOpen(true)}
          aria-current={moreActive ? "page" : undefined}
          className={cn("flex h-16 flex-1 flex-col items-center justify-center gap-1 text-[11px] font-medium", moreActive ? "text-primary" : "text-muted-foreground")}
        >
          <Menu size={20} />
          More
        </button>
      </nav>

      <Sheet open={moreOpen} onOpenChange={setMoreOpen}>
        <SheetContent side="bottom" className="max-h-[85dvh] overflow-y-auto rounded-t-2xl pb-[calc(1rem+env(safe-area-inset-bottom))]">
          <SheetHeader>
            <SheetTitle>All screens</SheetTitle>
            <SheetDescription className="sr-only">Every part of the Dashboard you can open</SheetDescription>
          </SheetHeader>
          <div className="grid gap-4 px-4">
            {[...NAV_GROUPS, { label: "Workspace", items: [SETTINGS_ITEM] }].map((group) => {
              const items = group.items.filter((i) => allowed.has(i.id));
              if (!items.length) return null;
              return (
                <div key={group.label} className="grid gap-1">
                  <div className="text-[10.5px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">{group.label}</div>
                  <div className="grid grid-cols-2 gap-1.5">
                    {items.map((item) => {
                      const Icon = item.icon;
                      const active = activeView === item.id;
                      return (
                        <button
                          key={item.id}
                          type="button"
                          onClick={() => go(item.id)}
                          className={cn(
                            "flex h-11 items-center gap-2.5 rounded-xl border px-3 text-sm font-medium",
                            active ? "border-primary/30 bg-accent text-accent-foreground" : "border-border bg-card text-foreground",
                          )}
                        >
                          <Icon size={17} className={active ? "text-primary" : "text-muted-foreground"} />
                          <span className="truncate">{item.label}</span>
                        </button>
                      );
                    })}
                  </div>
                </div>
              );
            })}
            <button type="button" onClick={onLogout} className="mt-1 flex h-11 items-center justify-center gap-2 rounded-xl border border-border text-sm font-medium text-destructive">
              <LogOut size={16} />
              Sign out
            </button>
          </div>
        </SheetContent>
      </Sheet>
    </>
  );
}
