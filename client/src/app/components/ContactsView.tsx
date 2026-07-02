import { useEffect, useState } from "react";
import { Badge } from "./ui/badge";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { Search, Plus, Filter, Download, Upload, MoreHorizontal, MessageCircle } from "lucide-react";
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

const tagColors: Record<string, string> = {
  VIP: "bg-yellow-500/20 text-yellow-400 border-yellow-500/30",
  Order: "bg-blue-500/20 text-blue-400 border-blue-500/30",
  Shipping: "bg-purple-500/20 text-purple-400 border-purple-500/30",
  Support: "bg-primary/20 text-primary border-primary/30",
  Retention: "bg-red-500/20 text-red-400 border-red-500/30",
  Sales: "bg-orange-500/20 text-orange-400 border-orange-500/30",
  Billing: "bg-cyan-500/20 text-cyan-400 border-cyan-500/30",
};

const statusDot: Record<string, string> = {
  active: "bg-primary",
  lead: "bg-primary",
  customer: "bg-blue-400",
  inactive: "bg-muted-foreground",
  blocked: "bg-destructive",
};

const lifecycleColors: Record<string, string> = {
  lead: "bg-primary/20 text-primary border-primary/30",
  customer: "bg-blue-500/20 text-blue-400 border-blue-500/30",
  active: "bg-primary/20 text-primary border-primary/30",
  inactive: "bg-secondary text-muted-foreground border-border",
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

export function ContactsView({ onOpenContactChat, canWrite = false }: ContactsViewProps) {
  const [search, setSearch] = useState("");
  const [crmFilter, setCrmFilter] = useState("");
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [contacts, setContacts] = useState<Contact[]>(fallbackContacts);
  const [showCreate, setShowCreate] = useState(false);
  const [form, setForm] = useState({ name: "", phone: "", email: "", tags: "" });
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    getContacts<{ data: Contact[]; total: number }>("", crmFilter)
      .then((response) => setContacts(response.data))
      .catch(() => setContacts(fallbackContacts));
    setSelectedIds([]);
  }, [crmFilter]);

  const leadCount = contacts.filter((contact) => (contact.lifecycleStatus || "lead") === "lead").length;

  const filtered = contacts.filter(
    (c) =>
      !search ||
      c.name.toLowerCase().includes(search.toLowerCase()) ||
      c.phone.includes(search) ||
      c.email.toLowerCase().includes(search.toLowerCase())
  );

  function toggleSelect(id: string) {
    setSelectedIds((prev) =>
      prev.includes(id) ? prev.filter((i) => i !== id) : [...prev, id]
    );
  }

  function toggleAll() {
    if (selectedIds.length === filtered.length) {
      setSelectedIds([]);
    } else {
      setSelectedIds(filtered.map((c) => c.id));
    }
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

    await Promise.all(ids.map((id) => deleteContact(id).catch(() => undefined)));
  }

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      {/* Header */}
      <div className="flex flex-col gap-3 px-3 py-3 border-b border-border shrink-0 sm:flex-row sm:items-center sm:justify-between sm:px-6 sm:py-4">
        <div className="min-w-0">
          <h1 className="text-foreground">CRM</h1>
          <p className="text-xs text-muted-foreground mt-0.5">{leadCount} leads · {contacts.length} total records</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="outline" size="sm" className="hidden h-8 text-xs border-border text-muted-foreground hover:text-foreground sm:inline-flex">
            <Upload size={13} className="mr-1.5" /> Import
          </Button>
          <Button variant="outline" size="sm" className="hidden h-8 text-xs border-border text-muted-foreground hover:text-foreground sm:inline-flex">
            <Download size={13} className="mr-1.5" /> Export
          </Button>
          {canWrite && (
            <Button
              size="sm"
              className="h-8 text-xs bg-primary text-primary-foreground hover:bg-primary/90"
              onClick={() => setShowCreate((current) => !current)}
            >
              <Plus size={13} className="mr-1.5" /> New lead
            </Button>
          )}
        </div>
      </div>

      {canWrite && showCreate && (
        <form onSubmit={handleCreateContact} className="grid grid-cols-1 md:grid-cols-5 gap-2 px-3 sm:px-6 py-3 border-b border-border bg-secondary/20 shrink-0">
          <Input
            value={form.name}
            onChange={(e) => setForm((current) => ({ ...current, name: e.target.value }))}
            placeholder="Name"
            className="h-8 text-xs bg-background border-border"
          />
          <Input
            value={form.phone}
            onChange={(e) => setForm((current) => ({ ...current, phone: e.target.value }))}
            placeholder="Phone"
            className="h-8 text-xs bg-background border-border"
          />
          <Input
            value={form.email}
            onChange={(e) => setForm((current) => ({ ...current, email: e.target.value }))}
            placeholder="Email"
            className="h-8 text-xs bg-background border-border"
          />
          <Input
            value={form.tags}
            onChange={(e) => setForm((current) => ({ ...current, tags: e.target.value }))}
            placeholder="Tags, comma separated"
            className="h-8 text-xs bg-background border-border"
          />
          <div className="flex gap-2">
            <Button type="submit" size="sm" className="h-8 text-xs bg-primary text-primary-foreground" disabled={saving}>
              {saving ? "Saving..." : "Save"}
            </Button>
            <Button type="button" variant="outline" size="sm" className="h-8 text-xs border-border" onClick={() => setShowCreate(false)}>
              Cancel
            </Button>
          </div>
        </form>
      )}

      {/* Filters */}
      <div className="flex flex-col gap-2 px-3 py-3 border-b border-border shrink-0 sm:flex-row sm:items-center sm:px-6">
        <div className="relative w-full flex-1 sm:max-w-xs">
          <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search contacts..."
            className="pl-8 h-8 text-xs bg-secondary border-transparent focus:border-border"
          />
        </div>
        <div className="no-scrollbar flex items-center gap-0.5 overflow-x-auto rounded-md border border-border bg-secondary/40 p-0.5">
          {crmFilters.map((filter) => (
            <button
              key={filter.label}
              onClick={() => setCrmFilter(filter.id)}
              className={`h-7 px-2.5 rounded text-xs transition-colors ${crmFilter === filter.id ? "bg-primary/20 text-primary" : "text-muted-foreground hover:text-foreground"}`}
            >
              {filter.label}
            </button>
          ))}
        </div>
        <Button variant="outline" size="sm" className="h-8 w-fit text-xs border-border text-muted-foreground hover:text-foreground">
          <Filter size={13} className="mr-1.5" /> Filter
        </Button>
        {canWrite && selectedIds.length > 0 && (
          <div className="flex flex-wrap items-center gap-2 sm:ml-2">
            <span className="text-xs text-muted-foreground">{selectedIds.length} selected</span>
            <Button variant="outline" size="sm" className="h-7 text-xs border-border text-muted-foreground hover:text-foreground">
              <MessageCircle size={12} className="mr-1" /> Message
            </Button>
            <Button variant="outline" size="sm" className="h-7 text-xs border-border text-muted-foreground hover:text-foreground">
              Assign
            </Button>
            <Button
              variant="outline"
              size="sm"
              className="h-7 text-xs border-destructive/30 text-destructive hover:bg-destructive/10"
              onClick={handleDeleteSelected}
            >
              Delete
            </Button>
          </div>
        )}
      </div>

      {/* Table */}
      <div className="no-scrollbar flex-1 overflow-y-auto sm:hidden">
        <div className="divide-y divide-border">
          {filtered.map((contact) => (
            <button
              key={contact.id}
              onClick={() => onOpenContactChat?.(contact.id)}
              className={`w-full px-3 py-3 text-left transition-colors hover:bg-secondary/30 ${selectedIds.includes(contact.id) ? "bg-primary/5" : ""}`}
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
                <div className="h-9 w-9 shrink-0 rounded-full bg-secondary flex items-center justify-center">
                  <span className="text-xs font-medium text-foreground">
                    {contact.name.split(" ").map((n) => n[0]).join("").slice(0, 2)}
                  </span>
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${statusDot[contact.lifecycleStatus || contact.status] || statusDot.active}`} />
                    <span className="truncate text-sm font-medium text-foreground">{contact.name}</span>
                    <Badge variant="outline" className={`shrink-0 text-[10px] px-1.5 py-0 h-4 capitalize ${lifecycleColors[contact.lifecycleStatus || "lead"] || lifecycleColors.lead}`}>
                      {contact.lifecycleStatus || "lead"}
                    </Badge>
                  </div>
                  <p className="mt-0.5 truncate font-mono text-xs text-muted-foreground">{contact.phone}</p>
                  <p className="truncate text-xs text-muted-foreground">{contact.email || contact.source}</p>
                  <div className="mt-2 flex flex-wrap gap-1">
                    {contact.tags.slice(0, 3).map((tag) => (
                      <Badge key={tag} variant="outline" className={`text-[10px] px-1.5 py-0 h-4 ${tagColors[tag] || "border-border text-muted-foreground"}`}>
                        {tag}
                      </Badge>
                    ))}
                    <span className="ml-auto text-[11px] text-muted-foreground">{contact.lastActivity}</span>
                  </div>
                </div>
              </div>
            </button>
          ))}
        </div>
      </div>

      <div className="hidden flex-1 overflow-auto sm:block">
        <table className="w-full text-xs">
          <thead>
            <tr className="border-b border-border bg-secondary/50 sticky top-0">
              {canWrite && (
                <th className="pl-6 pr-3 py-2.5 text-left w-8">
                  <input
                    type="checkbox"
                    checked={selectedIds.length === filtered.length && filtered.length > 0}
                    onChange={toggleAll}
                    className="rounded"
                  />
                </th>
              )}
              <th className="px-3 py-2.5 text-left font-medium text-muted-foreground">Name</th>
              <th className="px-3 py-2.5 text-left font-medium text-muted-foreground">Phone</th>
              <th className="px-3 py-2.5 text-left font-medium text-muted-foreground hidden md:table-cell">Email</th>
              <th className="px-3 py-2.5 text-left font-medium text-muted-foreground">Tags</th>
              <th className="px-3 py-2.5 text-left font-medium text-muted-foreground hidden md:table-cell">Stage</th>
              <th className="px-3 py-2.5 text-left font-medium text-muted-foreground hidden lg:table-cell">Assigned to</th>
              <th className="px-3 py-2.5 text-left font-medium text-muted-foreground hidden lg:table-cell">Source</th>
              <th className="px-3 py-2.5 text-left font-medium text-muted-foreground">Last activity</th>
              <th className="px-3 py-2.5 text-left font-medium text-muted-foreground hidden sm:table-cell">Chats</th>
              <th className="px-3 py-2.5 text-left font-medium text-muted-foreground w-8"></th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((contact) => (
              <tr
                key={contact.id}
                onClick={() => onOpenContactChat?.(contact.id)}
                className={`border-b border-border hover:bg-secondary/30 transition-colors cursor-pointer ${
                  selectedIds.includes(contact.id) ? "bg-primary/5" : ""
                }`}
              >
                {canWrite && (
                  <td className="pl-6 pr-3 py-2.5">
                    <input
                      type="checkbox"
                      checked={selectedIds.includes(contact.id)}
                      onClick={(event) => event.stopPropagation()}
                      onChange={() => toggleSelect(contact.id)}
                      className="rounded"
                    />
                  </td>
                )}
                <td className="px-3 py-2.5">
                  <div className="flex items-center gap-2">
                    <div className="w-6 h-6 rounded-full bg-secondary flex items-center justify-center shrink-0">
                      <span className="text-[10px] font-medium text-foreground">
                        {contact.name.split(" ").map((n) => n[0]).join("").slice(0, 2)}
                      </span>
                    </div>
                    <div className="flex items-center gap-1.5">
                      <span className={`w-1.5 h-1.5 rounded-full ${statusDot[contact.lifecycleStatus || contact.status] || statusDot.active} shrink-0`} />
                      <span className="font-medium text-foreground">{contact.name}</span>
                      <Badge variant="outline" className={`text-[10px] px-1.5 py-0 h-4 capitalize ${lifecycleColors[contact.lifecycleStatus || "lead"] || lifecycleColors.lead}`}>
                        {contact.lifecycleStatus || "lead"}
                      </Badge>
                    </div>
                  </div>
                </td>
                <td className="px-3 py-2.5 text-muted-foreground font-mono">{contact.phone}</td>
                <td className="px-3 py-2.5 text-muted-foreground hidden md:table-cell">{contact.email}</td>
                <td className="px-3 py-2.5">
                  <div className="flex flex-wrap gap-1">
                    {contact.tags.map((tag) => (
                      <Badge key={tag} variant="outline" className={`text-[10px] px-1.5 py-0 h-4 ${tagColors[tag] || "border-border text-muted-foreground"}`}>
                        {tag}
                      </Badge>
                    ))}
                  </div>
                </td>
                <td className="px-3 py-2.5 hidden md:table-cell">
                  <Badge variant="outline" className="text-[10px] px-1.5 py-0 h-4 border-border text-muted-foreground capitalize">
                    {(contact.crmStage || contact.lifecycleStatus || "new_lead").replace(/_/g, " ")}
                  </Badge>
                </td>
                <td className="px-3 py-2.5 text-muted-foreground hidden lg:table-cell">{contact.assignedTo}</td>
                <td className="px-3 py-2.5 text-muted-foreground hidden lg:table-cell">{contact.source}</td>
                <td className="px-3 py-2.5 text-muted-foreground">{contact.lastActivity}</td>
                <td className="px-3 py-2.5 text-muted-foreground hidden sm:table-cell">{contact.conversations}</td>
                <td className="px-3 py-2.5">
                  <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100">
                    <button
                      className="w-6 h-6 rounded flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-secondary transition-colors"
                      onClick={(event) => {
                        event.stopPropagation();
                        onOpenContactChat?.(contact.id);
                      }}
                    >
                      <MessageCircle size={12} />
                    </button>
                    <button className="w-6 h-6 rounded flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-secondary transition-colors" onClick={(event) => event.stopPropagation()}>
                      <MoreHorizontal size={12} />
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Pagination */}
      <div className="flex items-center justify-between gap-3 px-3 py-3 border-t border-border shrink-0 sm:px-6">
        <span className="text-xs text-muted-foreground">Showing {filtered.length} of {contacts.length} contacts</span>
        <div className="hidden items-center gap-1 sm:flex">
          <Button variant="outline" size="sm" className="h-7 text-xs border-border text-muted-foreground" disabled>
            Previous
          </Button>
          <Button variant="outline" size="sm" className="h-7 text-xs border-border bg-primary/10 text-primary">
            1
          </Button>
          <Button variant="outline" size="sm" className="h-7 text-xs border-border text-muted-foreground">
            Next
          </Button>
        </div>
      </div>
    </div>
  );
}

