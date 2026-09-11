// Bridge between api.ts's generic retry and whatever UI is mounted to collect the password.
//
// Kept as a module-level registration rather than React context so that api.ts - a plain module
// with no access to the component tree - can trigger a masked dialog. ActionPasswordDialog
// registers itself on mount; if nothing has registered (or the dialog is cancelled) the request
// simply fails with the server's original error, which is the correct fallback.

export type ActionPasswordPrompter = (detail: { message: string }) => Promise<string | null>;

let prompter: ActionPasswordPrompter | null = null;

export function setActionPasswordPrompter(next: ActionPasswordPrompter | null) {
  prompter = next;
}

export async function requestActionPassword(message: string): Promise<string | null> {
  if (!prompter) return null;
  return prompter({ message });
}
