import { useEffect, useMemo, useState, type ReactNode } from "react";
import {
  Activity,
  AlertCircle,
  ArrowUpRight,
  BarChart3,
  CheckCircle2,
  Clock3,
  Flame,
  Megaphone,
  MessageCircle,
  Radio,
  Sparkles,
  Target,
  TrendingUp,
  Users,
  Workflow,
} from "lucide-react";
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { Badge } from "./ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "./ui/card";
import { EmptyState } from "./ui/empty-state";
import { LoadingSkeleton } from "./ui/loading-skeleton";
import { getDashboardSummary } from "../lib/api";
import { demoDashboard } from "../lib/demoData";

type DashboardSummary = typeof demoDashboard;
type DashboardKpi = DashboardSummary["kpis"][number];
type RecentConversation = DashboardSummary["recentConversations"][number];

const statusColor: Record<string, string> = {
  open: "border-primary/30 bg-primary/10 text-primary",
  waiting: "border-warning/30 bg-warning/10 text-warning",
  pending: "border-warning/30 bg-warning/10 text-warning",
  resolved: "border-border bg-secondary/60 text-muted-foreground",
  archived: "border-border bg-secondary/40 text-muted-foreground",
};

const chartTooltip = {
  background: "hsl(var(--popover))",
  border: "1px solid hsl(var(--border))",
  borderRadius: 8,
  color: "hsl(var(--popover-foreground))",
  fontSize: 12,
};

interface DashboardViewProps {
  userName: string;
}

function firstName(name: string) {
  return name.trim().split(/\s+/)[0] || "there";
}

function kpiByLabel(kpis: DashboardKpi[], labels: string[]) {
  return kpis.find((kpi) => labels.some((label) => kpi.label.toLowerCase().includes(label)));
}

function numericValue(value: unknown) {
  const number = Number(String(value ?? "").replace(/[^\d.-]/g, ""));
  return Number.isFinite(number) ? number : 0;
}

function sumVolume(summary: DashboardSummary, key: "inbound" | "outbound") {
  return (summary.messageVolume || []).reduce((total, item) => total + numericValue(item[key]), 0);
}

