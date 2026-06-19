import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "./ui/tooltip";
import {
  LayoutDashboard,
  MessageCircle,
  Users,
  Zap,
  Megaphone,
  BarChart3,
  Users2,
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
];

export function ActivityBar({ activeView, onViewChange, onLogout, unreadCount = 0 }: ActivityBarProps) {
  const unreadLabel = unreadCount > 99 ? "99+" : String(unreadCount);

  return (
    <TooltipProvider delayDuration={300}>
      <aside className="w-12 flex flex-col items-center py-3 gap-1 bg-sidebar border-r border-sidebar-border shrink-0">
        {/* Logo */}
        <div className="w-8 h-8 rounded-md bg-primary flex items-center justify-center mb-3 shrink-0">
          <MessageCircle size={14} className="text-primary-foreground" />
        </div>

        {/* Nav */}
        <nav className="flex flex-col items-center gap-0.5 flex-1">
          {NAV_ITEMS.map((item) => {
            const isActive = activeView === item.id;
            return (
              <Tooltip key={item.id}>
                <TooltipTrigger asChild>
                  <button
                    onClick={() => onViewChange(item.id)}
                    className={`relative w-9 h-9 rounded-md flex items-center justify-center transition-colors ${
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
                      <span className="absolute left-0 top-1/2 -translate-y-1/2 w-0.5 h-5 bg-primary rounded-r-full -ml-px" />
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
        <div className="flex flex-col items-center gap-0.5 mt-auto">
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                onClick={() => onViewChange("settings")}
                className={`w-9 h-9 rounded-md flex items-center justify-center transition-colors ${
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
                className="relative w-9 h-9 rounded-md flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-sidebar-accent transition-colors"
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
                className="w-9 h-9 rounded-md flex items-center justify-center text-muted-foreground hover:text-destructive hover:bg-sidebar-accent transition-colors"
              >
                <LogOut size={18} />
              </button>
            </TooltipTrigger>
            <TooltipContent side="right" className="bg-popover text-popover-foreground border-border">
              Sign out
            </TooltipContent>
          </Tooltip>

          {/* Avatar */}
          <div className="w-7 h-7 rounded-full bg-primary flex items-center justify-center mt-2 shrink-0">
            <span className="text-primary-foreground text-xs font-semibold">O</span>
          </div>
        </div>
      </aside>
    </TooltipProvider>
  );
}

