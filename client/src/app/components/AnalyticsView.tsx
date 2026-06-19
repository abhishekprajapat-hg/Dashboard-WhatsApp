import { useEffect, useState } from "react";
import { Card } from "./ui/card";
import { Badge } from "./ui/badge";
import {
  AreaChart, Area, BarChart, Bar, LineChart, Line, PieChart, Pie, Cell,
  XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend,
} from "recharts";
import { TrendingUp, TrendingDown, MessageCircle, Users, Clock, CheckCircle2 } from "lucide-react";
import { getDashboardSummary } from "../lib/api";
import { demoDashboard } from "../lib/demoData";

const volumeData = [
  { date: "Jun 1", inbound: 0, outbound: 0, resolved: 0 },
  { date: "Jun 2", inbound: 0, outbound: 0, resolved: 0 },
  { date: "Jun 3", inbound: 0, outbound: 0, resolved: 0 },
  { date: "Jun 4", inbound: 0, outbound: 0, resolved: 0 },
  { date: "Jun 5", inbound: 0, outbound: 0, resolved: 0 },
  { date: "Jun 6", inbound: 0, outbound: 0, resolved: 0 },
  { date: "Jun 7", inbound: 0, outbound: 0, resolved: 0 },
  { date: "Jun 8", inbound: 0, outbound: 0, resolved: 0 },
  { date: "Jun 9", inbound: 0, outbound: 0, resolved: 0 },
  { date: "Jun 10", inbound: 0, outbound: 0, resolved: 0 },
  { date: "Jun 11", inbound: 0, outbound: 0, resolved: 0 },
  { date: "Jun 12", inbound: 0, outbound: 0, resolved: 0 },
  { date: "Jun 13", inbound: 0, outbound: 0, resolved: 0 },
  { date: "Jun 14", inbound: 0, outbound: 0, resolved: 0 },
];

const responseTimeData = [
  { hour: "8 AM", avg: 0 },
  { hour: "9 AM", avg: 0 },
  { hour: "10 AM", avg: 0 },
  { hour: "11 AM", avg: 0 },
  { hour: "12 PM", avg: 0 },
  { hour: "1 PM", avg: 0 },
  { hour: "2 PM", avg: 0 },
  { hour: "3 PM", avg: 0 },
  { hour: "4 PM", avg: 0 },
  { hour: "5 PM", avg: 0 },
];

const agentPerformance = [
  { name: "Admin", resolved: 0, csat: 0, avg: 0 },
];

const channelData = [
  { name: "WhatsApp", value: 0, color: "#25D366" },
  { name: "API", value: 0, color: "#128C7E" },
  { name: "Import", value: 0, color: "#3b82f6" },
];

const kpis = [
  { label: "Total messages", value: "0", delta: "+0%", up: true, icon: <MessageCircle size={15} /> },
  { label: "New contacts", value: "0", delta: "+0%", up: true, icon: <Users size={15} /> },
  { label: "Avg response time", value: "0 min", delta: "+0%", up: true, icon: <Clock size={15} /> },
  { label: "Resolution rate", value: "0%", delta: "+0%", up: true, icon: <CheckCircle2 size={15} /> },
];

