import { useEffect, useState } from "react";
import { Keyboard, LogOut, MessageCircle, Moon, Sun } from "lucide-react";
import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
  CommandShortcut,
} from "../ui/command";
import { getContacts } from "../../lib/api";
import { NAV_GROUPS, SETTINGS_ITEM, type ViewId } from "./nav";

type ContactHit = { id: string; name: string; phone?: string; email?: string };

const CUSTOMER_PREFIX = "customer:";

// Customers are already matched by the server, so they always show and rank first. Screens and
// actions match when every typed word starts one of their words ("pip" finds Pipeline) - loose
// letter-by-letter fuzzy matching made "Rohan" pull up Shipping and Marketing.
function paletteFilter(value: string, search: string, keywords?: string[]) {
  if (value.startsWith(CUSTOMER_PREFIX)) return 1;
  const words = `${value} ${(keywords || []).join(" ")}`.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
  const terms = search.toLowerCase().split(/\s+/).filter(Boolean);
  return terms.every((t) => words.some((w) => w.startsWith(t))) ? 0.5 : 0;
}

interface CommandPaletteProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  visibleViews: ViewId[];
  onNavigate: (view: ViewId) => void;
  onOpenContact: (contactId: string) => void;
  theme: "light" | "dark";
  onToggleTheme: () => void;
  onShowShortcuts: () => void;
  onLogout: () => void;
}

/**
 * Ctrl K / Cmd K: jump to any screen, find a customer and open their chat, or run a common action.
 * Every entry reaches something that already exists - nothing here is a new feature. Customer
 * search uses the same contacts API the CRM screen uses, and only when the person can see the CRM.
 */
export function CommandPalette({ open, onOpenChange, visibleViews, onNavigate, onOpenContact, theme, onToggleTheme, onShowShortcuts, onLogout }: CommandPaletteProps) {
  const [query, setQuery] = useState("");
  const [contacts, setContacts] = useState<ContactHit[]>([]);
  const allowed = new Set(visibleViews);
  const canSearchContacts = allowed.has("contacts") || allowed.has("inbox");

  useEffect(() => {
    if (!open) {
      setQuery("");
      setContacts([]);
    }
  }, [open]);

  useEffect(() => {
    const q = query.trim();
    if (!open || !canSearchContacts || q.length < 2) {
      setContacts([]);
      return;
    }
    let cancelled = false;
    const timer = window.setTimeout(() => {
      getContacts<{ data: ContactHit[] }>({ search: q, limit: 6 })
        .then((res) => {
          if (!cancelled) setContacts(res.data || []);
        })
        .catch(() => {
          if (!cancelled) setContacts([]);
        });
    }, 220);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [query, open, canSearchContacts]);

  function run(action: () => void) {
    onOpenChange(false);
    action();
  }

  return (
    <CommandDialog open={open} onOpenChange={onOpenChange} title="Search or jump to" description="Find a screen, a customer or an action" filter={paletteFilter}>
      <CommandInput placeholder="Search screens, customers or actions…" value={query} onValueChange={setQuery} />
      <CommandList className="max-h-[min(420px,60vh)]">
        <CommandEmpty>No matches. Try a customer's name or phone number.</CommandEmpty>

        {contacts.length > 0 && (
          <CommandGroup heading="Customers">
            {contacts.map((c) => (
              <CommandItem key={c.id} value={`${CUSTOMER_PREFIX}${c.id}`} onSelect={() => run(() => onOpenContact(c.id))}>
                <MessageCircle />
                <span className="truncate">{c.name}</span>
                {c.phone && <span className="ml-1 truncate text-xs text-muted-foreground tabular-nums">{c.phone}</span>}
                <CommandShortcut>Open chat</CommandShortcut>
              </CommandItem>
            ))}
          </CommandGroup>
        )}

        {NAV_GROUPS.map((group) => {
          const items = group.items.filter((i) => allowed.has(i.id));
          if (!items.length) return null;
          return (
            <CommandGroup key={group.label} heading={group.label}>
              {items.map((item) => {
                const Icon = item.icon;
                return (
                  <CommandItem key={item.id} value={`${item.label} ${item.hint} ${group.label}`} onSelect={() => run(() => onNavigate(item.id))}>
                    <Icon />
                    <span>{item.label}</span>
                    <span className="ml-1 truncate text-xs text-muted-foreground">{item.hint}</span>
                    {item.key && <CommandShortcut>G {item.key.toUpperCase()}</CommandShortcut>}
                  </CommandItem>
                );
              })}
            </CommandGroup>
          );
        })}

        <CommandSeparator />
        <CommandGroup heading="Actions">
          {allowed.has("settings") && (
            <CommandItem value="settings workspace integrations" onSelect={() => run(() => onNavigate(SETTINGS_ITEM.id))}>
              <SETTINGS_ITEM.icon />
              <span>Open settings</span>
              <CommandShortcut>G ,</CommandShortcut>
            </CommandItem>
          )}
          <CommandItem value="theme night light dark mode appearance" onSelect={() => run(onToggleTheme)}>
            {theme === "dark" ? <Sun /> : <Moon />}
            <span>{theme === "dark" ? "Switch to light mode" : "Switch to night mode"}</span>
          </CommandItem>
          <CommandItem value="keyboard shortcuts help" onSelect={() => run(onShowShortcuts)}>
            <Keyboard />
            <span>Keyboard shortcuts</span>
            <CommandShortcut>?</CommandShortcut>
          </CommandItem>
          <CommandItem value="sign out log out logout" onSelect={() => run(onLogout)}>
            <LogOut />
            <span>Sign out</span>
          </CommandItem>
        </CommandGroup>
      </CommandList>
    </CommandDialog>
  );
}

