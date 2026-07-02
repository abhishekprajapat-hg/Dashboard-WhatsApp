import { useEffect, useMemo, useState, type ReactNode } from "react";
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Line,
  LineChart,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import {
  Activity,
  BarChart3,
  Clock3,
  Download,
  FileSpreadsheet,
  Filter,
  Flame,
  MessageCircle,
  ReceiptText,
  Send,
  Target,
  Users,
  Zap,
} from "lucide-react";
import { Badge } from "./ui/badge";
import { Button } from "./ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "./ui/card";
import { getAnalyticsExportUrl, getAnalyticsSummary, getStoredToken } from "../lib/api";

interface EnterpriseAnalytics {
  kpis: { label: string; value: string; delta: string; up: boolean }[];
  metrics: {
    totalContacts: number;
    newLeads: number;
    openConversations: number;
    unreadMessages: number;
    responseTimeMinutes: number;
    responseTimeLabel: string;
    leadConversionRate: number;
    campaign: { sent: number; delivered: number; read: number; failed: number };
    automationRuns: number;
  };
  filters: {
    from: string;
    to: string;
    memberId: string;
    teamMembers: { id: string; name: string; role: string }[];
  };
  messageVolume: { date: string; inbound: number; outbound: number; resolved: number }[];
  agentPerformance: { name: string; role: string; resolved: number; assigned: number; avg: number; csat: number }[];
  sourceBreakdown: { name: string; value: number; color: string }[];
  campaignPerformance: {
    id: string;
    name: string;
    template: string;
    status: string;
    sent: number;
    delivered: number;
    read: number;
    replies: number;
    clicks: number;
    conversions: number;
    failed: number;
    deliveryRate: number;
    readRate: number;
    conversionRate: number;
  }[];
  automationPerformance: { id: string; name: string; status: string; trigger: string; runs: number; conversionRate: number; nodes: number }[];
  templatePerformance: { id: string; name: string; category: string; language: string; status: string; sent: number; delivered: number; read: number; failed: number; readRate: number }[];
  deliveryFailures: { id: string; contact: string; phone: string; body: string; error: string; time: string }[];
  webhookHealth: { processed: number; failed: number; failureRate: number };
  leadAnalytics: { byStage: { stage: string; count: number }[]; bySource: { source: string; count: number }[]; conversions: number; revenue: number };
  conversion: { rate: number; wonLeads: number; openLeads: number };
  revenue: { total: number; pipeline: number; won: number };
  responseTime: { averageMinutes: number; label: string; trend: { date: string; minutes: number }[] };
  resolutionTime: { averageMinutes: number; label: string; resolved: number };
  peakHours: { hour: number; label: string; messages: number }[];
  heatMap: { day: number; hour: number; value: number }[];
  realtimeCharts: { refreshedAt: string; lastHour: { time: string; direction: string; status: string }[] };
  customReports: { id: string; name: string; metrics: string[] }[];
  roleBasedAnalytics: { scope: string; canViewTeam: boolean; permissions?: string[] };
}

const emptyAnalytics: EnterpriseAnalytics = {
  kpis: [],
  metrics: {
    totalContacts: 0,
    newLeads: 0,
    openConversations: 0,
    unreadMessages: 0,
    responseTimeMinutes: 0,
    responseTimeLabel: "0m",
    leadConversionRate: 0,
    campaign: { sent: 0, delivered: 0, read: 0, failed: 0 },
    automationRuns: 0,
  },
  filters: { from: "", to: "", memberId: "all", teamMembers: [] },
  messageVolume: [],
  agentPerformance: [],
  sourceBreakdown: [],
  campaignPerformance: [],
  automationPerformance: [],
  templatePerformance: [],
  deliveryFailures: [],
  webhookHealth: { processed: 0, failed: 0, failureRate: 0 },
  leadAnalytics: { byStage: [], bySource: [], conversions: 0, revenue: 0 },
  conversion: { rate: 0, wonLeads: 0, openLeads: 0 },
  revenue: { total: 0, pipeline: 0, won: 0 },
  responseTime: { averageMinutes: 0, label: "0m", trend: [] },
  resolutionTime: { averageMinutes: 0, label: "0m", resolved: 0 },
  peakHours: [],
  heatMap: [],
  realtimeCharts: { refreshedAt: new Date().toISOString(), lastHour: [] },
  customReports: [],
  roleBasedAnalytics: { scope: "workspace", canViewTeam: false },
};

