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
import {
  assignContactOwner,
  bulkImportContacts,
  createContact,
  deleteContact,
  getContactFilterOptions,
  getContacts,
  getTeamMembers,
} from "../lib/api";
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

const PAGE_SIZE = 25;

const STAGE_OPTIONS_FALLBACK = ["new_lead", "contacted", "qualified", "proposal_sent", "won", "lost"];

interface FilterOptions {
  stages: string[];
  sources: string[];
  tags: { id: string; name: string }[];
}

const EMPTY_FILTER_OPTIONS: FilterOptions = { stages: STAGE_OPTIONS_FALLBACK, sources: [], tags: [] };

interface ContactFilters {
  stage: string;
  source: string;
  ownerUserId: string;
  tag: string;
}

const EMPTY_CONTACT_FILTERS: ContactFilters = { stage: "", source: "", ownerUserId: "", tag: "" };

const IMPORT_FIELDS = [
  { key: "name", label: "Name", required: true },
  { key: "phone", label: "Phone", required: true },
  { key: "email", label: "Email", required: false },
  { key: "tags", label: "Tags", required: false },
] as const;

type ImportFieldKey = (typeof IMPORT_FIELDS)[number]["key"];

// Minimal RFC4180-style parser: handles quoted fields, embedded commas/newlines inside quotes,
// and "" as an escaped quote - a plain String.split(",") (used by this file's CSV *export*
// already) is not safe for arbitrary uploaded CSVs on the way back in.
function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;

  for (let i = 0; i < text.length; i += 1) {
    const char = text[i];

    if (inQuotes) {
      if (char === '"' && text[i + 1] === '"') {
        field += '"';
        i += 1;
      } else if (char === '"') {
        inQuotes = false;
      } else {
        field += char;
      }
      continue;
    }

    if (char === '"') {
      inQuotes = true;
    } else if (char === ",") {
      row.push(field);
      field = "";
    } else if (char === "\n" || char === "\r") {
      if (char === "\r" && text[i + 1] === "\n") i += 1;
      row.push(field);
      field = "";
      if (row.some((value) => value.trim() !== "")) rows.push(row);
      row = [];
    } else {
      field += char;
    }
  }

  if (field !== "" || row.length > 0) {
    row.push(field);
    if (row.some((value) => value.trim() !== "")) rows.push(row);
  }

  return rows;
}

function guessColumn(headers: string[], candidates: string[]) {
  const lower = headers.map((header) => header.trim().toLowerCase());
  for (const candidate of candidates) {
    const index = lower.findIndex((header) => header === candidate);
    if (index !== -1) return index;
  }
  for (const candidate of candidates) {
    const index = lower.findIndex((header) => header.includes(candidate));
    if (index !== -1) return index;
  }
  return -1;
}

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

interface ImportResult {
  created: number;
  skipped: number;
  errors: { row: string; message: string }[];
}

