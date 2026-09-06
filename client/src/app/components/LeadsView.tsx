import { useEffect, useMemo, useState } from "react";
import {
  CalendarClock,
  CheckCircle2,
  Circle,
  Flag,
  Lock,
  ListChecks,
  MessageCircle,
  Plus,
  StickyNote,
  Target,
  UserRoundCheck,
  Wallet,
} from "lucide-react";
import { Badge } from "./ui/badge";
import { Button } from "./ui/button";
import { EmptyState } from "./ui/empty-state";
import { LoadingSkeleton } from "./ui/loading-skeleton";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "./ui/sheet";
import {
  addLeadInternalComment,
  addLeadNote,
  createTask,
  getLead,
  getLeads,
  getTasks,
  getTeamMembers,
  updateLead,
  updateTask,
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
}

interface MemberOption {
  userId: string;
  name: string;
}

const STAGES: { id: string; label: string }[] = [
  { id: "new_lead", label: "New lead" },
  { id: "contacted", label: "Contacted" },
  { id: "qualified", label: "Qualified" },
  { id: "proposal_sent", label: "Proposal sent" },
  { id: "won", label: "Won" },
  { id: "lost", label: "Lost" },
];

const STAGE_ACCENT: Record<string, string> = {
  new_lead: "border-t-info",
  contacted: "border-t-warning",
  qualified: "border-t-primary",
  proposal_sent: "border-t-primary",
  won: "border-t-primary",
  lost: "border-t-destructive",
};

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

function initials(name = "") {
  return (
    name
      .split(" ")
      .map((part) => part[0])
      .filter(Boolean)
      .slice(0, 2)
      .join("")
      .toUpperCase() || "L"
  );
}

function timelineIcon(type: string) {
  switch (type) {
    case "stage_change":
      return <Flag size={13} className="text-primary" />;
    case "owner_change":
      return <UserRoundCheck size={13} className="text-info" />;
    case "follow_up_set":
      return <CalendarClock size={13} className="text-warning" />;
    case "note":
      return <StickyNote size={13} className="text-muted-foreground" />;
    case "deal_updated":
      return <Wallet size={13} className="text-primary" />;
    default:
      return <MessageCircle size={13} className="text-muted-foreground" />;
  }
}

function formatDeal(value: number | null, currency: string) {
  if (value === null || Number.isNaN(value)) return "";
  try {
    return new Intl.NumberFormat("en-IN", { style: "currency", currency: currency || "INR", maximumFractionDigits: 0 }).format(value);
  } catch {
    return `${currency} ${value}`;
  }
}

interface LeadsViewProps {
  canWrite?: boolean;
}