function MetricCard({
  label,
  value,
  detail,
  icon,
  tone = "primary",
  unavailable = false,
}: {
  label: string;
  value: ReactNode;
  detail?: ReactNode;
  icon: ReactNode;
  tone?: "primary" | "info" | "warning" | "muted";
  unavailable?: boolean;
}) {
  const toneClass = {
    primary: "from-primary/18 text-primary ring-primary/20",
    info: "from-info/18 text-info ring-info/20",
    warning: "from-warning/18 text-warning ring-warning/20",
    muted: "from-secondary/70 text-muted-foreground ring-border",
  }[tone];

  return (
    <Card className="group relative overflow-hidden border-border/80 bg-card/85 transition-all duration-200 hover:-translate-y-0.5 hover:border-border">
      <div className={`absolute inset-x-0 top-0 h-px bg-gradient-to-r ${tone === "muted" ? "from-transparent via-border to-transparent" : "from-transparent via-current to-transparent"} opacity-50`} />
      <CardContent className="relative p-4">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="truncate text-xs font-medium text-muted-foreground">{label}</p>
            <div className={`mt-3 truncate text-2xl font-semibold leading-none ${unavailable ? "text-muted-foreground" : "text-foreground"}`}>{value}</div>
          </div>
          <div className={`flex size-10 shrink-0 items-center justify-center rounded-lg bg-gradient-to-br ${toneClass} ring-1`}>
            {icon}
          </div>
        </div>
        {detail && (
          <div className="mt-4 flex items-center gap-1.5 text-xs text-muted-foreground">
            {!unavailable && <ArrowUpRight size={12} className="text-primary" />}
            <span className="truncate">{detail}</span>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function SectionTitle({ title, description, action }: { title: string; description?: string; action?: ReactNode }) {
  return (
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div className="min-w-0">
        <h3 className="text-sm font-semibold text-foreground">{title}</h3>
        {description && <p className="mt-1 text-xs leading-5 text-muted-foreground">{description}</p>}
      </div>
      {action && <div className="shrink-0">{action}</div>}
    </div>
  );
}

function ConversationRow({ conversation }: { conversation: RecentConversation }) {
  const initials = conversation.name
    .split(" ")
    .map((part) => part[0])
    .join("")
    .slice(0, 2)
    .toUpperCase() || "WA";

  return (
    <div className="flex items-start gap-3 rounded-lg px-3 py-3 transition-colors hover:bg-secondary/45 sm:items-center">
      <div className="flex size-9 shrink-0 items-center justify-center rounded-lg border border-border/80 bg-secondary text-xs font-semibold text-foreground">
        {initials}
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex min-w-0 flex-col gap-1 sm:flex-row sm:items-center sm:gap-2">
          <span className="truncate text-sm font-medium text-foreground">{conversation.name || "Unknown contact"}</span>
          {conversation.phone && <span className="truncate text-xs text-muted-foreground">{conversation.phone}</span>}
        </div>
        <p className="mt-0.5 truncate text-xs text-muted-foreground">{conversation.preview || "No messages yet"}</p>
      </div>
      <div className="flex shrink-0 flex-col items-end gap-1.5">
        <Badge variant="outline" className={`capitalize ${statusColor[conversation.status] || statusColor.open}`}>
          {conversation.status}
        </Badge>
        <span className="text-[11px] text-muted-foreground">{conversation.time}</span>
      </div>
    </div>
  );
}

export function DashboardView({ userName }: DashboardViewProps) {
  const [summary, setSummary] = useState<DashboardSummary>(demoDashboard);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;
    setLoading(true);
    getDashboardSummary<DashboardSummary>()
      .then((response) => {
        if (active) setSummary({ ...demoDashboard, ...response });
      })
      .catch(() => {
        if (active) setSummary(demoDashboard);
      })
      .finally(() => {
        if (active) setLoading(false);
      });

    return () => {
      active = false;
    };
  }, []);

  const openConversationKpi = kpiByLabel(summary.kpis || [], ["open conversation"]);
  const leadKpi = kpiByLabel(summary.kpis || [], ["total lead", "new contact", "lead"]);
  const responseKpi = kpiByLabel(summary.kpis || [], ["response"]);
  const conversionKpi = kpiByLabel(summary.kpis || [], ["conversion", "resolution rate"]);
  const inboundMessages = sumVolume(summary, "inbound");
  const outboundMessages = sumVolume(summary, "outbound");
  const hotLeads = useMemo(
    () => (summary.recentConversations || []).filter((conversation) => ["open", "waiting", "pending"].includes(conversation.status)).slice(0, 4),
    [summary.recentConversations],
  );
  const recentActivity = useMemo(() => {
    const items = [
      {
        title: `${inboundMessages.toLocaleString()} inbound messages tracked`,
        detail: "From existing message volume data",
        icon: <MessageCircle size={15} />,
      },
      {
        title: `${outboundMessages.toLocaleString()} outbound messages sent`,
        detail: "Includes team replies and business sends",
        icon: <Megaphone size={15} />,
      },
      {
        title: `${(summary.teamWorkload || []).reduce((total, member) => total + numericValue(member.resolvedToday), 0)} conversations resolved today`,
        detail: "Based on visible team workload",
        icon: <CheckCircle2 size={15} />,
      },
    ];
    return items.filter((item) => !item.title.startsWith("0 ") || item.title.includes("resolved"));
  }, [inboundMessages, outboundMessages, summary.teamWorkload]);

  const kpiCards = [
    {
      label: "Total Leads",
      value: leadKpi?.value ?? "0",
      detail: leadKpi ? `${leadKpi.label} ${leadKpi.delta || ""}`.trim() : "Lead count not available yet",
      icon: <Users size={18} />,
      tone: "info" as const,
      unavailable: !leadKpi,
    },
    {
      label: "Open Conversations",
      value: openConversationKpi?.value ?? "0",
      detail: openConversationKpi?.delta || "Live inbox workload",
      icon: <MessageCircle size={18} />,
      tone: "primary" as const,
    },
    {
      label: "Unread Messages",
      value: inboundMessages.toLocaleString(),
      detail: "Inbound volume from summary",
      icon: <Radio size={18} />,
      tone: inboundMessages > 0 ? ("warning" as const) : ("muted" as const),
    },
    {
      label: "Campaign Sent",
      value: "—",
      detail: "Not included in dashboard summary",
      icon: <Megaphone size={18} />,
      tone: "muted" as const,
      unavailable: true,
    },
    {
      label: "Automation Runs",
      value: "—",
      detail: "Not included in dashboard summary",
      icon: <Workflow size={18} />,
      tone: "muted" as const,
      unavailable: true,
    },
    {
      label: "Conversion Rate",
      value: conversionKpi?.value ?? "0%",
      detail: conversionKpi?.delta || conversionKpi?.label || "Resolution/conversion signal",
      icon: <Target size={18} />,
      tone: "primary" as const,
    },
  ];

  return (
    <div className="w-full min-w-0 flex-1 overflow-x-hidden overflow-y-auto p-3 sm:p-4 lg:p-6">
      <div className="mx-auto flex w-full max-w-[1500px] flex-col gap-4 lg:gap-5">
        <div className="overflow-hidden rounded-xl border border-border/80 bg-card/70 shadow-2xl shadow-black/20">
          <div className="relative p-4 sm:p-5">
            <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_18%_0%,rgba(37,211,102,0.12),transparent_24rem),radial-gradient(circle_at_88%_10%,rgba(79,140,255,0.1),transparent_22rem)]" />
            <div className="relative flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
              <div className="min-w-0">
                <Badge variant="success" className="mb-3">
                  <Sparkles size={12} />
                  CEO overview
                </Badge>
                <h1 className="text-2xl font-semibold leading-tight text-foreground sm:text-3xl">Good morning, {firstName(userName)}</h1>
                <p className="mt-1 max-w-2xl text-sm leading-6 text-muted-foreground">
                  A live CRM snapshot of conversations, leads, campaigns, automation, and WhatsApp health.
                </p>
              </div>
              <div className="grid grid-cols-2 gap-2 sm:flex sm:flex-wrap sm:justify-end">
                <Badge variant={summary.health?.whatsapp === "connected" ? "success" : "warning"} className="justify-center px-3 py-1.5">
                  <span className="size-1.5 rounded-full bg-current" />
                  WhatsApp {summary.health?.whatsapp || "unknown"}
                </Badge>
                <Badge variant="outline" className="justify-center px-3 py-1.5">
                  {summary.health?.onlineAgents || 0} agents online
                </Badge>
              </div>
            </div>
          </div>
        </div>

        {loading ? (
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-6">
            {Array.from({ length: 6 }).map((_, index) => (
              <Card key={index} className="xl:col-span-1">
                <CardContent className="p-4">
                  <LoadingSkeleton rows={2} showHeader={false} />
                </CardContent>
              </Card>
            ))}
          </div>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-6">
            {kpiCards.map((kpi) => (
              <MetricCard key={kpi.label} {...kpi} />
            ))}
          </div>
        )}

        <div className="grid gap-4 xl:grid-cols-[1.65fr_1fr]">
          <Card className="overflow-hidden">
            <CardHeader className="px-4 pt-4">
              <SectionTitle
                title="Message Volume"
                description="Inbound and outbound WhatsApp activity from the current summary"
                action={<Badge variant="outline">Last 7 days</Badge>}
              />
            </CardHeader>
            <CardContent className="overflow-x-auto px-4 pb-4">
              {loading ? (
                <LoadingSkeleton rows={4} />
              ) : summary.messageVolume?.length ? (
                <div className="min-w-[300px]">
                <ResponsiveContainer width="100%" height={250}>
                  <AreaChart data={summary.messageVolume} margin={{ top: 8, right: 8, left: -20, bottom: 0 }}>
                    <defs>
                      <linearGradient id="dashboardInbound" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor="#25D366" stopOpacity={0.28} />
                        <stop offset="95%" stopColor="#25D366" stopOpacity={0} />
                      </linearGradient>
                      <linearGradient id="dashboardOutbound" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor="#4f8cff" stopOpacity={0.22} />
                        <stop offset="95%" stopColor="#4f8cff" stopOpacity={0} />
                      </linearGradient>
                    </defs>
                    <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                    <XAxis dataKey="day" tick={{ fill: "hsl(var(--muted-foreground))", fontSize: 11 }} axisLine={false} tickLine={false} />
                    <YAxis tick={{ fill: "hsl(var(--muted-foreground))", fontSize: 11 }} axisLine={false} tickLine={false} />
                    <Tooltip contentStyle={chartTooltip} />
                    <Area type="monotone" dataKey="inbound" stroke="#25D366" strokeWidth={2} fill="url(#dashboardInbound)" />
                    <Area type="monotone" dataKey="outbound" stroke="#4f8cff" strokeWidth={2} fill="url(#dashboardOutbound)" />
                  </AreaChart>
                </ResponsiveContainer>
                </div>
              ) : (
                <EmptyState icon={<BarChart3 size={18} />} title="No message activity yet" description="Inbound and outbound volume will appear here once WhatsApp messages start syncing." />
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="px-4 pt-4">
              <SectionTitle title="WhatsApp & System Health" description="Operational signals for today" />
            </CardHeader>
            <CardContent className="space-y-3 px-4 pb-4">
              <div className="flex items-start gap-3 rounded-lg border border-primary/20 bg-primary/10 p-3">
                <CheckCircle2 size={17} className="mt-0.5 shrink-0 text-primary" />
                <div className="min-w-0">
                  <p className="text-sm font-medium text-foreground">WhatsApp API {summary.health?.whatsapp || "unknown"}</p>
                  <p className="text-xs leading-5 text-muted-foreground">Connection status from dashboard health.</p>
                </div>
              </div>
              <div className="flex items-start gap-3 rounded-lg border border-border/80 bg-surface-subtle/70 p-3">
                <Activity size={17} className="mt-0.5 shrink-0 text-info" />
                <div className="min-w-0">
                  <p className="text-sm font-medium text-foreground">{summary.health?.onlineAgents || 0} agents online</p>
                  <p className="text-xs leading-5 text-muted-foreground">Available operators visible to this workspace.</p>
                </div>
              </div>
              <div className={`flex items-start gap-3 rounded-lg border p-3 ${summary.health?.slaWarnings ? "border-warning/25 bg-warning/10" : "border-border/80 bg-surface-subtle/70"}`}>
                <AlertCircle size={17} className={`mt-0.5 shrink-0 ${summary.health?.slaWarnings ? "text-warning" : "text-muted-foreground"}`} />
                <div className="min-w-0">
                  <p className="text-sm font-medium text-foreground">{summary.health?.slaWarnings || 0} conversations waiting</p>
                  <p className="text-xs leading-5 text-muted-foreground">Pending conversations that may need attention.</p>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>

        <div className="grid gap-4 xl:grid-cols-3">
          <Card className="xl:col-span-1">
            <CardHeader className="px-4 pt-4">
              <SectionTitle title="Recent Activity" description="Derived from current message and team summary" />
            </CardHeader>
            <CardContent className="px-4 pb-4">
              {loading ? (
                <LoadingSkeleton rows={3} showHeader={false} />
              ) : recentActivity.length ? (
                <div className="space-y-2">
                  {recentActivity.map((item) => (
                    <div key={item.title} className="flex gap-3 rounded-lg border border-border/70 bg-surface-subtle/60 p-3">
                      <div className="flex size-8 shrink-0 items-center justify-center rounded-md bg-primary/10 text-primary">{item.icon}</div>
                      <div className="min-w-0">
                        <p className="truncate text-sm font-medium text-foreground">{item.title}</p>
                        <p className="text-xs leading-5 text-muted-foreground">{item.detail}</p>
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <EmptyState icon={<Clock3 size={18} />} title="No recent activity" description="Activity appears after messages, assignments, or resolutions are recorded." />
              )}
            </CardContent>
          </Card>

          <Card className="xl:col-span-1">
            <CardHeader className="px-4 pt-4">
              <SectionTitle title="Hot Leads" description="Open or waiting recent conversations" action={<Badge variant="warning">{hotLeads.length} active</Badge>} />
            </CardHeader>
            <CardContent className="px-4 pb-4">
              {loading ? (
                <LoadingSkeleton rows={4} showHeader={false} />
              ) : hotLeads.length ? (
                <div className="space-y-1">
                  {hotLeads.map((conversation) => (
                    <ConversationRow key={`${conversation.phone}-${conversation.time}`} conversation={conversation} />
                  ))}
                </div>
              ) : (
                <EmptyState icon={<Flame size={18} />} title="No hot leads right now" description="Open and waiting conversations will be highlighted here." />
              )}
            </CardContent>
          </Card>

          <Card className="xl:col-span-1">
            <CardHeader className="px-4 pt-4">
              <SectionTitle title="Team Monitoring" description="Live assigned workload" />
            </CardHeader>
            <CardContent className="px-4 pb-4">
              {loading ? (
                <LoadingSkeleton rows={4} showHeader={false} />
              ) : summary.teamWorkload?.length ? (
                <div className="space-y-2">
                  {summary.teamWorkload.slice(0, 5).map((member) => (
                    <div key={member.userId} className="grid grid-cols-[1fr_auto] gap-3 rounded-lg border border-border/70 bg-surface-subtle/60 p-3">
                      <div className="min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="truncate text-sm font-medium text-foreground">{member.name}</span>
                          <Badge variant="outline" className="capitalize">{member.role}</Badge>
                        </div>
                        <p className="text-xs text-muted-foreground">Last active {member.lastActive}</p>
                      </div>
                      <div className="text-right text-xs">
                        <div className="font-semibold text-foreground">{member.open} open</div>
                        <div className="text-muted-foreground">{member.resolvedToday} resolved</div>
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <EmptyState icon={<Users size={18} />} title="No team workload available" description="Team monitoring appears for roles with workspace reporting access." />
              )}
            </CardContent>
          </Card>
        </div>

        <Card>
          <CardHeader className="px-4 pt-4">
            <SectionTitle
              title="Recent Conversations"
              description="Latest customer conversations visible to your role"
              action={<Badge variant="outline">{summary.recentConversations?.length || 0} shown</Badge>}
            />
          </CardHeader>
          <CardContent className="px-4 pb-4">
            {loading ? (
              <LoadingSkeleton rows={5} showHeader={false} />
            ) : summary.recentConversations?.length ? (
              <div className="divide-y divide-border/70">
                {summary.recentConversations.map((conversation) => (
                  <ConversationRow key={`${conversation.phone}-${conversation.time}-${conversation.preview}`} conversation={conversation} />
                ))}
              </div>
            ) : (
              <EmptyState icon={<MessageCircle size={18} />} title="No recent conversations" description="Customer conversations will appear here after the inbox receives messages." />
            )}
          </CardContent>
        </Card>

        <div className="grid gap-4 xl:grid-cols-3">
          <Card className="xl:col-span-2">
            <CardHeader className="px-4 pt-4">
              <SectionTitle title="Agent Performance" description="Resolved conversations from visible team workload" />
            </CardHeader>
            <CardContent className="px-4 pb-4">
              {summary.agentPerformance?.length ? (
                <ResponsiveContainer width="100%" height={190}>
                  <BarChart data={summary.agentPerformance} layout="vertical" margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" horizontal={false} />
                    <XAxis type="number" tick={{ fill: "hsl(var(--muted-foreground))", fontSize: 11 }} axisLine={false} tickLine={false} />
                    <YAxis dataKey="name" type="category" tick={{ fill: "hsl(var(--muted-foreground))", fontSize: 11 }} axisLine={false} tickLine={false} width={80} />
                    <Tooltip contentStyle={chartTooltip} />
                    <Bar dataKey="resolved" fill="#25D366" radius={[0, 5, 5, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              ) : (
                <EmptyState icon={<TrendingUp size={18} />} title="No performance data yet" description="Resolved conversation metrics will appear as your team works through the inbox." />
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="px-4 pt-4">
              <CardTitle className="flex items-center gap-2 text-sm font-semibold">
                <BarChart3 size={16} />
                Executive Signals
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3 px-4 pb-4 text-sm">
              <div className="flex items-center justify-between gap-3">
                <span className="text-muted-foreground">Avg response</span>
                <span className="font-medium text-foreground">{responseKpi?.value || "—"}</span>
              </div>
              <div className="flex items-center justify-between gap-3">
                <span className="text-muted-foreground">Outbound messages</span>
                <span className="font-medium text-foreground">{outboundMessages.toLocaleString()}</span>
              </div>
              <div className="flex items-center justify-between gap-3">
                <span className="text-muted-foreground">Open assigned</span>
                <span className="font-medium text-foreground">{(summary.teamWorkload || []).reduce((total, member) => total + numericValue(member.open), 0)}</span>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
