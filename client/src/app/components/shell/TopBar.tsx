import { Keyboard, LogOut, Moon, Search, Settings, Sun } from "lucide-react";
import { NotificationsBell } from "../NotificationsBell";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "../ui/dropdown-menu";
import { BrandMark } from "./BrandMark";
import { VIEW_META, type ViewId } from "./nav";

interface TopBarProps {
  activeView: ViewId;
  userName: string;
  userEmail?: string;
  roleLabel: string;
  theme: "light" | "dark";
  canOpenSettings: boolean;
  onToggleTheme: () => void;
  onOpenSearch: () => void;
  onShowShortcuts: () => void;
  onOpenSettings: () => void;
  onLogout: () => void;
}

/** Page title on the left; notifications and the account menu on the right. */
export function TopBar({ activeView, userName, userEmail, roleLabel, theme, canOpenSettings, onToggleTheme, onOpenSearch, onShowShortcuts, onOpenSettings, onLogout }: TopBarProps) {
  const meta = VIEW_META[activeView];
  const initials = (userName || userEmail || "U")
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((p) => p.charAt(0).toUpperCase())
    .join("");

  return (
    <header className="flex h-14 shrink-0 items-center gap-2 border-b border-border bg-background/80 px-3 backdrop-blur-xl sm:px-5">
      <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-card text-primary shadow-card md:hidden">
        <BrandMark className="size-5" />
      </span>
      <div className="min-w-0 flex-1">
        <h1 className="truncate text-[15px] font-semibold leading-tight tracking-[-0.015em] text-foreground">{meta.label}</h1>
        <p className="hidden truncate text-xs text-muted-foreground sm:block">{meta.hint}</p>
      </div>

      <button
        type="button"
        onClick={onOpenSearch}
        aria-label="Search or jump to"
        className="flex size-9 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-foreground/[0.06] hover:text-foreground md:hidden"
      >
        <Search size={17} />
      </button>

      <NotificationsBell />

      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            aria-label="Account menu"
            className="flex items-center gap-2 rounded-lg py-1 pl-1 pr-1 transition-colors hover:bg-foreground/[0.06] sm:pr-2.5"
          >
            <span className="flex size-8 items-center justify-center rounded-full bg-primary text-[11px] font-semibold text-primary-foreground">{initials}</span>
            <span className="hidden min-w-0 text-left leading-tight sm:block">
              <span className="block max-w-[10rem] truncate text-[12.5px] font-medium text-foreground">{userName}</span>
              <span className="block max-w-[10rem] truncate text-[11px] text-muted-foreground">{roleLabel}</span>
            </span>
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-60">
          <DropdownMenuLabel className="font-normal">
            <div className="truncate text-sm font-medium">{userName}</div>
            {userEmail && <div className="truncate text-xs text-muted-foreground">{userEmail}</div>}
          </DropdownMenuLabel>
          <DropdownMenuSeparator />
          <DropdownMenuItem onSelect={onToggleTheme}>
            {theme === "dark" ? <Sun /> : <Moon />}
            {theme === "dark" ? "Light mode" : "Night mode"}
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={onShowShortcuts}>
            <Keyboard />
            Keyboard shortcuts
            <span className="ml-auto text-xs text-muted-foreground">?</span>
          </DropdownMenuItem>
          {canOpenSettings && (
            <DropdownMenuItem onSelect={onOpenSettings}>
              <Settings />
              Settings
            </DropdownMenuItem>
          )}
          <DropdownMenuSeparator />
          <DropdownMenuItem onSelect={onLogout} variant="destructive">
            <LogOut />
            Sign out
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </header>
  );
}
