import type { LucideIcon } from "lucide-react";
import {
  BarChart3,
  Bell,
  Bot,
  ContactRound,
  FileText,
  Inbox,
  LayoutDashboard,
  LogOut,
  Megaphone,
  MessageCircle,
  Settings,
  ShieldCheck,
  Sparkles,
  Users2,
  Zap,
} from "lucide-react";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "./ui/tooltip";

export type ViewId =
  | "dashboard"
  | "inbox"
  | "contacts"
  | "automation"
  | "templates"
  | "campaigns"
  | "analytics"
  | "team"
  | "admin"
  | "assistant"
  | "settings";

interface ActivityBarProps {
  activeView: ViewId;
  onViewChange: (view: ViewId) => void;
  onLogout: () => void;
  unreadCount?: number;
  visibleViews?: ViewId[];
}

const NAV_ITEMS: { id: ViewId; icon: LucideIcon; label: string }[] = [
  { id: "dashboard", icon: LayoutDashboard, label: "Dashboard" },
  { id: "inbox", icon: Inbox, label: "Inbox" },
  { id: "contacts", icon: ContactRound, label: "CRM" },
  { id: "automation", icon: Zap, label: "Automation" },
  { id: "templates", icon: FileText, label: "Templates" },
  { id: "campaigns", icon: Megaphone, label: "Campaigns" },
  { id: "analytics", icon: BarChart3, label: "Analytics" },
  { id: "team", icon: Users2, label: "Team" },
  { id: "assistant", icon: Bot, label: "AI Assistant" },
  { id: "admin", icon: ShieldCheck, label: "Admin" },
];

const navButtonBase =
  "group relative flex h-11 w-11 min-w-[2.75rem] flex-none snap-center items-center justify-center rounded-lg outline-none transition-all duration-200 focus-visible:ring-2 focus-visible:ring-ring/45 md:h-10 md:w-10 md:min-w-[2.5rem]";

const navButtonState = {
  active: "bg-primary/12 text-primary shadow-[0_0_0_1px_rgba(37,211,102,0.24)_inset,0_12px_30px_rgba(37,211,102,0.08)]",
  idle: "text-muted-foreground hover:-translate-y-0.5 hover:bg-sidebar-accent hover:text-foreground md:hover:translate-x-0.5 md:hover:translate-y-0",
};

function NavIndicator() {
  return (
    <>
      <span className="absolute bottom-0 left-1/2 h-0.5 w-7 -translate-x-1/2 rounded-t-full bg-primary md:left-[-13px] md:top-1/2 md:h-7 md:w-0.5 md:-translate-y-1/2 md:translate-x-0 md:rounded-r-full" />
      <span className="absolute inset-0 rounded-lg bg-primary/5 opacity-0 transition-opacity group-hover:opacity-100" />
    </>
  );
}

