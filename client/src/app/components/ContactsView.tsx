import { useEffect, useMemo, useState } from "react";
import {
  Activity,
  Download,
  Filter,
  Mail,
  MessageCircle,
  MoreHorizontal,
  Phone,
  Plus,
  Search,
  Tag,
  Upload,
  UserRound,
  Users,
  X,
} from "lucide-react";
import { Badge } from "./ui/badge";
import { Button } from "./ui/button";
import { Card, CardContent } from "./ui/card";
import { EmptyState } from "./ui/empty-state";
import { Input } from "./ui/input";
import { LoadingSkeleton } from "./ui/loading-skeleton";
import { createContact, deleteContact, getContacts } from "../lib/api";
import { demoContacts } from "../lib/demoData";

interface Contact {
  id: string;
  name: string;
  phone: string;
  email: string;
  tags: string[];
  assignedTo: string;
  source: string;
  lastActivity: string;
  conversations: number;
  status: "active" | "inactive" | "blocked";
  lifecycleStatus?: "lead" | "customer" | "active" | "inactive";
  crmStage?: string;
  crmAddedAt?: string;
}

const fallbackContacts = demoContacts as Contact[];

const lifecycleColors: Record<string, string> = {
  lead: "border-primary/25 bg-primary/10 text-primary",
  customer: "border-info/25 bg-info/10 text-info",
  active: "border-primary/25 bg-primary/10 text-primary",
  inactive: "border-border bg-secondary/70 text-muted-foreground",
  blocked: "border-destructive/25 bg-destructive/10 text-destructive",
};

const statusDot: Record<string, string> = {
  active: "bg-primary",
  lead: "bg-primary",
  customer: "bg-info",
  inactive: "bg-muted-foreground",
  blocked: "bg-destructive",
};

const crmFilters = [
  { id: "", label: "All" },
  { id: "lead", label: "Leads" },
  { id: "customer", label: "Customers" },
];

interface ContactsViewProps {
  onOpenContactChat?: (contactId: string) => void;
  canWrite?: boolean;
}

function contactInitials(name = "") {
  return name
    .split(" ")
    .map((part) => part[0])
    .join("")
    .slice(0, 2)
    .toUpperCase() || "WA";
}

function stageLabel(contact: Contact) {
  return (contact.crmStage || contact.lifecycleStatus || "new_lead").replace(/_/g, " ");
}

function contactLifecycle(contact: Contact) {
  return contact.lifecycleStatus || contact.status || "lead";
}

function ContactAvatar({ contact, size = "md" }: { contact: Contact; size?: "sm" | "md" | "lg" }) {
  const classes = {
    sm: "size-8 rounded-lg text-[10px]",
    md: "size-10 rounded-xl text-xs",
    lg: "size-16 rounded-2xl text-lg",
  };

  return (
    <div className={`${classes[size]} flex shrink-0 items-center justify-center bg-gradient-to-br from-primary to-teal-700 font-semibold text-primary-foreground shadow-[0_12px_28px_rgba(37,211,102,0.14)]`}>
      {contactInitials(contact.name)}
    </div>
  );
}

