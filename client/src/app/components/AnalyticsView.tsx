import { useEffect, useState } from "react";
import { Card } from "./ui/card";
import { Badge } from "./ui/badge";
import {
  AreaChart, Area, BarChart, Bar, PieChart, Pie, Cell,
  XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
} from "recharts";
import { TrendingUp, TrendingDown, MessageCircle, Users, AlertCircle, CheckCircle2, Zap, Send } from "lucide-react";
import { getAnalyticsSummary } from "../lib/api";

interface AnalyticsPayload {
  kpis: { label: string; value: string; delta: string; up: boolean }[];
  messageVolume: { date: string; inbound: number; outbound: number; resolved: number }[];
  agentPerformance: { name: string; role: string; resolved: number; assigned: number; avg: number; csat: number }[];
  sourceBreakdown: { name: string; value: number; color: string }[];
  campaignPerformance: { id: string; name: string; template: string; status: string; sent: number; delivered: number; failed: number; deliveryRate: number }[];
  automationPerformance: { id: string; name: string; status: string; trigger: string; runs: number; lastRunAt: string | null }[];
  deliveryFailures: { id: string; contact: string; phone: string; body: string; error: string; time: string }[];
  webhookHealth: { processed: number; failed: number; failureRate: number };
}

const emptyAnalytics: AnalyticsPayload = {
  kpis: [
    { label: "Total messages", value: "0", delta: "+0%", up: true },
    { label: "New contacts", value: "0", delta: "+0%", up: true },
    { label: "Delivery failure rate", value: "0%", delta: "+0%", up: true },
    { label: "Resolution rate", value: "0%", delta: "+0%", up: true },
  ],
  messageVolume: [],
  agentPerformance: [],
  sourceBreakdown: [],
  campaignPerformance: [],
  automationPerformance: [],
  deliveryFailures: [],
  webhookHealth: { processed: 0, failed: 0, failureRate: 0 },
};