export function AnalyticsView() {
  const [summary, setSummary] = useState(demoDashboard);

  useEffect(() => {
    getDashboardSummary<typeof demoDashboard>()
      .then(setSummary)
      .catch(() => setSummary(demoDashboard));
  }, []);

  const liveKpis = summary.kpis.map((kpi, index) => ({
    ...kpi,
    up: true,
    icon: [<MessageCircle size={15} />, <Users size={15} />, <Clock size={15} />, <CheckCircle2 size={15} />][index] || <MessageCircle size={15} />,
  }));
  const liveVolumeData = summary.messageVolume.map((item) => ({ date: item.day, inbound: item.inbound, outbound: item.outbound, resolved: 0 }));
  const liveAgentPerformance = summary.agentPerformance.map((agent) => ({ name: agent.name, resolved: agent.resolved, csat: 0, avg: agent.avg }));

  return (
    <div className="flex-1 overflow-y-auto p-6 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-foreground">Analytics</h1>
          <p className="text-xs text-muted-foreground mt-0.5">Jun 1 – Jun 14, 2026</p>
        </div>
        <div className="flex items-center gap-2">
          {["7d", "14d", "30d", "90d"].map((p, i) => (
            <button
              key={p}
              className={`text-xs px-3 py-1 rounded transition-colors ${
                i === 1
                  ? "bg-primary/20 text-primary"
                  : "text-muted-foreground hover:text-foreground hover:bg-secondary"
              }`}
            >
              {p}
            </button>
          ))}
        </div>
      </div>

      {/* KPIs */}
      <div className="grid grid-cols-2 xl:grid-cols-4 gap-3">
        {liveKpis.map((kpi) => (
          <Card key={kpi.label} className="p-4 bg-card border-border">
            <div className="flex items-center justify-between mb-2">
              <span className="text-muted-foreground">{kpi.icon}</span>
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

      {/* Message Volume */}
      <Card className="p-4 bg-card border-border">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h3 className="text-sm font-medium text-foreground">Message Volume</h3>
            <p className="text-xs text-muted-foreground">Daily inbound, outbound, and resolved</p>
          </div>
          <div className="flex items-center gap-3 text-[11px] text-muted-foreground">
            <span className="flex items-center gap-1"><span className="w-2 h-0.5 bg-primary inline-block" />Inbound</span>
            <span className="flex items-center gap-1"><span className="w-2 h-0.5 bg-chart-2 inline-block" />Outbound</span>
            <span className="flex items-center gap-1"><span className="w-2 h-0.5 bg-chart-3 inline-block" />Resolved</span>
          </div>
        </div>
        <ResponsiveContainer width="100%" height={200}>
          <AreaChart data={liveVolumeData} margin={{ top: 0, right: 0, left: -20, bottom: 0 }}>
            <defs>
              <linearGradient id="gIn" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor="#25D366" stopOpacity={0.2} />
                <stop offset="95%" stopColor="#25D366" stopOpacity={0} />
              </linearGradient>
              <linearGradient id="gOut" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor="#128C7E" stopOpacity={0.2} />
                <stop offset="95%" stopColor="#128C7E" stopOpacity={0} />
              </linearGradient>
              <linearGradient id="gRes" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor="#3b82f6" stopOpacity={0.2} />
                <stop offset="95%" stopColor="#3b82f6" stopOpacity={0} />
              </linearGradient>
            </defs>
            <CartesianGrid strokeDasharray="3 3" stroke="rgba(240,246,252,0.06)" />
            <XAxis dataKey="date" tick={{ fill: "#8b949e", fontSize: 11 }} axisLine={false} tickLine={false} />
            <YAxis tick={{ fill: "#8b949e", fontSize: 11 }} axisLine={false} tickLine={false} />
            <Tooltip contentStyle={{ background: "#1c2128", border: "1px solid rgba(240,246,252,0.1)", borderRadius: 6, fontSize: 12 }} labelStyle={{ color: "#e6edf3" }} />
            <Area type="monotone" dataKey="inbound" stroke="#25D366" strokeWidth={2} fill="url(#gIn)" />
            <Area type="monotone" dataKey="outbound" stroke="#128C7E" strokeWidth={2} fill="url(#gOut)" />
            <Area type="monotone" dataKey="resolved" stroke="#3b82f6" strokeWidth={2} fill="url(#gRes)" />
          </AreaChart>
        </ResponsiveContainer>
      </Card>

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
        {/* Response time */}
        <Card className="xl:col-span-2 p-4 bg-card border-border">
          <h3 className="text-sm font-medium text-foreground mb-1">Avg Response Time by Hour</h3>
          <p className="text-xs text-muted-foreground mb-4">Minutes · Today</p>
          <ResponsiveContainer width="100%" height={160}>
            <BarChart data={responseTimeData} margin={{ top: 0, right: 0, left: -20, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="rgba(240,246,252,0.06)" vertical={false} />
              <XAxis dataKey="hour" tick={{ fill: "#8b949e", fontSize: 11 }} axisLine={false} tickLine={false} />
              <YAxis tick={{ fill: "#8b949e", fontSize: 11 }} axisLine={false} tickLine={false} />
              <Tooltip contentStyle={{ background: "#1c2128", border: "1px solid rgba(240,246,252,0.1)", borderRadius: 6, fontSize: 12 }} labelStyle={{ color: "#e6edf3" }} />
              <Bar dataKey="avg" fill="#25D366" radius={[3, 3, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </Card>

        {/* Channel breakdown */}
        <Card className="p-4 bg-card border-border">
          <h3 className="text-sm font-medium text-foreground mb-1">Contact Source</h3>
          <p className="text-xs text-muted-foreground mb-4">This month</p>
          <ResponsiveContainer width="100%" height={120}>
            <PieChart>
              <Pie data={channelData} cx="50%" cy="50%" innerRadius={35} outerRadius={55} paddingAngle={3} dataKey="value">
                {channelData.map((entry) => (
                  <Cell key={entry.name} fill={entry.color} />
                ))}
              </Pie>
              <Tooltip contentStyle={{ background: "#1c2128", border: "1px solid rgba(240,246,252,0.1)", borderRadius: 6, fontSize: 12 }} />
            </PieChart>
          </ResponsiveContainer>
          <div className="space-y-1.5 mt-2">
            {channelData.map((c) => (
              <div key={c.name} className="flex items-center justify-between">
                <div className="flex items-center gap-1.5">
                  <span className="w-2 h-2 rounded-full" style={{ background: c.color }} />
                  <span className="text-xs text-muted-foreground">{c.name}</span>
                </div>
                <span className="text-xs font-medium text-foreground">{c.value}%</span>
              </div>
            ))}
          </div>
        </Card>
      </div>

      {/* Agent performance table */}
      <Card className="bg-card border-border">
        <div className="px-4 py-3 border-b border-border">
          <h3 className="text-sm font-medium text-foreground">Agent Leaderboard</h3>
          <p className="text-xs text-muted-foreground">This month's performance</p>
        </div>
        <table className="w-full text-xs">
          <thead>
            <tr className="border-b border-border bg-secondary/30">
              <th className="px-4 py-2.5 text-left font-medium text-muted-foreground">Agent</th>
              <th className="px-4 py-2.5 text-right font-medium text-muted-foreground">Resolved</th>
              <th className="px-4 py-2.5 text-right font-medium text-muted-foreground">CSAT</th>
              <th className="px-4 py-2.5 text-right font-medium text-muted-foreground">Avg Response</th>
            </tr>
          </thead>
          <tbody>
            {liveAgentPerformance.map((agent, i) => (
              <tr key={agent.name} className="border-b border-border hover:bg-secondary/20 transition-colors">
                <td className="px-4 py-3">
                  <div className="flex items-center gap-2.5">
                    <span className="text-[10px] text-muted-foreground w-4">{i + 1}</span>
                    <div className="w-6 h-6 rounded-full bg-secondary flex items-center justify-center">
                      <span className="text-[10px] font-medium text-foreground">{agent.name.split(" ").map(n => n[0]).join("")}</span>
                    </div>
                    <span className="font-medium text-foreground">{agent.name}</span>
                  </div>
                </td>
                <td className="px-4 py-3 text-right text-foreground font-medium">{agent.resolved}</td>
                <td className="px-4 py-3 text-right">
                  <span className="text-primary font-medium">★ {agent.csat}</span>
                </td>
                <td className="px-4 py-3 text-right text-muted-foreground">{agent.avg} min</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>
    </div>
  );
}
