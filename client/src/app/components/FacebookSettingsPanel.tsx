import { useEffect, useRef, useState } from "react";
import { Badge } from "./ui/badge";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { Card } from "./ui/card";
import { Facebook, Send, Trash2 } from "lucide-react";
import { connectFacebookAccounts, deleteFacebookAccount, getFacebookAccounts, getFacebookAuthorizeUrl, sendFacebookTestMessage } from "../lib/api";

const cardClass = "rounded-lg border-border bg-card/90 shadow-xl shadow-black/5";
const fieldClass = "bg-background/80 border-border shadow-inner shadow-black/10 focus:border-primary/50 focus:ring-2 focus:ring-primary/20";

interface FacebookAccount {
  id: string;
  pageId: string;
  pageName: string;
  profilePictureUrl?: string;
  status: string;
  lastError: string;
}

function statusVariant(status: string) {
  if (status === "connected") return "default";
  if (status === "needs_attention") return "destructive";
  return "outline";
}

// Minimal scope, matching this project's own "genuine minimal feature before requesting a
// permission" discipline (see InstagramSettingsPanel.tsx): connect a Page, receive/reply to DMs
// in the unified Inbox. No Page post publishing/comments/insights here yet - real follow-ups for
// a later, separate permission request once this is proven live, same pattern Instagram's own
// permissions followed one at a time.
export function FacebookSettingsPanel() {
  const [accounts, setAccounts] = useState<FacebookAccount[]>([]);
  const [loading, setLoading] = useState(true);
  const [connecting, setConnecting] = useState(false);
  const [notice, setNotice] = useState("");
  const [sendTargets, setSendTargets] = useState<Record<string, { to: string; body: string }>>({});
  const [busyId, setBusyId] = useState("");
  const popupRef = useRef<Window | null>(null);
  const processedResultRef = useRef(false);

  async function loadAccounts() {
    setLoading(true);
    try {
      const response = await getFacebookAccounts<{ data: FacebookAccount[] }>();
      setAccounts(response.data);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Facebook Pages could not be loaded.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadAccounts().catch(() => undefined);
  }, []);

  // Same window.opener-hostility workaround as InstagramSettingsPanel.tsx - Facebook's own
  // login/consent pages set a strict Cross-Origin-Opener-Policy too, severing window.opener before
  // the popup ever returns here. localStorage + the "storage" event doesn't depend on the opener
  // relationship, just on both windows being same-origin.
  async function handleOAuthResult(raw: string) {
    if (processedResultRef.current) return;
    let data: { type?: string; code?: string; error?: string };
    try {
      data = JSON.parse(raw);
    } catch {
      return;
    }
    if (data?.type !== "FB_PAGES_OAUTH_CALLBACK") return;
    processedResultRef.current = true;
    localStorage.removeItem("fb_pages_oauth_result");

    if (data.error) {
      setNotice(data.error);
      return;
    }
    if (!data.code) return;

    setConnecting(true);
    setNotice("");
    try {
      await connectFacebookAccounts(data.code);
      await loadAccounts();
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Could not connect the Facebook Page.");
    } finally {
      setConnecting(false);
    }
  }

  useEffect(() => {
    function onStorage(event: StorageEvent) {
      if (event.key !== "fb_pages_oauth_result" || !event.newValue) return;
      handleOAuthResult(event.newValue);
    }
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);

  async function handleConnect() {
    setNotice("");
    processedResultRef.current = false;
    localStorage.removeItem("fb_pages_oauth_result");
    try {
      const response = await getFacebookAuthorizeUrl<{ url: string }>();
      popupRef.current = window.open(response.url, "fb_pages_oauth", "width=520,height=720");

      const pollId = window.setInterval(() => {
        if (!popupRef.current || popupRef.current.closed) {
          window.clearInterval(pollId);
          const stored = localStorage.getItem("fb_pages_oauth_result");
          if (stored) handleOAuthResult(stored);
        }
      }, 500);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Facebook connect is not configured yet.");
    }
  }

  async function handleDelete(id: string) {
    setBusyId(id);
    try {
      await deleteFacebookAccount(id);
      await loadAccounts();
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Could not disconnect the Page.");
    } finally {
      setBusyId("");
    }
  }

  async function handleSend(id: string) {
    const target = sendTargets[id];
    if (!target?.to || !target?.body) {
      setNotice("Enter both a recipient PSID and a message body first.");
      return;
    }
    setBusyId(id);
    setNotice("");
    try {
      await sendFacebookTestMessage(id, target);
      setNotice("Message sent.");
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Could not send the message.");
    } finally {
      setBusyId("");
    }
  }

  return (
    <div className="space-y-4">
      <Card className={`p-4 ${cardClass}`}>
        <div className="flex items-center gap-2 mb-1">
          <Facebook size={16} className="text-primary" />
          <h3 className="text-sm font-medium text-foreground">Facebook Page DMs</h3>
        </div>
        <p className="text-xs text-muted-foreground mb-3">
          Connect a Facebook Page to receive and reply to Messenger DMs in the same Inbox used for WhatsApp and
          Instagram. Uses the same Meta app as WhatsApp/Ads (classic Facebook Login), not the separate Instagram app.
        </p>
        <Button type="button" size="sm" className="h-8 text-xs bg-primary text-primary-foreground" onClick={handleConnect} disabled={connecting}>
          {connecting ? "Connecting..." : "Connect Facebook Page"}
        </Button>
      </Card>

      {notice && (
        <Card
          className={
            notice === "Message sent."
              ? `p-3 border-emerald-500/25 bg-emerald-500/10 ${cardClass}`
              : `p-3 border-destructive/40 bg-destructive/5 ${cardClass}`
          }
        >
          <p className={notice === "Message sent." ? "text-xs text-emerald-300" : "text-xs text-destructive"}>{notice}</p>
        </Card>
      )}

      <div className="space-y-2">
        {!loading && accounts.length === 0 && (
          <Card className={`p-4 ${cardClass}`}>
            <p className="text-sm text-foreground">No Facebook Page connected</p>
          </Card>
        )}
        {accounts.map((account) => (
          <Card key={account.id} className={`p-4 ${cardClass}`}>
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  {account.profilePictureUrl && (
                    <img
                      src={account.profilePictureUrl}
                      alt={`${account.pageName} profile picture`}
                      className="h-8 w-8 rounded-full object-cover"
                    />
                  )}
                  <span className="text-sm font-medium text-foreground">{account.pageName || account.pageId}</span>
                  <Badge variant={statusVariant(account.status)}>{account.status}</Badge>
                </div>
                {account.lastError && <p className="text-xs text-destructive mt-1">{account.lastError}</p>}

                <div className="mt-3 flex flex-wrap items-center gap-2">
                  <Input
                    value={sendTargets[account.id]?.to || ""}
                    onChange={(event) => setSendTargets((current) => ({ ...current, [account.id]: { ...current[account.id], to: event.target.value, body: current[account.id]?.body || "" } }))}
                    placeholder="Recipient PSID"
                    className={`h-8 w-40 text-xs ${fieldClass}`}
                  />
                  <Input
                    value={sendTargets[account.id]?.body || ""}
                    onChange={(event) => setSendTargets((current) => ({ ...current, [account.id]: { ...current[account.id], body: event.target.value, to: current[account.id]?.to || "" } }))}
                    placeholder="Message"
                    className={`h-8 flex-1 text-xs ${fieldClass}`}
                  />
                  <Button type="button" size="sm" className="h-8 text-xs" onClick={() => handleSend(account.id)} disabled={busyId === account.id}>
                    <Send size={13} className="mr-1" /> Send
                  </Button>
                </div>
              </div>
              <Button type="button" variant="ghost" size="sm" className="h-8 w-8 p-0 text-muted-foreground hover:text-destructive" onClick={() => handleDelete(account.id)} disabled={busyId === account.id}>
                <Trash2 size={14} />
              </Button>
            </div>
          </Card>
        ))}
      </div>
    </div>
  );
}
