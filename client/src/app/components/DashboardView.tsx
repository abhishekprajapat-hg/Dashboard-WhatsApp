import { useEffect, useState } from "react";
import { Badge } from "./ui/badge";
import { Card } from "./ui/card";
import {
  MessageCircle,
  Users,
  Clock,
  TrendingUp,
  CheckCircle2,
  AlertCircle,
  ArrowUpRight,
} from "lucide-react";
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  BarChart,
  Bar,
} from "recharts";
import { getDashboardSummary } from "../lib/api";
import { demoDashboard } from "../lib/demoData";

const statusColor: Record<string, string> = {
  open: "bg-primary/20 text-primary border-primary/30",
  waiting: "bg-yellow-500/20 text-yellow-400 border-yellow-500/30",
  resolved: "bg-secondary text-muted-foreground border-border",
};

interface DashboardViewProps {
  userName: string;
}

export function DashboardView({ userName }: DashboardViewProps) {
  const [summary, setSummary] = useState(demoDashboard);

  useEffect(() => {
    getDashboardSummary<typeof demoDashboard>()
      .then(setSummary)
      .catch(() => setSummary(demoDashboard));
  }, []);

  const icons = [<MessageCircle size={16} />, <Users size={16} />, <Clock size={16} />, <TrendingUp size={16} />];
  const colors = ["text-primary", "text-blue-400", "text-yellow-400", "text-primary"];

  return (
    <div className="flex-1 overflow-y-auto p-3 sm:p-4 lg:p-6 space-y-4 lg:space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0">
          <h1 className="text-foreground">Good morning, {userName.split(" ")[0]}</h1>
          <p className="text-muted-foreground text-sm mt-0.5">Here&apos;s what&apos;s happening with your workspace today.</p>
        </div>
        <Badge variant="outline" className="w-fit border-primary/30 text-primary bg-primary/10">
          <span className="w-1.5 h-1.5 rounded-full bg-primary animate-pulse mr-1.5 inline-block" />
          {summary.health.onlineAgents} agents online
        </Badge>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-3">
        {summary.kpis.map((kpi, index) => (
          <Card key={kpi.label} className="p-4 bg-card border-border">
            <div className="flex items-start justify-between">
              <div className={colors[index]}>{icons[index]}</div>
              <span className="text-xs text-primary flex items-center gap-0.5">
                <ArrowUpRight size={10} />
                {kpi.delta}
              </span>
            </div>
            <div className="mt-3">
              <div className="text-2xl font-semibold text-foreground">{kpi.value}</div>
              <div className="text-xs text-muted-foreground mt-0.5">{kpi.label}</div>
            </div>
          </Card>
        ))}
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
        <Card className="xl:col-span-2 p-4 bg-card border-border">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between mb-4">
            <div>
              <h3 className="text-foreground text-sm font-medium">Message Volume</h3>
              <p className="text-xs text-muted-foreground">Last 7 days</p>
            </div>
            <div className="flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
              <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-primary inline-block" />Inbound</span>
              <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-chart-2 inline-block" />Outbound</span>
            </div>
          </div>
          <ResponsiveContainer width="100%" height={180}>
            <AreaChart data={summary.messageVolume} margin={{ top: 0, right: 0, left: -20, bottom: 0 }}>
              <defs>
                <linearGradient id="colorIn" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#25D366" stopOpacity={0.3} />
                  <stop offset="95%" stopColor="#25D366" stopOpacity={0} />
                </linearGradient>
                <linearGradient id="colorOut" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#128C7E" stopOpacity={0.3} />
                  <stop offset="95%" stopColor="#128C7E" stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="rgba(240,246,252,0.06)" />
              <XAxis dataKey="day" tick={{ fill: "#8b949e", fontSize: 11 }} axisLine={false} tickLine={false} />
              <YAxis tick={{ fill: "#8b949e", fontSize: 11 }} axisLine={false} tickLine={false} />
              <Tooltip
                contentStyle={{ background: "#1c2128", border: "1px solid rgba(240,246,252,0.1)", borderRadius: 6, fontSize: 12 }}
                labelStyle={{ color: "#e6edf3" }}
              />
              <Area type="monotone" dataKey="inbound" stroke="#25D366" strokeWidth={2} fill="url(#colorIn)" />
              <Area type="monotone" dataKey="outbound" stroke="#128C7E" strokeWidth={2} fill="url(#colorOut)" />
            </AreaChart>
          </ResponsiveContainer>
        </Card>

        <Card className="p-4 bg-card border-border">
          <h3 className="text-foreground text-sm font-medium mb-1">Agent Performance</h3>
          <p className="text-xs text-muted-foreground mb-4">Conversations resolved today</p>
          <ResponsiveContainer width="100%" height={180}>
            <BarChart data={summary.agentPerformance} layout="vertical" margin={{ top: 0, right: 0, left: 0, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="rgba(240,246,252,0.06)" horizontal={false} />
              <XAxis type="number" tick={{ fill: "#8b949e", fontSize: 11 }} axisLine={false} tickLine={false} />
              <YAxis dataKey="name" type="category" tick={{ fill: "#8b949e", fontSize: 11 }} axisLine={false} tickLine={false} width={50} />
              <Tooltip
                contentStyle={{ background: "#1c2128", border: "1px solid rgba(240,246,252,0.1)", borderRadius: 6, fontSize: 12 }}
                labelStyle={{ color: "#e6edf3" }}
              />
              <Bar dataKey="resolved" fill="#25D366" radius={[0, 3, 3, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </Card>
      </div>


      {summary.teamWorkload.length > 0 && (
        <Card className="bg-card border-border">
          <div className="flex flex-col gap-2 p-4 border-b border-border sm:flex-row sm:items-center sm:justify-between">
            <div>
              <h3 className="text-foreground text-sm font-medium">Team Monitoring</h3>
              <p className="text-xs text-muted-foreground">Live workload by assigned conversations</p>
            </div>
            <Badge variant="outline" className="border-border text-muted-foreground">
              {summary.teamWorkload.reduce((total, member) => total + member.open, 0)} open assigned
            </Badge>
          </div>
          <div className="divide-y divide-border">
            {summary.teamWorkload.map((member) => (
              <div key={member.userId} className="grid grid-cols-3 items-center gap-3 px-4 py-3 sm:grid-cols-[1fr_auto_auto_auto]">
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-medium text-foreground truncate">{member.name}</span>
                    <Badge variant="outline" className="h-4 px-1.5 py-0 text-[10px] border-border text-muted-foreground capitalize">
                      {member.role}
                    </Badge>
                  </div>
                  <p className="text-[11px] text-muted-foreground">Last active {member.lastActive}</p>
                </div>
                <div className="text-right">
                  <div className="text-sm text-foreground">{member.open}</div>
                  <div className="text-[10px] text-muted-foreground">Open</div>
                </div>
                <div className="text-right">
                  <div className="text-sm text-foreground">{member.assigned}</div>
                  <div className="text-[10px] text-muted-foreground">Assigned</div>
                </div>
                <div className="text-right">
                  <div className="text-sm text-primary">{member.resolvedToday}</div>
                  <div className="text-[10px] text-muted-foreground">Resolved</div>
                </div>
              </div>
            ))}
          </div>
        </Card>
      )}

      <Card className="bg-card border-border">
        <div className="flex items-center justify-between gap-3 p-4 border-b border-border">
          <h3 className="text-foreground text-sm font-medium">Recent Conversations</h3>
          <button className="text-xs text-primary hover:underline">View all -&gt;</button>
        </div>
        <div className="divide-y divide-border">
          {summary.recentConversations.map((conv) => (
            <div key={conv.phone} className="flex items-start gap-3 px-4 py-3 hover:bg-secondary/50 transition-colors cursor-pointer sm:items-center">
              <div className="w-8 h-8 rounded-full bg-secondary flex items-center justify-center shrink-0">
                <span className="text-xs font-medium text-foreground">{conv.name.split(" ").map((n) => n[0]).join("").slice(0, 2)}</span>
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex min-w-0 flex-col gap-0.5 sm:flex-row sm:items-center sm:gap-2">
                  <span className="truncate text-sm font-medium text-foreground">{conv.name}</span>
                  <span className="truncate text-xs text-muted-foreground">{conv.phone}</span>
                </div>
                <p className="text-xs text-muted-foreground truncate">{conv.preview}</p>
              </div>
              <div className="flex shrink-0 flex-col items-end gap-1 sm:flex-row sm:items-center sm:gap-2">
                <Badge variant="outline" className={`text-xs ${statusColor[conv.status]}`}>{conv.status}</Badge>
                <span className="hidden text-xs text-muted-foreground sm:inline">{conv.agent}</span>
                <span className="text-xs text-muted-foreground">{conv.time}</span>
              </div>
            </div>
          ))}
        </div>
      </Card>

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-3">
        <div className="flex items-start gap-3 p-3 rounded-lg bg-primary/10 border border-primary/20">
          <CheckCircle2 size={16} className="text-primary mt-0.5 shrink-0" />
          <div>
            <p className="text-sm font-medium text-foreground">WhatsApp API Connected</p>
            <p className="text-xs text-muted-foreground">Business account verified - +971 4 234 5678</p>
          </div>
        </div>
        <div className="flex items-start gap-3 p-3 rounded-lg bg-yellow-500/10 border border-yellow-500/20">
          <AlertCircle size={16} className="text-yellow-400 mt-0.5 shrink-0" />
          <div>
            <p className="text-sm font-medium text-foreground">{summary.health.slaWarnings} conversations waiting &gt;30 min</p>
            <p className="text-xs text-muted-foreground">Assign to available agents to maintain SLA</p>
          </div>
        </div>
      </div>
    </div>
  );
}