function ImportContactsModal({ onClose, onImported }: { onClose: () => void; onImported: () => void }) {
  const [step, setStep] = useState<"upload" | "map" | "result">("upload");
  const [fileName, setFileName] = useState("");
  const [headers, setHeaders] = useState<string[]>([]);
  const [rows, setRows] = useState<string[][]>([]);
  const [columnMap, setColumnMap] = useState<Record<ImportFieldKey, number>>({ name: -1, phone: -1, email: -1, tags: -1 });
  const [importing, setImporting] = useState(false);
  const [result, setResult] = useState<ImportResult | null>(null);
  const [parseError, setParseError] = useState("");

  function handleFile(file: File) {
    setParseError("");
    setFileName(file.name);
    const reader = new FileReader();
    reader.onload = () => {
      const parsed = parseCsv(String(reader.result || ""));
      if (parsed.length < 2) {
        setParseError("This file doesn't look like a CSV with a header row and at least one data row.");
        return;
      }
      const [headerRow, ...dataRows] = parsed;
      setHeaders(headerRow);
      setRows(dataRows);
      setColumnMap({
        name: guessColumn(headerRow, ["name", "full name", "contact name"]),
        phone: guessColumn(headerRow, ["phone", "phone number", "mobile", "whatsapp"]),
        email: guessColumn(headerRow, ["email", "email address"]),
        tags: guessColumn(headerRow, ["tags", "tag", "labels"]),
      });
      setStep("map");
    };
    reader.onerror = () => setParseError("Could not read this file.");
    reader.readAsText(file);
  }

  function mapRow(row: string[]) {
    const value = (key: ImportFieldKey) => (columnMap[key] >= 0 ? (row[columnMap[key]] || "").trim() : "");
    return { name: value("name"), phone: value("phone"), email: value("email"), tags: value("tags") };
  }

  const mappedPreview = rows.slice(0, 5).map(mapRow);
  const canImport = columnMap.name >= 0 && columnMap.phone >= 0 && rows.length > 0;

  async function handleImport() {
    setImporting(true);
    try {
      const payload = rows.map((row) => {
        const mapped = mapRow(row);
        return {
          name: mapped.name,
          phone: mapped.phone,
          email: mapped.email,
          tags: mapped.tags ? mapped.tags.split(/[;,]/).map((tag) => tag.trim()).filter(Boolean) : [],
        };
      });
      const response = await bulkImportContacts<{ data: ImportResult }>(payload);
      setResult(response.data);
      setStep("result");
      onImported();
    } finally {
      setImporting(false);
    }
  }

  return (
    <div className="fixed inset-0 z-30 flex items-center justify-center overflow-y-auto bg-black/65 p-3 backdrop-blur-sm sm:p-4">
      <div className="max-h-[calc(100dvh-1.5rem)] w-full max-w-2xl overflow-y-auto rounded-xl border border-border/90 bg-card p-4 shadow-2xl shadow-black/45 sm:p-5">
        <div className="mb-4 flex items-start justify-between gap-3">
          <div>
            <h2 className="text-lg font-semibold text-foreground">Import contacts</h2>
            <p className="mt-1 text-sm text-muted-foreground">Upload a CSV, map its columns, then import.</p>
          </div>
          <button type="button" className="rounded-lg p-2 text-muted-foreground hover:bg-secondary hover:text-foreground" onClick={onClose}>
            <X size={17} />
          </button>
        </div>

        {step === "upload" && (
          <div className="space-y-3">
            <label className="flex h-32 cursor-pointer flex-col items-center justify-center gap-2 rounded-lg border-2 border-dashed border-border text-sm text-muted-foreground hover:border-primary/40 hover:text-foreground">
              <Upload size={20} />
              Click to choose a CSV file
              <input type="file" accept=".csv,text/csv" className="hidden" onChange={(e) => e.target.files?.[0] && handleFile(e.target.files[0])} />
            </label>
            {parseError && <p className="text-xs text-destructive">{parseError}</p>}
          </div>
        )}

        {step === "map" && (
          <div className="space-y-4">
            <p className="text-xs text-muted-foreground">{fileName} - {rows.length} rows detected</p>
            <div className="grid gap-3 sm:grid-cols-2">
              {IMPORT_FIELDS.map((field) => (
                <label key={field.key} className="space-y-1 text-xs">
                  <span className="text-muted-foreground">{field.label}{field.required ? " *" : " (optional)"}</span>
                  <select
                    value={columnMap[field.key]}
                    onChange={(e) => setColumnMap((current) => ({ ...current, [field.key]: Number(e.target.value) }))}
                    className="h-9 w-full rounded-md border border-input bg-input-background px-2 text-sm text-foreground outline-none focus:border-ring focus:ring-2 focus:ring-ring/20"
                  >
                    <option value={-1}>Don't import</option>
                    {headers.map((header, index) => (
                      <option key={index} value={index}>
                        {header || `Column ${index + 1}`}
                      </option>
                    ))}
                  </select>
                </label>
              ))}
            </div>

            <div className="overflow-x-auto rounded-lg border border-border/80">
              <table className="w-full text-xs">
                <thead className="bg-surface-subtle/70">
                  <tr>
                    {IMPORT_FIELDS.map((field) => (
                      <th key={field.key} className="px-3 py-2 text-left font-medium text-muted-foreground">
                        {field.label}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {mappedPreview.map((row, index) => (
                    <tr key={index} className="border-t border-border/70">
                      <td className="px-3 py-2 text-foreground">{row.name || "—"}</td>
                      <td className="px-3 py-2 text-foreground">{row.phone || "—"}</td>
                      <td className="px-3 py-2 text-muted-foreground">{row.email || "—"}</td>
                      <td className="px-3 py-2 text-muted-foreground">{row.tags || "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {!canImport && <p className="text-xs text-destructive">Map both Name and Phone columns to continue.</p>}

            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => setStep("upload")}>
                Back
              </Button>
              <Button disabled={!canImport || importing} onClick={handleImport}>
                {importing ? "Importing..." : `Import ${rows.length} contact${rows.length === 1 ? "" : "s"}`}
              </Button>
            </div>
          </div>
        )}

        {step === "result" && result && (
          <div className="space-y-3">
            <div className="grid grid-cols-3 gap-2 text-center">
              <div className="rounded-lg border border-primary/25 bg-primary/10 p-3">
                <p className="text-xl font-semibold text-primary">{result.created}</p>
                <p className="text-xs text-muted-foreground">Created</p>
              </div>
              <div className="rounded-lg border border-border bg-secondary/50 p-3">
                <p className="text-xl font-semibold text-foreground">{result.skipped}</p>
                <p className="text-xs text-muted-foreground">Skipped (duplicate)</p>
              </div>
              <div className="rounded-lg border border-destructive/25 bg-destructive/10 p-3">
                <p className="text-xl font-semibold text-destructive">{result.errors.length}</p>
                <p className="text-xs text-muted-foreground">Errors</p>
              </div>
            </div>
            {result.errors.length > 0 && (
              <div className="max-h-40 overflow-y-auto rounded-lg border border-border/70 p-2 text-xs text-muted-foreground">
                {result.errors.map((error, index) => (
                  <div key={index}>
                    {error.row}: {error.message}
                  </div>
                ))}
              </div>
            )}
            <div className="flex justify-end">
              <Button onClick={onClose}>Done</Button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

export function ContactsView({ onOpenContactChat, canWrite = false }: ContactsViewProps) {
  const [search, setSearch] = useState("");
  const [crmFilter, setCrmFilter] = useState("");
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [contacts, setContacts] = useState<Contact[]>(fallbackContacts);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(0);
  const [selectedContactId, setSelectedContactId] = useState<string>("");
  const [showCreate, setShowCreate] = useState(false);
  const [form, setForm] = useState({ name: "", phone: "", email: "", tags: "" });
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(true);
  const [teamMembers, setTeamMembers] = useState<{ userId: string; name: string }[]>([]);
  const [showAssignMenu, setShowAssignMenu] = useState(false);
  const [assigning, setAssigning] = useState(false);
  const [showFilterPanel, setShowFilterPanel] = useState(false);
  const [filters, setFilters] = useState<ContactFilters>(EMPTY_CONTACT_FILTERS);
  const [filterOptions, setFilterOptions] = useState<FilterOptions>(EMPTY_FILTER_OPTIONS);
  const [showImport, setShowImport] = useState(false);
  const [leadCount, setLeadCount] = useState(0);
  const [customerCount, setCustomerCount] = useState(0);
  const [refreshKey, setRefreshKey] = useState(0);

  useEffect(() => {
    let active = true;
    setLoading(true);
    getContacts<{ data: Contact[]; total: number }>({
      lifecycle: crmFilter,
      stage: filters.stage,
      source: filters.source,
      ownerUserId: filters.ownerUserId,
      tag: filters.tag,
      skip: page * PAGE_SIZE,
      limit: PAGE_SIZE,
    })
      .then((response) => {
        if (!active) return;
        setContacts(response.data);
        setTotal(response.total);
      })
      .catch(() => {
        if (active) {
          setContacts(fallbackContacts);
          setTotal(fallbackContacts.length);
        }
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    setSelectedIds([]);

    return () => {
      active = false;
    };
  }, [crmFilter, filters, page, refreshKey]);

  useEffect(() => {
    let active = true;
    getTeamMembers<{ data: { userId: string; name: string }[] }>()
      .then((response) => {
        if (active) setTeamMembers(response.data.filter((member) => member.userId));
      })
      .catch(() => undefined);
    getContactFilterOptions<{ data: FilterOptions }>()
      .then((response) => {
        if (active) setFilterOptions(response.data);
      })
      .catch(() => undefined);
    refreshOverviewCounts();
    return () => {
      active = false;
    };
  }, []);

  // Workspace-wide, independent of the current page/filter selection - these feed the header
  // stat cards, not the (now server-paginated) contacts list itself.
  function refreshOverviewCounts() {
    getContacts<{ total: number }>({ lifecycle: "lead", limit: 1 })
      .then((response) => setLeadCount(response.total))
      .catch(() => undefined);
    getContacts<{ total: number }>({ lifecycle: "customer", limit: 1 })
      .then((response) => setCustomerCount(response.total))
      .catch(() => undefined);
  }

  function updateFilters(patch: Partial<ContactFilters>) {
    setPage(0);
    setFilters((current) => ({ ...current, ...patch }));
  }

  function changeCrmFilter(id: string) {
    setPage(0);
    setCrmFilter(id);
  }

  const activeFilterCount = Object.values(filters).filter(Boolean).length;

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

  async function handleAssignSelected(member: { userId: string; name: string }) {
    const ids = selectedIds;
    setShowAssignMenu(false);
    setAssigning(true);
    try {
      await Promise.all(ids.map((id) => assignContactOwner(id, member.userId).catch(() => undefined)));
      setContacts((items) => items.map((contact) => (ids.includes(contact.id) ? { ...contact, assignedTo: member.name } : contact)));
    } finally {
      setAssigning(false);
    }
  }

  function openContact(contact: Contact) {
    setSelectedContactId(contact.id);
  }

  function handleExportCsv() {
    const headers = ["Name", "Phone", "Email", "Stage", "Source", "Assigned To", "Tags", "Last Activity"];
    const csvEscape = (value: unknown) => `"${String(value ?? "").replace(/"/g, '""')}"`;
    const rows = filtered.map((contact) => [
      contact.name,
      contact.phone,
      contact.email,
      stageLabel(contact),
      contact.source,
      contact.assignedTo,
      (contact.tags || []).join("; "),
      contact.lastActivity,
    ]);
    const csv = [headers, ...rows].map((row) => row.map(csvEscape).join(",")).join("\r\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `contacts-export-${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  }

  return (
    <div className="relative flex w-full min-w-0 flex-1 flex-col overflow-x-hidden overflow-y-visible">
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_18%_0%,rgba(37,211,102,0.08),transparent_26rem),radial-gradient(circle_at_88%_12%,rgba(79,140,255,0.08),transparent_24rem)]" />

      <div className="relative z-10 flex flex-col gap-4 border-b border-border/80 bg-surface/70 px-3 py-4 backdrop-blur-xl sm:px-6">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          <div className="min-w-0">
            <Badge variant="success" className="mb-2">
              <Users size={12} />
              CRM workspace
            </Badge>
            <h1 className="text-2xl font-semibold text-foreground">Contacts</h1>
            <p className="mt-1 text-sm text-muted-foreground">{leadCount} leads · {customerCount} customers · {total} matching records</p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {canWrite && (
              <Button variant="outline" size="sm" className="hidden sm:inline-flex" onClick={() => setShowImport(true)}>
                <Upload size={14} />
                Import
              </Button>
            )}
            <Button variant="outline" size="sm" className="hidden sm:inline-flex" disabled={filtered.length === 0} onClick={handleExportCsv}>
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
            { label: "Matching contacts", value: total, icon: <Activity size={16} />, tone: "text-primary" },
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

      {showImport && canWrite && (
        <ImportContactsModal
          onClose={() => setShowImport(false)}
          onImported={() => {
            setPage(0);
            setRefreshKey((current) => current + 1);
            refreshOverviewCounts();
          }}
        />
      )}

      {showCreate && canWrite && (
        <div className="fixed inset-0 z-30 flex items-center justify-center overflow-y-auto bg-black/65 p-3 backdrop-blur-sm sm:p-4">
          <form onSubmit={handleCreateContact} className="max-h-[calc(100dvh-1.5rem)] w-full max-w-2xl overflow-y-auto rounded-xl border border-border/90 bg-card p-4 shadow-2xl shadow-black/45 sm:p-5">
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

            <div className="mt-5 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
              <Button type="button" variant="outline" className="w-full sm:w-auto" onClick={() => setShowCreate(false)}>
                Cancel
              </Button>
              <Button type="submit" className="w-full sm:w-auto" disabled={saving}>
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
                  onClick={() => changeCrmFilter(filter.id)}
                  className={`h-8 rounded-md px-3 text-xs font-medium transition-colors ${crmFilter === filter.id ? "bg-primary/12 text-primary" : "text-muted-foreground hover:bg-secondary hover:text-foreground"}`}
                >
                  {filter.label}
                </button>
              ))}
            </div>
            <div className="relative">
              <Button variant="outline" size="sm" className="h-10 w-full sm:w-fit" onClick={() => setShowFilterPanel((current) => !current)}>
                <Filter size={14} />
                Filter
                {activeFilterCount > 0 && (
                  <span className="ml-1 flex size-4 items-center justify-center rounded-full bg-primary text-[10px] font-semibold text-primary-foreground">
                    {activeFilterCount}
                  </span>
                )}
              </Button>
              {showFilterPanel && (
                <div className="absolute right-0 top-full z-20 mt-1 w-72 space-y-3 rounded-lg border border-border bg-card p-3 shadow-xl">
                  <label className="block space-y-1 text-xs">
                    <span className="text-muted-foreground">Stage</span>
                    <select
                      value={filters.stage}
                      onChange={(e) => updateFilters({ stage: e.target.value })}
                      className="h-8 w-full rounded-md border border-input bg-input-background px-2 text-xs text-foreground outline-none focus:border-ring focus:ring-2 focus:ring-ring/20"
                    >
                      <option value="">Any stage</option>
                      {filterOptions.stages.map((stage) => (
                        <option key={stage} value={stage}>
                          {stage.replace(/_/g, " ")}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="block space-y-1 text-xs">
                    <span className="text-muted-foreground">Source</span>
                    <select
                      value={filters.source}
                      onChange={(e) => updateFilters({ source: e.target.value })}
                      className="h-8 w-full rounded-md border border-input bg-input-background px-2 text-xs text-foreground outline-none focus:border-ring focus:ring-2 focus:ring-ring/20"
                    >
                      <option value="">Any source</option>
                      {filterOptions.sources.map((source) => (
                        <option key={source} value={source}>
                          {source}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="block space-y-1 text-xs">
                    <span className="text-muted-foreground">Owner</span>
                    <select
                      value={filters.ownerUserId}
                      onChange={(e) => updateFilters({ ownerUserId: e.target.value })}
                      className="h-8 w-full rounded-md border border-input bg-input-background px-2 text-xs text-foreground outline-none focus:border-ring focus:ring-2 focus:ring-ring/20"
                    >
                      <option value="">Any owner</option>
                      {teamMembers.map((member) => (
                        <option key={member.userId} value={member.userId}>
                          {member.name}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="block space-y-1 text-xs">
                    <span className="text-muted-foreground">Tag</span>
                    <select
                      value={filters.tag}
                      onChange={(e) => updateFilters({ tag: e.target.value })}
                      className="h-8 w-full rounded-md border border-input bg-input-background px-2 text-xs text-foreground outline-none focus:border-ring focus:ring-2 focus:ring-ring/20"
                    >
                      <option value="">Any tag</option>
                      {filterOptions.tags.map((tag) => (
                        <option key={tag.id} value={tag.id}>
                          {tag.name}
                        </option>
                      ))}
                    </select>
                  </label>
                  <Button
                    variant="outline"
                    size="sm"
                    className="w-full"
                    disabled={activeFilterCount === 0}
                    onClick={() => updateFilters(EMPTY_CONTACT_FILTERS)}
                  >
                    Clear filters
                  </Button>
                </div>
              )}
            </div>
          </div>

          {canWrite && selectedIds.length > 0 && (
            <div className="flex flex-wrap items-center gap-2 border-b border-border/80 bg-primary/5 px-3 py-2">
              <span className="text-xs text-muted-foreground">{selectedIds.length} selected</span>
              <Button variant="outline" size="sm" onClick={() => selectedContact && onOpenContactChat?.(selectedContact.id)}>
                <MessageCircle size={13} />
                Message
              </Button>
              <div className="relative">
                <Button variant="outline" size="sm" disabled={assigning || teamMembers.length === 0} onClick={() => setShowAssignMenu((current) => !current)}>
                  {assigning ? "Assigning..." : "Assign"}
                </Button>
                {showAssignMenu && (
                  <div className="absolute left-0 top-full z-20 mt-1 w-48 rounded-lg border border-border bg-card p-1 shadow-xl">
                    {teamMembers.map((member) => (
                      <button
                        key={member.userId}
                        type="button"
                        className="block w-full rounded-md px-2.5 py-1.5 text-left text-xs text-foreground hover:bg-secondary"
                        onClick={() => handleAssignSelected(member)}
                      >
                        {member.name}
                      </button>
                    ))}
                  </div>
                )}
              </div>
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
            <span className="text-xs text-muted-foreground">
              {total === 0 ? "No contacts" : `Showing ${page * PAGE_SIZE + 1}-${Math.min(total, (page + 1) * PAGE_SIZE)} of ${total}`}
            </span>
            <div className="hidden items-center gap-1 sm:flex">
              <Button variant="outline" size="sm" className="h-8" disabled={page === 0} onClick={() => setPage((current) => Math.max(0, current - 1))}>
                Previous
              </Button>
              <Button variant="outline" size="sm" className="h-8 bg-primary/10 text-primary">
                {page + 1}
              </Button>
              <Button
                variant="outline"
                size="sm"
                className="h-8"
                disabled={(page + 1) * PAGE_SIZE >= total}
                onClick={() => setPage((current) => current + 1)}
              >
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
