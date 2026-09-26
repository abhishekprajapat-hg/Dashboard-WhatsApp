import { Fragment } from "react";
import { ChevronsLeft, ChevronsRight, Search } from "lucide-react";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "../ui/tooltip";
import { cn } from "../ui/utils";
import { BrandMark } from "./BrandMark";
import { NAV_GROUPS, SETTINGS_ITEM, type NavItem, type ViewId } from "./nav";

interface SidebarProps {
  activeView: ViewId;
  onViewChange: (view: ViewId) => void;
  visibleViews: ViewId[];
  unreadCount: number;
  workspaceName: string;
  collapsed: boolean;
  onToggleCollapsed: () => void;
  onOpenSearch: () => void;
}

/**
 * Desktop navigation: labelled groups instead of the old 17 unlabelled icons. Collapses to an icon
 * rail (remembered per browser) for people who prefer the compact feel. Only screens the person's
 * role allows are shown - the same permission check as before.
 */
export function Sidebar({ activeView, onViewChange, visibleViews, unreadCount, workspaceName, collapsed, onToggleCollapsed, onOpenSearch }: SidebarProps) {
  const allowed = new Set(visibleViews);
  const groups = NAV_GROUPS.map((g) => ({ ...g, items: g.items.filter((i) => allowed.has(i.id)) })).filter((g) => g.items.length);
  const unreadLabel = unreadCount > 99 ? "99+" : String(unreadCount);

  function renderItem(item: NavItem) {
    const active = activeView === item.id;
    const Icon = item.icon;
    const badge = item.id === "inbox" && unreadCount > 0 ? unreadLabel : null;
    const button = (
      <button
        type="button"
        aria-current={active ? "page" : undefined}
        aria-label={collapsed ? item.label : undefined}
        onClick={() => onViewChange(item.id)}
        className={cn(
          "group relative flex w-full items-center gap-2.5 rounded-lg text-[13px] font-medium outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring/40",
          collapsed ? "h-9 justify-center" : "h-8 px-2.5",
          active
            ? "bg-sidebar-accent text-foreground shadow-card"
            : "text-sidebar-foreground/75 hover:bg-foreground/[0.05] hover:text-foreground",
        )}
      >
        <Icon size={16} strokeWidth={active ? 2.2 : 1.9} className={cn("shrink-0", active ? "text-primary" : "text-muted-foreground group-hover:text-foreground")} />
        {!collapsed && <span className="truncate">{item.label}</span>}
        {badge && (
          <span
            className={cn(
              "rounded-full bg-primary px-1.5 text-[10px] font-semibold leading-4 text-primary-foreground tabular-nums",
              collapsed ? "absolute -right-0.5 -top-0.5" : "ml-auto",
            )}
          >
            {badge}
          </span>
        )}
      </button>
    );
    if (!collapsed) return button;
    return (
      <Tooltip>
        <TooltipTrigger asChild>{button}</TooltipTrigger>
        <TooltipContent side="right">{item.label}</TooltipContent>
      </Tooltip>
    );
  }

  return (
    <TooltipProvider delayDuration={200}>
      <aside
        className={cn(
          "relative z-30 hidden h-dvh shrink-0 flex-col border-r border-sidebar-border bg-sidebar text-sidebar-foreground transition-[width] duration-200 md:flex",
          collapsed ? "w-[64px] px-2" : "w-[236px] px-3",
        )}
        aria-label="Main navigation"
      >
        <div className={cn("flex h-14 shrink-0 items-center gap-2.5", collapsed ? "justify-center" : "px-1")}>
          <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-card text-primary shadow-card">
            <BrandMark className="size-5" />
          </span>
          {!collapsed && (
            <div className="min-w-0 leading-tight">
              <div className="truncate text-[13.5px] font-semibold tracking-[-0.01em] text-foreground">Nemnidhi</div>
              <div className="truncate text-[11.5px] text-muted-foreground">{workspaceName}</div>
            </div>
          )}
        </div>

        <button
          type="button"
          onClick={onOpenSearch}
          aria-label="Search or jump to"
          className={cn(
            "mb-3 flex shrink-0 items-center gap-2 rounded-lg border border-border bg-card text-[12.5px] text-muted-foreground shadow-[0_1px_2px_rgba(16,18,22,0.04)] transition-colors hover:border-foreground/20 hover:text-foreground",
            collapsed ? "h-9 justify-center" : "h-8 px-2.5",
          )}
        >
          <Search size={14} className="shrink-0" />
          {!collapsed && (
            <>
              <span className="truncate">Search or jump to…</span>
              <kbd className="ml-auto rounded border border-border bg-secondary px-1.5 font-sans text-[10px] font-medium text-muted-foreground">Ctrl K</kbd>
            </>
          )}
        </button>

        <nav className="no-scrollbar -mx-1 flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto px-1 pb-3">
          {groups.map((group) => (
            <div key={group.label} className="flex flex-col gap-0.5">
              {!collapsed ? (
                <div className="px-2.5 pb-1 text-[10.5px] font-semibold uppercase tracking-[0.12em] text-muted-foreground/80">{group.label}</div>
              ) : (
                <div className="mx-auto mb-1 h-px w-6 bg-sidebar-border" />
              )}
              {group.items.map((item) => (
                <Fragment key={item.id}>{renderItem(item)}</Fragment>
              ))}
            </div>
          ))}
        </nav>

        <div className="flex shrink-0 flex-col gap-0.5 border-t border-sidebar-border py-3">
          {allowed.has("settings") && renderItem(SETTINGS_ITEM)}
          <button
            type="button"
            onClick={onToggleCollapsed}
            aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
            className={cn(
              "flex items-center gap-2.5 rounded-lg text-[12.5px] text-muted-foreground transition-colors hover:bg-foreground/[0.05] hover:text-foreground",
              collapsed ? "h-9 justify-center" : "h-8 px-2.5",
            )}
          >
            {collapsed ? <ChevronsRight size={16} /> : <ChevronsLeft size={16} />}
            {!collapsed && <span>Collapse</span>}
          </button>
        </div>
      </aside>
    </TooltipProvider>
  );
}