const chartTooltip = {
  background: "hsl(var(--card))",
  border: "1px solid hsl(var(--border))",
  borderRadius: 8,
  fontSize: 12,
};

const dayNames: Record<number, string> = {
  1: "Sun",
  2: "Mon",
  3: "Tue",
  4: "Wed",
  5: "Thu",
  6: "Fri",
  7: "Sat",
};

function money(value: number) {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(Number(value || 0));
}

function num(value: number) {
  return Number(value || 0).toLocaleString();
}

function isoDate(offsetDays = 0) {
  const date = new Date();
  date.setDate(date.getDate() + offsetDays);
  return date.toISOString().slice(0, 10);
}

function downloadFromUrl(url: string) {
  const token = getStoredToken();
  fetch(url, { headers: token ? { Authorization: `Bearer ${token}` } : {} })
    .then((response) => response.blob())
    .then((blob) => {
      const link = document.createElement("a");
      link.href = URL.createObjectURL(blob);
      link.download = url.includes("/pdf") ? "enterprise-analytics.pdf" : "enterprise-analytics.csv";
      link.click();
      URL.revokeObjectURL(link.href);
    })
    .catch(() => undefined);
}

function KpiCard({ item, icon }: { item: { label: string; value: string; delta: string; up: boolean }; icon: ReactNode }) {
  return (
    <Card className="rounded-lg border-border/70">
      <CardContent className="flex items-center justify-between gap-3 p-4">
        <div className="min-w-0">
          <div className="truncate text-xs text-muted-foreground">{item.label}</div>
          <div className="mt-1 text-2xl font-semibold tracking-normal">{item.value}</div>
          <Badge variant="outline" className="mt-2 text-[10px]">
            {item.delta}
          </Badge>
        </div>
        <div className="flex size-11 items-center justify-center rounded-md bg-primary/10 text-primary">{icon}</div>
      </CardContent>
    </Card>
  );
}

function MiniMetric({ label, value, danger = false }: { label: string; value: string; danger?: boolean }) {
  return (
    <div className="rounded-md border border-border bg-card px-3 py-2">
      <div className="text-[11px] text-muted-foreground">{label}</div>
      <div className={`mt-1 text-lg font-semibold ${danger ? "text-destructive" : "text-foreground"}`}>{value}</div>
    </div>
  );
}

function HeatMap({ data }: { data: { day: number; hour: number; value: number }[] }) {
  const max = Math.max(1, ...data.map((item) => item.value));
  const valueFor = (day: number, hour: number) => data.find((item) => item.day === day && item.hour === hour)?.value || 0;

  return (
    <div className="overflow-x-auto">
      <div className="min-w-[760px] space-y-1">
        <div className="grid grid-cols-[44px_repeat(24,1fr)] gap-1 text-[10px] text-muted-foreground">
          <span />
          {Array.from({ length: 24 }, (_, hour) => (
            <span key={hour} className="text-center">{hour}</span>
          ))}
        </div>
        {[1, 2, 3, 4, 5, 6, 7].map((day) => (
          <div key={day} className="grid grid-cols-[44px_repeat(24,1fr)] gap-1">
            <span className="flex items-center text-[10px] text-muted-foreground">{dayNames[day]}</span>
            {Array.from({ length: 24 }, (_, hour) => {
              const value = valueFor(day, hour);
              const opacity = Math.max(0.08, value / max);
              return (
                <div
                  key={`${day}-${hour}`}
                  title={`${dayNames[day]} ${hour}:00 - ${value} messages`}
                  className="h-5 rounded-sm border border-border"
                  style={{ backgroundColor: `rgba(37, 211, 102, ${opacity})` }}
                />
              );
            })}
          </div>
        ))}
      </div>
    </div>
  );
}

