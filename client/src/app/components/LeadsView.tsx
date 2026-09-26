import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import {
  ArrowRightLeft,
  CalendarClock,
  CheckCircle2,
  Circle,
  Flag,
  Lock,
  MessageCircle,
  Plus,
  Search,
  StickyNote,
  UserRoundCheck,
  Wallet,
  X,
} from "lucide-react";
import { Button } from "./ui/button";
import { EmptyState } from "./ui/empty-state";
import { LoadingSkeleton } from "./ui/loading-skeleton";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "./ui/sheet";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuTrigger } from "./ui/dropdown-menu";
import { cn } from "./ui/utils";
import { avatarTint } from "./whatsapp-inbox/utils";
import { formatMoney, formatMoneyShort, initialsOf } from "../lib/format";
import {
  addLeadInternalComment,
  addLeadNote,
  createTask,
  getLead,
  getLeads,
  getSettings,
  getTasks,
  getTeamMembers,
  updateLead,
  updateTask,
  type PipelineStage,
} from "../lib/api";

interface Lead {
  id: string;
  contactId: string;
  contactName: string;
  contactPhone: string;
  contactEmail: string;
  conversationId: string;
  ownerUserId: string;
  ownerName: string;
  stage: string;
  status: string;
  score: number;
  source: string;
  campaign: string;
  followUpAt: string | null;
  dealValue: number | null;
  dealCurrency: string;
  lastActivityAt: string;
  createdAt: string;
  updatedAt: string;
}

interface TimelineEvent {
  id?: string;
  type: string;
  title?: string;
  body?: string;
  from?: string;
  to?: string;
  at: string;
  source?: string;
}

interface InternalComment {
  id?: string;
  text: string;
  at: string;
  actorUserId?: string;
}

interface LeadDetail extends Lead {
  timeline: TimelineEvent[];
  internalComments: InternalComment[];
}

interface TaskItem {
  id: string;
  title: string;
  status: "open" | "completed";
  dueAt: string | null;
  assignedToUserId: { id: string; name: string } | null;
}

interface MemberOption {
  userId: string;
  name: string;
}

// Fallback only, shown until GET /settings resolves - matches services/pipelineStages.js's
// DEFAULT_PIPELINE_STAGES so a first paint before the fetch completes looks identical to what a
// workspace with no custom stages configured actually gets from the server. The real, possibly
// workspace-customized list (master plan "CRM industry-specificity") replaces this via the
// `stages` state below.
const DEFAULT_STAGES: PipelineStage[] = [
  { key: "new_lead", label: "New lead", color: "info", type: "open" },
  { key: "contacted", label: "Contacted", color: "warning", type: "open" },
  { key: "qualified", label: "Qualified", color: "primary", type: "open" },
  { key: "proposal_sent", label: "Proposal sent", color: "primary", type: "open" },
  { key: "won", label: "Won", color: "success", type: "won" },
  { key: "lost", label: "Lost", color: "destructive", type: "lost" },
];

// A workspace's stored `color` is a generic name (sky/amber/violet/indigo/green/red, etc. - see
// the industry pack seed data) or already one of this app's own theme tokens - map either onto a
// real class from the design system's palette (theme.css), rather than generating arbitrary
// Tailwind colour classes at runtime.
const COLOR_TO_DOT: Record<string, string> = {
  sky: "bg-info",
  info: "bg-info",
  blue: "bg-info",
  amber: "bg-warning",
  warning: "bg-warning",
  yellow: "bg-warning",
  violet: "bg-chart-3",
  indigo: "bg-primary",
  primary: "bg-primary",
  green: "bg-success",
  success: "bg-success",
  red: "bg-destructive",
  destructive: "bg-destructive",
};

function stageDot(color: string) {
  return COLOR_TO_DOT[color] || "bg-primary";
}

