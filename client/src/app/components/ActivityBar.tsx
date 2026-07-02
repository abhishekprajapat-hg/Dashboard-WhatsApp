import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "./ui/tooltip";
import {
  LayoutDashboard,
  MessageCircle,
  Users,
  Zap,
  Megaphone,
  BarChart3,
  Users2,
  ShieldCheck,
  Bot,
  Settings,
  LogOut,
  Bell,
} from "lucide-react";

export type ViewId =
  | "dashboard"
  | "inbox"
  | "contacts"
  | "automation"
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
}

const NAV_ITEMS: { id: ViewId; icon: React.ReactNode; label: string }[] = [
  { id: "dashboard", icon: <LayoutDashboard size={18} />, label: "Dashboard" },
  { id: "inbox", icon: <MessageCircle size={18} />, label: "Inbox" },
  { id: "contacts", icon: <Users size={18} />, label: "CRM" },
  { id: "automation", icon: <Zap size={18} />, label: "Automation" },
  { id: "campaigns", icon: <Megaphone size={18} />, label: "Campaigns" },
  { id: "analytics", icon: <BarChart3 size={18} />, label: "Analytics" },
  { id: "team", icon: <Users2 size={18} />, label: "Team" },
  { id: "assistant", icon: <Bot size={18} />, label: "AI Assistant" },
  { id: "admin", icon: <ShieldCheck size={18} />, label: "Admin" },
];

export function ActivityBar({ activeView, onViewChange, onLogout, unreadCount = 0 }: ActivityBarProps) {
  const unreadLabel = unreadCount > 99 ? "99+" : String(unreadCount);

  return (
    <TooltipProvider delayDuration={300}>
      <aside className="fixed inset-x-0 bottom-0 z-40 order-2 flex h-14 items-center gap-1 border-t border-sidebar-border bg-sidebar px-2 md:relative md:inset-auto md:order-none md:h-auto md:w-12 md:flex-col md:border-r md:border-t-0 md:py-3">
        {/* Logo */}
        <div className="hidden w-8 h-8 rounded-md bg-primary md:flex items-center justify-center mb-3 shrink-0">
          <MessageCircle size={14} className="text-primary-foreground" />
        </div>

        {/* Nav */}
        <nav className="flex min-w-0 flex-1 items-center justify-around gap-0.5 md:flex-col md:justify-start">
          {NAV_ITEMS.map((item) => {
            const isActive = activeView === item.id;
            return (
              <Tooltip key={item.id}>
                <TooltipTrigger asChild>
                  <button
                    onClick={() => onViewChange(item.id)}
                    className={`relative h-10 min-w-10 flex-1 rounded-md flex items-center justify-center transition-colors md:h-9 md:w-9 md:min-w-0 md:flex-none ${
                      isActive
                        ? "bg-sidebar-accent text-primary"
                        : "text-muted-foreground hover:text-foreground hover:bg-sidebar-accent"
                    }`}
                  >
                    {item.icon}
                    {item.id === "inbox" && unreadCount > 0 && (
                      <span className="absolute -top-0.5 -right-0.5 min-w-4 h-4 px-1 rounded-full bg-primary text-primary-foreground text-[9px] leading-4 font-semibold">
                        {unreadLabel}
                      </span>
                    )}
                    {isActive && (
                      <span className="absolute bottom-0 left-1/2 h-0.5 w-5 -translate-x-1/2 rounded-t-full bg-primary md:left-0 md:top-1/2 md:h-5 md:w-0.5 md:-translate-x-0 md:-translate-y-1/2 md:rounded-r-full md:-ml-px" />
                    )}
                  </button>
                </TooltipTrigger>
                <TooltipContent side="right" className="bg-popover text-popover-foreground border-border">
                  {item.label}
                </TooltipContent>
              </Tooltip>
            );
          })}
        </nav>

        {/* Bottom items */}
        <div className="flex items-center gap-0.5 md:mt-auto md:flex-col">
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                onClick={() => onViewChange("settings")}
                className={`h-10 w-10 rounded-md flex items-center justify-center transition-colors md:h-9 md:w-9 ${
                  activeView === "settings"
                    ? "bg-sidebar-accent text-primary"
                    : "text-muted-foreground hover:text-foreground hover:bg-sidebar-accent"
                }`}
              >
                <Settings size={18} />
              </button>
            </TooltipTrigger>
            <TooltipContent side="right" className="bg-popover text-popover-foreground border-border">
              Settings
            </TooltipContent>
          </Tooltip>

          <Tooltip>
            <TooltipTrigger asChild>
              <button
                className="relative hidden w-9 h-9 rounded-md md:flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-sidebar-accent transition-colors"
              >
                <Bell size={18} />
                {unreadCount > 0 && (
                  <span className="absolute -top-0.5 -right-0.5 min-w-4 h-4 px-1 rounded-full bg-destructive text-white text-[9px] leading-4 font-semibold">
                    {unreadLabel}
                  </span>
                )}
              </button>
            </TooltipTrigger>
            <TooltipContent side="right" className="bg-popover text-popover-foreground border-border">
              Notifications
            </TooltipContent>
          </Tooltip>

          <Tooltip>
            <TooltipTrigger asChild>
              <button
                onClick={onLogout}
                className="hidden w-9 h-9 rounded-md md:flex items-center justify-center text-muted-foreground hover:text-destructive hover:bg-sidebar-accent transition-colors"
              >
                <LogOut size={18} />
              </button>
            </TooltipTrigger>
            <TooltipContent side="right" className="bg-popover text-popover-foreground border-border">
              Sign out
            </TooltipContent>
          </Tooltip>

          {/* Avatar */}
          <div className="hidden w-7 h-7 rounded-full bg-primary md:flex items-center justify-center mt-2 shrink-0">
            <span className="text-primary-foreground text-xs font-semibold">O</span>
          </div>
        </div>
      </aside>
    </TooltipProvider>
  );
}

