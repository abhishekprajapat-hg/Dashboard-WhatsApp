import { useEffect, useRef, useState } from "react";
import { Badge } from "./ui/badge";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { Card } from "./ui/card";
import { Instagram, Send, Trash2 } from "lucide-react";
import { connectInstagramAccount, deleteInstagramAccount, getInstagramAccounts, getInstagramAuthorizeUrl, sendInstagramTestMessage } from "../lib/api";

const cardClass = "rounded-lg border-border bg-card/90 shadow-xl shadow-black/5";
const fieldClass = "bg-background/80 border-border shadow-inner shadow-black/10 focus:border-primary/50 focus:ring-2 focus:ring-primary/20";

interface InstagramAccount {
  id: string;
  instagramUserId: string;
  username: string;
  status: string;
  lastError: string;
}

function statusVariant(status: string): "default" | "outline" | "destructive" | "warning" {
  if (status === "connected") return "default";
  if (status === "needs_attention") return "destructive";
  return "outline";
}

export function InstagramSettingsPanel() {
  const [accounts, setAccounts] = useState<InstagramAccount[]>([]);
  const [loading, setLoading] = useState(true);
  const [connecting, setConnecting] = useState(false);
  const [notice, setNotice] = useState("");
  const [sendTargets, setSendTargets] = useState<Record<string, { to: string; body: string }>>({});
  const [busyId, setBusyId] = useState("");
  const popupRef = useRef<Window | null>(null);

  async function loadAccounts() {
    setLoading(true);
    try {
      const response = await getInstagramAccounts<{ data: InstagramAccount[] }>();
      setAccounts(response.data);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Instagram accounts could not be loaded.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadAccounts().catch(() => undefined);
  }, []);

  // Instagram's own login pages very likely set their own strict Cross-Origin-Opener-Policy,
  // which severs window.opener the moment the popup navigates *to* instagram.com - before it ever
  // comes back to our own oauth-callback page. No header on our side can undo a browsing-context
  // group switch that already happened on Instagram's domain, so postMessage/window.opener can't
  // be relied on here (confirmed by this failing in real testing even after fixing our own COOP
  // header). localStorage + the "storage" event doesn't depend on the opener relationship at all -
  // just on both windows being same-origin when they read/write it, which they always are here.
  const processedResultRef = useRef(false);

  async function handleOAuthResult(raw: string) {
    if (processedResultRef.current) return;
    let data: { type?: string; code?: string; error?: string };
    try {
      data = JSON.parse(raw);
    } catch {
      return;
    }
    if (data?.type !== "IG_OAUTH_CALLBACK") return;
    processedResultRef.current = true;
    localStorage.removeItem("ig_oauth_result");

    if (data.error) {
      setNotice(data.error);
      return;
    }
    if (!data.code) return;

    setConnecting(true);
    setNotice("");
    try {
      await connectInstagramAccount(data.code);
      await loadAccounts();
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Could not connect the Instagram account.");
    } finally {
      setConnecting(false);
    }
  }

  useEffect(() => {
    function onStorage(event: StorageEvent) {
      if (event.key !== "ig_oauth_result" || !event.newValue) return;
      handleOAuthResult(event.newValue);
    }
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);

  async function handleConnect() {
    setNotice("");
    processedResultRef.current = false;
    localStorage.removeItem("ig_oauth_result");
    try {
      const response = await getInstagramAuthorizeUrl<{ url: string }>();
      popupRef.current = window.open(response.url, "ig_oauth", "width=520,height=720");

      // Fallback for the (rare, browser-dependent) case where the "storage" event doesn't fire in
      // time or at all - poll for the popup closing and check localStorage directly once it does.
      const pollId = window.setInterval(() => {
        if (!popupRef.current || popupRef.current.closed) {
          window.clearInterval(pollId);
          const stored = localStorage.getItem("ig_oauth_result");
          if (stored) handleOAuthResult(stored);
        }
      }, 500);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Instagram connect is not configured yet.");
    }
  }

  async function handleDelete(id: string) {
    setBusyId(id);
    try {
      await deleteInstagramAccount(id);
      await loadAccounts();
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Could not disconnect the account.");
    } finally {
      setBusyId("");
    }
  }

  async function handleSend(id: string) {
    const target = sendTargets[id];
    if (!target?.to || !target?.body) {
      setNotice("Enter both a recipient Instagram-scoped ID and a message body first.");
      return;
    }
    setBusyId(id);
    setNotice("");
    try {
      await sendInstagramTestMessage(id, target);
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
          <Instagram size={16} className="text-primary" />
          <h3 className="text-sm font-medium text-foreground">Instagram DMs</h3>
        </div>
        <p className="text-xs text-muted-foreground mb-3">
          Connect an Instagram professional account to receive and reply to DMs. Requires a separate Instagram App
          ID/Secret from App Dashboard &gt; Instagram &gt; API setup with Instagram Login - not the same app used for
          WhatsApp/Ads.
        </p>
        <Button type="button" size="sm" className="h-8 text-xs bg-primary text-primary-foreground" onClick={handleConnect} disabled={connecting}>
          {connecting ? "Connecting..." : "Connect Instagram"}
        </Button>
      </Card>

      {notice && (
        <Card className={`p-3 border-destructive/40 bg-destructive/5 ${cardClass}`}>
          <p className="text-xs text-destructive">{notice}</p>
        </Card>
      )}

      <div className="space-y-2">
        {!loading && accounts.length === 0 && (
          <Card className={`p-4 ${cardClass}`}>
            <p className="text-sm text-foreground">No Instagram account connected</p>
          </Card>
        )}
        {accounts.map((account) => (
          <Card key={account.id} className={`p-4 ${cardClass}`}>
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-sm font-medium text-foreground">@{account.username || account.instagramUserId}</span>
                  <Badge variant={statusVariant(account.status)}>{account.status}</Badge>
                </div>
                {account.lastError && <p className="text-xs text-destructive mt-1">{account.lastError}</p>}

                <div className="mt-3 flex flex-wrap items-center gap-2">
                  <Input
                    value={sendTargets[account.id]?.to || ""}
                    onChange={(event) => setSendTargets((current) => ({ ...current, [account.id]: { ...current[account.id], to: event.target.value, body: current[account.id]?.body || "" } }))}
                    placeholder="Recipient IGSID"
                    className={`h-8 w-40 text-xs ${fieldClass}`}
                  />
                  <Input
                    value={sendTargets[account.id]?.body || ""}
                    onChange={(event) => setSendTargets((current) => ({ ...current, [account.id]: { ...current[account.id], body: event.target.value, to: current[account.id]?.to || "" } }))}
                    placeholder="Message"
                    className={`h-8 w-56 text-xs ${fieldClass}`}
                  />
                  <Button type="button" size="sm" variant="outline" className="h-8 text-xs border-border" onClick={() => handleSend(account.id)} disabled={busyId === account.id}>
                    <Send size={12} className="mr-1" /> Send
                  </Button>
                </div>
                <p className="mt-2 text-[11px] text-muted-foreground">
                  Only delivers if this IGSID has messaged your account within the last 24 hours - same session-window
                  rule as WhatsApp.
                </p>
              </div>
              <Button type="button" size="icon-sm" variant="outline" className="border-border" title="Disconnect" onClick={() => handleDelete(account.id)} disabled={busyId === account.id}>
                <Trash2 size={14} />
              </Button>
            </div>
          </Card>
        ))}
      </div>
    </div>
  );
}
