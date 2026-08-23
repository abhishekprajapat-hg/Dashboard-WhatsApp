import { useEffect, useRef, useState } from "react";
import { Badge } from "./ui/badge";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { Card } from "./ui/card";
import { BarChart2, ImagePlus, Instagram, MessageCircle, Send, Trash2 } from "lucide-react";
import { connectInstagramAccount, deleteInstagramAccount, getInstagramAccounts, getInstagramAuthorizeUrl, getInstagramComments, getInstagramInsights, publishInstagramPost, replyToInstagramComment, sendInstagramTestMessage, uploadMediaWithProgress } from "../lib/api";

const cardClass = "rounded-lg border-border bg-card/90 shadow-xl shadow-black/5";
const fieldClass = "bg-background/80 border-border shadow-inner shadow-black/10 focus:border-primary/50 focus:ring-2 focus:ring-primary/20";

interface InstagramAccount {
  id: string;
  instagramUserId: string;
  username: string;
  status: string;
  lastError: string;
}

interface InsightMetric {
  name: string;
  title: string;
  description: string;
  value: number | null;
}

interface InstagramCommentItem {
  id: string;
  mediaId: string;
  fromUsername: string;
  text: string;
  repliedAt: string | null;
  replyText: string;
  createdAt: string;
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
  const [insightsByAccountId, setInsightsByAccountId] = useState<Record<string, InsightMetric[]>>({});
  const [insightsLoadingId, setInsightsLoadingId] = useState("");
  const [comments, setComments] = useState<InstagramCommentItem[]>([]);
  const [commentsLoading, setCommentsLoading] = useState(false);
  const [replyDrafts, setReplyDrafts] = useState<Record<string, string>>({});
  const [replyBusyId, setReplyBusyId] = useState("");
  const [publishFiles, setPublishFiles] = useState<Record<string, File | null>>({});
  const [publishCaptions, setPublishCaptions] = useState<Record<string, string>>({});
  const [publishBusyId, setPublishBusyId] = useState("");
  const popupRef = useRef<Window | null>(null);

  async function loadComments() {
    setCommentsLoading(true);
    try {
      const response = await getInstagramComments<{ data: InstagramCommentItem[] }>();
      setComments(response.data);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Could not load comments.");
    } finally {
      setCommentsLoading(false);
    }
  }

  useEffect(() => {
    loadComments().catch(() => undefined);
  }, []);

  async function handleReplyToComment(id: string) {
    const message = replyDrafts[id];
    if (!message) {
      setNotice("Enter a reply first.");
      return;
    }
    setReplyBusyId(id);
    setNotice("");
    try {
      await replyToInstagramComment(id, message);
      setReplyDrafts((current) => ({ ...current, [id]: "" }));
      await loadComments();
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Could not send the reply.");
    } finally {
      setReplyBusyId("");
    }
  }

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

  async function handleViewInsights(id: string) {
    setInsightsLoadingId(id);
    setNotice("");
    try {
      const response = await getInstagramInsights<{ data: InsightMetric[] }>(id);
      setInsightsByAccountId((current) => ({ ...current, [id]: response.data }));
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Could not load insights.");
    } finally {
      setInsightsLoadingId("");
    }
  }