function relativeTime(iso?: string | null) {
  if (!iso) return "Never";
  const diffMs = Date.now() - new Date(iso).getTime();
  const minutes = Math.max(0, Math.floor(diffMs / 60000));
  if (minutes < 1) return "Just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

function toDateInputValue(iso: string | null) {
  if (!iso) return "";
  const date = new Date(iso);
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

function timelineIcon(type: string) {
  switch (type) {
    case "stage_change":
      return <Flag size={12} className="text-primary" />;
    case "owner_change":
      return <UserRoundCheck size={12} className="text-info" />;
    case "follow_up_set":
      return <CalendarClock size={12} className="text-warning" />;
    case "note":
      return <StickyNote size={12} className="text-muted-foreground" />;
    case "deal_updated":
      return <Wallet size={12} className="text-money" />;
    default:
      return <MessageCircle size={12} className="text-muted-foreground" />;
  }
}

// Follow-up signal for a card: overdue (coral), today (amber), or the date.
function followUpState(iso: string | null) {
  if (!iso) return null;
  const due = new Date(iso);
  const now = new Date();
  const startToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const endToday = startToday + 864e5 - 1;
  if (due.getTime() < startToday) {
    const days = Math.max(1, Math.round((startToday - due.getTime()) / 864e5));
    return { tone: "overdue" as const, label: `Follow-up ${days}d overdue` };
  }
  if (due.getTime() <= endToday) return { tone: "today" as const, label: "Follow up today" };
  return { tone: "later" as const, label: `Follow up ${due.toLocaleDateString("en-IN", { day: "numeric", month: "short" })}` };
}

function scoreClass(score: number) {
  if (score >= 80) return "bg-problem-soft text-destructive";
  if (score >= 50) return "bg-money-soft text-money";
  return "bg-secondary text-muted-foreground";
}

const fieldClass =
  "h-9 w-full rounded-lg border border-input bg-input-background px-2.5 text-[13px] text-foreground outline-none transition-colors focus:border-ring focus:ring-2 focus:ring-ring/20 disabled:opacity-60";

function PanelSection({ title, icon, children, aside }: { title: string; icon?: ReactNode; children: ReactNode; aside?: ReactNode }) {
  return (
    <section className="grid gap-2.5 border-b border-border px-5 py-4 last:border-b-0">
      <div className="flex items-center justify-between gap-2">
        <h3 className="flex items-center gap-1.5 text-[10.5px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
          {icon}
          {title}
        </h3>
        {aside}
      </div>
      {children}
    </section>
  );
}

interface LeadsViewProps {
  canWrite?: boolean;
  currentUserId?: string;
  openLeadId?: string | null;
  onLeadLinkHandled?: () => void;
  onOpenContact?: (contactId: string) => void;
}

export function LeadsView({ canWrite = false, currentUserId, openLeadId, onLeadLinkHandled, onOpenContact }: LeadsViewProps) {
  const [leads, setLeads] = useState<Lead[]>([]);
  const [loading, setLoading] = useState(true);
  const [members, setMembers] = useState<MemberOption[]>([]);
  const [selectedId, setSelectedId] = useState<string>("");
  const [detail, setDetail] = useState<LeadDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [tasks, setTasks] = useState<TaskItem[]>([]);
  const [noteText, setNoteText] = useState("");
  const [savingNote, setSavingNote] = useState(false);
  const [savingField, setSavingField] = useState(false);
  const [newTaskTitle, setNewTaskTitle] = useState("");
  const [newTaskAssigneeId, setNewTaskAssigneeId] = useState("");
  const [savingTask, setSavingTask] = useState(false);
  const [dealValueInput, setDealValueInput] = useState("");
  const [savingDeal, setSavingDeal] = useState(false);
  const [commentText, setCommentText] = useState("");
  const [savingComment, setSavingComment] = useState(false);
  const [stages, setStages] = useState<PipelineStage[]>(DEFAULT_STAGES);
  const [search, setSearch] = useState("");
  const [ownerFilter, setOwnerFilter] = useState("");
  const [dragId, setDragId] = useState("");
  const [dropStage, setDropStage] = useState("");
  const [moveError, setMoveError] = useState("");
  const openedFromLink = useRef<string | null>(null);

  useEffect(() => {
    let active = true;
    getSettings<{ crm?: { pipelineStages?: PipelineStage[] } }>()
      .then((response) => {
        if (active && response.crm?.pipelineStages?.length) setStages(response.crm.pipelineStages);
      })
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    let active = true;
    setLoading(true);
    getLeads<{ data: Lead[]; total: number }>({ limit: 200 })
      .then((response) => {
        if (active) setLeads(response.data);
      })
      .catch(() => {
        if (active) setLeads([]);
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    let active = true;
    getTeamMembers<{ data: MemberOption[] }>()
      .then((response) => {
        if (active) setMembers(response.data.filter((member) => member.userId));
      })
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, []);

  // Deep link: #leads/<leadId> opens that lead straight away.
  useEffect(() => {
    if (openLeadId && openedFromLink.current !== openLeadId) {
      openedFromLink.current = openLeadId;
      loadDetail(openLeadId);
      onLeadLinkHandled?.();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [openLeadId]);

  function setLeadHash(leadId: string) {
    if (!/^#\/?leads(\/|$)/.test(window.location.hash)) return;
    const next = leadId ? `#leads/${encodeURIComponent(leadId)}` : "#leads";
    if (window.location.hash !== next) window.history.replaceState(null, "", next);
  }

  function loadDetail(leadId: string) {
    setSelectedId(leadId);
    setLeadHash(leadId);
    setDetailLoading(true);
    setDetail(null);
    setTasks([]);
    getLead<{ data: LeadDetail }>(leadId)
      .then((leadResponse) => {
        setDetail(leadResponse.data);
        setDealValueInput(leadResponse.data.dealValue === null ? "" : String(leadResponse.data.dealValue));
        return getTasks<{ data: TaskItem[] }>({ contactId: leadResponse.data.contactId });
      })
      .then((taskResponse) => setTasks(taskResponse.data))
      .catch(() => undefined)
      .finally(() => setDetailLoading(false));
  }

  function closeDetail() {
    setSelectedId("");
    setLeadHash("");
    setDetail(null);
    setTasks([]);
    setNoteText("");
    setNewTaskTitle("");
    setDealValueInput("");
    setCommentText("");
  }

  function applyLeadUpdate(updated: LeadDetail) {
    setDetail(updated);
    setDealValueInput(updated.dealValue === null ? "" : String(updated.dealValue));
    setLeads((items) => items.map((lead) => (lead.id === updated.id ? { ...lead, ...updated } : lead)));
  }

  async function handleStageChange(leadId: string, stage: string) {
    setSavingField(true);
    try {
      const response = await updateLead<{ data: LeadDetail }>(leadId, { stage });
      if (detail?.id === leadId) applyLeadUpdate(response.data);
      else setLeads((items) => items.map((lead) => (lead.id === leadId ? { ...lead, stage: response.data.stage, status: response.data.status } : lead)));
    } finally {
      setSavingField(false);
    }
  }

  // Board moves (drag or the "Move to" menu) update the card at once and roll back if the save fails.
  async function moveLead(leadId: string, stage: string) {
    const lead = leads.find((item) => item.id === leadId);
    if (!lead || lead.stage === stage || !canWrite) return;
    const previous = lead.stage;
    setMoveError("");
    setLeads((items) => items.map((item) => (item.id === leadId ? { ...item, stage } : item)));
    try {
      await handleStageChange(leadId, stage);
    } catch {
      setLeads((items) => items.map((item) => (item.id === leadId ? { ...item, stage: previous } : item)));
      setMoveError(`Couldn't move ${lead.contactName || "that lead"}. Check your connection and try again.`);
    }
  }

  async function handleOwnerChange(leadId: string, ownerUserId: string) {
    setSavingField(true);
    try {
      const response = await updateLead<{ data: LeadDetail }>(leadId, { ownerUserId });
      applyLeadUpdate(response.data);
    } finally {
      setSavingField(false);
    }
  }

  async function handleFollowUpChange(leadId: string, value: string) {
    setSavingField(true);
    try {
      const response = await updateLead<{ data: LeadDetail }>(leadId, {
        followUpAt: value ? new Date(value).toISOString() : "",
      });
      applyLeadUpdate(response.data);
    } finally {
      setSavingField(false);
    }
  }

  async function handleAddNote(e: React.FormEvent) {
    e.preventDefault();
    if (!detail || !noteText.trim()) return;
    setSavingNote(true);
    try {
      const response = await addLeadNote<{ data: LeadDetail }>(detail.id, noteText.trim());
      applyLeadUpdate(response.data);
      setNoteText("");
    } finally {
      setSavingNote(false);
    }
  }

  async function handleSaveDealValue() {
    if (!detail) return;
    const trimmed = dealValueInput.trim();
    if (trimmed === "" && detail.dealValue === null) return;
    if (trimmed !== "" && Number(trimmed) === detail.dealValue) return;
    setSavingDeal(true);
    try {
      const response = await updateLead<{ data: LeadDetail }>(detail.id, { dealValue: trimmed === "" ? "" : Number(trimmed) });
      applyLeadUpdate(response.data);
    } finally {
      setSavingDeal(false);
    }
  }

  async function handleAddComment(e: React.FormEvent) {
    e.preventDefault();
    if (!detail || !commentText.trim()) return;
    setSavingComment(true);
    try {
      const response = await addLeadInternalComment<{ data: LeadDetail }>(detail.id, commentText.trim());
      applyLeadUpdate(response.data);
      setCommentText("");
    } finally {
      setSavingComment(false);
    }
  }

  async function handleAddTask(e: React.FormEvent) {
    e.preventDefault();
    if (!detail || !newTaskTitle.trim()) return;
    setSavingTask(true);
    try {
      const response = await createTask<{ data: TaskItem }>({
        title: newTaskTitle.trim(),
        contactId: detail.contactId,
        assignedToUserId: newTaskAssigneeId || undefined,
      });
      setTasks((items) => [response.data, ...items]);
      setNewTaskTitle("");
      setNewTaskAssigneeId("");
    } finally {
      setSavingTask(false);
    }
  }

  async function handleToggleTask(task: TaskItem) {
    const nextStatus = task.status === "completed" ? "open" : "completed";
    setTasks((items) => items.map((item) => (item.id === task.id ? { ...item, status: nextStatus } : item)));
    await updateTask(task.id, { status: nextStatus }).catch(() => undefined);
  }

  const filteredLeads = useMemo(() => {
    const q = search.trim().toLowerCase();
    return leads.filter((lead) => {
      if (ownerFilter === "__mine" && lead.ownerUserId !== currentUserId) return false;
      if (ownerFilter === "__none" && lead.ownerUserId) return false;
      if (ownerFilter && !ownerFilter.startsWith("__") && lead.ownerUserId !== ownerFilter) return false;
      if (!q) return true;
      return `${lead.contactName} ${lead.contactPhone} ${lead.source} ${lead.campaign}`.toLowerCase().includes(q);
    });
  }, [leads, search, ownerFilter, currentUserId]);

  const columns = useMemo(() => {
    return stages.map((stage) => {
      const stageLeads = filteredLeads
        .filter((lead) => lead.stage === stage.key)
        .sort((a, b) => new Date(b.lastActivityAt || b.updatedAt).getTime() - new Date(a.lastActivityAt || a.updatedAt).getTime());
      return {
        ...stage,
        leads: stageLeads,
        total: stageLeads.reduce((sum, lead) => sum + (lead.dealValue || 0), 0),
        currency: stageLeads.find((lead) => lead.dealCurrency)?.dealCurrency || "INR",
      };
    });
  }, [filteredLeads, stages]);

  const openValue = columns.filter((c) => c.type !== "won" && c.type !== "lost").reduce((sum, c) => sum + c.total, 0);
  const wonValue = columns.filter((c) => c.type === "won").reduce((sum, c) => sum + c.total, 0);
  const overdueCount = filteredLeads.filter((lead) => lead.status === "open" && followUpState(lead.followUpAt)?.tone === "overdue").length;
  const filtering = Boolean(search.trim() || ownerFilter);

  return (
    <div className="flex w-full min-w-0 flex-1 flex-col overflow-hidden">
      <div className="flex flex-wrap items-center gap-x-5 gap-y-3 border-b border-border px-4 py-3 sm:px-6">
        <dl className="flex items-baseline gap-5 text-[12.5px]">
          <div>
            <dt className="text-muted-foreground">Open pipeline</dt>
            <dd className="font-serif text-[26px] leading-tight text-money tabular-nums">{formatMoneyShort(openValue)}</dd>
          </div>
          <div>
            <dt className="text-muted-foreground">Won</dt>
            <dd className="text-[17px] font-semibold text-foreground tabular-nums">{formatMoneyShort(wonValue)}</dd>
          </div>
          <div>
            <dt className="text-muted-foreground">Leads</dt>
            <dd className="text-[17px] font-semibold text-foreground tabular-nums">{filteredLeads.length}</dd>
          </div>
          {overdueCount > 0 && (
            <div>
              <dt className="text-muted-foreground">Overdue</dt>
              <dd className="text-[17px] font-semibold text-destructive tabular-nums">{overdueCount}</dd>
            </div>
          )}
        </dl>
        <div className="ml-auto flex w-full items-center gap-2 sm:w-auto">
          <label className="flex h-9 min-w-0 flex-1 items-center gap-2 rounded-lg bg-secondary/70 px-2.5 text-muted-foreground focus-within:bg-card focus-within:ring-2 focus-within:ring-ring/30 sm:w-56 sm:flex-none">
            <Search size={15} className="shrink-0" />
            <input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Find a lead"
              aria-label="Find a lead"
              className="min-w-0 flex-1 bg-transparent text-[13px] text-foreground outline-none placeholder:text-muted-foreground"
            />
            {search && (
              <button type="button" onClick={() => setSearch("")} aria-label="Clear search" className="rounded p-0.5 hover:text-foreground">
                <X size={14} />
              </button>
            )}
          </label>
          <select value={ownerFilter} onChange={(event) => setOwnerFilter(event.target.value)} aria-label="Owner" className="h-9 w-36 shrink-0 rounded-lg border border-input bg-card px-2 text-[13px] text-foreground outline-none focus:ring-2 focus:ring-ring/20">
            <option value="">Everyone</option>
            {currentUserId && <option value="__mine">My leads</option>}
            <option value="__none">Unassigned</option>
            {members.map((member) => (
              <option key={member.userId} value={member.userId}>
                {member.name}
              </option>
            ))}
          </select>
        </div>
      </div>

      {moveError && (
        <div className="flex items-center gap-2 border-b border-border bg-problem-soft px-4 py-2 text-[12.5px] text-destructive sm:px-6">
          <span className="flex-1">{moveError}</span>
          <button type="button" onClick={() => setMoveError("")} aria-label="Dismiss" className="rounded p-0.5 hover:bg-card/60">
            <X size={14} />
          </button>
        </div>
      )}

      {loading ? (
        <div className="flex min-h-0 flex-1 gap-3 overflow-hidden p-4 sm:px-6">
          {[0, 1, 2, 3].map((i) => (
            <div key={i} className="w-[272px] shrink-0 space-y-2">
              <div className="h-5 w-28 animate-pulse rounded bg-secondary" />
              {[0, 1, 2].map((j) => (
                <div key={j} className="h-24 animate-pulse rounded-xl bg-secondary/70" />
              ))}
            </div>
          ))}
        </div>
      ) : leads.length === 0 ? (
        <div className="flex flex-1 items-center justify-center p-6">
          <EmptyState title="No leads yet" description="Leads captured from WhatsApp conversations or added from the CRM will show up here." />
        </div>
      ) : (
        <div className="flex min-h-0 flex-1 snap-x gap-3 overflow-x-auto px-4 pb-4 pt-3 sm:px-6">
          {columns.map((column) => {
            const closed = column.type === "won" || column.type === "lost";
            const isDropTarget = dropStage === column.key && dragId && leads.find((l) => l.id === dragId)?.stage !== column.key;
            return (
              <section
                key={column.key}
                aria-label={column.label}
                onDragOver={(event) => {
                  if (!dragId || !canWrite) return;
                  event.preventDefault();
                  event.dataTransfer.dropEffect = "move";
                  if (dropStage !== column.key) setDropStage(column.key);
                }}
                onDragLeave={(event) => {
                  if (!event.currentTarget.contains(event.relatedTarget as Node)) setDropStage((current) => (current === column.key ? "" : current));
                }}
                onDrop={(event) => {
                  event.preventDefault();
                  const id = event.dataTransfer.getData("text/lead-id") || dragId;
                  setDropStage("");
                  setDragId("");
                  if (id) moveLead(id, column.key);
                }}
                className={cn(
                  "flex h-full w-[272px] shrink-0 snap-start flex-col rounded-xl transition-colors",
                  isDropTarget ? "bg-accent ring-2 ring-primary/40" : closed ? "bg-secondary/40" : "bg-secondary/60",
                )}
              >
                <header className="px-3 pb-2 pt-3">
                  <div className="flex items-center gap-2">
                    <span className={cn("size-2 shrink-0 rounded-full", stageDot(column.color))} />
                    <h3 className="min-w-0 flex-1 truncate text-[13px] font-semibold text-foreground">{column.label}</h3>
                    <span className="text-[12px] text-muted-foreground tabular-nums">{column.leads.length}</span>
                  </div>
                  <p className={cn("mt-0.5 pl-4 text-[12px] tabular-nums", column.total ? "text-money" : "text-muted-foreground")}>
                    {column.total ? formatMoneyShort(column.total, column.currency) : "No deal value"}
                  </p>
                </header>
                <div className="min-h-0 flex-1 space-y-2 overflow-y-auto px-2 pb-2">
                  {column.leads.map((lead) => {
                    const follow = lead.status === "open" ? followUpState(lead.followUpAt) : null;
                    return (
                      <article
                        key={lead.id}
                        draggable={canWrite}
                        onDragStart={(event) => {
                          event.dataTransfer.setData("text/lead-id", lead.id);
                          event.dataTransfer.effectAllowed = "move";
                          setDragId(lead.id);
                        }}
                        onDragEnd={() => {
                          setDragId("");
                          setDropStage("");
                        }}
                        className={cn(
                          "group relative rounded-xl border bg-card p-3 shadow-card transition-[box-shadow,opacity,border-color]",
                          selectedId === lead.id ? "border-primary/50 ring-1 ring-primary/25" : "border-transparent hover:border-border",
                          dragId === lead.id && "opacity-50",
                          canWrite && "cursor-grab active:cursor-grabbing",
                        )}
                      >
                        <button type="button" onClick={() => loadDetail(lead.id)} className="absolute inset-0 rounded-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50" aria-label={`Open ${lead.contactName || "lead"}`} />
                        <div className="pointer-events-none relative flex items-start gap-2.5">
                          <span className={cn("flex size-8 shrink-0 items-center justify-center rounded-full text-[11px] font-semibold", avatarTint(lead.contactName))}>{initialsOf(lead.contactName)}</span>
                          <div className="min-w-0 flex-1">
                            <p className="truncate text-[13.5px] font-medium text-foreground">{lead.contactName || "Unknown"}</p>
                            <p className="truncate text-[11.5px] text-muted-foreground tabular-nums">{lead.contactPhone}</p>
                          </div>
                          <span className={cn("shrink-0 rounded-md px-1.5 py-0.5 text-[11px] font-semibold tabular-nums", scoreClass(lead.score))} title="Lead score">
                            {lead.score}
                          </span>
                        </div>
                        {lead.dealValue !== null && (
                          <p className="pointer-events-none relative mt-2 text-[14px] font-semibold text-money tabular-nums">{formatMoney(lead.dealValue, lead.dealCurrency)}</p>
                        )}
                        {follow && (
                          <p
                            className={cn(
                              "pointer-events-none relative mt-1.5 flex items-center gap-1 text-[11.5px] font-medium",
                              follow.tone === "overdue" ? "text-destructive" : follow.tone === "today" ? "text-warning" : "text-muted-foreground",
                            )}
                          >
                            <CalendarClock size={12} />
                            {follow.label}
                          </p>
                        )}
                        <div className="relative mt-2 flex items-center gap-2 text-[11.5px] text-muted-foreground">
                          <span className="pointer-events-none min-w-0 flex-1 truncate">
                            {lead.ownerName || "Unassigned"}
                            {lead.source ? ` · ${lead.source}` : ""}
                          </span>
                          {canWrite && (
                            <DropdownMenu>
                              <DropdownMenuTrigger asChild>
                                <button
                                  type="button"
                                  aria-label={`Move ${lead.contactName || "lead"} to another stage`}
                                  disabled={savingField}
                                  className="flex h-6 items-center gap-1 rounded-md px-1.5 text-[11px] font-medium text-muted-foreground opacity-100 transition-opacity hover:bg-secondary hover:text-foreground sm:opacity-0 sm:group-hover:opacity-100 sm:focus-visible:opacity-100 data-[state=open]:opacity-100"
                                >
                                  <ArrowRightLeft size={12} />
                                  Move
                                </button>
                              </DropdownMenuTrigger>
                              <DropdownMenuContent align="end" className="w-48">
                                <DropdownMenuLabel className="text-xs font-medium text-muted-foreground">Move to</DropdownMenuLabel>
                                {stages.map((stage) => (
                                  <DropdownMenuItem key={stage.key} disabled={stage.key === lead.stage} onSelect={() => moveLead(lead.id, stage.key)}>
                                    <span className={cn("size-2 rounded-full", stageDot(stage.color))} />
                                    {stage.label}
                                  </DropdownMenuItem>
                                ))}
                              </DropdownMenuContent>
                            </DropdownMenu>
                          )}
                        </div>
                      </article>
                    );
                  })}
                  {column.leads.length === 0 && (
                    <div className={cn("rounded-xl border border-dashed px-3 py-5 text-center text-[12px] text-muted-foreground", isDropTarget ? "border-primary/50" : "border-border")}>
                      {isDropTarget ? "Drop here" : filtering ? "No matches" : "No leads"}
                    </div>
                  )}
                </div>
              </section>
            );
          })}
        </div>
      )}

      <Sheet open={Boolean(selectedId)} onOpenChange={(open) => !open && closeDetail()}>
        <SheetContent side="right" className="w-full gap-0 overflow-y-auto p-0 sm:max-w-[440px]">
          {detailLoading || !detail ? (
            <div className="p-5">
              <SheetTitle className="sr-only">Lead details</SheetTitle>
              <SheetDescription className="sr-only">Loading</SheetDescription>
              <LoadingSkeleton />
            </div>
          ) : (
            <>
              <SheetHeader className="gap-3 border-b border-border px-5 pb-4 pt-5">
                <div className="flex items-start gap-3 pr-8">
                  <span className={cn("flex size-12 shrink-0 items-center justify-center rounded-full text-sm font-semibold", avatarTint(detail.contactName))}>{initialsOf(detail.contactName)}</span>
                  <div className="min-w-0 flex-1">
                    <SheetTitle className="truncate text-[17px]">{detail.contactName || "Unknown lead"}</SheetTitle>
                    <SheetDescription className="truncate text-[12.5px] tabular-nums">
                      {detail.contactPhone}
                      {detail.contactEmail ? ` · ${detail.contactEmail}` : ""}
                    </SheetDescription>
                    <p className="mt-0.5 truncate text-[12px] text-muted-foreground">
                      {detail.source}
                      {detail.campaign ? ` · ${detail.campaign}` : ""} · active {relativeTime(detail.lastActivityAt).toLowerCase()}
                    </p>
                  </div>
                </div>
                <div className="flex items-end justify-between gap-3">
                  <div>
                    <p className="text-[11.5px] text-muted-foreground">Deal value</p>
                    <p className="font-serif text-[28px] leading-none text-money tabular-nums">{detail.dealValue !== null ? formatMoney(detail.dealValue, detail.dealCurrency) : "—"}</p>
                  </div>
                  {onOpenContact && detail.contactId && (
                    <Button size="sm" onClick={() => onOpenContact(detail.contactId)}>
                      <MessageCircle size={14} />
                      Open chat
                    </Button>
                  )}
                </div>
              </SheetHeader>

              <PanelSection title="Deal">
                <div className="grid grid-cols-2 gap-2.5">
                  <label className="grid gap-1 text-[12px]">
                    <span className="text-muted-foreground">Stage</span>
                    <select value={detail.stage} disabled={!canWrite || savingField} onChange={(event) => handleStageChange(detail.id, event.target.value)} className={fieldClass}>
                      {stages.map((stage) => (
                        <option key={stage.key} value={stage.key}>
                          {stage.label}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="grid gap-1 text-[12px]">
                    <span className="text-muted-foreground">Owner</span>
                    <select value={detail.ownerUserId} disabled={!canWrite || savingField} onChange={(event) => handleOwnerChange(detail.id, event.target.value)} className={fieldClass}>
                      <option value="">Unassigned</option>
                      {members.map((member) => (
                        <option key={member.userId} value={member.userId}>
                          {member.name}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="grid gap-1 text-[12px]">
                    <span className="text-muted-foreground">Follow-up date</span>
                    <input type="date" value={toDateInputValue(detail.followUpAt)} disabled={!canWrite || savingField} onChange={(event) => handleFollowUpChange(detail.id, event.target.value)} className={fieldClass} />
                  </label>
                  <label className="grid gap-1 text-[12px]">
                    <span className="text-muted-foreground">Deal value ({detail.dealCurrency})</span>
                    <input
                      type="number"
                      min="0"
                      placeholder="0"
                      value={dealValueInput}
                      disabled={!canWrite || savingDeal}
                      onChange={(event) => setDealValueInput(event.target.value)}
                      onBlur={handleSaveDealValue}
                      className={cn(fieldClass, "tabular-nums")}
                    />
                  </label>
                </div>
              </PanelSection>

              <PanelSection title="Tasks" aside={<span className="text-[11.5px] text-muted-foreground tabular-nums">{tasks.filter((t) => t.status === "open").length} open</span>}>
                <div className="grid gap-1">
                  {tasks.length === 0 && <p className="text-[12.5px] text-muted-foreground">No tasks for this lead yet.</p>}
                  {tasks.map((task) => (
                    <button
                      key={task.id}
                      type="button"
                      onClick={() => canWrite && handleToggleTask(task)}
                      className="flex w-full items-center gap-2.5 rounded-lg px-1.5 py-1.5 text-left text-[13px] hover:bg-secondary"
                    >
                      {task.status === "completed" ? <CheckCircle2 size={16} className="shrink-0 text-success" /> : <Circle size={16} className="shrink-0 text-muted-foreground" />}
                      <span className={cn("min-w-0 flex-1 truncate", task.status === "completed" ? "text-muted-foreground line-through" : "text-foreground")}>{task.title}</span>
                      {task.assignedToUserId && <span className="shrink-0 truncate text-[11px] text-muted-foreground">{task.assignedToUserId.name}</span>}
                    </button>
                  ))}
                </div>
                {canWrite && (
                  <form onSubmit={handleAddTask} className="grid gap-1.5">
                    <div className="flex gap-1.5">
                      <input value={newTaskTitle} onChange={(event) => setNewTaskTitle(event.target.value)} placeholder="Add a task" aria-label="New task" className={fieldClass} />
                      <Button type="submit" size="sm" className="h-9" disabled={savingTask || !newTaskTitle.trim()} aria-label="Add task">
                        <Plus size={14} />
                      </Button>
                    </div>
                    <select value={newTaskAssigneeId} onChange={(event) => setNewTaskAssigneeId(event.target.value)} aria-label="Assign task to" className={cn(fieldClass, "h-8 text-[12px] text-muted-foreground")}>
                      <option value="">Assign to… (optional)</option>
                      {members.map((member) => (
                        <option key={member.userId} value={member.userId}>
                          {member.name}
                        </option>
                      ))}
                    </select>
                  </form>
                )}
              </PanelSection>

              <PanelSection title="Timeline">
                {canWrite && (
                  <form onSubmit={handleAddNote} className="flex gap-1.5">
                    <input value={noteText} onChange={(event) => setNoteText(event.target.value)} placeholder="Add a note to the timeline" aria-label="New note" className={fieldClass} />
                    <Button type="submit" size="sm" className="h-9" disabled={savingNote || !noteText.trim()}>
                      Add
                    </Button>
                  </form>
                )}
                <ol className="relative grid gap-3.5 pl-7 before:absolute before:bottom-1 before:left-[11px] before:top-1 before:w-px before:bg-border">
                  {[...detail.timeline].reverse().map((event, index) => (
                    <li key={event.id || index} className="relative">
                      <span className="absolute -left-7 top-0 flex size-[23px] items-center justify-center rounded-full border border-border bg-card">{timelineIcon(event.type)}</span>
                      <p className="text-[13px] text-foreground">
                        {event.title || event.body || event.type}
                        {event.from && event.to ? <span className="text-muted-foreground"> · {event.from.replace(/_/g, " ")} → {event.to.replace(/_/g, " ")}</span> : ""}
                      </p>
                      {event.body && event.title && <p className="mt-0.5 text-[12.5px] text-muted-foreground">{event.body}</p>}
                      <p className="mt-0.5 text-[11px] text-muted-foreground">{relativeTime(event.at)}</p>
                    </li>
                  ))}
                  {detail.timeline.length === 0 && <li className="text-[12.5px] text-muted-foreground">No activity yet.</li>}
                </ol>
              </PanelSection>

              <PanelSection title="Internal comments" icon={<Lock size={11} />}>
                <p className="-mt-1 text-[11.5px] text-muted-foreground">Team only. Never shown to the customer, kept apart from the timeline.</p>
                {canWrite && (
                  <form onSubmit={handleAddComment} className="flex gap-1.5">
                    <input value={commentText} onChange={(event) => setCommentText(event.target.value)} placeholder="Add an internal comment" aria-label="New internal comment" className={fieldClass} />
                    <Button type="submit" size="sm" className="h-9" disabled={savingComment || !commentText.trim()}>
                      Add
                    </Button>
                  </form>
                )}
                <div className="grid gap-2">
                  {[...detail.internalComments].reverse().map((comment, index) => (
                    <div key={comment.id || index} className="rounded-lg bg-bubble-note px-3 py-2">
                      <p className="text-[13px] text-foreground">{comment.text}</p>
                      <p className="mt-0.5 text-[11px] text-muted-foreground">
                        {members.find((member) => member.userId === comment.actorUserId)?.name || "Team member"} · {relativeTime(comment.at)}
                      </p>
                    </div>
                  ))}
                  {detail.internalComments.length === 0 && <p className="text-[12.5px] text-muted-foreground">No internal comments yet.</p>}
                </div>
              </PanelSection>
            </>
          )}
        </SheetContent>
      </Sheet>
    </div>
  );
}
