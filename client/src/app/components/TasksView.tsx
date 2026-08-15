import { useEffect, useMemo, useState } from "react";
import {
  addMonths,
  eachDayOfInterval,
  endOfMonth,
  endOfWeek,
  format,
  isSameDay,
  isSameMonth,
  startOfMonth,
  startOfWeek,
  subMonths,
} from "date-fns";
import {
  Calendar as CalendarIcon,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Circle,
  ListChecks,
  Pencil,
  Plus,
  Trash2,
  X,
} from "lucide-react";
import { Badge } from "./ui/badge";
import { Button } from "./ui/button";
import { Card, CardContent } from "./ui/card";
import { EmptyState } from "./ui/empty-state";
import { Input } from "./ui/input";
import { LoadingSkeleton } from "./ui/loading-skeleton";
import {
  createCalendarEvent,
  createTask,
  deleteCalendarEvent,
  deleteTask,
  getCalendarEvents,
  getContacts,
  getTasks,
  getTeamMembers,
  updateCalendarEvent,
  updateTask,
} from "../lib/api";

interface AssignedUser {
  id: string;
  name: string;
}

interface TaskItem {
  id: string;
  title: string;
  description: string;
  status: "open" | "completed";
  dueAt: string | null;
  assignedToUserId: AssignedUser | null;
  contactId: string | null;
}

interface CalendarEventItem {
  id: string;
  title: string;
  description: string;
  startAt: string;
  endAt: string | null;
  assignedToUserId: AssignedUser | null;
  contactId: string | null;
}

interface MemberOption {
  userId: string;
  name: string;
}

interface ContactOption {
  id: string;
  name: string;
}

interface TasksViewProps {
  canWrite?: boolean;
}

function toDatetimeLocal(iso: string) {
  const date = new Date(iso);
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function fromDatetimeLocal(value: string) {
  return value ? new Date(value).toISOString() : "";
}

const tabs: { id: "tasks" | "calendar"; label: string; icon: React.ReactNode }[] = [
  { id: "tasks", label: "Tasks", icon: <ListChecks size={14} /> },
  { id: "calendar", label: "Calendar", icon: <CalendarIcon size={14} /> },
];

export function TasksView({ canWrite = false }: TasksViewProps) {
  const [tab, setTab] = useState<"tasks" | "calendar">("tasks");
  const [members, setMembers] = useState<MemberOption[]>([]);
  const [contacts, setContacts] = useState<ContactOption[]>([]);

  useEffect(() => {
    getTeamMembers<{ data: { userId: string; name: string }[] }>()
      .then((response) => setMembers(response.data.map((member) => ({ userId: member.userId, name: member.name }))))
      .catch(() => undefined);
    getContacts<{ data: { id: string; name: string }[] }>()
      .then((response) => setContacts(response.data.map((contact) => ({ id: contact.id, name: contact.name }))))
      .catch(() => undefined);
  }, []);

  return (
    <div className="relative flex w-full min-w-0 flex-1 flex-col overflow-x-hidden overflow-y-auto">
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_18%_0%,rgba(37,211,102,0.08),transparent_26rem),radial-gradient(circle_at_88%_12%,rgba(79,140,255,0.08),transparent_24rem)]" />

      <div className="relative z-10 flex flex-col gap-4 border-b border-border/80 bg-surface/70 px-3 py-4 backdrop-blur-xl sm:px-6">
        <div className="min-w-0">
          <Badge variant="success" className="mb-2">
            <ListChecks size={12} />
            Team workspace
          </Badge>
          <h1 className="text-2xl font-semibold text-foreground">Tasks &amp; Calendar</h1>
          <p className="mt-1 text-sm text-muted-foreground">Follow-ups and events created by your team or by automation flows.</p>
        </div>

        <div className="no-scrollbar flex items-center gap-1 overflow-x-auto rounded-lg border border-border bg-surface-subtle/70 p-1">
          {tabs.map((item) => (
            <button
              key={item.id}
              type="button"
              onClick={() => setTab(item.id)}
              className={`flex h-8 items-center gap-1.5 rounded-md px-3 text-xs font-medium transition-colors ${
                tab === item.id ? "bg-primary/12 text-primary" : "text-muted-foreground hover:bg-secondary hover:text-foreground"
              }`}
            >
              {item.icon}
              {item.label}
            </button>
          ))}
        </div>
      </div>

      <div className="relative z-10 flex min-h-0 flex-1 flex-col p-3 sm:p-4">
        {tab === "tasks" ? (
          <TasksTab canWrite={canWrite} members={members} contacts={contacts} />
        ) : (
          <CalendarTab canWrite={canWrite} members={members} contacts={contacts} />
        )}
      </div>
    </div>
  );
}