export function AnalyticsView() {
  const [days, setDays] = useState(30);
  const [fromDate, setFromDate] = useState(() => isoDate(-30));
  const [toDate, setToDate] = useState(() => isoDate(0));
  const [memberId, setMemberId] = useState("all");
  const [analytics, setAnalytics] = useState<EnterpriseAnalytics>(emptyAnalytics);
  const [loading, setLoading] = useState(true);
  const [report, setReport] = useState("executive");
  const query = useMemo(() => ({ days, from: fromDate, to: toDate, memberId }), [days, fromDate, toDate, memberId]);

  useEffect(() => {
    setLoading(true);
    getAnalyticsSummary<EnterpriseAnalytics>(query)
      .then(setAnalytics)
      .catch(() => setAnalytics(emptyAnalytics))
      .finally(() => setLoading(false));
  }, [query]);

  useEffect(() => {
    const timer = window.setInterval(() => {
      getAnalyticsSummary<EnterpriseAnalytics>(query).then(setAnalytics).catch(() => undefined);
    }, 30000);
    return () => window.clearInterval(timer);
  }, [query]);

  const kpiIcons = [<Users size={19} />, <Target size={19} />, <MessageCircle size={19} />, <Clock3 size={19} />, <BarChart3 size={19} />, <Send size={19} />, <Zap size={19} />, <Activity size={19} />];
  const sourceTotal = analytics.sourceBreakdown.reduce((sum, item) => sum + item.value, 0);
  const peakHour = useMemo(() => [...analytics.peakHours].sort((a, b) => b.messages - a.messages)[0], [analytics.peakHours]);
  const selectedReport = analytics.customReports.find((item) => item.id === report) || analytics.customReports[0];

  return (
    <div className="min-h-0 flex-1 overflow-auto bg-muted/20">
      <div className="mx-auto flex w-full max-w-[1500px] flex-col gap-4 p-3 md:p-5">
        <div className="flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
          <div>
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <BarChart3 size={14} />
              <span>Enterprise analytics</span>
              <Badge variant="outline" className="capitalize">{analytics.roleBasedAnalytics.scope.replace("_", " ")}</Badge>
            </div>
            <h1 className="mt-1 text-2xl font-semibold tracking-normal">Analytics Command Center</h1>
            <p className="text-sm text-muted-foreground">Messages, customers, agents, revenue, campaigns, leads, automations, templates, heat maps, and role-based reporting.</p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {[7, 14, 30, 90].map((period) => (
              <button
                key={period}
                onClick={() => {
                  setDays(period);
                  setFromDate(isoDate(-period));
                  setToDate(isoDate(0));
                }}
                className={`h-8 rounded-md border px-3 text-xs transition-colors ${days === period ? "border-primary bg-primary text-primary-foreground" : "border-border bg-card text-muted-foreground hover:text-foreground"}`}
              >
                {period}d
              </button>
            ))}
            <input type="date" value={fromDate} onChange={(event) => setFromDate(event.target.value)} className="h-8 rounded-md border border-border bg-card px-2 text-xs text-foreground" />
            <input type="date" value={toDate} onChange={(event) => setToDate(event.target.value)} className="h-8 rounded-md border border-border bg-card px-2 text-xs text-foreground" />
            <select value={memberId} onChange={(event) => setMemberId(event.target.value)} className="h-8 rounded-md border border-border bg-card px-2 text-xs text-foreground">
              <option value="all">All team</option>
              {analytics.filters.teamMembers.map((member) => <option key={member.id} value={member.id}>{member.name}</option>)}
            </select>
            <Button variant="outline" size="sm" onClick={() => downloadFromUrl(getAnalyticsExportUrl("pdf", query))}>
              <Download size={15} />
              PDF
            </Button>
            <Button variant="outline" size="sm" onClick={() => downloadFromUrl(getAnalyticsExportUrl("excel", query))}>
              <FileSpreadsheet size={15} />
              Excel
            </Button>
          </div>
        </div>

        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          {(analytics.kpis.length ? analytics.kpis : emptyAnalytics.kpis).map((kpi, index) => (
            <KpiCard key={kpi.label} item={kpi} icon={kpiIcons[index] || <Activity size={19} />} />
          ))}
        </div>

        <Card className="rounded-lg border-border/70">
          <CardContent className="grid gap-3 p-4 md:grid-cols-4">
            <MiniMetric label="Campaign delivered/read" value={`${num(analytics.metrics.campaign.delivered)} / ${num(analytics.metrics.campaign.read)}`} />
            <MiniMetric label="Campaign failed" value={num(analytics.metrics.campaign.failed)} danger={analytics.metrics.campaign.failed > 0} />
            <MiniMetric label="Unread messages" value={num(analytics.metrics.unreadMessages)} />
            <MiniMetric label="Automation runs" value={num(analytics.metrics.automationRuns)} />
          </CardContent>
        </Card>

        <div className="grid gap-4 xl:grid-cols-[1.7fr_1fr]">
          <Card className="rounded-lg border-border/70">
            <CardHeader className="flex-row items-center justify-between px-4 pt-4">
              <div>
                <CardTitle className="text-sm font-semibold">Real-time Message Charts</CardTitle>
                <p className="text-xs text-muted-foreground">Inbound, outbound, and resolved conversations</p>
              </div>
              <Badge variant="outline">{loading ? "Syncing" : "Live"}</Badge>
            </CardHeader>
            <CardContent className="px-4 pb-4">
              <ResponsiveContainer width="100%" height={270}>
                <AreaChart data={analytics.messageVolume} margin={{ top: 8, right: 8, left: -20, bottom: 0 }}>
                  <defs>
                    <linearGradient id="analyticsInbound" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#25D366" stopOpacity={0.25} />
                      <stop offset="95%" stopColor="#25D366" stopOpacity={0} />
                    </linearGradient>
                    <linearGradient id="analyticsOutbound" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#3b82f6" stopOpacity={0.2} />
                      <stop offset="95%" stopColor="#3b82f6" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                  <XAxis dataKey="date" tick={{ fill: "hsl(var(--muted-foreground))", fontSize: 11 }} axisLine={false} tickLine={false} />
                  <YAxis tick={{ fill: "hsl(var(--muted-foreground))", fontSize: 11 }} axisLine={false} tickLine={false} />
                  <Tooltip contentStyle={chartTooltip} />
                  <Area type="monotone" dataKey="inbound" stroke="#25D366" strokeWidth={2} fill="url(#analyticsInbound)" />
                  <Area type="monotone" dataKey="outbound" stroke="#3b82f6" strokeWidth={2} fill="url(#analyticsOutbound)" />
                  <Line type="monotone" dataKey="resolved" stroke="#f59e0b" strokeWidth={2} dot={false} />
                </AreaChart>
              </ResponsiveContainer>
            </CardContent>
          </Card>

          <Card className="rounded-lg border-border/70">
            <CardHeader className="px-4 pt-4">
              <CardTitle className="text-sm font-semibold">Customers and Lead Sources</CardTitle>
              <p className="text-xs text-muted-foreground">{num(sourceTotal)} sourced customers</p>
            </CardHeader>
            <CardContent className="px-4 pb-4">
              <ResponsiveContainer width="100%" height={180}>
                <PieChart>
                  <Pie data={analytics.sourceBreakdown} cx="50%" cy="50%" innerRadius={48} outerRadius={78} paddingAngle={3} dataKey="value">
                    {analytics.sourceBreakdown.map((entry) => <Cell key={entry.name} fill={entry.color} />)}
                  </Pie>
                  <Tooltip contentStyle={chartTooltip} />
                </PieChart>
              </ResponsiveContainer>
              <div className="space-y-1.5">
                {analytics.sourceBreakdown.map((source) => (
                  <div key={source.name} className="flex items-center justify-between text-xs">
                    <span className="flex items-center gap-2 text-muted-foreground"><span className="size-2 rounded-full" style={{ background: source.color }} />{source.name}</span>
                    <span className="font-medium text-foreground">{source.value}</span>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        </div>

        <div className="grid gap-4 xl:grid-cols-3">
          <Card className="rounded-lg border-border/70">
            <CardHeader className="px-4 pt-4">
              <CardTitle className="flex items-center gap-2 text-sm font-semibold"><Clock3 size={16} /> Response and Resolution Time</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4 px-4 pb-4">
              <div className="grid grid-cols-2 gap-3">
                <div className="rounded-md border border-border p-3">
                  <div className="text-xs text-muted-foreground">Avg response</div>
                  <div className="mt-1 text-xl font-semibold">{analytics.responseTime.label}</div>
                </div>
                <div className="rounded-md border border-border p-3">
                  <div className="text-xs text-muted-foreground">Avg resolution</div>
                  <div className="mt-1 text-xl font-semibold">{analytics.resolutionTime.label}</div>
                </div>
              </div>
              <ResponsiveContainer width="100%" height={130}>
                <LineChart data={analytics.responseTime.trend}>
                  <XAxis dataKey="date" hide />
                  <YAxis hide />
                  <Tooltip contentStyle={chartTooltip} />
                  <Line type="monotone" dataKey="minutes" stroke="#25D366" strokeWidth={2} dot={false} />
                </LineChart>
              </ResponsiveContainer>
            </CardContent>
          </Card>

          <Card className="rounded-lg border-border/70">
            <CardHeader className="px-4 pt-4">
              <CardTitle className="flex items-center gap-2 text-sm font-semibold"><ReceiptText size={16} /> Revenue and Conversion</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3 px-4 pb-4">
              <div className="flex items-center justify-between">
                <span className="text-sm text-muted-foreground">Won revenue</span>
                <span className="text-xl font-semibold">{money(analytics.revenue.won)}</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-sm text-muted-foreground">Pipeline</span>
                <span className="font-medium">{money(analytics.revenue.pipeline)}</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-sm text-muted-foreground">Conversion rate</span>
                <Badge>{analytics.conversion.rate}%</Badge>
              </div>
              <div className="h-2 overflow-hidden rounded-full bg-muted">
                <div className="h-full bg-primary" style={{ width: `${Math.min(100, analytics.conversion.rate)}%` }} />
              </div>
            </CardContent>
          </Card>

          <Card className="rounded-lg border-border/70">
            <CardHeader className="px-4 pt-4">
              <CardTitle className="flex items-center gap-2 text-sm font-semibold"><Flame size={16} /> Peak Hours</CardTitle>
              <p className="text-xs text-muted-foreground">Peak: {peakHour?.label || "00:00"} with {num(peakHour?.messages || 0)} messages</p>
            </CardHeader>
            <CardContent className="px-4 pb-4">
              <ResponsiveContainer width="100%" height={160}>
                <BarChart data={analytics.peakHours}>
                  <XAxis dataKey="hour" tick={{ fill: "hsl(var(--muted-foreground))", fontSize: 10 }} axisLine={false} tickLine={false} interval={2} />
                  <YAxis hide />
                  <Tooltip contentStyle={chartTooltip} />
                  <Bar dataKey="messages" fill="#25D366" radius={[3, 3, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </CardContent>
          </Card>
        </div>

        <Card className="rounded-lg border-border/70">
          <CardHeader className="flex-row items-center justify-between px-4 pt-4">
            <div>
              <CardTitle className="flex items-center gap-2 text-sm font-semibold"><Activity size={16} /> Heat Map</CardTitle>
              <p className="text-xs text-muted-foreground">Message intensity by weekday and hour</p>
            </div>
            <Badge variant="outline">UTC server time</Badge>
          </CardHeader>
          <CardContent className="px-4 pb-4">
            <HeatMap data={analytics.heatMap} />
          </CardContent>
        </Card>

        <div className="grid gap-4 xl:grid-cols-2">
          <Card className="rounded-lg border-border/70">
            <CardHeader className="px-4 pt-4">
              <CardTitle className="text-sm font-semibold">Campaign Analytics</CardTitle>
            </CardHeader>
            <CardContent className="overflow-x-auto px-4 pb-4">
              <table className="w-full min-w-[720px] text-left text-xs">
                <thead className="border-b border-border text-muted-foreground">
                  <tr>
                    {["Campaign", "Sent", "Delivered", "Read", "Replies", "Clicks", "Conversions", "Failed"].map((column) => <th key={column} className="py-2 font-medium">{column}</th>)}
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {analytics.campaignPerformance.map((campaign) => (
                    <tr key={campaign.id}>
                      <td className="max-w-44 truncate py-2 text-foreground">{campaign.name}</td>
                      <td>{campaign.sent}</td>
                      <td>{campaign.delivered}</td>
                      <td>{campaign.read}</td>
                      <td>{campaign.replies}</td>
                      <td>{campaign.clicks}</td>
                      <td>{campaign.conversions}</td>
                      <td className="text-destructive">{campaign.failed}</td>
                    </tr>
                  ))}
                  {!analytics.campaignPerformance.length && <tr><td className="py-3 text-muted-foreground" colSpan={8}>No campaign activity in this range.</td></tr>}
                </tbody>
              </table>
            </CardContent>
          </Card>

          <Card className="rounded-lg border-border/70">
            <CardHeader className="px-4 pt-4">
              <CardTitle className="text-sm font-semibold">Lead Analytics</CardTitle>
            </CardHeader>
            <CardContent className="grid gap-4 px-4 pb-4 md:grid-cols-2">
              <div>
                <p className="mb-2 text-xs text-muted-foreground">By Stage</p>
                <div className="space-y-2">
                  {analytics.leadAnalytics.byStage.map((item) => (
                    <div key={item.stage} className="flex items-center justify-between rounded-md border border-border px-3 py-2 text-sm">
                      <span>{item.stage}</span>
                      <Badge variant="outline">{item.count}</Badge>
                    </div>
                  ))}
                  {!analytics.leadAnalytics.byStage.length && <div className="rounded-md border border-border px-3 py-2 text-sm text-muted-foreground">No leads in this range.</div>}
                </div>
              </div>
              <div>
                <p className="mb-2 text-xs text-muted-foreground">By Source</p>
                <div className="space-y-2">
                  {analytics.leadAnalytics.bySource.map((item) => (
                    <div key={item.source} className="flex items-center justify-between rounded-md border border-border px-3 py-2 text-sm">
                      <span>{item.source}</span>
                      <Badge variant="outline">{item.count}</Badge>
                    </div>
                  ))}
                  {!analytics.leadAnalytics.bySource.length && <div className="rounded-md border border-border px-3 py-2 text-sm text-muted-foreground">No lead sources in this range.</div>}
                </div>
              </div>
            </CardContent>
          </Card>
        </div>

        <div className="grid gap-4 xl:grid-cols-2">
          <Card className="rounded-lg border-border/70">
            <CardHeader className="px-4 pt-4">
              <CardTitle className="flex items-center gap-2 text-sm font-semibold"><Zap size={16} /> Automation Performance</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2 px-4 pb-4">
              {analytics.automationPerformance.map((flow) => (
                <div key={flow.id} className="flex items-center justify-between gap-3 rounded-md border border-border p-3">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium">{flow.name}</p>
                    <p className="text-xs text-muted-foreground">{flow.trigger} · {flow.nodes} nodes</p>
                  </div>
                  <div className="text-right">
                    <Badge variant="outline">{flow.runs} runs</Badge>
                    <p className="mt-1 text-xs text-muted-foreground">{flow.conversionRate}% conv</p>
                  </div>
                </div>
              ))}
              {!analytics.automationPerformance.length && <div className="rounded-md border border-border p-3 text-sm text-muted-foreground">No automation runs in this range.</div>}
            </CardContent>
          </Card>

          <Card className="rounded-lg border-border/70">
            <CardHeader className="px-4 pt-4">
              <CardTitle className="text-sm font-semibold">Template Performance</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2 px-4 pb-4">
              {analytics.templatePerformance.map((template) => (
                <div key={template.id} className="grid grid-cols-[1fr_auto] gap-3 rounded-md border border-border p-3">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium">{template.name}</p>
                    <p className="text-xs text-muted-foreground">{template.category} · {template.language} · {template.status}</p>
                  </div>
                  <div className="text-right text-xs">
                    <p>{template.sent} sent</p>
                    <p className="text-muted-foreground">{template.readRate}% read</p>
                  </div>
                </div>
              ))}
              {!analytics.templatePerformance.length && <div className="rounded-md border border-border p-3 text-sm text-muted-foreground">No template performance yet.</div>}
            </CardContent>
          </Card>
        </div>

        <div className="grid gap-4 xl:grid-cols-[1fr_1.4fr]">
          <Card className="rounded-lg border-border/70">
            <CardHeader className="px-4 pt-4">
              <CardTitle className="flex items-center gap-2 text-sm font-semibold"><Filter size={16} /> Custom Reports</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3 px-4 pb-4">
              <select value={report} onChange={(event) => setReport(event.target.value)} className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm outline-none">
                {analytics.customReports.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
              </select>
              <div className="rounded-md border border-border p-3">
                <p className="text-sm font-medium">{selectedReport?.name || "Custom Report"}</p>
                <div className="mt-2 flex flex-wrap gap-2">
                  {(selectedReport?.metrics || []).map((metric) => <Badge key={metric} variant="outline">{metric}</Badge>)}
                </div>
              </div>
              <div className="rounded-md bg-muted p-3 text-xs text-muted-foreground">
                Role based analytics: {analytics.roleBasedAnalytics.canViewTeam ? "workspace-wide visibility" : "assigned conversation scope"}.
              </div>
            </CardContent>
          </Card>

          <Card className="rounded-lg border-border/70">
            <CardHeader className="px-4 pt-4">
              <CardTitle className="text-sm font-semibold">Agent Performance</CardTitle>
            </CardHeader>
            <CardContent className="overflow-x-auto px-4 pb-4">
              <table className="w-full min-w-[620px] text-left text-xs">
                <thead className="border-b border-border text-muted-foreground">
                  <tr>
                    {["Agent", "Role", "Resolved", "Assigned", "Avg Response"].map((column) => <th key={column} className="py-2 font-medium">{column}</th>)}
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {analytics.agentPerformance.map((agent) => (
                    <tr key={agent.name}>
                      <td className="py-2 text-foreground">{agent.name}</td>
                      <td>{agent.role}</td>
                      <td>{agent.resolved}</td>
                      <td>{agent.assigned}</td>
                      <td>{agent.avg}m</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