export function ContactsView({ onOpenContactChat, canWrite = false }: ContactsViewProps) {
  const [search, setSearch] = useState("");
  const [crmFilter, setCrmFilter] = useState("");
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [contacts, setContacts] = useState<Contact[]>(fallbackContacts);
  const [selectedContactId, setSelectedContactId] = useState<string>("");
  const [showCreate, setShowCreate] = useState(false);
  const [form, setForm] = useState({ name: "", phone: "", email: "", tags: "" });
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;
    setLoading(true);
    getContacts<{ data: Contact[]; total: number }>("", crmFilter)
      .then((response) => {
        if (active) setContacts(response.data);
      })
      .catch(() => {
        if (active) setContacts(fallbackContacts);
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    setSelectedIds([]);

    return () => {
      active = false;
    };
  }, [crmFilter]);

  const filtered = useMemo(() => {
    const query = search.trim().toLowerCase();
    if (!query) return contacts;
    return contacts.filter((contact) => {
      const haystack = [
        contact.name,
        contact.phone,
        contact.email,
        contact.source,
        contact.assignedTo,
        contact.crmStage,
        contact.lifecycleStatus,
        ...(contact.tags || []),
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();
      return haystack.includes(query);
    });
  }, [contacts, search]);

  const selectedContact = contacts.find((contact) => contact.id === selectedContactId) || filtered[0] || contacts[0];
  const leadCount = contacts.filter((contact) => contactLifecycle(contact) === "lead").length;
  const customerCount = contacts.filter((contact) => contactLifecycle(contact) === "customer").length;
  const activeCount = contacts.filter((contact) => contact.status === "active" || contactLifecycle(contact) === "active").length;

  function toggleSelect(id: string) {
    setSelectedIds((prev) => (prev.includes(id) ? prev.filter((item) => item !== id) : [...prev, id]));
  }

  function toggleAll() {
    setSelectedIds((prev) => (prev.length === filtered.length ? [] : filtered.map((contact) => contact.id)));
  }

  async function handleCreateContact(e: React.FormEvent) {
    e.preventDefault();
    if (!form.name.trim() || !form.phone.trim()) return;

    setSaving(true);
    try {
      const response = await createContact<{ data: Contact }>({
        name: form.name.trim(),
        phone: form.phone.trim(),
        email: form.email.trim(),
        tags: form.tags.split(",").map((tag) => tag.trim()).filter(Boolean),
      });
      setContacts((items) => [response.data, ...items]);
      setSelectedContactId(response.data.id);
      setForm({ name: "", phone: "", email: "", tags: "" });
      setShowCreate(false);
    } finally {
      setSaving(false);
    }
  }

  async function handleDeleteSelected() {
    const ids = selectedIds;
    setSelectedIds([]);
    setContacts((items) => items.filter((contact) => !ids.includes(contact.id)));
    if (selectedContact && ids.includes(selectedContact.id)) setSelectedContactId("");

    await Promise.all(ids.map((id) => deleteContact(id).catch(() => undefined)));
  }

  function openContact(contact: Contact) {
    setSelectedContactId(contact.id);
  }

  return (
    <div className="relative flex flex-1 flex-col overflow-hidden">
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_18%_0%,rgba(37,211,102,0.08),transparent_26rem),radial-gradient(circle_at_88%_12%,rgba(79,140,255,0.08),transparent_24rem)]" />

      <div className="relative z-10 flex flex-col gap-4 border-b border-border/80 bg-surface/70 px-3 py-4 backdrop-blur-xl sm:px-6">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          <div className="min-w-0">
            <Badge variant="success" className="mb-2">
              <Users size={12} />
              CRM workspace
            </Badge>
            <h1 className="text-2xl font-semibold text-foreground">Contacts</h1>
            <p className="mt-1 text-sm text-muted-foreground">{leadCount} leads · {customerCount} customers · {contacts.length} total records</p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Button variant="outline" size="sm" className="hidden sm:inline-flex">
              <Upload size={14} />
              Import
            </Button>
            <Button variant="outline" size="sm" className="hidden sm:inline-flex">
              <Download size={14} />
              Export
            </Button>
            {canWrite && (
              <Button size="sm" onClick={() => setShowCreate(true)}>
                <Plus size={14} />
                New lead
              </Button>
            )}
          </div>
        </div>

        <div className="grid gap-3 sm:grid-cols-3">
          {[
            { label: "Active contacts", value: activeCount, icon: <Activity size={16} />, tone: "text-primary" },
            { label: "Leads", value: leadCount, icon: <UserRound size={16} />, tone: "text-info" },
            { label: "Selected", value: selectedIds.length, icon: <Filter size={16} />, tone: "text-warning" },
          ].map((item) => (
            <Card key={item.label} className="bg-card/75">
              <CardContent className="flex items-center justify-between p-3">
                <div>
                  <p className="text-xs text-muted-foreground">{item.label}</p>
                  <p className="mt-1 text-xl font-semibold text-foreground">{item.value}</p>
                </div>
                <div className={`flex size-9 items-center justify-center rounded-lg bg-secondary/70 ${item.tone}`}>{item.icon}</div>
              </CardContent>
            </Card>
          ))}
        </div>
      </div>

      {showCreate && canWrite && (
        <div className="absolute inset-0 z-30 flex items-center justify-center bg-black/65 p-4 backdrop-blur-sm">
          <form onSubmit={handleCreateContact} className="w-full max-w-2xl rounded-xl border border-border/90 bg-card p-5 shadow-2xl shadow-black/45">
            <div className="mb-5 flex items-start justify-between gap-3">
              <div>
                <h2 className="text-lg font-semibold text-foreground">Create contact</h2>
                <p className="mt-1 text-sm text-muted-foreground">Add a lead to your WhatsApp CRM without changing campaign or inbox behavior.</p>
              </div>
              <button type="button" className="rounded-lg p-2 text-muted-foreground hover:bg-secondary hover:text-foreground" onClick={() => setShowCreate(false)}>
                <X size={17} />
              </button>
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              <label className="space-y-1.5 text-sm">
                <span className="text-foreground">Name</span>
                <Input value={form.name} onChange={(e) => setForm((current) => ({ ...current, name: e.target.value }))} placeholder="Customer name" required />
              </label>
              <label className="space-y-1.5 text-sm">
                <span className="text-foreground">Phone</span>
                <Input value={form.phone} onChange={(e) => setForm((current) => ({ ...current, phone: e.target.value }))} placeholder="+91 98765 43210" required />
              </label>
              <label className="space-y-1.5 text-sm">
                <span className="text-foreground">Email</span>
                <Input type="email" value={form.email} onChange={(e) => setForm((current) => ({ ...current, email: e.target.value }))} placeholder="customer@company.com" />
              </label>
              <label className="space-y-1.5 text-sm">
                <span className="text-foreground">Tags</span>
                <Input value={form.tags} onChange={(e) => setForm((current) => ({ ...current, tags: e.target.value }))} placeholder="VIP, Sales, Support" />
              </label>
            </div>

            <div className="mt-5 flex justify-end gap-2">
              <Button type="button" variant="outline" onClick={() => setShowCreate(false)}>
                Cancel
              </Button>
              <Button type="submit" disabled={saving}>
                {saving ? "Saving..." : "Save contact"}
              </Button>
            </div>
          </form>
        </div>
      )}

      <div className="relative z-10 flex min-h-0 flex-1 flex-col gap-4 p-3 sm:p-4 lg:grid lg:grid-cols-[minmax(0,1fr)_340px]">
        <div className="flex min-h-0 flex-col overflow-hidden rounded-xl border border-border/80 bg-card/72 shadow-2xl shadow-black/15">
          <div className="flex flex-col gap-3 border-b border-border/80 p-3 sm:flex-row sm:items-center">
            <div className="relative min-w-0 flex-1">
              <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
              <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search name, phone, email, tags, source..." className="h-10 pl-9" />
            </div>
            <div className="no-scrollbar flex items-center gap-1 overflow-x-auto rounded-lg border border-border bg-surface-subtle/70 p-1">
              {crmFilters.map((filter) => (
                <button
                  key={filter.label}
                  type="button"
                  onClick={() => setCrmFilter(filter.id)}
                  className={`h-8 rounded-md px-3 text-xs font-medium transition-colors ${crmFilter === filter.id ? "bg-primary/12 text-primary" : "text-muted-foreground hover:bg-secondary hover:text-foreground"}`}
                >
                  {filter.label}
                </button>
              ))}
            </div>
            <Button variant="outline" size="sm" className="h-10 w-fit">
              <Filter size={14} />
              Filter
            </Button>
          </div>

          {canWrite && selectedIds.length > 0 && (
            <div className="flex flex-wrap items-center gap-2 border-b border-border/80 bg-primary/5 px-3 py-2">
              <span className="text-xs text-muted-foreground">{selectedIds.length} selected</span>
              <Button variant="outline" size="sm" onClick={() => selectedContact && onOpenContactChat?.(selectedContact.id)}>
                <MessageCircle size={13} />
                Message
              </Button>
              <Button variant="outline" size="sm">Assign</Button>
              <Button variant="outline" size="sm" className="border-destructive/30 text-destructive hover:bg-destructive/10" onClick={handleDeleteSelected}>
                Delete
              </Button>
            </div>
          )}

          {loading ? (
            <div className="p-4">
              <LoadingSkeleton rows={8} />
            </div>
          ) : filtered.length === 0 ? (
            <div className="flex flex-1 items-center justify-center p-6">
              <EmptyState
                icon={<Users size={18} />}
                title={contacts.length === 0 ? "No contacts yet" : "No contacts match your search"}
                description={contacts.length === 0 ? "Create your first lead or import contacts to start using CRM workflows." : "Try a different name, phone, tag, source, or lifecycle filter."}
                action={canWrite && contacts.length === 0 ? <Button onClick={() => setShowCreate(true)}><Plus size={14} /> New lead</Button> : undefined}
              />
            </div>
          ) : (
            <>
              <div className="no-scrollbar flex-1 overflow-y-auto sm:hidden">
                <div className="divide-y divide-border/70">
                  {filtered.map((contact) => {
                    const lifecycle = contactLifecycle(contact);
                    return (
                      <button
                        key={contact.id}
                        type="button"
                        onClick={() => openContact(contact)}
                        className={`w-full px-3 py-3 text-left transition-colors hover:bg-secondary/35 ${selectedContact?.id === contact.id ? "bg-primary/7" : ""}`}
                      >
                        <div className="flex items-start gap-3">
                          {canWrite && (
                            <input
                              type="checkbox"
                              checked={selectedIds.includes(contact.id)}
                              onClick={(event) => event.stopPropagation()}
                              onChange={() => toggleSelect(contact.id)}
                              className="mt-1 rounded"
                            />
                          )}
                          <ContactAvatar contact={contact} />
                          <div className="min-w-0 flex-1">
                            <div className="flex items-center gap-2">
                              <span className={`size-1.5 shrink-0 rounded-full ${statusDot[lifecycle] || statusDot.active}`} />
                              <span className="truncate text-sm font-medium text-foreground">{contact.name}</span>
                              <Badge variant="outline" className={`capitalize ${lifecycleColors[lifecycle] || lifecycleColors.lead}`}>
                                {lifecycle}
                              </Badge>
                            </div>
                            <p className="mt-1 truncate font-mono text-xs text-muted-foreground">{contact.phone}</p>
                            <p className="truncate text-xs text-muted-foreground">{contact.email || contact.source || "WhatsApp"}</p>
                            <div className="mt-2 flex flex-wrap gap-1">
                              {(contact.tags || []).slice(0, 3).map((tag) => (
                                <Badge key={tag} variant="outline" className="border-border text-[10px] text-muted-foreground">
                                  {tag}
                                </Badge>
                              ))}
                              <span className="ml-auto text-[11px] text-muted-foreground">{contact.lastActivity || "No activity"}</span>
                            </div>
                          </div>
                        </div>
                      </button>
                    );
                  })}
                </div>
              </div>

              <div className="hidden flex-1 overflow-x-auto overflow-y-auto sm:block">
                <table className="w-full min-w-[980px] text-xs">
                  <thead className="sticky top-0 z-10 border-b border-border bg-surface-subtle/95 backdrop-blur">
                    <tr>
                      {canWrite && (
                        <th className="w-8 py-3 pl-4 pr-3 text-left">
                          <input type="checkbox" checked={selectedIds.length === filtered.length && filtered.length > 0} onChange={toggleAll} className="rounded" />
                        </th>
                      )}
                      {["Name", "Phone", "Email", "Tags", "Stage", "Assigned", "Source", "Last activity", "Chats", ""].map((column) => (
                        <th key={column} className="px-3 py-3 text-left font-medium text-muted-foreground">
                          {column}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {filtered.map((contact) => {
                      const lifecycle = contactLifecycle(contact);
                      return (
                        <tr
                          key={contact.id}
                          onClick={() => openContact(contact)}
                          className={`group cursor-pointer border-b border-border/70 transition-colors hover:bg-secondary/35 ${selectedContact?.id === contact.id ? "bg-primary/7" : ""}`}
                        >
                          {canWrite && (
                            <td className="py-3 pl-4 pr-3">
                              <input
                                type="checkbox"
                                checked={selectedIds.includes(contact.id)}
                                onClick={(event) => event.stopPropagation()}
                                onChange={() => toggleSelect(contact.id)}
                                className="rounded"
                              />
                            </td>
                          )}
                          <td className="px-3 py-3">
                            <div className="flex items-center gap-3">
                              <ContactAvatar contact={contact} size="sm" />
                              <div className="min-w-0">
                                <div className="flex items-center gap-2">
                                  <span className={`size-1.5 shrink-0 rounded-full ${statusDot[lifecycle] || statusDot.active}`} />
                                  <span className="truncate font-medium text-foreground">{contact.name}</span>
                                </div>
                                <span className="text-[11px] text-muted-foreground">{contact.conversations || 0} conversations</span>
                              </div>
                            </div>
                          </td>
                          <td className="px-3 py-3 font-mono text-muted-foreground">{contact.phone}</td>
                          <td className="px-3 py-3 text-muted-foreground">{contact.email || "—"}</td>
                          <td className="px-3 py-3">
                            <div className="flex max-w-56 flex-wrap gap-1">
                              {(contact.tags || []).length ? (
                                contact.tags.map((tag) => (
                                  <Badge key={tag} variant="outline" className="border-border text-[10px] text-muted-foreground">
                                    {tag}
                                  </Badge>
                                ))
                              ) : (
                                <span className="text-muted-foreground">—</span>
                              )}
                            </div>
                          </td>
                          <td className="px-3 py-3">
                            <Badge variant="outline" className={`capitalize ${lifecycleColors[lifecycle] || lifecycleColors.lead}`}>
                              {stageLabel(contact)}
                            </Badge>
                          </td>
                          <td className="px-3 py-3 text-muted-foreground">{contact.assignedTo || "Unassigned"}</td>
                          <td className="px-3 py-3 text-muted-foreground">{contact.source || "WhatsApp"}</td>
                          <td className="px-3 py-3 text-muted-foreground">{contact.lastActivity || "No activity"}</td>
                          <td className="px-3 py-3 text-muted-foreground">{contact.conversations || 0}</td>
                          <td className="px-3 py-3">
                            <div className="flex items-center gap-1 opacity-0 transition-opacity group-hover:opacity-100">
                              <button
                                className="flex size-7 items-center justify-center rounded-md text-muted-foreground hover:bg-secondary hover:text-primary"
                                onClick={(event) => {
                                  event.stopPropagation();
                                  onOpenContactChat?.(contact.id);
                                }}
                              >
                                <MessageCircle size={13} />
                              </button>
                              <button className="flex size-7 items-center justify-center rounded-md text-muted-foreground hover:bg-secondary hover:text-foreground" onClick={(event) => event.stopPropagation()}>
                                <MoreHorizontal size={13} />
                              </button>
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </>
          )}

          <div className="flex items-center justify-between gap-3 border-t border-border/80 px-3 py-3">
            <span className="text-xs text-muted-foreground">Showing {filtered.length} of {contacts.length} contacts</span>
            <div className="hidden items-center gap-1 sm:flex">
              <Button variant="outline" size="sm" className="h-8" disabled>
                Previous
              </Button>
              <Button variant="outline" size="sm" className="h-8 bg-primary/10 text-primary">
                1
              </Button>
              <Button variant="outline" size="sm" className="h-8">
                Next
              </Button>
            </div>
          </div>
        </div>

        {selectedContact ? (
          <aside className="hidden min-h-0 flex-col overflow-hidden rounded-xl border border-border/80 bg-card/72 shadow-2xl shadow-black/15 lg:flex">
            <div className="border-b border-border/80 p-5 text-center">
              <ContactAvatar contact={selectedContact} size="lg" />
              <h2 className="mt-3 truncate text-lg font-semibold text-foreground">{selectedContact.name}</h2>
              <p className="font-mono text-xs text-muted-foreground">{selectedContact.phone}</p>
              <Badge variant="outline" className={`mt-3 capitalize ${lifecycleColors[contactLifecycle(selectedContact)] || lifecycleColors.lead}`}>
                {stageLabel(selectedContact)}
              </Badge>
            </div>

            <div className="no-scrollbar min-h-0 flex-1 space-y-5 overflow-y-auto p-4">
              <section>
                <h3 className="mb-2 flex items-center gap-2 text-xs font-semibold uppercase text-muted-foreground">
                  <Phone size={14} />
                  Contact
                </h3>
                <div className="space-y-2 rounded-lg border border-border/80 bg-surface-subtle/55 p-3 text-sm">
                  <div className="flex items-center gap-2 text-muted-foreground"><Phone size={14} /> {selectedContact.phone}</div>
                  <div className="flex items-center gap-2 text-muted-foreground"><Mail size={14} /> {selectedContact.email || "No email"}</div>
                  <div className="flex items-center gap-2 text-muted-foreground"><Activity size={14} /> {selectedContact.lastActivity || "No activity"}</div>
                </div>
              </section>

              <section>
                <h3 className="mb-2 flex items-center gap-2 text-xs font-semibold uppercase text-muted-foreground">
                  <Tag size={14} />
                  Tags
                </h3>
                <div className="flex flex-wrap gap-1.5">
                  {(selectedContact.tags?.length ? selectedContact.tags : ["New"]).map((tag) => (
                    <Badge key={tag} variant="outline" className="border-border text-muted-foreground">
                      {tag}
                    </Badge>
                  ))}
                </div>
              </section>

              <section>
                <h3 className="mb-2 text-xs font-semibold uppercase text-muted-foreground">CRM details</h3>
                <div className="space-y-2 rounded-lg border border-border/80 bg-surface-subtle/55 p-3 text-xs">
                  <div className="flex justify-between gap-3"><span className="text-muted-foreground">Assigned</span><span className="text-foreground">{selectedContact.assignedTo || "Unassigned"}</span></div>
                  <div className="flex justify-between gap-3"><span className="text-muted-foreground">Source</span><span className="text-foreground">{selectedContact.source || "WhatsApp"}</span></div>
                  <div className="flex justify-between gap-3"><span className="text-muted-foreground">Chats</span><span className="text-foreground">{selectedContact.conversations || 0}</span></div>
                  <div className="flex justify-between gap-3"><span className="text-muted-foreground">CRM added</span><span className="text-foreground">{selectedContact.crmAddedAt || "—"}</span></div>
                </div>
              </section>

              <section>
                <h3 className="mb-2 text-xs font-semibold uppercase text-muted-foreground">Timeline</h3>
                <div className="space-y-3 text-xs text-muted-foreground">
                  <div className="flex gap-2"><span className="mt-1 size-1.5 rounded-full bg-primary" /> Last activity: {selectedContact.lastActivity || "No activity yet"}</div>
                  <div className="flex gap-2"><span className="mt-1 size-1.5 rounded-full bg-info" /> Source: {selectedContact.source || "WhatsApp"}</div>
                  <div className="flex gap-2"><span className="mt-1 size-1.5 rounded-full bg-warning" /> Assigned to {selectedContact.assignedTo || "Unassigned"}</div>
                </div>
              </section>
            </div>

            <div className="border-t border-border/80 p-4">
              <Button className="w-full" onClick={() => onOpenContactChat?.(selectedContact.id)}>
                <MessageCircle size={14} />
                Open WhatsApp chat
              </Button>
            </div>
          </aside>
        ) : null}
      </div>
    </div>
  );
}
