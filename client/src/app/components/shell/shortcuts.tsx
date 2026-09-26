import { useEffect, useRef } from "react";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "../ui/dialog";
import { ALL_NAV_ITEMS, type ViewId } from "./nav";

function isTyping(target: EventTarget | null) {
  const el = target as HTMLElement | null;
  if (!el) return false;
  const tag = el.tagName;
  return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || el.isContentEditable;
}

/**
 * App-wide keyboard shortcuts: Ctrl/Cmd K opens search, "?" shows this list, and "g" followed by a
 * letter jumps to a screen (Linear-style). Ignored while typing in a field, so it never steals keys
 * from a message being written.
 */
export function useGlobalShortcuts({
  onOpenPalette,
  onShowShortcuts,
  onNavigate,
  visibleViews,
}: {
  onOpenPalette: () => void;
  onShowShortcuts: () => void;
  onNavigate: (view: ViewId) => void;
  visibleViews: ViewId[];
}) {
  const pendingG = useRef<number | null>(null);
  const latest = useRef({ onOpenPalette, onShowShortcuts, onNavigate, visibleViews });
  latest.current = { onOpenPalette, onShowShortcuts, onNavigate, visibleViews };

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const { onOpenPalette, onShowShortcuts, onNavigate, visibleViews } = latest.current;
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        onOpenPalette();
        return;
      }
      if (e.ctrlKey || e.metaKey || e.altKey || isTyping(e.target)) return;
      // Never jump screens from behind an open form or confirmation.
      if (document.querySelector('[role="dialog"][data-state="open"], [role="alertdialog"][data-state="open"]')) return;
      if (e.key === "?") {
        e.preventDefault();
        onShowShortcuts();
        return;
      }
      if (pendingG.current !== null) {
        window.clearTimeout(pendingG.current);
        pendingG.current = null;
        const item = ALL_NAV_ITEMS.find((i) => i.key === e.key.toLowerCase());
        if (item && visibleViews.includes(item.id)) {
          e.preventDefault();
          onNavigate(item.id);
        }
        return;
      }
      if (e.key === "g") {
        pendingG.current = window.setTimeout(() => {
          pendingG.current = null;
        }, 900);
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
}

function Keys({ keys }: { keys: string[] }) {
  return (
    <span className="flex items-center gap-1">
      {keys.map((k) => (
        <kbd key={k} className="min-w-6 rounded-md border border-border bg-secondary px-1.5 py-0.5 text-center font-sans text-[11px] font-medium text-foreground">
          {k}
        </kbd>
      ))}
    </span>
  );
}

export function ShortcutsDialog({ open, onOpenChange, visibleViews }: { open: boolean; onOpenChange: (open: boolean) => void; visibleViews: ViewId[] }) {
  const jumps = ALL_NAV_ITEMS.filter((i) => i.key && visibleViews.includes(i.id));
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Keyboard shortcuts</DialogTitle>
          <DialogDescription>They work anywhere except while you're typing in a field.</DialogDescription>
        </DialogHeader>
        <div className="grid gap-5 text-sm">
          <div className="grid gap-2">
            <div className="flex items-center justify-between"><span>Search or jump to anything</span><Keys keys={["Ctrl", "K"]} /></div>
            <div className="flex items-center justify-between"><span>Show this list</span><Keys keys={["?"]} /></div>
          </div>
          <div className="grid gap-2">
            <div className="text-[11px] font-semibold uppercase tracking-[0.1em] text-muted-foreground">Go to</div>
            <div className="grid gap-x-6 gap-y-2 sm:grid-cols-2">
              {jumps.map((i) => (
                <div key={i.id} className="flex items-center justify-between gap-3">
                  <span className="truncate">{i.label}</span>
                  <Keys keys={["G", i.key!.toUpperCase()]} />
                </div>
              ))}
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
