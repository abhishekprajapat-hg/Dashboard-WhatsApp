import { useEffect, useMemo, useState } from "react";
import type React from "react";
import { Check, Copy, Headset, LifeBuoy, Plus, Search, Sparkles, X } from "lucide-react";
import { Badge } from "./ui/badge";
import { Button } from "./ui/button";
import { Card, CardContent } from "./ui/card";
import { EmptyState } from "./ui/empty-state";
import { Input } from "./ui/input";
import { LoadingSkeleton } from "./ui/loading-skeleton";
import { isPlanLimitError, PlanLockedState } from "./PlanLockedState";
import { createTicket, getConversations, getSettings, getTeamMembers, getTickets, suggestTicketReply, updateTicket, type SupportCategory } from "../lib/api";

interface MemberOption {
  userId: string;
  name: string;
}

interface TicketRecord {
  id: string;
  contactId: string;
  contactName: string;
  contactPhone: string;
  category: string;
  status: "open" | "pending" | "resolved" | "archived";
  assignedToUserId: { id: string; name: string } | null;
  preview: string;
  lastActivity: string;
  createdAt: string;
}

interface ConversationOption {
  id: string;
  name: string;
  phone: string;
  preview: string;
}

interface SupportViewProps {
  canWrite?: boolean;
}

// Fallback only, shown until GET /settings resolves - matches
// server/routes/settings.js's defaultSupportCategories() so a first paint before the fetch
// completes looks identical to what a workspace with no custom categories actually gets from the
// server (master plan "CRM industry-specificity" - this list is now workspace-configurable via
// Settings > CRM, not a fixed platform-wide array).
const DEFAULT_CATEGORIES: SupportCategory[] = [
  { key: "billing", label: "Billing" },
  { key: "delivery", label: "Delivery" },
  { key: "product", label: "Product" },
  { key: "technical", label: "Technical" },
  { key: "general", label: "General" },
  { key: "other", label: "Other" },
];

const STATUS_BADGE: Record<string, { variant: "outline" | "warning" | "success"; label: string }> = {
  open: { variant: "outline", label: "Open" },
  pending: { variant: "warning", label: "Pending" },
  resolved: { variant: "success", label: "Resolved" },
};

function categoryLabel(categories: SupportCategory[], id: string) {
  return categories.find((option) => option.key === id)?.label || id;
}

