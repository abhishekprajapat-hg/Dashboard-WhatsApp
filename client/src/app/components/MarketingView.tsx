import { useEffect, useState } from "react";
import { Area, AreaChart, Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { AlertTriangle, Check, Copy, Globe, Search, Sparkles, TrendingUp, X } from "lucide-react";
import { Badge } from "./ui/badge";
import { Button } from "./ui/button";
import { Card, CardContent } from "./ui/card";
import { Input } from "./ui/input";
import { LoadingSkeleton } from "./ui/loading-skeleton";
import { isPlanLimitError, PlanLockedState } from "./PlanLockedState";
import {
  createSeoAudit,
  generateSeoRecommendation,
  getGoogleMarketingAccount,
  getMarketingAnalyticsSummary,
  getSearchConsoleSummary,
  getSeoAudits,
} from "../lib/api";

const cardClass = "rounded-lg border-border/80 bg-card/90 shadow-xl shadow-black/5";
const chartTooltip = { background: "hsl(var(--card))", border: "1px solid hsl(var(--border))", borderRadius: 8, fontSize: 12 };

interface GoogleMarketingAccount {
  id: string;
  googleEmail: string;
  ga4PropertyName: string;
  searchConsoleSiteUrl: string;
  status: "connected" | "disconnected" | "needs_attention";
}

interface AnalyticsSummary {
  totals: { sessions: number; users: number; conversions: number };
  dailySessions: { date: string; sessions: number }[];
  topChannels: { channel: string; sessions: number }[];
}

interface SearchConsoleSummary {
  clicks: number;
  impressions: number;
  ctr: number;
  averagePosition: number;
  topQueries: { query: string; clicks: number; impressions: number; ctr: number; position: number }[];
  topPages: { page: string; clicks: number; impressions: number; ctr: number; position: number }[];
}

interface Finding {
  severity: "critical" | "warning" | "info";
  category: string;
  message: string;
}

interface AiRecommendation {
  summary: string;
  actions: { title: string; detail: string; priority: "high" | "medium" | "low" }[];
  provider: string;
}

interface SeoAudit {
  id: string;
  url: string;
  status: "queued" | "running" | "completed" | "failed";
  findings: Finding[];
  aiRecommendation: AiRecommendation | null;
  error: string;
  createdAt: string;
}

function num(value: number) {
  return Number(value || 0).toLocaleString();
}

function pct(value: number) {
  return `${(Number(value || 0) * 100).toFixed(1)}%`;
}

function StatTile({ label, value }: { label: string; value: string }) {
  return (
    <Card className={cardClass}>
      <CardContent className="p-4">
        <div className="text-xs text-muted-foreground">{label}</div>
        <div className="mt-1 text-2xl font-semibold text-foreground">{value}</div>
      </CardContent>
    </Card>
  );
}

const SEVERITY_BADGE: Record<Finding["severity"], "destructive" | "warning" | "outline"> = {
  critical: "destructive",
  warning: "warning",
  info: "outline",
};

function FindingRow({ finding }: { finding: Finding }) {
  return (
    <div className="flex items-start gap-2 border-b border-border/60 py-2 last:border-0">
      <Badge variant={SEVERITY_BADGE[finding.severity]} className="mt-0.5 shrink-0 uppercase">
        {finding.severity}
      </Badge>
      <div className="min-w-0">
        <div className="text-xs font-medium text-foreground">{finding.category}</div>
        <div className="text-xs text-muted-foreground">{finding.message}</div>
      </div>
    </div>
  );
}

// Modal, not the inline-field pattern - there's no existing editable field an SEO recommendation
// writes into (unlike TemplateCopyGenerator's template body), same reasoning SupportView.tsx's
// SuggestReplyModal already applies to ticket-reply suggestions.
function RecommendationModal({ audit, onClose, onGenerated, onLocked }: { audit: SeoAudit; onClose: () => void; onGenerated: (audit: SeoAudit) => void; onLocked: (message: string) => void }) {
  const [loading, setLoading] = useState(!audit.aiRecommendation);
  const [recommendation, setRecommendation] = useState(audit.aiRecommendation);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (audit.aiRecommendation) return;
    generateSeoRecommendation<{ data: SeoAudit }>(audit.id)
      .then((response) => {
        setRecommendation(response.data.aiRecommendation);
        onGenerated(response.data);
      })
      .catch((error) => {
        if (isPlanLimitError(error)) onLocked(error.message);
      })
      .finally(() => setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [audit.id]);

  async function handleCopy() {
    if (!recommendation) return;
    const text = [recommendation.summary, "", ...recommendation.actions.map((action) => `- ${action.title}: ${action.detail}`)].join("\n");
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // Clipboard access can be denied by the browser - the text is still visible/selectable, so
      // this degrades to "copy it by hand" rather than surfacing an error.
    }
  }

  return (
    <div className="fixed inset-0 z-30 flex items-center justify-center overflow-y-auto bg-black/65 p-3 backdrop-blur-sm sm:p-4">
      <div className="max-h-[calc(100dvh-1.5rem)] w-full max-w-lg overflow-y-auto rounded-xl border border-border/90 bg-card p-4 shadow-2xl shadow-black/45 sm:p-5">
        <div className="mb-4 flex items-start justify-between gap-3">
          <h2 className="flex items-center gap-1.5 text-lg font-semibold text-foreground">
            <Sparkles size={16} className="text-primary" />
            AI growth recommendation
          </h2>
          <button type="button" className="rounded-lg p-2 text-muted-foreground hover:bg-secondary hover:text-foreground" onClick={onClose}>
            <X size={17} />
          </button>
        </div>

        {loading ? (
          <LoadingSkeleton rows={4} />
        ) : recommendation ? (
          <div className="space-y-3">
            <p className="text-sm text-foreground">{recommendation.summary}</p>
            <div className="space-y-2">
              {recommendation.actions.map((action, index) => (
                <div key={index} className="rounded-lg border border-border/70 bg-surface-subtle/60 p-3">
                  <div className="flex items-center gap-2">
                    <Badge variant={action.priority === "high" ? "destructive" : action.priority === "medium" ? "warning" : "outline"} className="uppercase">
                      {action.priority}
                    </Badge>
                    <span className="text-sm font-medium text-foreground">{action.title}</span>
                  </div>
                  <p className="mt-1 text-xs text-muted-foreground">{action.detail}</p>
                </div>
              ))}
            </div>
            <p className="text-[10px] text-muted-foreground">
              A written recommendation only - apply these yourself on your own site. Nothing here changes anything automatically.
            </p>
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">Could not generate a recommendation.</p>
        )}

        <div className="mt-4 flex justify-end">
          <Button type="button" variant="outline" onClick={handleCopy} disabled={loading || !recommendation}>
            {copied ? <Check size={14} /> : <Copy size={14} />}
            {copied ? "Copied" : "Copy to clipboard"}
          </Button>
        </div>
      </div>
    </div>
  );
}

