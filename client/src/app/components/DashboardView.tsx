import { useEffect, useMemo, useState, type ReactNode } from "react";
import {
  AlertTriangle,
  ArrowRight,
  CalendarClock,
  CheckCircle2,
  ChevronRight,
  Clock3,
  FileWarning,
  MessageCircle,
  ReceiptIndianRupee,
  Users,
} from "lucide-react";
import { Badge } from "./ui/badge";
import { EmptyState } from "./ui/empty-state";
import { Skeleton } from "./ui/skeleton";
import { cn } from "./ui/utils";
import { getConversations, getDashboardSummary, getInvoices, getLeads, getSettings, getTasks, getWhatsAppConsole } from "../lib/api";
import { demoDashboard } from "../lib/demoData";
import { formatMoneyShort, initialsOf, listNames } from "../lib/format";
import type { ViewId } from "./shell/nav";

type DashboardSummary = typeof demoDashboard;

type ConversationLite = { id: string; contactId: string; name: string; phone: string; preview: string; time: string; unread: number; status: string; agent?: string; channel?: string };
type LeadLite = { id: string; contactName: string; stage: string; status: string; dealValue: number | null; dealCurrency: string; followUpAt: string | null; createdAt: string };
type TaskLite = { id: string; title: string; status: string; dueAt: string | null };
type InvoiceLite = { id: string; invoiceNumber: string; status: string; balanceDue: number; currency: string; dueDate: string | null; contact?: { name: string } };
type ConsoleLite = {
  health: { status: "healthy" | "attention" | "offline"; connectedAccounts: number; needsAttention: number };
  messageStats: { sent: number; delivered: number; failed: number };
  templateStats: { pending: number; rejected: number };
};
type Stage = { key: string; label: string; type?: string };

interface DashboardViewProps {
  userName: string;
  workspaceName: string;
  visibleViews: ViewId[];
  unreadCount: number;
  onNavigate: (view: ViewId) => void;
  onOpenContact: (contactId: string) => void;
}

type Tone = "problem" | "warning" | "info" | "money";

interface AttentionItem {
  key: string;
  tone: Tone;
  icon: ReactNode;
  title: string;
  detail: string;
  action: () => void;
  actionLabel: string;
}

const toneClass: Record<Tone, string> = {
  problem: "bg-problem-soft text-destructive",
  warning: "bg-warning/12 text-warning",
  info: "bg-jewel-soft text-primary",
  money: "bg-money-soft text-money",
};

function greeting(date = new Date()) {
  const hour = date.getHours();
  if (hour < 12) return "Good morning";
  if (hour < 17) return "Good afternoon";
  return "Good evening";
}

function firstName(name: string) {
  return name.trim().split(/\s+/)[0] || "there";
}

function endOfToday() {
  const d = new Date();
  d.setHours(23, 59, 59, 999);
  return d;
}

function prettyStage(key: string) {
  return key.replace(/[_-]+/g, " ").replace(/^\w/, (c) => c.toUpperCase());
}

function plural(n: number, one: string, many = `${one}s`) {
  return `${n.toLocaleString("en-IN")} ${n === 1 ? one : many}`;
}

// Settled promise helper: every section of Today is optional, so one failed or forbidden request
// must never blank the page.
function settle<T>(enabled: boolean, load: () => Promise<T>): Promise<T | null> {
  return enabled ? load().catch(() => null) : Promise.resolve(null);
}

/**
 * Today: what needs the person's attention right now, one headline figure, then the day's pulse.
 * Everything is read from existing endpoints, and only the ones this person's role and plan
 * already allow (visibleViews). Nothing on this screen changes data; rows just take you there.
 */