export function SupportView({ canWrite = false }: SupportViewProps) {
  const [tickets, setTickets] = useState<TicketRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState("");
  const [members, setMembers] = useState<MemberOption[]>([]);
  const [showForm, setShowForm] = useState(false);
  const [lockedMessage, setLockedMessage] = useState("");
  const [updatingId, setUpdatingId] = useState("");
  const [suggestingTicket, setSuggestingTicket] = useState<TicketRecord | null>(null);
  const [categories, setCategories] = useState<SupportCategory[]>(DEFAULT_CATEGORIES);

  useEffect(() => {
    getSettings<{ support?: { categories?: SupportCategory[] } }>()
      .then((response) => {
        if (response.support?.categories?.length) setCategories(response.support.categories);
      })
      .catch(() => undefined);
  }, []);

  function loadTickets() {
    setLoading(true);
    getTickets<{ data: TicketRecord[] }>({ status: statusFilter || undefined })
      .then((response) => setTickets(response.data))
      .catch((error) => {
        if (isPlanLimitError(error)) setLockedMessage(error.message);
        setTickets([]);
      })
      .finally(() => setLoading(false));
  }

  useEffect(loadTickets, [statusFilter]);

  useEffect(() => {
    getTeamMembers<{ data: { userId: string; name: string }[] }>()
      .then((response) => setMembers(response.data.map((member) => ({ userId: member.userId, name: member.name }))))
      .catch(() => undefined);
  }, []);

  const memberName = useMemo(() => new Map(members.map((member) => [member.userId, member.name])), [members]);
  const openCount = tickets.filter((ticket) => ticket.status === "open").length;
  const pendingCount = tickets.filter((ticket) => ticket.status === "pending").length;
  const resolvedCount = tickets.filter((ticket) => ticket.status === "resolved").length;

  async function handleStatusChange(ticket: TicketRecord, status: "open" | "pending" | "resolved") {
    setUpdatingId(ticket.id);
    try {
      const response = await updateTicket<{ data: TicketRecord }>(ticket.id, { status });
      setTickets((items) => items.map((item) => (item.id === ticket.id ? response.data : item)));
    } catch (error) {
      if (isPlanLimitError(error)) setLockedMessage(error.message);
    } finally {
      setUpdatingId("");
    }
  }

  async function handleAssign(ticket: TicketRecord, assignedToUserId: string) {
    setUpdatingId(ticket.id);
    try {
      const response = await updateTicket<{ data: TicketRecord }>(ticket.id, { assignedToUserId });
      setTickets((items) => items.map((item) => (item.id === ticket.id ? response.data : item)));
    } catch (error) {
      if (isPlanLimitError(error)) setLockedMessage(error.message);
    } finally {
      setUpdatingId("");
    }
  }

  if (lockedMessage) {
    return (
      <div className="flex min-h-full w-full items-center justify-center p-6">
        <PlanLockedState title="Customer support is locked" message={lockedMessage} icon={<Headset size={20} />} />
      </div>
    );
  }

  return (
    <div className="relative flex w-full min-w-0 flex-1 flex-col overflow-x-hidden overflow-y-auto">

      <div className="flex flex-col gap-3 border-b border-border px-4 py-3 sm:px-6">
      </div>

      <div className="relative z-10 flex min-h-0 flex-1 flex-col gap-4 p-3 sm:p-4">
        <dl className="grid grid-cols-3 overflow-hidden rounded-xl border border-border bg-card shadow-card">
          {[
            { label: "Open", value: openCount, tone: "text-muted-foreground" },
            { label: "Pending", value: pendingCount, tone: "text-warning" },
            { label: "Resolved", value: resolvedCount, tone: "text-primary" },
          ].map((item, index) => (
            <div key={item.label} className={`px-4 py-3 sm:px-5 ${index > 0 ? "border-l border-border" : ""}`}>
              <dt className="text-[12px] text-muted-foreground">{item.label}</dt>
              <dd className={`mt-0.5 text-[22px] font-semibold tracking-[-0.02em] tabular-nums ${item.tone === "text-destructive" && Number(item.value) > 0 ? "text-destructive" : "text-foreground"}`}>{item.value}</dd>
            </div>
          ))}
        </dl>

        <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-xl border border-border bg-card shadow-card">
          <div className="flex flex-col gap-3 border-b border-border p-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="no-scrollbar flex w-fit max-w-full items-center gap-0.5 overflow-x-auto rounded-lg bg-secondary/70 p-0.5">
              {[
                { id: "", label: "All" },
                { id: "open", label: "Open" },
                { id: "pending", label: "Pending" },
                { id: "resolved", label: "Resolved" },
              ].map((filter) => (
                <button
                  key={filter.label}
                  type="button"
                  onClick={() => setStatusFilter(filter.id)}
                  className={`h-8 rounded-md px-3 text-xs font-medium transition-colors ${
                    statusFilter === filter.id ? "bg-primary/12 text-primary" : "text-muted-foreground hover:bg-secondary hover:text-foreground"
                  }`}
                >
                  {filter.label}
                </button>
              ))}
            </div>
            {canWrite && (
              <Button size="sm" onClick={() => setShowForm(true)}>
                <Plus size={14} />
                New ticket
              </Button>
            )}
          </div>

          {loading ? (
            <div className="p-4">
              <LoadingSkeleton rows={6} />
            </div>
          ) : tickets.length === 0 ? (
            <div className="flex flex-1 items-center justify-center p-6">
              <EmptyState
                icon={<LifeBuoy size={18} />}
                title="No tickets yet"
                description="Categorize a WhatsApp conversation as a support ticket to start tracking it here."
                action={canWrite ? <Button onClick={() => setShowForm(true)}><Plus size={14} /> New ticket</Button> : undefined}
              />
            </div>
          ) : (
            <div className="flex-1 overflow-x-auto overflow-y-auto">
              <table className="w-full min-w-[860px] text-[13px]">
                <thead className="sticky top-0 z-10 border-b border-border bg-background/95 backdrop-blur">
                  <tr>
                    {["Customer", "Category", "Last message", "Status", "Assigned to", "Activity", "Actions"].map((column) => (
                      <th key={column} className="whitespace-nowrap px-3 py-2.5 text-left text-[11.5px] font-medium text-muted-foreground">
                        {column}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {tickets.map((ticket) => {
                    const badge = STATUS_BADGE[ticket.status] || STATUS_BADGE.open;
                    return (
                      <tr key={ticket.id} className="group border-b border-border transition-colors hover:bg-secondary/35">
                        <td className="px-3 py-2.5 font-medium text-foreground">{ticket.contactName}</td>
                        <td className="px-3 py-2.5 text-muted-foreground">{categoryLabel(categories, ticket.category)}</td>
                        <td className="max-w-[220px] truncate px-3 py-3 text-muted-foreground">{ticket.preview}</td>
                        <td className="px-3 py-2.5">
                          {canWrite ? (
                            <select
                              value={ticket.status}
                              onChange={(event) => handleStatusChange(ticket, event.target.value as "open" | "pending" | "resolved")}
                              disabled={updatingId === ticket.id}
                              className="h-7 rounded-md border border-input/85 bg-input-background px-2 text-xs text-foreground outline-none disabled:opacity-40"
                            >
                              <option value="open">Open</option>
                              <option value="pending">Pending</option>
                              <option value="resolved">Resolved</option>
                            </select>
                          ) : (
                            <Badge variant={badge.variant}>{badge.label}</Badge>
                          )}
                        </td>
                        <td className="px-3 py-2.5">
                          {canWrite ? (
                            <select
                              value={ticket.assignedToUserId?.id || ""}
                              onChange={(event) => handleAssign(ticket, event.target.value)}
                              disabled={updatingId === ticket.id}
                              className="h-7 rounded-md border border-input/85 bg-input-background px-2 text-xs text-foreground outline-none disabled:opacity-40"
                            >
                              <option value="">Unassigned</option>
                              {members.map((member) => (
                                <option key={member.userId} value={member.userId}>{member.name}</option>
                              ))}
                            </select>
                          ) : (
                            <span className="text-muted-foreground">{ticket.assignedToUserId?.name || memberName.get(ticket.assignedToUserId?.id || "") || "Unassigned"}</span>
                          )}
                        </td>
                        <td className="px-3 py-2.5 text-muted-foreground">{ticket.lastActivity}</td>
                        <td className="px-3 py-2.5">
                          <button
                            type="button"
                            className="flex items-center gap-1 rounded-md px-2 py-1 text-[11px] font-medium text-primary opacity-0 transition-opacity hover:bg-primary/10 group-hover:opacity-100"
                            onClick={() => setSuggestingTicket(ticket)}
                          >
                            <Sparkles size={12} />
                            Suggest reply
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>

      {showForm && canWrite && (
        <NewTicketModal
          members={members}
          categories={categories}
          onClose={() => setShowForm(false)}
          onCreated={(created) => {
            setTickets((items) => [created, ...items]);
            setShowForm(false);
          }}
          onLocked={setLockedMessage}
        />
      )}

      {suggestingTicket && (
        <SuggestReplyModal ticket={suggestingTicket} onClose={() => setSuggestingTicket(null)} onLocked={setLockedMessage} />
      )}
    </div>
  );
}

// Support pillar's AI piece (platform master plan, Phase 5) - a ticket has no send box of its own
// (that's the Inbox's job), so this surfaces the suggestion as text to copy across rather than
// sending anything from here.
function SuggestReplyModal({ ticket, onClose, onLocked }: { ticket: TicketRecord; onClose: () => void; onLocked: (message: string) => void }) {
  const [loading, setLoading] = useState(true);
  const [reply, setReply] = useState("");
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    suggestTicketReply<{ data: { reply: string; provider: string } }>(ticket.id)
      .then((response) => setReply(response.data.reply))
      .catch((error) => {
        if (isPlanLimitError(error)) onLocked(error.message);
      })
      .finally(() => setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ticket.id]);

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(reply);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // Clipboard access can be denied by the browser (permissions, insecure context) - the text
      // is still visible and selectable in the modal, so this degrades to "copy it by hand"
      // rather than surfacing an error for something that isn't actually broken.
    }
  }

  return (
    <div className="fixed inset-0 z-30 flex items-center justify-center overflow-y-auto bg-black/40 p-3 backdrop-blur-[2px] sm:p-4">
      <div className="max-h-[calc(100dvh-1.5rem)] w-full max-w-md overflow-y-auto rounded-xl border border-border bg-card p-4 shadow-float sm:p-5">
        <div className="mb-4 flex items-start justify-between gap-3">
          <h2 className="flex items-center gap-1.5 text-lg font-semibold text-foreground">
            <Sparkles size={16} className="text-primary" />
            Suggested reply
          </h2>
          <button type="button" className="rounded-lg p-2 text-muted-foreground hover:bg-secondary hover:text-foreground" onClick={onClose}>
            <X size={17} />
          </button>
        </div>

        {loading ? (
          <LoadingSkeleton rows={3} />
        ) : (
          <p className="whitespace-pre-wrap rounded-lg border border-border bg-surface-subtle p-3 text-sm text-foreground">{reply}</p>
        )}

        <div className="mt-4 flex justify-end">
          <Button type="button" variant="outline" onClick={handleCopy} disabled={loading || !reply}>
            {copied ? <Check size={14} /> : <Copy size={14} />}
            {copied ? "Copied" : "Copy to clipboard"}
          </Button>
        </div>
      </div>
    </div>
  );
}

function NewTicketModal({
  members,
  categories,
  onClose,
  onCreated,
  onLocked,
}: {
  members: MemberOption[];
  categories: SupportCategory[];
  onClose: () => void;
  onCreated: (ticket: TicketRecord) => void;
  onLocked: (message: string) => void;
}) {
  const [search, setSearch] = useState("");
  const [results, setResults] = useState<ConversationOption[]>([]);
  const [searching, setSearching] = useState(false);
  const [conversationId, setConversationId] = useState("");
  const [selectedLabel, setSelectedLabel] = useState("");
  const [category, setCategory] = useState("general");
  const [assignedToUserId, setAssignedToUserId] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!search.trim()) {
      setResults([]);
      return;
    }
    setSearching(true);
    const timeout = setTimeout(() => {
      getConversations<{ data: ConversationOption[] }>({ search: search.trim(), limit: 8 })
        .then((response) => setResults(response.data))
        .catch(() => setResults([]))
        .finally(() => setSearching(false));
    }, 300);
    return () => clearTimeout(timeout);
  }, [search]);

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (!conversationId || !category) return;

    setSaving(true);
    try {
      const response = await createTicket<{ data: TicketRecord }>({ conversationId, category, assignedToUserId: assignedToUserId || undefined });
      onCreated(response.data);
    } catch (error) {
      if (isPlanLimitError(error)) onLocked(error.message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-30 flex items-center justify-center overflow-y-auto bg-black/40 p-3 backdrop-blur-[2px] sm:p-4">
      <form onSubmit={handleSubmit} className="max-h-[calc(100dvh-1.5rem)] w-full max-w-lg overflow-y-auto rounded-xl border border-border bg-card p-4 shadow-float sm:p-5">
        <div className="mb-5 flex items-start justify-between gap-3">
          <h2 className="text-lg font-semibold text-foreground">New ticket</h2>
          <button type="button" className="rounded-lg p-2 text-muted-foreground hover:bg-secondary hover:text-foreground" onClick={onClose}>
            <X size={17} />
          </button>
        </div>

        <div className="grid gap-3">
          <label className="space-y-1.5 text-sm">
            <span className="text-foreground">Find the conversation</span>
            <div className="relative">
              <Search size={14} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={selectedLabel || search}
                onChange={(event) => {
                  setSelectedLabel("");
                  setConversationId("");
                  setSearch(event.target.value);
                }}
                placeholder="Search by customer name or phone"
                className="pl-8"
              />
            </div>
            {!conversationId && search.trim() && (
              <div className="max-h-48 overflow-y-auto rounded-md border border-border bg-surface-subtle">
                {searching ? (
                  <p className="p-3 text-xs text-muted-foreground">Searching…</p>
                ) : results.length === 0 ? (
                  <p className="p-3 text-xs text-muted-foreground">No conversations found.</p>
                ) : (
                  results.map((result) => (
                    <button
                      key={result.id}
                      type="button"
                      className="flex w-full flex-col items-start gap-0.5 px-3 py-2 text-left text-xs hover:bg-secondary/60"
                      onClick={() => {
                        setConversationId(result.id);
                        setSelectedLabel(`${result.name} (${result.phone})`);
                      }}
                    >
                      <span className="font-medium text-foreground">{result.name}</span>
                      <span className="text-muted-foreground">{result.phone} — {result.preview}</span>
                    </button>
                  ))
                )}
              </div>
            )}
          </label>

          <label className="space-y-1.5 text-sm">
            <span className="text-foreground">Category</span>
            <select
              value={category}
              onChange={(event) => setCategory(event.target.value)}
              className="flex h-9 w-full min-w-0 rounded-md border border-input/85 bg-input-background px-3 text-sm text-foreground outline-none"
              required
            >
              {categories.map((option) => (
                <option key={option.key} value={option.key}>{option.label}</option>
              ))}
            </select>
          </label>

          <label className="space-y-1.5 text-sm">
            <span className="text-foreground">Assign to (optional)</span>
            <select
              value={assignedToUserId}
              onChange={(event) => setAssignedToUserId(event.target.value)}
              className="flex h-9 w-full min-w-0 rounded-md border border-input/85 bg-input-background px-3 text-sm text-foreground outline-none"
            >
              <option value="">Unassigned</option>
              {members.map((member) => (
                <option key={member.userId} value={member.userId}>{member.name}</option>
              ))}
            </select>
          </label>
        </div>

        <div className="mt-5 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <Button type="button" variant="outline" className="w-full sm:w-auto" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" className="w-full sm:w-auto" disabled={saving || !conversationId}>
            {saving ? "Creating..." : "Create ticket"}
          </Button>
        </div>
      </form>
    </div>
  );
}