  async function handlePublish(id: string) {
    const file = publishFiles[id];
    if (!file) {
      setNotice("Choose an image first.");
      return;
    }
    setPublishBusyId(id);
    setNotice("");
    try {
      const upload = await uploadMediaWithProgress<{ data: { url: string } }>(file);
      await publishInstagramPost(id, { imageUrl: upload.data.url, caption: publishCaptions[id] || undefined });
      setNotice("Post published.");
      setPublishFiles((current) => ({ ...current, [id]: null }));
      setPublishCaptions((current) => ({ ...current, [id]: "" }));
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Could not publish the post.");
    } finally {
      setPublishBusyId("");
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

                <div className="mt-3">
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    className="h-8 text-xs border-border"
                    onClick={() => handleViewInsights(account.id)}
                    disabled={insightsLoadingId === account.id}
                  >
                    <BarChart2 size={12} className="mr-1" />
                    {insightsLoadingId === account.id ? "Loading..." : "View Insights"}
                  </Button>
                  {insightsByAccountId[account.id] && (
                    <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-4">
                      {insightsByAccountId[account.id].map((metric) => (
                        <div key={metric.name} className="rounded-md border border-border/80 bg-background/60 p-2" title={metric.description}>
                          <p className="text-[10px] uppercase tracking-wide text-muted-foreground">{metric.title || metric.name}</p>
                          <p className="text-sm font-medium text-foreground">{metric.value ?? "—"}</p>
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                <div className="mt-3 border-t border-border/60 pt-3">
                  <p className="mb-1 text-xs font-medium text-foreground">Publish Post</p>
                  <div className="flex flex-wrap items-center gap-2">
                    <input
                      type="file"
                      accept="image/jpeg,image/jpg"
                      onChange={(event) => setPublishFiles((current) => ({ ...current, [account.id]: event.target.files?.[0] || null }))}
                      className="text-xs text-muted-foreground file:mr-2 file:rounded-md file:border file:border-border file:bg-background/80 file:px-2 file:py-1 file:text-xs"
                    />
                    <Input
                      value={publishCaptions[account.id] || ""}
                      onChange={(event) => setPublishCaptions((current) => ({ ...current, [account.id]: event.target.value }))}
                      placeholder="Caption (optional)"
                      className={`h-8 w-56 text-xs ${fieldClass}`}
                    />
                    <Button type="button" size="sm" variant="outline" className="h-8 text-xs border-border" onClick={() => handlePublish(account.id)} disabled={publishBusyId === account.id}>
                      <ImagePlus size={12} className="mr-1" />
                      {publishBusyId === account.id ? "Publishing..." : "Publish"}
                    </Button>
                  </div>
                  <p className="mt-1 text-[11px] text-muted-foreground">JPEG only - Meta requires the image be fetchable from a public URL.</p>
                </div>
              </div>
              <Button type="button" size="icon-sm" variant="outline" className="border-border" title="Disconnect" onClick={() => handleDelete(account.id)} disabled={busyId === account.id}>
                <Trash2 size={14} />
              </Button>
            </div>
          </Card>
        ))}
      </div>

      <Card className={`p-4 ${cardClass}`}>
        <div className="mb-3 flex items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <MessageCircle size={16} className="text-primary" />
            <h3 className="text-sm font-medium text-foreground">Recent Comments</h3>
          </div>
          <Button type="button" size="sm" variant="outline" className="h-8 text-xs border-border" onClick={loadComments} disabled={commentsLoading}>
            {commentsLoading ? "Loading..." : "Refresh"}
          </Button>
        </div>
        {comments.length === 0 ? (
          <p className="text-sm text-muted-foreground">No comments yet.</p>
        ) : (
          <div className="space-y-3">
            {comments.map((comment) => (
              <div key={comment.id} className="rounded-md border border-border/80 bg-background/60 p-3">
                <p className="text-xs text-muted-foreground">@{comment.fromUsername || "unknown"}</p>
                <p className="text-sm text-foreground">{comment.text}</p>
                {comment.repliedAt ? (
                  <p className="mt-2 text-xs text-muted-foreground">Replied: {comment.replyText}</p>
                ) : (
                  <div className="mt-2 flex flex-wrap items-center gap-2">
                    <Input
                      value={replyDrafts[comment.id] || ""}
                      onChange={(event) => setReplyDrafts((current) => ({ ...current, [comment.id]: event.target.value }))}
                      placeholder="Reply"
                      className={`h-8 w-56 text-xs ${fieldClass}`}
                    />
                    <Button type="button" size="sm" variant="outline" className="h-8 text-xs border-border" onClick={() => handleReplyToComment(comment.id)} disabled={replyBusyId === comment.id}>
                      <Send size={12} className="mr-1" /> Reply
                    </Button>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </Card>
    </div>
  );
}