export function LeadsView({ canWrite = false }: LeadsViewProps) {
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
  const [savingTask, setSavingTask] = useState(false);
  const [dealValueInput, setDealValueInput] = useState("");
  const [savingDeal, setSavingDeal] = useState(false);
  const [commentText, setCommentText] = useState("");
  const [savingComment, setSavingComment] = useState(false);

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

  function loadDetail(leadId: string) {
    setSelectedId(leadId);
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
      const response = await createTask<{ data: TaskItem }>({ title: newTaskTitle.trim(), contactId: detail.contactId });
      setTasks((items) => [response.data, ...items]);
      setNewTaskTitle("");
    } finally {
      setSavingTask(false);
    }
  }

  async function handleToggleTask(task: TaskItem) {
    const nextStatus = task.status === "completed" ? "open" : "completed";
    setTasks((items) => items.map((item) => (item.id === task.id ? { ...item, status: nextStatus } : item)));
    await updateTask(task.id, { status: nextStatus }).catch(() => undefined);
  }

  const columns = useMemo(() => {
    return STAGES.map((stage) => ({
      ...stage,
      leads: leads
        .filter((lead) => lead.stage === stage.id)
        .sort((a, b) => new Date(b.lastActivityAt || b.updatedAt).getTime() - new Date(a.lastActivityAt || a.updatedAt).getTime()),
    }));
  }, [leads]);

  return (
    <div className="relative flex w-full min-w-0 flex-1 flex-col overflow-hidden">
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_18%_0%,rgba(37,211,102,0.08),transparent_26rem),radial-gradient(circle_at_88%_12%,rgba(79,140,255,0.08),transparent_24rem)]" />

      <div className="relative z-10 flex flex-col gap-3 border-b border-border/80 bg-surface/70 px-3 py-4 backdrop-blur-xl sm:px-6">
        <div className="min-w-0">
          <Badge variant="success" className="mb-2">
            <Target size={12} />
            Pipeline
          </Badge>
          <h1 className="text-2xl font-semibold text-foreground">Lead pipeline</h1>
          <p className="mt-1 text-sm text-muted-foreground">{leads.length} leads across {STAGES.length} stages</p>
        </div>
      </div>

      {loading ? (
        <div className="relative z-10 flex-1 p-6">
          <LoadingSkeleton />
        </div>
      ) : leads.length === 0 ? (
        <div className="relative z-10 flex flex-1 items-center justify-center p-6">
          <EmptyState
            title="No leads yet"
            description="Leads captured from WhatsApp conversations or added manually from CRM will show up here."
          />
        </div>
      ) : (
        <div className="relative z-10 flex min-h-0 flex-1 gap-3 overflow-x-auto p-3 sm:p-4">
          {columns.map((column) => (
            <div key={column.id} className="flex h-full w-72 shrink-0 flex-col rounded-xl border border-border/80 bg-card/60">
              <div className={`flex items-center justify-between border-b border-t-2 ${STAGE_ACCENT[column.id]} border-border/70 px-3 py-2.5`}>
                <span className="text-sm font-semibold text-foreground">{column.label}</span>
                <span className="rounded-full bg-secondary/70 px-2 py-0.5 text-xs text-muted-foreground">{column.leads.length}</span>
              </div>
              <div className="no-scrollbar flex-1 space-y-2 overflow-y-auto p-2">
                {column.leads.map((lead) => (
                  <div
                    key={lead.id}
                    onClick={() => loadDetail(lead.id)}
                    className={`cursor-pointer rounded-lg border bg-card p-3 shadow-sm transition hover:border-primary/40 ${
                      selectedId === lead.id ? "border-primary/60 ring-1 ring-primary/30" : "border-border/80"
                    }`}
                  >
                    <div className="flex items-center gap-2">
                      <div className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-gradient-to-br from-primary to-teal-700 text-[10px] font-semibold text-primary-foreground">
                        {initials(lead.contactName)}
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-medium text-foreground">{lead.contactName || "Unknown"}</p>
                        <p className="truncate text-[11px] text-muted-foreground">{lead.contactPhone}</p>
                      </div>
                      <span className="shrink-0 rounded-full border border-primary/25 bg-primary/10 px-1.5 py-0.5 text-[10px] font-semibold text-primary">
                        {lead.score}
                      </span>
                    </div>
                    <div className="mt-2 flex items-center justify-between text-[11px] text-muted-foreground">
                      <span className="truncate">{lead.ownerName}</span>
                      <span className="truncate">{lead.source}</span>
                    </div>
                    {lead.dealValue !== null && (
                      <div className="mt-1.5 inline-flex items-center gap-1 rounded-full border border-primary/25 bg-primary/10 px-1.5 py-0.5 text-[10px] font-medium text-primary">
                        <Wallet size={10} />
                        {formatDeal(lead.dealValue, lead.dealCurrency)}
                      </div>
                    )}
                    {canWrite && (
                      <select
                        value={lead.stage}
                        onClick={(event) => event.stopPropagation()}
                        onChange={(event) => handleStageChange(lead.id, event.target.value)}
                        disabled={savingField}
                        className="mt-2 h-7 w-full rounded-md border border-input bg-input-background px-1.5 text-[11px] text-foreground outline-none focus:border-ring focus:ring-2 focus:ring-ring/20"
                      >
                        {STAGES.map((stage) => (
                          <option key={stage.id} value={stage.id}>
                            {stage.label}
                          </option>
                        ))}
                      </select>
                    )}
                  </div>
                ))}
                {column.leads.length === 0 && (
                  <div className="rounded-lg border border-dashed border-border/70 p-4 text-center text-[11px] text-muted-foreground">
                    No leads
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      <Sheet open={Boolean(selectedId)} onOpenChange={(open) => !open && closeDetail()}>
        <SheetContent side="right" className="w-full gap-0 overflow-y-auto p-0 sm:max-w-md">
          {detailLoading || !detail ? (
            <div className="p-4">
              <SheetTitle className="sr-only">Lead details</SheetTitle>
              <LoadingSkeleton />
            </div>
          ) : (
            <>
              <SheetHeader className="border-b border-border/80 pb-4">
                <div className="flex items-start gap-3">
                  <div className="flex size-12 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-primary to-teal-700 text-sm font-semibold text-primary-foreground">
                    {initials(detail.contactName)}
                  </div>
                  <div className="min-w-0 flex-1">
                    <SheetTitle className="truncate text-base">{detail.contactName || "Unknown lead"}</SheetTitle>
                    <p className="truncate text-xs text-muted-foreground">{detail.contactPhone}{detail.contactEmail ? ` · ${detail.contactEmail}` : ""}</p>
                    <p className="mt-1 truncate text-xs text-muted-foreground">{detail.source}{detail.campaign ? ` · ${detail.campaign}` : ""}</p>
                  </div>
                </div>
              </SheetHeader>

              <div className="flex-1 space-y-5 overflow-y-auto p-4">
                <section className="space-y-2 rounded-lg border border-border/80 bg-surface-subtle/55 p-3">
                  <div className="grid grid-cols-2 gap-2">
                    <label className="space-y-1 text-xs">
                      <span className="text-muted-foreground">Stage</span>
                      <select
                        value={detail.stage}
                        disabled={!canWrite || savingField}
                        onChange={(event) => handleStageChange(detail.id, event.target.value)}
                        className="h-8 w-full rounded-md border border-input bg-input-background px-2 text-xs text-foreground outline-none focus:border-ring focus:ring-2 focus:ring-ring/20"
                      >
                        {STAGES.map((stage) => (
                          <option key={stage.id} value={stage.id}>
                            {stage.label}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label className="space-y-1 text-xs">
                      <span className="text-muted-foreground">Owner</span>
                      <select
                        value={detail.ownerUserId}
                        disabled={!canWrite || savingField}
                        onChange={(event) => handleOwnerChange(detail.id, event.target.value)}
                        className="h-8 w-full rounded-md border border-input bg-input-background px-2 text-xs text-foreground outline-none focus:border-ring focus:ring-2 focus:ring-ring/20"
                      >
                        <option value="">Unassigned</option>
                        {members.map((member) => (
                          <option key={member.userId} value={member.userId}>
                            {member.name}
                          </option>
                        ))}
                      </select>
                    </label>
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <label className="space-y-1 text-xs">
                      <span className="text-muted-foreground">Follow-up date</span>
                      <input
                        type="date"
                        value={toDateInputValue(detail.followUpAt)}
                        disabled={!canWrite || savingField}
                        onChange={(event) => handleFollowUpChange(detail.id, event.target.value)}
                        className="h-8 w-full rounded-md border border-input bg-input-background px-2 text-xs text-foreground outline-none focus:border-ring focus:ring-2 focus:ring-ring/20"
                      />
                    </label>
                    <label className="space-y-1 text-xs">
                      <span className="text-muted-foreground">Deal value ({detail.dealCurrency})</span>
                      <input
                        type="number"
                        min="0"
                        placeholder="0"
                        value={dealValueInput}
                        disabled={!canWrite || savingDeal}
                        onChange={(event) => setDealValueInput(event.target.value)}
                        onBlur={handleSaveDealValue}
                        className="h-8 w-full rounded-md border border-input bg-input-background px-2 text-xs text-foreground outline-none focus:border-ring focus:ring-2 focus:ring-ring/20"
                      />
                    </label>
                  </div>
                  <div className="text-[11px] text-muted-foreground">Last activity: {relativeTime(detail.lastActivityAt)}</div>
                </section>

                <section>
                  <h3 className="mb-2 flex items-center gap-2 text-xs font-semibold uppercase text-muted-foreground">
                    <ListChecks size={14} /> Tasks for this lead
                  </h3>
                  <div className="space-y-1.5">
                    {tasks.length === 0 && <p className="text-xs text-muted-foreground">No tasks yet.</p>}
                    {tasks.map((task) => (
                      <button
                        key={task.id}
                        type="button"
                        onClick={() => canWrite && handleToggleTask(task)}
                        className="flex w-full items-center gap-2 rounded-md border border-border/70 bg-card px-2.5 py-1.5 text-left text-xs hover:border-primary/40"
                      >
                        {task.status === "completed" ? (
                          <CheckCircle2 size={14} className="shrink-0 text-primary" />
                        ) : (
                          <Circle size={14} className="shrink-0 text-muted-foreground" />
                        )}
                        <span className={`min-w-0 flex-1 truncate ${task.status === "completed" ? "text-muted-foreground line-through" : "text-foreground"}`}>
                          {task.title}
                        </span>
                      </button>
                    ))}
                  </div>
                  {canWrite && (
                    <form onSubmit={handleAddTask} className="mt-2 flex gap-1.5">
                      <input
                        value={newTaskTitle}
                        onChange={(event) => setNewTaskTitle(event.target.value)}
                        placeholder="Quick add a task..."
                        className="h-8 flex-1 rounded-md border border-input bg-input-background px-2 text-xs text-foreground outline-none focus:border-ring focus:ring-2 focus:ring-ring/20"
                      />
                      <Button type="submit" size="sm" disabled={savingTask || !newTaskTitle.trim()}>
                        <Plus size={13} />
                      </Button>
                    </form>
                  )}
                </section>

                <section>
                  <h3 className="mb-2 flex items-center gap-2 text-xs font-semibold uppercase text-muted-foreground">
                    <StickyNote size={14} /> Activity timeline
                  </h3>
                  {canWrite && (
                    <form onSubmit={handleAddNote} className="mb-3 flex gap-1.5">
                      <input
                        value={noteText}
                        onChange={(event) => setNoteText(event.target.value)}
                        placeholder="Add a note..."
                        className="h-8 flex-1 rounded-md border border-input bg-input-background px-2 text-xs text-foreground outline-none focus:border-ring focus:ring-2 focus:ring-ring/20"
                      />
                      <Button type="submit" size="sm" disabled={savingNote || !noteText.trim()}>
                        Add
                      </Button>
                    </form>
                  )}
                  <div className="space-y-3 border-l border-border/70 pl-3">
                    {[...detail.timeline].reverse().map((event, index) => (
                      <div key={event.id || index} className="relative">
                        <span className="absolute -left-[19px] top-0.5 flex size-4 items-center justify-center rounded-full border border-border bg-card">
                          {timelineIcon(event.type)}
                        </span>
                        <p className="text-xs text-foreground">
                          {event.title || event.body || event.type}
                          {event.from && event.to ? ` (${event.from.replace(/_/g, " ")} → ${event.to.replace(/_/g, " ")})` : ""}
                        </p>
                        {event.body && event.title && <p className="mt-0.5 text-xs text-muted-foreground">{event.body}</p>}
                        <p className="mt-0.5 text-[10px] text-muted-foreground">{relativeTime(event.at)}</p>
                      </div>
                    ))}
                    {detail.timeline.length === 0 && <p className="text-xs text-muted-foreground">No activity yet.</p>}
                  </div>
                </section>

                <section className="rounded-lg border border-dashed border-border/70 bg-secondary/20 p-3">
                  <h3 className="mb-2 flex items-center gap-2 text-xs font-semibold uppercase text-muted-foreground">
                    <Lock size={13} /> Internal comments
                  </h3>
                  <p className="mb-2 text-[10px] text-muted-foreground">Team-only - never shown to the customer, kept separate from the activity timeline above.</p>
                  {canWrite && (
                    <form onSubmit={handleAddComment} className="mb-3 flex gap-1.5">
                      <input
                        value={commentText}
                        onChange={(event) => setCommentText(event.target.value)}
                        placeholder="Add an internal comment..."
                        className="h-8 flex-1 rounded-md border border-input bg-input-background px-2 text-xs text-foreground outline-none focus:border-ring focus:ring-2 focus:ring-ring/20"
                      />
                      <Button type="submit" size="sm" disabled={savingComment || !commentText.trim()}>
                        Add
                      </Button>
                    </form>
                  )}
                  <div className="space-y-2">
                    {[...detail.internalComments].reverse().map((comment, index) => (
                      <div key={comment.id || index} className="rounded-md border border-border/60 bg-card px-2.5 py-1.5">
                        <p className="text-xs text-foreground">{comment.text}</p>
                        <p className="mt-0.5 text-[10px] text-muted-foreground">
                          {members.find((member) => member.userId === comment.actorUserId)?.name || "Team member"} · {relativeTime(comment.at)}
                        </p>
                      </div>
                    ))}
                    {detail.internalComments.length === 0 && <p className="text-xs text-muted-foreground">No internal comments yet.</p>}
                  </div>
                </section>
              </div>
            </>
          )}
        </SheetContent>
      </Sheet>
    </div>
  );
}