interface MarketingViewProps {
  canWrite?: boolean;
}

export function MarketingView({ canWrite = false }: MarketingViewProps) {
  const [account, setAccount] = useState<GoogleMarketingAccount | null>(null);
  const [analytics, setAnalytics] = useState<AnalyticsSummary | null>(null);
  const [searchConsole, setSearchConsole] = useState<SearchConsoleSummary | null>(null);
  const [audits, setAudits] = useState<SeoAudit[]>([]);
  const [loading, setLoading] = useState(true);
  const [lockedMessage, setLockedMessage] = useState("");
  const [auditUrl, setAuditUrl] = useState("");
  const [runningAudit, setRunningAudit] = useState(false);
  const [auditNotice, setAuditNotice] = useState("");
  const [activeRecommendationAudit, setActiveRecommendationAudit] = useState<SeoAudit | null>(null);

  async function loadAll() {
    setLoading(true);
    try {
      const accountResponse = await getGoogleMarketingAccount<{ data: GoogleMarketingAccount | null }>();
      setAccount(accountResponse.data);

      if (accountResponse.data?.status === "connected") {
        const [analyticsResponse, searchConsoleResponse, auditsResponse] = await Promise.all([
          getMarketingAnalyticsSummary<{ data: AnalyticsSummary }>().catch(() => null),
          getSearchConsoleSummary<{ data: SearchConsoleSummary }>().catch(() => null),
          getSeoAudits<{ data: SeoAudit[] }>(),
        ]);
        if (analyticsResponse) setAnalytics(analyticsResponse.data);
        if (searchConsoleResponse) setSearchConsole(searchConsoleResponse.data);
        setAudits(auditsResponse.data);
      } else {
        const auditsResponse = await getSeoAudits<{ data: SeoAudit[] }>().catch(() => ({ data: [] }));
        setAudits(auditsResponse.data);
      }
    } catch (error) {
      if (isPlanLimitError(error)) setLockedMessage(error.message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadAll().catch(() => undefined);
  }, []);

  async function handleRunAudit() {
    if (!canWrite || !auditUrl.trim()) return;
    setRunningAudit(true);
    setAuditNotice("");
    try {
      const response = await createSeoAudit<{ data: SeoAudit }>(auditUrl.trim());
      setAudits((current) => [response.data, ...current]);
      setAuditUrl("");
    } catch (error) {
      if (isPlanLimitError(error)) {
        setLockedMessage(error.message);
      } else {
        setAuditNotice(error instanceof Error ? error.message : "The audit could not be run.");
      }
    } finally {
      setRunningAudit(false);
    }
  }

  function handleRecommendationUpdated(updatedAudit: SeoAudit) {
    setAudits((current) => current.map((audit) => (audit.id === updatedAudit.id ? updatedAudit : audit)));
    setActiveRecommendationAudit(updatedAudit);
  }

  if (lockedMessage) {
    return (
      <div className="flex min-h-full w-full items-center justify-center p-6">
        <PlanLockedState title="Marketing is locked" message={lockedMessage} icon={<TrendingUp size={20} />} />
      </div>
    );
  }

  return (
    <div className="relative flex w-full min-w-0 flex-1 flex-col overflow-x-hidden overflow-y-auto">
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_18%_0%,rgba(47,168,118,0.08),transparent_26rem),radial-gradient(circle_at_88%_12%,rgba(79,140,255,0.08),transparent_24rem)]" />

      <div className="relative z-10 flex flex-col gap-4 border-b border-border/80 bg-surface/70 px-3 py-4 backdrop-blur-xl sm:px-6">
        <div className="min-w-0">
          <Badge variant="success" className="mb-2">
            <TrendingUp size={12} />
            Marketing
          </Badge>
          <h1 className="text-2xl font-semibold text-foreground">Marketing</h1>
          <p className="mt-1 text-sm text-muted-foreground">Your own Google Analytics, Search Console, and AI-drafted SEO recommendations for your own website.</p>
        </div>
      </div>

      <div className="relative z-10 flex min-h-0 flex-1 flex-col gap-4 p-3 sm:p-4">
        {loading && <LoadingSkeleton rows={4} />}

        {!loading && !account && (
          <Card className={cardClass}>
            <CardContent className="flex flex-col items-center gap-3 p-8 text-center">
              <Globe size={28} className="text-muted-foreground" />
              <div>
                <p className="text-sm font-medium text-foreground">Connect your Google account to get started</p>
                <p className="mt-1 text-xs text-muted-foreground">Go to Settings &gt; Marketing to connect your own Google Analytics and Search Console.</p>
              </div>
            </CardContent>
          </Card>
        )}

        {!loading && account && account.status === "needs_attention" && (
          <Card className={cardClass}>
            <CardContent className="flex flex-col items-center gap-3 p-8 text-center">
              <AlertTriangle size={28} className="text-warning" />
              <div>
                <p className="text-sm font-medium text-foreground">Finish choosing your property and site</p>
                <p className="mt-1 text-xs text-muted-foreground">Go to Settings &gt; Marketing to pick your GA4 property and Search Console site.</p>
              </div>
            </CardContent>
          </Card>
        )}

        {!loading && account?.status === "connected" && (
          <>
            <div className="grid gap-3 sm:grid-cols-4">
              <StatTile label="Sessions (28d)" value={num(analytics?.totals.sessions || 0)} />
              <StatTile label="Users (28d)" value={num(analytics?.totals.users || 0)} />
              <StatTile label="Search clicks (28d)" value={num(searchConsole?.clicks || 0)} />
              <StatTile label="Avg. search position" value={(searchConsole?.averagePosition || 0).toFixed(1)} />
            </div>

            <div className="grid gap-3 lg:grid-cols-2">
              <Card className={cardClass}>
                <CardContent className="p-4">
                  <h3 className="mb-3 text-sm font-medium text-foreground">Sessions, last 28 days</h3>
                  {analytics?.dailySessions.length ? (
                    <ResponsiveContainer width="100%" height={220}>
                      <AreaChart data={analytics.dailySessions}>
                        <defs>
                          <linearGradient id="marketingSessions" x1="0" y1="0" x2="0" y2="1">
                            <stop offset="0%" stopColor="hsl(var(--primary))" stopOpacity={0.35} />
                            <stop offset="100%" stopColor="hsl(var(--primary))" stopOpacity={0} />
                          </linearGradient>
                        </defs>
                        <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                        <XAxis dataKey="date" tick={{ fontSize: 10 }} stroke="hsl(var(--muted-foreground))" />
                        <YAxis tick={{ fontSize: 10 }} stroke="hsl(var(--muted-foreground))" />
                        <Tooltip contentStyle={chartTooltip} />
                        <Area type="monotone" dataKey="sessions" stroke="hsl(var(--primary))" fill="url(#marketingSessions)" strokeWidth={2} />
                      </AreaChart>
                    </ResponsiveContainer>
                  ) : (
                    <div className="flex h-[180px] items-center justify-center rounded-md border border-dashed border-border bg-background/60 text-center text-xs text-muted-foreground">
                      No analytics data for this period.
                    </div>
                  )}
                </CardContent>
              </Card>

              <Card className={cardClass}>
                <CardContent className="p-4">
                  <h3 className="mb-3 text-sm font-medium text-foreground">Top channels</h3>
                  {analytics?.topChannels.length ? (
                    <ResponsiveContainer width="100%" height={220}>
                      <BarChart data={analytics.topChannels} layout="vertical">
                        <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                        <XAxis type="number" tick={{ fontSize: 10 }} stroke="hsl(var(--muted-foreground))" />
                        <YAxis dataKey="channel" type="category" width={110} tick={{ fontSize: 10 }} stroke="hsl(var(--muted-foreground))" />
                        <Tooltip contentStyle={chartTooltip} />
                        <Bar dataKey="sessions" fill="hsl(var(--primary))" radius={[0, 4, 4, 0]} />
                      </BarChart>
                    </ResponsiveContainer>
                  ) : (
                    <div className="flex h-[180px] items-center justify-center rounded-md border border-dashed border-border bg-background/60 text-center text-xs text-muted-foreground">
                      No channel data for this period.
                    </div>
                  )}
                </CardContent>
              </Card>
            </div>

            <Card className={cardClass}>
              <CardContent className="p-4">
                <h3 className="mb-3 text-sm font-medium text-foreground">Top search queries</h3>
                {searchConsole?.topQueries.length ? (
                  <div className="overflow-x-auto">
                    <table className="w-full text-left text-xs">
                      <thead className="text-muted-foreground">
                        <tr>
                          <th className="pb-2 pr-3 font-normal">Query</th>
                          <th className="pb-2 pr-3 font-normal">Clicks</th>
                          <th className="pb-2 pr-3 font-normal">Impressions</th>
                          <th className="pb-2 pr-3 font-normal">CTR</th>
                          <th className="pb-2 font-normal">Avg. position</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-border/60">
                        {searchConsole.topQueries.map((row) => (
                          <tr key={row.query}>
                            <td className="py-2 pr-3 text-foreground">{row.query}</td>
                            <td className="py-2 pr-3">{num(row.clicks)}</td>
                            <td className="py-2 pr-3">{num(row.impressions)}</td>
                            <td className="py-2 pr-3">{pct(row.ctr)}</td>
                            <td className="py-2">{row.position.toFixed(1)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                ) : (
                  <p className="text-xs text-muted-foreground">No search query data for this period.</p>
                )}
              </CardContent>
            </Card>
          </>
        )}

        <Card className={cardClass}>
          <CardContent className="p-4">
            <div className="mb-1 flex items-center gap-2">
              <Search size={16} className="text-primary" />
              <h3 className="text-sm font-medium text-foreground">SEO audit</h3>
            </div>
            <p className="mb-3 text-xs text-muted-foreground">
              Enter your own website's URL for a free PageSpeed Insights + Search Console check, plus an AI-drafted
              recommendation you apply yourself.
            </p>
            {canWrite && (
              <div className="flex flex-wrap gap-2">
                <Input
                  value={auditUrl}
                  onChange={(event) => setAuditUrl(event.target.value)}
                  placeholder="https://your-website.com"
                  className="h-9 max-w-sm flex-1 text-xs"
                />
                <Button type="button" size="sm" className="h-9 bg-primary text-xs text-primary-foreground" onClick={handleRunAudit} disabled={runningAudit || !auditUrl.trim()}>
                  {runningAudit ? "Running audit (this can take ~30s)..." : "Run audit"}
                </Button>
              </div>
            )}
            {auditNotice && <p className="mt-2 text-xs text-destructive">{auditNotice}</p>}

            <div className="mt-4 space-y-3">
              {audits.length === 0 && <p className="text-xs text-muted-foreground">No audits run yet.</p>}
              {audits.map((audit) => (
                <div key={audit.id} className="rounded-lg border border-border/70 bg-surface-subtle/50 p-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="min-w-0">
                      <div className="truncate text-sm font-medium text-foreground">{audit.url}</div>
                      <div className="text-[10px] text-muted-foreground">{new Date(audit.createdAt).toLocaleString()}</div>
                    </div>
                    <div className="flex items-center gap-2">
                      <Badge variant={audit.status === "completed" ? "success" : audit.status === "failed" ? "destructive" : "outline"}>{audit.status}</Badge>
                      {audit.status === "completed" && (audit.aiRecommendation || canWrite) && (
                        <Button type="button" size="sm" variant="outline" className="h-7 text-xs" onClick={() => setActiveRecommendationAudit(audit)}>
                          <Sparkles size={12} className="mr-1" />
                          {audit.aiRecommendation ? "View recommendation" : "Generate recommendation"}
                        </Button>
                      )}
                    </div>
                  </div>
                  {audit.status === "failed" && <p className="mt-2 text-xs text-destructive">{audit.error}</p>}
                  {audit.findings.length > 0 && (
                    <div className="mt-2 border-t border-border/60 pt-2">
                      {audit.findings.slice(0, 5).map((finding, index) => (
                        <FindingRow key={index} finding={finding} />
                      ))}
                    </div>
                  )}
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      </div>

      {activeRecommendationAudit && (
        <RecommendationModal
          audit={activeRecommendationAudit}
          onClose={() => setActiveRecommendationAudit(null)}
          onGenerated={handleRecommendationUpdated}
          onLocked={(message) => {
            setActiveRecommendationAudit(null);
            setLockedMessage(message);
          }}
        />
      )}
    </div>
  );
}