export function DashboardView({ userName, workspaceName, visibleViews, unreadCount, onNavigate, onOpenContact }: DashboardViewProps) {
  // App rebuilds visibleViews on every render; key on its contents so Today fetches once.
  const viewsKey = visibleViews.join(",");
  const can = useMemo(() => new Set(viewsKey.split(",") as ViewId[]), [viewsKey]);
  const [loading, setLoading] = useState(true);
  const [summary, setSummary] = useState<DashboardSummary>(demoDashboard);
  const [waiting, setWaiting] = useState<ConversationLite[] | null>(null);
  const [recent, setRecent] = useState<ConversationLite[] | null>(null);
  const [leads, setLeads] = useState<LeadLite[] | null>(null);
  const [stages, setStages] = useState<Stage[]>([]);
  const [tasks, setTasks] = useState<TaskLite[] | null>(null);
  const [invoices, setInvoices] = useState<InvoiceLite[] | null>(null);
  const [whatsapp, setWhatsapp] = useState<ConsoleLite | null>(null);

  useEffect(() => {
    let active = true;
    setLoading(true);
    Promise.all([
      getDashboardSummary<DashboardSummary>().catch(() => null),
      settle(can.has("inbox"), () => getConversations<{ data: ConversationLite[] }>({ status: "waiting", limit: 20 })),
      settle(can.has("inbox"), () => getConversations<{ data: ConversationLite[] }>({ limit: 6 })),
      settle(can.has("leads"), () => getLeads<{ data: LeadLite[] }>({ limit: 200 })),
      settle(can.has("leads"), () => getSettings<{ crm?: { pipelineStages?: Stage[] } }>()),
      settle(can.has("tasks"), () => getTasks<{ data: TaskLite[] }>({ status: "open" })),
      settle(can.has("invoicing"), () => getInvoices<{ data: InvoiceLite[] }>()),
      settle(can.has("settings"), () => getWhatsAppConsole<ConsoleLite>()),
    ]).then(([summaryRes, waitingRes, recentRes, leadsRes, settingsRes, tasksRes, invoicesRes, consoleRes]) => {
      if (!active) return;
      if (summaryRes) setSummary({ ...demoDashboard, ...summaryRes });
      setWaiting(waitingRes?.data ?? null);
      setRecent(recentRes?.data ?? null);
      setLeads(leadsRes?.data ?? null);
      setStages(settingsRes?.crm?.pipelineStages ?? []);
      setTasks(tasksRes?.data ?? null);
      setInvoices(invoicesRes?.data ?? null);
      setWhatsapp(consoleRes ?? null);
      setLoading(false);
    });
    return () => {
      active = false;
    };
  }, [can]);

  const now = Date.now();
  const todayEnd = endOfToday().getTime();

  const openLeads = useMemo(() => (leads || []).filter((lead) => lead.status === "open"), [leads]);
  const followUpsDue = openLeads.filter((lead) => lead.followUpAt && new Date(lead.followUpAt).getTime() <= todayEnd);
  const overdueTasks = (tasks || []).filter((task) => task.status === "open" && task.dueAt && new Date(task.dueAt).getTime() < now);
  const dueTodayTasks = (tasks || []).filter((task) => {
    if (task.status !== "open" || !task.dueAt) return false;
    const due = new Date(task.dueAt).getTime();
    return due >= now && due <= todayEnd;
  });
  const overdueInvoices = (invoices || []).filter(
    (invoice) =>
      invoice.balanceDue > 0 &&
      (invoice.status === "overdue" || (["sent", "partially_paid"].includes(invoice.status) && invoice.dueDate && new Date(invoice.dueDate).getTime() < now)),
  );
  const overdueAmount = overdueInvoices.reduce((total, invoice) => total + (invoice.balanceDue || 0), 0);

  const attention: AttentionItem[] = [];
  if (whatsapp && whatsapp.health.status !== "healthy") {
    const offline = whatsapp.health.status === "offline";
    attention.push({
      key: "whatsapp",
      tone: "problem",
      icon: <AlertTriangle size={17} />,
      title: offline ? "WhatsApp isn't connected" : "A WhatsApp number needs attention",
      detail: offline ? "Customers can't reach you on WhatsApp until a number is connected." : "Messages may not send until it's fixed in Settings.",
      action: () => {
        window.location.hash = "#settings/whatsapp";
      },
      actionLabel: offline ? "Connect" : "Fix",
    });
  }
  if (waiting?.length) {
    attention.push({
      key: "waiting",
      tone: "warning",
      icon: <Clock3 size={17} />,
      title: `${plural(waiting.length, "chat")} waiting for a reply`,
      detail: listNames(waiting.map((c) => c.name)),
      action: () => (waiting.length === 1 && waiting[0].contactId ? onOpenContact(waiting[0].contactId) : onNavigate("inbox")),
      actionLabel: waiting.length === 1 ? "Reply" : "Open inbox",
    });
  } else if (unreadCount > 0 && can.has("inbox")) {
    attention.push({
      key: "unread",
      tone: "info",
      icon: <MessageCircle size={17} />,
      title: `${plural(unreadCount, "unread message")}`,
      detail: "New messages in your inbox.",
      action: () => onNavigate("inbox"),
      actionLabel: "Open inbox",
    });
  }
  if (followUpsDue.length) {
    attention.push({
      key: "followups",
      tone: "info",
      icon: <CalendarClock size={17} />,
      title: `${plural(followUpsDue.length, "follow-up")} due today`,
      detail: listNames(followUpsDue.map((lead) => lead.contactName)),
      action: () => onNavigate("leads"),
      actionLabel: "Pipeline",
    });
  }
  if (overdueTasks.length || dueTodayTasks.length) {
    attention.push({
      key: "tasks",
      tone: overdueTasks.length ? "problem" : "info",
      icon: <CheckCircle2 size={17} />,
      title: overdueTasks.length ? `${plural(overdueTasks.length, "task")} overdue` : `${plural(dueTodayTasks.length, "task")} due today`,
      detail: listNames((overdueTasks.length ? overdueTasks : dueTodayTasks).map((task) => task.title)),
      action: () => onNavigate("tasks"),
      actionLabel: "Tasks",
    });
  }
  if (overdueInvoices.length) {
    attention.push({
      key: "invoices",
      tone: "money",
      icon: <ReceiptIndianRupee size={17} />,
      title: `${formatMoneyShort(overdueAmount, overdueInvoices[0]?.currency)} overdue on ${plural(overdueInvoices.length, "invoice")}`,
      detail: listNames(overdueInvoices.map((invoice) => invoice.contact?.name || invoice.invoiceNumber)),
      action: () => onNavigate("invoicing"),
      actionLabel: "Collect",
    });
  }
  if (whatsapp && (whatsapp.templateStats.rejected > 0 || whatsapp.templateStats.pending > 0) && can.has("templates")) {
    const { rejected, pending } = whatsapp.templateStats;
    attention.push({
      key: "templates",
      tone: rejected ? "problem" : "info",
      icon: <FileWarning size={17} />,
      title: rejected ? `${plural(rejected, "template")} rejected by WhatsApp` : `${plural(pending, "template")} waiting for approval`,
      detail: rejected ? "Edit and resubmit so campaigns can use them." : "WhatsApp usually reviews templates within a day.",
      action: () => onNavigate("templates"),
      actionLabel: "Templates",
    });
  }

  // Headline figure: open pipeline value when this person can see leads, otherwise open chats.
  const stageLabel = (key: string) => stages.find((s) => s.key === key)?.label || prettyStage(key);
  const pipelineCurrency = openLeads.find((lead) => lead.dealCurrency)?.dealCurrency || "INR";
  const pipelineValue = openLeads.reduce((total, lead) => total + (lead.dealValue || 0), 0);
  const weekAgo = now - 7 * 864e5;
  const newThisWeek = (leads || []).filter((lead) => new Date(lead.createdAt).getTime() >= weekAgo).length;
  const byStage = useMemo(() => {
    const order = stages.length ? stages.map((s) => s.key) : [];
    const map = new Map<string, { count: number; value: number }>();
    for (const lead of openLeads) {
      const entry = map.get(lead.stage) || { count: 0, value: 0 };
      entry.count += 1;
      entry.value += lead.dealValue || 0;
      map.set(lead.stage, entry);
    }
    return [...map.entries()]
      .map(([key, v]) => ({ key, ...v }))
      .sort((a, b) => {
        const ia = order.indexOf(a.key);
        const ib = order.indexOf(b.key);
        return (ia === -1 ? 99 : ia) - (ib === -1 ? 99 : ib);
      });
  }, [openLeads, stages]);
  const maxStageValue = Math.max(1, ...byStage.map((s) => s.value));

  const kpi = (needle: string) => summary.kpis?.find((k) => k.label.toLowerCase().includes(needle))?.value;
  const pulse = [
    can.has("inbox") && { label: "Open chats", value: kpi("open conversation") ?? "0" },
    { label: "New contacts today", value: kpi("new contact") ?? "0" },
    can.has("inbox") && { label: "Resolution rate", value: kpi("resolution") ?? "0%" },
    whatsapp && whatsapp.messageStats.sent + whatsapp.messageStats.delivered > 0 && {
      label: "Delivered",
      value: `${Math.round((whatsapp.messageStats.delivered / Math.max(1, whatsapp.messageStats.sent + whatsapp.messageStats.delivered + whatsapp.messageStats.failed)) * 100)}%`,
    },
  ].filter(Boolean) as { label: string; value: string }[];

  const team = summary.teamWorkload || [];
  const maxOpen = Math.max(1, ...team.map((m) => m.open + m.resolvedToday));
  const dateLine = new Date().toLocaleDateString("en-IN", { weekday: "long", day: "numeric", month: "long" });

  return (
    <div className="w-full min-w-0 flex-1 overflow-y-auto overflow-x-hidden">
      <div className="mx-auto grid w-full max-w-[1180px] gap-6 px-4 py-6 sm:px-6 lg:px-8 lg:py-8">
        <header className="flex flex-wrap items-end justify-between gap-3">
          <div className="min-w-0">
            <p className="text-[12.5px] text-muted-foreground">
              {dateLine} · {workspaceName}
            </p>
            <h2 className="mt-1 font-serif text-[34px] leading-[1.05] tracking-[-0.01em] text-foreground sm:text-[40px]">
              {greeting()}, {firstName(userName)}
            </h2>
          </div>
          {whatsapp && (
            <Badge variant={whatsapp.health.status === "healthy" ? "success" : whatsapp.health.status === "attention" ? "warning" : "destructive"} className="px-2.5 py-1">
              <span className="size-1.5 rounded-full bg-current" />
              {whatsapp.health.status === "healthy"
                ? `WhatsApp live · ${plural(whatsapp.health.connectedAccounts, "number")}`
                : whatsapp.health.status === "attention"
                  ? "WhatsApp needs attention"
                  : "WhatsApp not connected"}
            </Badge>
          )}
        </header>

        <div className="grid gap-5 lg:grid-cols-[minmax(0,1.45fr)_minmax(0,1fr)]">
          <section className="rounded-xl border border-border bg-card shadow-card" aria-labelledby="needs-you">
            <div className="flex items-center justify-between gap-3 border-b border-border px-5 py-3.5">
              <h3 id="needs-you" className="text-sm font-semibold text-foreground">
                Needs you now
              </h3>
              {!loading && attention.length > 0 && <span className="text-xs text-muted-foreground tabular-nums">{attention.length} to look at</span>}
            </div>
            {loading ? (
              <div className="grid gap-4 p-5">
                {[0, 1, 2].map((i) => (
                  <div key={i} className="flex items-center gap-3">
                    <Skeleton className="size-9 rounded-full" />
                    <div className="grid flex-1 gap-2">
                      <Skeleton className="h-3.5 w-1/2" />
                      <Skeleton className="h-3 w-1/3" />
                    </div>
                  </div>
                ))}
              </div>
            ) : attention.length ? (
              <ul className="divide-y divide-border">
                {attention.map((item) => (
                  <li key={item.key}>
                    <button type="button" onClick={item.action} className="group flex w-full items-center gap-3.5 px-5 py-3.5 text-left transition-colors hover:bg-foreground/[0.03] focus-visible:bg-foreground/[0.04] focus-visible:outline-none">
                      <span className={cn("flex size-9 shrink-0 items-center justify-center rounded-full", toneClass[item.tone])}>{item.icon}</span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-[14px] font-medium text-foreground">{item.title}</span>
                        {item.detail && <span className="mt-0.5 block truncate text-[12.5px] text-muted-foreground">{item.detail}</span>}
                      </span>
                      <span className="hidden shrink-0 items-center gap-1 text-[12.5px] font-medium text-primary sm:flex">
                        {item.actionLabel}
                        <ArrowRight size={14} className="transition-transform group-hover:translate-x-0.5" />
                      </span>
                      <ChevronRight size={16} className="shrink-0 text-muted-foreground sm:hidden" />
                    </button>
                  </li>
                ))}
              </ul>
            ) : (
              <div className="flex items-center gap-3.5 px-5 py-6">
                <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-success/12 text-success">
                  <CheckCircle2 size={17} />
                </span>
                <div>
                  <p className="text-[14px] font-medium text-foreground">You're all caught up</p>
                  <p className="text-[12.5px] text-muted-foreground">No waiting chats, overdue tasks or unpaid invoices right now.</p>
                </div>
              </div>
            )}
          </section>

          {can.has("leads") ? (
            <section className="flex flex-col rounded-xl border border-border bg-card p-5 shadow-card" aria-labelledby="pipeline-figure">
              <p id="pipeline-figure" className="text-[12.5px] font-medium text-muted-foreground">
                Open pipeline
              </p>
              {loading ? (
                <Skeleton className="mt-2 h-11 w-40" />
              ) : (
                <p className="mt-1 font-serif text-[44px] leading-none tracking-[-0.01em] text-money tabular-nums">{formatMoneyShort(pipelineValue, pipelineCurrency)}</p>
              )}
              <p className="mt-2 text-[12.5px] text-muted-foreground">
                {plural(openLeads.length, "open lead")}
                {newThisWeek > 0 && ` · ${newThisWeek} new this week`}
              </p>
              {byStage.length > 0 && (
                <ul className="mt-5 grid gap-2.5">
                  {byStage.slice(0, 6).map((stage) => (
                    <li key={stage.key} className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 gap-y-1 text-[12.5px]">
                      <span className="truncate text-foreground">
                        {stageLabel(stage.key)} <span className="text-muted-foreground tabular-nums">· {stage.count}</span>
                      </span>
                      <span className="text-muted-foreground tabular-nums">{stage.value ? formatMoneyShort(stage.value, pipelineCurrency) : "—"}</span>
                      <span className="col-span-2 h-1 overflow-hidden rounded-full bg-secondary">
                        <span className="block h-full rounded-full bg-money/70" style={{ width: `${Math.max(3, (stage.value / maxStageValue) * 100)}%` }} />
                      </span>
                    </li>
                  ))}
                </ul>
              )}
              <button type="button" onClick={() => onNavigate("leads")} className="mt-auto flex items-center gap-1 self-start pt-5 text-[12.5px] font-medium text-primary hover:underline">
                Open pipeline <ArrowRight size={14} />
              </button>
            </section>
          ) : (
            <section className="flex flex-col rounded-xl border border-border bg-card p-5 shadow-card">
              <p className="text-[12.5px] font-medium text-muted-foreground">Open chats</p>
              <p className="mt-1 font-serif text-[44px] leading-none text-foreground tabular-nums">{kpi("open conversation") ?? "0"}</p>
              <p className="mt-2 text-[12.5px] text-muted-foreground">{plural(unreadCount, "unread message")}</p>
              {can.has("inbox") && (
                <button type="button" onClick={() => onNavigate("inbox")} className="mt-auto flex items-center gap-1 self-start pt-5 text-[12.5px] font-medium text-primary hover:underline">
                  Open inbox <ArrowRight size={14} />
                </button>
              )}
            </section>
          )}
        </div>

        {pulse.length > 0 && (
          <section aria-label="Today at a glance" className="grid grid-cols-2 overflow-hidden rounded-xl border border-border bg-card shadow-card sm:grid-cols-4">
            {pulse.map((item, index) => (
              <div key={item.label} className={cn("px-5 py-4", index > 0 && "border-l border-border", index === 2 && "max-sm:border-l-0", index >= 2 && "max-sm:border-t")}>
                <p className="text-[12px] text-muted-foreground">{item.label}</p>
                {loading ? <Skeleton className="mt-2 h-6 w-12" /> : <p className="mt-1 text-[22px] font-semibold tracking-[-0.02em] text-foreground tabular-nums">{item.value}</p>}
              </div>
            ))}
          </section>
        )}

        <div className="grid gap-5 lg:grid-cols-[minmax(0,1.45fr)_minmax(0,1fr)]">
          {can.has("inbox") && (
            <section className="rounded-xl border border-border bg-card shadow-card" aria-labelledby="recent-chats">
              <div className="flex items-center justify-between gap-3 border-b border-border px-5 py-3.5">
                <h3 id="recent-chats" className="text-sm font-semibold text-foreground">
                  Latest conversations
                </h3>
                <button type="button" onClick={() => onNavigate("inbox")} className="text-[12.5px] font-medium text-primary hover:underline">
                  View all
                </button>
              </div>
              {loading ? (
                <div className="grid gap-4 p-5">
                  {[0, 1, 2, 3].map((i) => (
                    <div key={i} className="flex items-center gap-3">
                      <Skeleton className="size-9 rounded-full" />
                      <div className="grid flex-1 gap-2">
                        <Skeleton className="h-3.5 w-1/3" />
                        <Skeleton className="h-3 w-2/3" />
                      </div>
                    </div>
                  ))}
                </div>
              ) : recent?.length ? (
                <ul className="divide-y divide-border">
                  {recent.map((c) => (
                    <li key={c.id}>
                      <button
                        type="button"
                        disabled={!c.contactId}
                        onClick={() => c.contactId && onOpenContact(c.contactId)}
                        className="flex w-full items-center gap-3 px-5 py-3 text-left transition-colors hover:bg-foreground/[0.03] focus-visible:bg-foreground/[0.04] focus-visible:outline-none"
                      >
                        <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-secondary text-[11px] font-semibold text-foreground">{initialsOf(c.name)}</span>
                        <span className="min-w-0 flex-1">
                          <span className="flex items-baseline gap-2">
                            <span className={cn("truncate text-[14px] text-foreground", c.unread > 0 ? "font-semibold" : "font-medium")}>{c.name}</span>
                            {c.status === "waiting" && <span className="shrink-0 text-[11px] font-medium text-warning">Waiting</span>}
                          </span>
                          <span className={cn("mt-0.5 block truncate text-[12.5px]", c.unread > 0 ? "text-foreground" : "text-muted-foreground")}>{c.preview || "No messages yet"}</span>
                        </span>
                        <span className="flex shrink-0 flex-col items-end gap-1">
                          <span className="text-[11px] text-muted-foreground tabular-nums">{c.time}</span>
                          {c.unread > 0 && (
                            <span className="min-w-5 rounded-full bg-primary px-1.5 text-center text-[10.5px] font-semibold leading-5 text-primary-foreground tabular-nums">{c.unread}</span>
                          )}
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
              ) : (
                <EmptyState icon={<MessageCircle size={18} />} title="No conversations yet" description="Chats appear here as soon as a customer messages your WhatsApp number." />
              )}
            </section>
          )}

          {team.length > 0 && (
            <section className="rounded-xl border border-border bg-card shadow-card" aria-labelledby="team-today">
              <div className="flex items-center justify-between gap-3 border-b border-border px-5 py-3.5">
                <h3 id="team-today" className="text-sm font-semibold text-foreground">
                  Team today
                </h3>
                {can.has("team") && (
                  <button type="button" onClick={() => onNavigate("team")} className="text-[12.5px] font-medium text-primary hover:underline">
                    Team
                  </button>
                )}
              </div>
              <ul className="grid gap-4 p-5">
                {team.slice(0, 6).map((member) => (
                  <li key={member.userId} className="grid gap-1.5">
                    <div className="flex items-center gap-2.5">
                      <span className="relative flex size-7 shrink-0 items-center justify-center rounded-full bg-secondary text-[10.5px] font-semibold text-foreground">
                        {initialsOf(member.name)}
                        <span className={cn("absolute -bottom-0.5 -right-0.5 size-2.5 rounded-full border-2 border-card", member.status === "online" ? "bg-success" : "bg-muted-foreground/40")} />
                      </span>
                      <span className="min-w-0 flex-1 truncate text-[13px] font-medium text-foreground">{member.name}</span>
                      <span className="shrink-0 text-[12px] text-muted-foreground tabular-nums">
                        {member.open} open · {member.resolvedToday} done
                      </span>
                    </div>
                    <div className="ml-[38px] flex h-1 overflow-hidden rounded-full bg-secondary">
                      <span className="h-full bg-success/70" style={{ width: `${(member.resolvedToday / maxOpen) * 100}%` }} />
                      <span className="h-full bg-primary/60" style={{ width: `${(member.open / maxOpen) * 100}%` }} />
                    </div>
                  </li>
                ))}
              </ul>
              <p className="flex items-center gap-3 border-t border-border px-5 py-2.5 text-[11.5px] text-muted-foreground">
                <span className="flex items-center gap-1.5">
                  <span className="size-2 rounded-full bg-success/70" /> Resolved today
                </span>
                <span className="flex items-center gap-1.5">
                  <span className="size-2 rounded-full bg-primary/60" /> Open
                </span>
                <Users size={13} className="ml-auto" />
              </p>
            </section>
          )}
        </div>
      </div>
    </div>
  );
}