export function AnalyticsView() {
  const [days, setDays] = useState(14);
  const [analytics, setAnalytics] = useState<AnalyticsPayload>(emptyAnalytics);

  useEffect(() => {
    getAnalyticsSummary<AnalyticsPayload>(days)
      .then(setAnalytics)
      .catch(() => setAnalytics(emptyAnalytics));
  }, [days]);

  const icons = [<MessageCircle size={15} />, <Users size={15} />, <AlertCircle size={15} />, <CheckCircle2 size={15} />];
  const sourceTotal = analytics.sourceBreakdown.reduce((sum, item) => sum + item.value, 0);

  return (
    <div className="flex-1 overflow-y-auto p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-foreground">Analytics</h1>
          <p className="text-xs text-muted-foreground mt-0.5">Campaigns, automations, agents, and delivery health</p>
        </div>
        <div className="flex items-center gap-2">
          {[7, 14, 30, 90].map((period) => (
            <button
              key={period}
              onClick={() => setDays(period)}
              className={`text-xs px-3 py-1 rounded transition-colors ${
                days === period ? "bg-primary/20 text-primary" : "text-muted-foreground hover:text-foreground hover:bg-secondary"
              }`}
            >
              {period}d
            </button>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-2 xl:grid-cols-4 gap-3">
        {analytics.kpis.map((kpi, index) => (
          <Card key={kpi.label} className="p-4 bg-card border-border">
            <div className="flex items-center justify-between mb-2">
              <span className="text-muted-foreground">{icons[index] || <MessageCircle size={15} />}</span>
              <Badge variant="outline" className={`text-[10px] px-1.5 ${kpi.up ? "border-primary/30 bg-primary/10 text-primary" : "border-destructive/30 bg-destructive/10 text-destructive"}`}>
                {kpi.up ? <TrendingUp size={9} className="mr-0.5 inline" /> : <TrendingDown size={9} className="mr-0.5 inline" />}
                {kpi.delta}
              </Badge>
            </div>
            <div className="text-xl font-semibold text-foreground">{kpi.value}</div>
            <div className="text-[11px] text-muted-foreground mt-0.5">{kpi.label}</div>
          </Card>
        ))}
      </div>

      <Card className="p-4 bg-card border-border">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h3 className="text-sm font-medium text-foreground">Message Volume</h3>
            <p className="text-xs text-muted-foreground">Daily inbound and outbound messages</p>
          </div>
          <div className="flex items-center gap-3 text-[11px] text-muted-foreground">
            <span className="flex items-center gap-1"><span className="w-2 h-0.5 bg-primary inline-block" />Inbound</span>
            <span className="flex items-center gap-1"><span className="w-2 h-0.5 bg-chart-2 inline-block" />Outbound</span>
          </div>
        </div>
        <ResponsiveContainer width="100%" height={210}>
          <AreaChart data={analytics.messageVolume} margin={{ top: 0, right: 0, left: -20, bottom: 0 }}>
            <defs>
              <linearGradient id="analyticsIn" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor="#25D366" stopOpacity={0.2} />
                <stop offset="95%" stopColor="#25D366" stopOpacity={0} />
              </linearGradient>
              <linearGradient id="analyticsOut" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor="#128C7E" stopOpacity={0.2} />
                <stop offset="95%" stopColor="#128C7E" stopOpacity={0} />
              </linearGradient>
            </defs>
            <CartesianGrid strokeDasharray="3 3" stroke="rgba(240,246,252,0.06)" />
            <XAxis dataKey="date" tick={{ fill: "#8b949e", fontSize: 11 }} axisLine={false} tickLine={false} />
            <YAxis tick={{ fill: "#8b949e", fontSize: 11 }} axisLine={false} tickLine={false} />
            <Tooltip contentStyle={{ background: "#1c2128", border: "1px solid rgba(240,246,252,0.1)", borderRadius: 6, fontSize: 12 }} labelStyle={{ color: "#e6edf3" }} />
            <Area type="monotone" dataKey="inbound" stroke="#25D366" strokeWidth={2} fill="url(#analyticsIn)" />
            <Area type="monotone" dataKey="outbound" stroke="#128C7E" strokeWidth={2} fill="url(#analyticsOut)" />
          </AreaChart>
        </ResponsiveContainer>
      </Card>

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
        <Card className="xl:col-span-2 p-4 bg-card border-border">
          <h3 className="text-sm font-medium text-foreground mb-1">Campaign Performance</h3>
          <p className="text-xs text-muted-foreground mb-4">Latest campaigns by sent, delivered, and failed</p>
          <ResponsiveContainer width="100%" height={190}>
            <BarChart data={analytics.campaignPerformance} margin={{ top: 0, right: 0, left: -20, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="rgba(240,246,252,0.06)" vertical={false} />
              <XAxis dataKey="name" tick={{ fill: "#8b949e", fontSize: 10 }} axisLine={false} tickLine={false} />
              <YAxis tick={{ fill: "#8b949e", fontSize: 11 }} axisLine={false} tickLine={false} />
              <Tooltip contentStyle={{ background: "#1c2128", border: "1px solid rgba(240,246,252,0.1)", borderRadius: 6, fontSize: 12 }} labelStyle={{ color: "#e6edf3" }} />
              <Bar dataKey="delivered" fill="#25D366" radius={[3, 3, 0, 0]} />
              <Bar dataKey="failed" fill="#f85149" radius={[3, 3, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </Card>

        <Card className="p-4 bg-card border-border">
          <h3 className="text-sm font-medium text-foreground mb-1">Contact Source</h3>
          <p className="text-xs text-muted-foreground mb-4">{sourceTotal.toLocaleString()} contacts</p>
          <ResponsiveContainer width="100%" height={125}>
            <PieChart>
              <Pie data={analytics.sourceBreakdown} cx="50%" cy="50%" innerRadius={35} outerRadius={55} paddingAngle={3} dataKey="value">
                {analytics.sourceBreakdown.map((entry) => <Cell key={entry.name} fill={entry.color} />)}
              </Pie>
              <Tooltip contentStyle={{ background: "#1c2128", border: "1px solid rgba(240,246,252,0.1)", borderRadius: 6, fontSize: 12 }} />
            </PieChart>
          </ResponsiveContainer>
          <div className="space-y-1.5 mt-2">
            {analytics.sourceBreakdown.map((source) => (
              <div key={source.name} className="flex items-center justify-between">
                <div className="flex items-center gap-1.5">
                  <span className="w-2 h-2 rounded-full" style={{ background: source.color }} />
                  <span className="text-xs text-muted-foreground">{source.name}</span>
                </div>
                <span className="text-xs font-medium text-foreground">{source.value}</span>
              </div>
            ))}
          </div>
        </Card>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
        <Card className="bg-card border-border">
          <div className="px-4 py-3 border-b border-border flex items-center justify-between">
            <div>
              <h3 className="text-sm font-medium text-foreground">Automation Runs</h3>
              <p className="text-xs text-muted-foreground">Latest active flows and trigger volume</p>
            </div>
            <Zap size={15} className="text-muted-foreground" />
          </div>
          <div className="divide-y divide-border">
            {analytics.automationPerformance.map((flow) => (
              <div key={flow.id} className="px-4 py-3 flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-sm text-foreground truncate">{flow.name}</p>
                  <p className="text-xs text-muted-foreground">{flow.trigger}</p>
                </div>
                <Badge variant="outline" className="text-[10px] border-primary/30 bg-primary/10 text-primary">{flow.runs} runs</Badge>
              </div>
            ))}
            {analytics.automationPerformance.length === 0 && <div className="px-4 py-6 text-sm text-muted-foreground">No automation runs yet.</div>}
          </div>
        </Card>

        <Card className="bg-card border-border">
          <div className="px-4 py-3 border-b border-border flex items-center justify-between">
            <div>
              <h3 className="text-sm font-medium text-foreground">Delivery Failures</h3>
              <p className="text-xs text-muted-foreground">Recent failed outbound messages</p>
            </div>
            <Send size={15} className="text-muted-foreground" />
          </div>
          <div className="divide-y divide-border">
            {analytics.deliveryFailures.map((failure) => (
              <div key={failure.id} className="px-4 py-3">
                <div className="flex items-center justify-between gap-3">
                  <p className="text-sm text-foreground truncate">{failure.contact}</p>
                  <Badge variant="outline" className="text-[10px] border-destructive/30 bg-destructive/10 text-destructive">failed</Badge>
                </div>
                <p className="text-xs text-muted-foreground truncate">{failure.error}</p>
                <p className="text-[10px] text-muted-foreground">{failure.phone}</p>
              </div>
            ))}
            {analytics.deliveryFailures.length === 0 && <div className="px-4 py-6 text-sm text-muted-foreground">No delivery failures in this range.</div>}
          </div>
        </Card>
      </div>

      <Card className="bg-card border-border">
        <div className="px-4 py-3 border-b border-border">
          <h3 className="text-sm font-medium text-foreground">Agent Leaderboard</h3>
          <p className="text-xs text-muted-foreground">Resolved conversations and assigned workload</p>
        </div>
        <table className="w-full text-xs">
          <thead>
            <tr className="border-b border-border bg-secondary/30">
              <th className="px-4 py-2.5 text-left font-medium text-muted-foreground">Agent</th>
              <th className="px-4 py-2.5 text-left font-medium text-muted-foreground">Role</th>
              <th className="px-4 py-2.5 text-right font-medium text-muted-foreground">Resolved today</th>
              <th className="px-4 py-2.5 text-right font-medium text-muted-foreground">Assigned</th>
            </tr>
          </thead>
          <tbody>
            {analytics.agentPerformance.map((agent, index) => (
              <tr key={agent.name} className="border-b border-border hover:bg-secondary/20 transition-colors">
                <td className="px-4 py-3">
                  <div className="flex items-center gap-2.5">
                    <span className="text-[10px] text-muted-foreground w-4">{index + 1}</span>
                    <div className="w-6 h-6 rounded-full bg-secondary flex items-center justify-center">
                      <span className="text-[10px] font-medium text-foreground">{agent.name.split(" ").map((name) => name[0]).join("")}</span>
                    </div>
                    <span className="font-medium text-foreground">{agent.name}</span>
                  </div>
                </td>
                <td className="px-4 py-3 text-muted-foreground">{agent.role}</td>
                <td className="px-4 py-3 text-right text-foreground font-medium">{agent.resolved}</td>
                <td className="px-4 py-3 text-right text-muted-foreground">{agent.assigned}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>
    </div>
  );
}