interface TaskFormState {
  title: string;
  description: string;
  dueAt: string;
  assignedToUserId: string;
  contactId: string;
}

const emptyTaskForm: TaskFormState = { title: "", description: "", dueAt: "", assignedToUserId: "", contactId: "" };

function TasksTab({ canWrite, members, contacts }: { canWrite: boolean; members: MemberOption[]; contacts: ContactOption[] }) {
  const [tasks, setTasks] = useState<TaskItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState<"" | "open" | "completed">("");
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState<TaskItem | null>(null);
  const [form, setForm] = useState<TaskFormState>(emptyTaskForm);
  const [saving, setSaving] = useState(false);

  function loadTasks() {
    setLoading(true);
    getTasks<{ data: TaskItem[] }>({ status: statusFilter || undefined })
      .then((response) => setTasks(response.data))
      .catch(() => setTasks([]))
      .finally(() => setLoading(false));
  }

  useEffect(loadTasks, [statusFilter]);

  const contactName = useMemo(() => new Map(contacts.map((contact) => [contact.id, contact.name])), [contacts]);
  const openCount = tasks.filter((task) => task.status === "open").length;
  const completedCount = tasks.filter((task) => task.status === "completed").length;
  const overdueCount = tasks.filter((task) => task.status === "open" && task.dueAt && new Date(task.dueAt) < new Date()).length;

  function openCreateForm() {
    setEditing(null);
    setForm(emptyTaskForm);
    setShowForm(true);
  }

  function openEditForm(task: TaskItem) {
    setEditing(task);
    setForm({
      title: task.title,
      description: task.description,
      dueAt: task.dueAt ? toDatetimeLocal(task.dueAt) : "",
      assignedToUserId: task.assignedToUserId?.id || "",
      contactId: task.contactId || "",
    });
    setShowForm(true);
  }

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (!form.title.trim()) return;

    setSaving(true);
    const payload = {
      title: form.title.trim(),
      description: form.description,
      dueAt: fromDatetimeLocal(form.dueAt),
      assignedToUserId: form.assignedToUserId,
      contactId: form.contactId,
    };

    try {
      if (editing) {
        const response = await updateTask<{ data: TaskItem }>(editing.id, payload);
        setTasks((items) => items.map((item) => (item.id === editing.id ? response.data : item)));
      } else {
        const response = await createTask<{ data: TaskItem }>(payload);
        setTasks((items) => [response.data, ...items]);
      }
      setShowForm(false);
    } finally {
      setSaving(false);
    }
  }

  async function handleToggleStatus(task: TaskItem) {
    const nextStatus = task.status === "open" ? "completed" : "open";
    setTasks((items) => items.map((item) => (item.id === task.id ? { ...item, status: nextStatus } : item)));
    await updateTask(task.id, { status: nextStatus }).catch(loadTasks);
  }

  async function handleDelete(task: TaskItem) {
    setTasks((items) => items.filter((item) => item.id !== task.id));
    await deleteTask(task.id).catch(loadTasks);
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-4">
      <div className="grid gap-3 sm:grid-cols-3">
        {[
          { label: "Open", value: openCount, tone: "text-primary" },
          { label: "Completed", value: completedCount, tone: "text-info" },
          { label: "Overdue", value: overdueCount, tone: "text-destructive" },
        ].map((item) => (
          <Card key={item.label} className="bg-card/75">
            <CardContent className="flex items-center justify-between p-3">
              <div>
                <p className="text-xs text-muted-foreground">{item.label}</p>
                <p className="mt-1 text-xl font-semibold text-foreground">{item.value}</p>
              </div>
              <div className={`flex size-9 items-center justify-center rounded-lg bg-secondary/70 ${item.tone}`}>
                <ListChecks size={16} />
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-xl border border-border/80 bg-card/72 shadow-2xl shadow-black/15">
        <div className="flex flex-col gap-3 border-b border-border/80 p-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="no-scrollbar flex items-center gap-1 overflow-x-auto rounded-lg border border-border bg-surface-subtle/70 p-1">
            {[
              { id: "", label: "All" },
              { id: "open", label: "Open" },
              { id: "completed", label: "Completed" },
            ].map((filter) => (
              <button
                key={filter.label}
                type="button"
                onClick={() => setStatusFilter(filter.id as "" | "open" | "completed")}
                className={`h-8 rounded-md px-3 text-xs font-medium transition-colors ${
                  statusFilter === filter.id ? "bg-primary/12 text-primary" : "text-muted-foreground hover:bg-secondary hover:text-foreground"
                }`}
              >
                {filter.label}
              </button>
            ))}
          </div>
          {canWrite && (
            <Button size="sm" onClick={openCreateForm}>
              <Plus size={14} />
              New task
            </Button>
          )}
        </div>

        {loading ? (
          <div className="p-4">
            <LoadingSkeleton rows={6} />
          </div>
        ) : tasks.length === 0 ? (
          <div className="flex flex-1 items-center justify-center p-6">
            <EmptyState
              icon={<ListChecks size={18} />}
              title="No tasks yet"
              description="Tasks created by automation flows or your team will show up here."
              action={canWrite ? <Button onClick={openCreateForm}><Plus size={14} /> New task</Button> : undefined}
            />
          </div>
        ) : (
          <>
            <div className="no-scrollbar flex-1 overflow-y-auto sm:hidden">
              <div className="divide-y divide-border/70">
                {tasks.map((task) => (
                  <div key={task.id} className="px-3 py-3">
                    <div className="flex items-start gap-3">
                      {canWrite && (
                        <button type="button" onClick={() => handleToggleStatus(task)} className="mt-0.5 text-muted-foreground">
                          {task.status === "completed" ? <CheckCircle2 size={18} className="text-primary" /> : <Circle size={18} />}
                        </button>
                      )}
                      <div className="min-w-0 flex-1">
                        <p className={`truncate text-sm font-medium ${task.status === "completed" ? "text-muted-foreground line-through" : "text-foreground"}`}>{task.title}</p>
                        <p className="mt-1 truncate text-xs text-muted-foreground">{task.assignedToUserId?.name || "Unassigned"}{task.contactId ? ` · ${contactName.get(task.contactId) || "Contact"}` : ""}</p>
                        <p className="mt-1 text-xs text-muted-foreground">{task.dueAt ? format(new Date(task.dueAt), "MMM d, yyyy · h:mm a") : "No due date"}</p>
                      </div>
                      {canWrite && (
                        <div className="flex items-center gap-1">
                          <button className="flex size-7 items-center justify-center rounded-md text-muted-foreground hover:bg-secondary hover:text-foreground" onClick={() => openEditForm(task)}>
                            <Pencil size={13} />
                          </button>
                          <button className="flex size-7 items-center justify-center rounded-md text-muted-foreground hover:bg-destructive/10 hover:text-destructive" onClick={() => handleDelete(task)}>
                            <Trash2 size={13} />
                          </button>
                        </div>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>

            <div className="hidden flex-1 overflow-x-auto overflow-y-auto sm:block">
              <table className="w-full min-w-[760px] text-xs">
                <thead className="sticky top-0 z-10 border-b border-border bg-surface-subtle/95 backdrop-blur">
                  <tr>
                    {["", "Title", "Due date", "Assignee", "Contact", "Actions"].map((column, index) => (
                      <th key={index} className="px-3 py-3 text-left font-medium text-muted-foreground">
                        {index === 0 || column === "Actions" ? "" : column}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {tasks.map((task) => {
                    const overdue = task.status === "open" && task.dueAt && new Date(task.dueAt) < new Date();
                    return (
                      <tr key={task.id} className="group border-b border-border/70 transition-colors hover:bg-secondary/35">
                        <td className="py-3 pl-4 pr-1">
                          {canWrite ? (
                            <button type="button" onClick={() => handleToggleStatus(task)} className="text-muted-foreground">
                              {task.status === "completed" ? <CheckCircle2 size={16} className="text-primary" /> : <Circle size={16} />}
                            </button>
                          ) : (
                            <Badge variant={task.status === "completed" ? "success" : "outline"}>{task.status}</Badge>
                          )}
                        </td>
                        <td className="px-3 py-3">
                          <span className={task.status === "completed" ? "text-muted-foreground line-through" : "text-foreground"}>{task.title}</span>
                        </td>
                        <td className={`px-3 py-3 ${overdue ? "text-destructive" : "text-muted-foreground"}`}>
                          {task.dueAt ? format(new Date(task.dueAt), "MMM d, yyyy · h:mm a") : "—"}
                        </td>
                        <td className="px-3 py-3 text-muted-foreground">{task.assignedToUserId?.name || "Unassigned"}</td>
                        <td className="px-3 py-3 text-muted-foreground">{task.contactId ? contactName.get(task.contactId) || "—" : "—"}</td>
                        <td className="px-3 py-3">
                          {canWrite && (
                            <div className="flex items-center gap-1 opacity-0 transition-opacity group-hover:opacity-100">
                              <button className="flex size-7 items-center justify-center rounded-md text-muted-foreground hover:bg-secondary hover:text-foreground" onClick={() => openEditForm(task)}>
                                <Pencil size={13} />
                              </button>
                              <button className="flex size-7 items-center justify-center rounded-md text-muted-foreground hover:bg-destructive/10 hover:text-destructive" onClick={() => handleDelete(task)}>
                                <Trash2 size={13} />
                              </button>
                            </div>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </>
        )}
      </div>

      {showForm && canWrite && (
        <div className="fixed inset-0 z-30 flex items-center justify-center overflow-y-auto bg-black/65 p-3 backdrop-blur-sm sm:p-4">
          <form onSubmit={handleSubmit} className="max-h-[calc(100dvh-1.5rem)] w-full max-w-lg overflow-y-auto rounded-xl border border-border/90 bg-card p-4 shadow-2xl shadow-black/45 sm:p-5">
            <div className="mb-5 flex items-start justify-between gap-3">
              <h2 className="text-lg font-semibold text-foreground">{editing ? "Edit task" : "New task"}</h2>
              <button type="button" className="rounded-lg p-2 text-muted-foreground hover:bg-secondary hover:text-foreground" onClick={() => setShowForm(false)}>
                <X size={17} />
              </button>
            </div>

            <div className="grid gap-3">
              <label className="space-y-1.5 text-sm">
                <span className="text-foreground">Title</span>
                <Input value={form.title} onChange={(event) => setForm((current) => ({ ...current, title: event.target.value }))} placeholder="Follow up with customer" required />
              </label>
              <label className="space-y-1.5 text-sm">
                <span className="text-foreground">Description</span>
                <Input value={form.description} onChange={(event) => setForm((current) => ({ ...current, description: event.target.value }))} placeholder="Optional details" />
              </label>
              <div className="grid gap-3 sm:grid-cols-2">
                <label className="space-y-1.5 text-sm">
                  <span className="text-foreground">Due date</span>
                  <Input type="datetime-local" value={form.dueAt} onChange={(event) => setForm((current) => ({ ...current, dueAt: event.target.value }))} />
                </label>
                <label className="space-y-1.5 text-sm">
                  <span className="text-foreground">Assignee</span>
                  <select
                    value={form.assignedToUserId}
                    onChange={(event) => setForm((current) => ({ ...current, assignedToUserId: event.target.value }))}
                    className="flex h-9 w-full min-w-0 rounded-md border border-input/85 bg-input-background px-3 text-sm text-foreground outline-none"
                  >
                    <option value="">Unassigned</option>
                    {members.map((member) => (
                      <option key={member.userId} value={member.userId}>{member.name}</option>
                    ))}
                  </select>
                </label>
              </div>
              <label className="space-y-1.5 text-sm">
                <span className="text-foreground">Related contact</span>
                <select
                  value={form.contactId}
                  onChange={(event) => setForm((current) => ({ ...current, contactId: event.target.value }))}
                  className="flex h-9 w-full min-w-0 rounded-md border border-input/85 bg-input-background px-3 text-sm text-foreground outline-none"
                >
                  <option value="">No related contact</option>
                  {contacts.map((contact) => (
                    <option key={contact.id} value={contact.id}>{contact.name}</option>
                  ))}
                </select>
              </label>
            </div>

            <div className="mt-5 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
              <Button type="button" variant="outline" className="w-full sm:w-auto" onClick={() => setShowForm(false)}>
                Cancel
              </Button>
              <Button type="submit" className="w-full sm:w-auto" disabled={saving}>
                {saving ? "Saving..." : "Save task"}
              </Button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}

interface EventFormState {
  title: string;
  description: string;
  startAt: string;
  endAt: string;
  assignedToUserId: string;
  contactId: string;
}

const emptyEventForm: EventFormState = { title: "", description: "", startAt: "", endAt: "", assignedToUserId: "", contactId: "" };

function CalendarTab({ canWrite, members, contacts }: { canWrite: boolean; members: MemberOption[]; contacts: ContactOption[] }) {
  const [monthCursor, setMonthCursor] = useState(() => startOfMonth(new Date()));
  const [events, setEvents] = useState<CalendarEventItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState<CalendarEventItem | null>(null);
  const [form, setForm] = useState<EventFormState>(emptyEventForm);
  const [saving, setSaving] = useState(false);

  const gridStart = startOfWeek(startOfMonth(monthCursor));
  const gridEnd = endOfWeek(endOfMonth(monthCursor));
  const days = useMemo(() => eachDayOfInterval({ start: gridStart, end: gridEnd }), [gridStart, gridEnd]);

  function loadEvents() {
    setLoading(true);
    getCalendarEvents<{ data: CalendarEventItem[] }>({ from: gridStart.toISOString(), to: gridEnd.toISOString() })
      .then((response) => setEvents(response.data))
      .catch(() => setEvents([]))
      .finally(() => setLoading(false));
  }

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(loadEvents, [monthCursor]);

  const eventsByDay = useMemo(() => {
    const map = new Map<string, CalendarEventItem[]>();
    for (const event of events) {
      const key = format(new Date(event.startAt), "yyyy-MM-dd");
      const list = map.get(key) || [];
      list.push(event);
      map.set(key, list);
    }
    return map;
  }, [events]);

  function openCreateForm(day?: Date) {
    setEditing(null);
    setForm({ ...emptyEventForm, startAt: day ? toDatetimeLocal(day.toISOString()) : "" });
    setShowForm(true);
  }

  function openEditForm(event: CalendarEventItem) {
    setEditing(event);
    setForm({
      title: event.title,
      description: event.description,
      startAt: toDatetimeLocal(event.startAt),
      endAt: event.endAt ? toDatetimeLocal(event.endAt) : "",
      assignedToUserId: event.assignedToUserId?.id || "",
      contactId: event.contactId || "",
    });
    setShowForm(true);
  }

  async function handleSubmit(formEvent: React.FormEvent) {
    formEvent.preventDefault();
    if (!form.title.trim() || !form.startAt) return;

    setSaving(true);
    const payload = {
      title: form.title.trim(),
      description: form.description,
      startAt: fromDatetimeLocal(form.startAt),
      endAt: fromDatetimeLocal(form.endAt),
      assignedToUserId: form.assignedToUserId,
      contactId: form.contactId,
    };

    try {
      if (editing) {
        const response = await updateCalendarEvent<{ data: CalendarEventItem }>(editing.id, payload);
        setEvents((items) => items.map((item) => (item.id === editing.id ? response.data : item)));
      } else {
        const response = await createCalendarEvent<{ data: CalendarEventItem }>(payload);
        setEvents((items) => [...items, response.data]);
      }
      setShowForm(false);
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(event: CalendarEventItem) {
    setEvents((items) => items.filter((item) => item.id !== event.id));
    setShowForm(false);
    await deleteCalendarEvent(event.id).catch(loadEvents);
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-4">
      <div className="flex items-center justify-between gap-3 rounded-xl border border-border/80 bg-card/72 p-3">
        <div className="flex items-center gap-2">
          <Button variant="outline" size="icon-sm" onClick={() => setMonthCursor((current) => subMonths(current, 1))}>
            <ChevronLeft size={15} />
          </Button>
          <h2 className="w-40 text-center text-sm font-semibold text-foreground">{format(monthCursor, "MMMM yyyy")}</h2>
          <Button variant="outline" size="icon-sm" onClick={() => setMonthCursor((current) => addMonths(current, 1))}>
            <ChevronRight size={15} />
          </Button>
        </div>
        {canWrite && (
          <Button size="sm" onClick={() => openCreateForm()}>
            <Plus size={14} />
            New event
          </Button>
        )}
      </div>

      {loading ? (
        <div className="rounded-xl border border-border/80 bg-card/72 p-4">
          <LoadingSkeleton rows={6} />
        </div>
      ) : (
        <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-xl border border-border/80 bg-card/72 shadow-2xl shadow-black/15">
          <div className="grid grid-cols-7 border-b border-border/80 text-center text-[11px] font-medium text-muted-foreground">
            {["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map((label) => (
              <div key={label} className="py-2">{label}</div>
            ))}
          </div>
          <div className="grid flex-1 grid-cols-7 overflow-y-auto">
            {days.map((day) => {
              const key = format(day, "yyyy-MM-dd");
              const dayEvents = eventsByDay.get(key) || [];
              const inCurrentMonth = isSameMonth(day, monthCursor);
              const isToday = isSameDay(day, new Date());
              return (
                <div
                  key={key}
                  onClick={() => canWrite && openCreateForm(day)}
                  className={`min-h-24 border-b border-r border-border/60 p-1.5 ${canWrite ? "cursor-pointer hover:bg-secondary/30" : ""} ${inCurrentMonth ? "" : "bg-surface-subtle/40"}`}
                >
                  <span className={`inline-flex size-5 items-center justify-center rounded-full text-[11px] ${isToday ? "bg-primary text-primary-foreground" : inCurrentMonth ? "text-foreground" : "text-muted-foreground/60"}`}>
                    {format(day, "d")}
                  </span>
                  <div className="mt-1 space-y-1">
                    {dayEvents.slice(0, 3).map((event) => (
                      <button
                        key={event.id}
                        type="button"
                        onClick={(clickEvent) => {
                          clickEvent.stopPropagation();
                          openEditForm(event);
                        }}
                        className="block w-full truncate rounded bg-primary/12 px-1.5 py-0.5 text-left text-[10px] font-medium text-primary hover:bg-primary/20"
                      >
                        {format(new Date(event.startAt), "h:mm a")} {event.title}
                      </button>
                    ))}
                    {dayEvents.length > 3 && (
                      <p className="px-1.5 text-[10px] text-muted-foreground">+{dayEvents.length - 3} more</p>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {showForm && canWrite && (
        <div className="fixed inset-0 z-30 flex items-center justify-center overflow-y-auto bg-black/65 p-3 backdrop-blur-sm sm:p-4">
          <form onSubmit={handleSubmit} className="max-h-[calc(100dvh-1.5rem)] w-full max-w-lg overflow-y-auto rounded-xl border border-border/90 bg-card p-4 shadow-2xl shadow-black/45 sm:p-5">
            <div className="mb-5 flex items-start justify-between gap-3">
              <h2 className="text-lg font-semibold text-foreground">{editing ? "Edit event" : "New event"}</h2>
              <button type="button" className="rounded-lg p-2 text-muted-foreground hover:bg-secondary hover:text-foreground" onClick={() => setShowForm(false)}>
                <X size={17} />
              </button>
            </div>

            <div className="grid gap-3">
              <label className="space-y-1.5 text-sm">
                <span className="text-foreground">Title</span>
                <Input value={form.title} onChange={(event) => setForm((current) => ({ ...current, title: event.target.value }))} placeholder="Client call" required />
              </label>
              <label className="space-y-1.5 text-sm">
                <span className="text-foreground">Description</span>
                <Input value={form.description} onChange={(event) => setForm((current) => ({ ...current, description: event.target.value }))} placeholder="Optional details" />
              </label>
              <div className="grid gap-3 sm:grid-cols-2">
                <label className="space-y-1.5 text-sm">
                  <span className="text-foreground">Starts</span>
                  <Input type="datetime-local" value={form.startAt} onChange={(event) => setForm((current) => ({ ...current, startAt: event.target.value }))} required />
                </label>
                <label className="space-y-1.5 text-sm">
                  <span className="text-foreground">Ends</span>
                  <Input type="datetime-local" value={form.endAt} onChange={(event) => setForm((current) => ({ ...current, endAt: event.target.value }))} />
                </label>
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                <label className="space-y-1.5 text-sm">
                  <span className="text-foreground">Assignee</span>
                  <select
                    value={form.assignedToUserId}
                    onChange={(event) => setForm((current) => ({ ...current, assignedToUserId: event.target.value }))}
                    className="flex h-9 w-full min-w-0 rounded-md border border-input/85 bg-input-background px-3 text-sm text-foreground outline-none"
                  >
                    <option value="">Unassigned</option>
                    {members.map((member) => (
                      <option key={member.userId} value={member.userId}>{member.name}</option>
                    ))}
                  </select>
                </label>
                <label className="space-y-1.5 text-sm">
                  <span className="text-foreground">Related contact</span>
                  <select
                    value={form.contactId}
                    onChange={(event) => setForm((current) => ({ ...current, contactId: event.target.value }))}
                    className="flex h-9 w-full min-w-0 rounded-md border border-input/85 bg-input-background px-3 text-sm text-foreground outline-none"
                  >
                    <option value="">None</option>
                    {contacts.map((contact) => (
                      <option key={contact.id} value={contact.id}>{contact.name}</option>
                    ))}
                  </select>
                </label>
              </div>
            </div>

            <div className="mt-5 flex flex-col-reverse gap-2 sm:flex-row sm:justify-between">
              {editing ? (
                <Button type="button" variant="outline" className="border-destructive/30 text-destructive hover:bg-destructive/10" onClick={() => handleDelete(editing)}>
                  <Trash2 size={14} />
                  Delete
                </Button>
              ) : (
                <span />
              )}
              <div className="flex flex-col-reverse gap-2 sm:flex-row">
                <Button type="button" variant="outline" className="w-full sm:w-auto" onClick={() => setShowForm(false)}>
                  Cancel
                </Button>
                <Button type="submit" className="w-full sm:w-auto" disabled={saving}>
                  {saving ? "Saving..." : "Save event"}
                </Button>
              </div>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}
