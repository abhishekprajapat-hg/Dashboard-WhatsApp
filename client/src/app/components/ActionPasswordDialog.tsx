import { useEffect, useRef, useState } from "react";
// Input is a plain function component and does not forward refs, so focus is handled with
// autoFocus below rather than an imperative ref.
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { ShieldAlert } from "lucide-react";
import { setActionPasswordPrompter } from "../lib/actionPassword";

// Collects the destructive-action password when the server answers 428. Mounted once at the app
// root; api.ts reaches it through the module-level prompter registration rather than React context,
// since api.ts is a plain module with no access to the tree.
//
// A masked <Input type="password"> rather than window.prompt, which would echo the secret in
// plaintext - this platform is routinely screen-shared while debugging, and a prompt box is exactly
// the thing that ends up in a screenshot.
export function ActionPasswordDialog() {
  const [open, setOpen] = useState(false);
  const [message, setMessage] = useState("");
  const [value, setValue] = useState("");
  const resolverRef = useRef<((value: string | null) => void) | null>(null);

  useEffect(() => {
    setActionPasswordPrompter((detail) => {
      setMessage(detail.message);
      setValue("");
      setOpen(true);
      return new Promise<string | null>((resolve) => {
        resolverRef.current = resolve;
      });
    });
    return () => setActionPasswordPrompter(null);
  }, []);

  function settle(result: string | null) {
    // Always resolve, never leave the awaiting request() hanging - cancelling must let the original
    // error surface rather than silently stalling the caller forever.
    resolverRef.current?.(result);
    resolverRef.current = null;
    setOpen(false);
    setValue("");
  }

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="action-password-title"
    >
      <div className="w-full max-w-md rounded-lg border border-border bg-card p-5 shadow-2xl">
        <div className="flex items-start gap-3">
          <ShieldAlert size={18} className="mt-0.5 shrink-0 text-destructive" />
          <div className="min-w-0">
            <h2 id="action-password-title" className="text-sm font-semibold text-foreground">
              Confirm a destructive action
            </h2>
            <p className="mt-1 text-xs leading-5 text-muted-foreground">{message}</p>
          </div>
        </div>

        <form
          className="mt-4 space-y-3"
          onSubmit={(event) => {
            event.preventDefault();
            if (value) settle(value);
          }}
        >
          <Input
            type="password"
            autoFocus
            value={value}
            onChange={(event) => setValue(event.target.value)}
            placeholder="Destructive-action password"
            autoComplete="off"
          />
          <div className="flex justify-end gap-2">
            <Button type="button" variant="outline" size="sm" onClick={() => settle(null)}>
              Cancel
            </Button>
            <Button type="submit" size="sm" disabled={!value}>
              Confirm
            </Button>
          </div>
        </form>

        <p className="mt-3 text-[11px] leading-4 text-muted-foreground">
          This is not your login password. It is set on the server and cannot be changed from here.
        </p>
      </div>
    </div>
  );
}