export function ActivityBar({ activeView, onViewChange, onLogout, unreadCount = 0, visibleViews }: ActivityBarProps) {
  const unreadLabel = unreadCount > 99 ? "99+" : String(unreadCount);
  const allowed = new Set(visibleViews || NAV_ITEMS.map((item) => item.id));
  const navItems = NAV_ITEMS.filter((item) => allowed.has(item.id));
  const canOpenSettings = allowed.has("settings");
  const renderNavButton = (item: { id: ViewId; icon: LucideIcon; label: string }, tooltipSide: "right" | "top" = "right") => {
    const isActive = activeView === item.id;
    const Icon = item.icon;

    return (
      <Tooltip key={item.id}>
        <TooltipTrigger asChild>
          <button
            aria-current={isActive ? "page" : undefined}
            aria-label={item.label}
            className={`${navButtonBase} ${isActive ? navButtonState.active : navButtonState.idle}`}
            onClick={() => onViewChange(item.id)}
            type="button"
          >
            <Icon size={19} strokeWidth={isActive ? 2.4 : 2} className="transition-transform duration-200 group-hover:scale-105" />
            {item.id === "inbox" && unreadCount > 0 && (
              <span className="absolute -right-1 -top-1 flex h-4 min-w-4 items-center justify-center rounded-full border border-sidebar bg-primary px-1 text-[9px] font-bold leading-4 text-primary-foreground shadow-[0_0_18px_rgba(37,211,102,0.45)]">
                {unreadLabel}
              </span>
            )}
            {isActive && <NavIndicator />}
          </button>
        </TooltipTrigger>
        <TooltipContent side={tooltipSide} className="border-border bg-popover text-popover-foreground">
          {item.label}
        </TooltipContent>
      </Tooltip>
    );
  };

  return (
    <TooltipProvider delayDuration={250}>
      <aside className="relative z-40 hidden h-dvh w-[72px] shrink-0 flex-col border-r border-sidebar-border bg-sidebar/95 px-3 py-4 text-sidebar-foreground backdrop-blur-xl md:flex">
        <div className="hidden md:flex md:flex-col md:items-center md:gap-2">
          <div className="relative flex size-10 items-center justify-center rounded-xl border border-primary/25 bg-primary text-primary-foreground shadow-[0_16px_36px_rgba(37,211,102,0.18)]">
            <MessageCircle size={18} />
            <span className="absolute -right-0.5 -top-0.5 size-2.5 rounded-full border border-sidebar bg-primary" />
          </div>
          <div className="h-px w-8 bg-sidebar-border" />
        </div>

        <nav className="no-scrollbar mt-4 flex min-w-0 flex-1 flex-col items-center justify-start gap-1 overflow-visible px-0">
          {navItems.map((item) => renderNavButton(item))}
        </nav>

        <div className="mt-auto flex flex-col items-center gap-1 border-t border-sidebar-border pt-3">
          {canOpenSettings && (
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  aria-current={activeView === "settings" ? "page" : undefined}
                  aria-label="Settings"
                  className={`${navButtonBase} ${activeView === "settings" ? navButtonState.active : navButtonState.idle}`}
                  onClick={() => onViewChange("settings")}
                  type="button"
                >
                  <Settings size={18} />
                  {activeView === "settings" && <NavIndicator />}
                </button>
              </TooltipTrigger>
              <TooltipContent side="right" className="border-border bg-popover text-popover-foreground">
                Settings
              </TooltipContent>
            </Tooltip>
          )}

          <Tooltip>
            <TooltipTrigger asChild>
              <button aria-label="Notifications" className={`${navButtonBase} hidden md:flex ${navButtonState.idle}`} type="button">
                <Bell size={18} />
                {unreadCount > 0 && (
                  <span className="absolute -right-1 -top-1 flex h-4 min-w-4 items-center justify-center rounded-full border border-sidebar bg-destructive px-1 text-[9px] font-bold leading-4 text-white">
                    {unreadLabel}
                  </span>
                )}
              </button>
            </TooltipTrigger>
            <TooltipContent side="right" className="border-border bg-popover text-popover-foreground">
              Notifications
            </TooltipContent>
          </Tooltip>

          <Tooltip>
            <TooltipTrigger asChild>
              <button
                aria-label="Sign out"
                className={`${navButtonBase} hidden text-muted-foreground hover:bg-sidebar-accent hover:text-destructive md:flex`}
                onClick={onLogout}
                type="button"
              >
                <LogOut size={18} />
              </button>
            </TooltipTrigger>
            <TooltipContent side="right" className="border-border bg-popover text-popover-foreground">
              Sign out
            </TooltipContent>
          </Tooltip>

          <div className="hidden size-9 shrink-0 items-center justify-center rounded-xl border border-sidebar-border bg-sidebar-accent text-primary md:flex">
            <Sparkles size={15} />
          </div>
        </div>
      </aside>

      <nav className="fixed inset-x-0 bottom-0 z-40 flex h-[calc(4rem+env(safe-area-inset-bottom))] min-w-0 items-center border-t border-sidebar-border bg-sidebar/95 px-2 pb-[env(safe-area-inset-bottom)] shadow-[0_-18px_45px_rgba(0,0,0,0.35)] backdrop-blur-xl md:hidden">
        <div className="no-scrollbar flex min-w-0 flex-1 snap-x items-center gap-1 overflow-x-auto overscroll-x-contain px-1 pr-2">
          {navItems.map((item) => renderNavButton(item, "top"))}
        </div>
        {canOpenSettings && (
          <div className="ml-1 flex flex-none items-center gap-1 border-l border-sidebar-border pl-2">
            {renderNavButton({ id: "settings", icon: Settings, label: "Settings" }, "top")}
          </div>
        )}
      </nav>
    </TooltipProvider>
  );
}
