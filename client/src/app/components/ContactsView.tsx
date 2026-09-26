import { useEffect, useMemo, useState } from "react";
import {
  CheckSquare,
  ChevronLeft,
  ChevronRight,
  Circle,
  Download,
  Filter,
  MessageCircle,
  MoreHorizontal,
  PanelRight,
  Plus,
  Search,
  Trash2,
  Upload,
  UserRound,
  Users,
  X,
} from "lucide-react";
import { Button } from "./ui/button";
import { EmptyState } from "./ui/empty-state";
import { Input } from "./ui/input";
import { cn } from "./ui/utils";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "./ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "./ui/alert-dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuTrigger } from "./ui/dropdown-menu";
import { Popover, PopoverContent, PopoverTrigger } from "./ui/popover";
import { Sheet, SheetContent, SheetDescription, SheetTitle } from "./ui/sheet";
import { avatarTint } from "./whatsapp-inbox/utils";
import { formatMoney } from "../lib/format";
import {
  assignContactOwner,
  bulkImportContacts,
  createContact,
  deleteContact,
  getContactFilterOptions,
  getContacts,
  getInvoices,
  getSettings,
  getTasks,
  getTeamMembers,
  type CustomFieldDefinition,
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

const statusDot: Record<string, string> = {
  active: "bg-primary",
  lead: "bg-primary",
  customer: "bg-success",
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
  canSeeTasks?: boolean;
  canSeeInvoices?: boolean;
}

const selectClass =
  "h-9 w-full rounded-lg border border-input bg-input-background px-2.5 text-[13px] text-foreground outline-none transition-colors focus:border-ring focus:ring-2 focus:ring-ring/20";

function formatDay(value?: string) {
  if (!value) return "—";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" });
}

// The preview sits beside the table on wide screens (xl) and opens as a sheet below that.
function useIsWide() {
  const query = "(min-width: 1280px)";
  const [wide, setWide] = useState(() => typeof window !== "undefined" && window.matchMedia(query).matches);
  useEffect(() => {
    const mql = window.matchMedia(query);
    const onChange = () => setWide(mql.matches);
    mql.addEventListener("change", onChange);
    return () => mql.removeEventListener("change", onChange);
  }, []);
  return wide;
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
    sm: "size-8 text-[11px]",
    md: "size-10 text-[12.5px]",
    lg: "size-16 text-lg",
  };

  return <div className={cn(classes[size], "flex shrink-0 items-center justify-center rounded-full font-semibold", avatarTint(contact.name))}>{contactInitials(contact.name)}</div>;
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
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-h-[calc(100dvh-2rem)] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Import contacts</DialogTitle>
          <DialogDescription>Upload a CSV, match its columns, then import.</DialogDescription>
        </DialogHeader>

        {step === "upload" && (
          <div className="space-y-3">
            <label className="flex h-36 cursor-pointer flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed border-border bg-secondary/40 text-sm text-muted-foreground transition-colors hover:border-primary/40 hover:text-foreground">
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
                    className={selectClass}
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
                <thead className="bg-secondary/60">
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
              <div className="rounded-lg bg-success/12 p-3">
                <p className="text-xl font-semibold text-success">{result.created}</p>
                <p className="text-xs text-muted-foreground">Created</p>
              </div>
              <div className="rounded-lg bg-secondary p-3">
                <p className="text-xl font-semibold text-foreground">{result.skipped}</p>
                <p className="text-xs text-muted-foreground">Skipped (duplicate)</p>
              </div>
              <div className="rounded-lg bg-problem-soft p-3">
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
      </DialogContent>
    </Dialog>
  );
}

export function ContactsView({ onOpenContactChat, canWrite = false, canSeeTasks = false, canSeeInvoices = false }: ContactsViewProps) {
  const isWide = useIsWide();
  const [previewOpen, setPreviewOpen] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [search, setSearch] = useState("");
  const [crmFilter, setCrmFilter] = useState("");
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [contacts, setContacts] = useState<Contact[]>(fallbackContacts);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(0);
  const [selectedContactId, setSelectedContactId] = useState<string>("");
  const [showCreate, setShowCreate] = useState(false);
  const [form, setForm] = useState({ name: "", phone: "", email: "", tags: "" });
  const [customFieldDefs, setCustomFieldDefs] = useState<CustomFieldDefinition[]>([]);
  const [customFieldValues, setCustomFieldValues] = useState<Record<string, string>>({});
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
    getSettings<{ crm?: { customFieldDefinitions?: CustomFieldDefinition[] } }>()
      .then((response) => setCustomFieldDefs((response.crm?.customFieldDefinitions || []).filter((field) => !field.archived)))
      .catch(() => undefined);
  }, []);

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
        customFields: Object.fromEntries(Object.entries(customFieldValues).filter(([, value]) => value !== "")),
      });
      setContacts((items) => [response.data, ...items]);
      setSelectedContactId(response.data.id);
      setForm({ name: "", phone: "", email: "", tags: "" });
      setCustomFieldValues({});
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
    setPreviewOpen(true);
  }

  function handleExportCsv() {
    const headers = ["Name", "Phone", "Email", "Stage", "Source", "Assigned To", "Tags", "Last Activity"];
    // Neutralize CSV/formula injection (CWE-1236): a cell starting with =, +, -, @, tab, or CR
    // can be interpreted as a formula by Excel/Sheets when this file is opened. This matters more
    // now that Import lets external, attacker-controlled text (a contact's name/tags from an
    // uploaded CSV) reach these same fields - prefixing with a single quote forces plain-text
    // rendering instead of formula execution.
    const csvEscape = (value: unknown) => {
      let text = String(value ?? "");
      if (/^[=+\-@\t\r]/.test(text)) text = `'${text}`;
      return `"${text.replace(/"/g, '""')}"`;
    };
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

  const preview = selectedContact ? (
    <ContactPreview
      contact={selectedContact}
      canSeeTasks={canSeeTasks}
      canSeeInvoices={canSeeInvoices}
      onOpenChat={onOpenContactChat ? () => onOpenContactChat(selectedContact.id) : undefined}
    />
  ) : null;

  return (
    <div className="flex w-full min-w-0 flex-1 flex-col overflow-hidden">
      <div className="flex flex-wrap items-center gap-2 border-b border-border px-4 py-3 sm:px-6">
        <div role="tablist" aria-label="Show" className="flex items-center gap-0.5 rounded-lg bg-secondary/70 p-0.5">
          {crmFilters.map((filter) => {
            const active = crmFilter === filter.id;
            const count = filter.id === "lead" ? leadCount : filter.id === "customer" ? customerCount : null;
            return (
              <button
                key={filter.label}
                type="button"
                role="tab"
                aria-selected={active}
                onClick={() => changeCrmFilter(filter.id)}
                className={cn("flex h-7 items-center gap-1.5 rounded-md px-3 text-[12.5px] font-medium transition-colors", active ? "bg-card text-foreground shadow-card" : "text-muted-foreground hover:text-foreground")}
              >
                {filter.label}
                {count !== null && <span className="text-[11px] text-muted-foreground tabular-nums">{count}</span>}
              </button>
            );
          })}
        </div>

        <label className="order-last flex h-9 min-w-0 basis-full items-center gap-2 rounded-lg bg-secondary/70 px-2.5 text-muted-foreground focus-within:bg-card focus-within:ring-2 focus-within:ring-ring/30 sm:order-none sm:max-w-xs sm:flex-1 sm:basis-auto">
          <Search size={15} className="shrink-0" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search this page"
            aria-label="Search contacts on this page"
            className="min-w-0 flex-1 bg-transparent text-[13px] text-foreground outline-none placeholder:text-muted-foreground"
          />
          {search && (
            <button type="button" onClick={() => setSearch("")} aria-label="Clear search" className="rounded p-0.5 hover:text-foreground">
              <X size={14} />
            </button>
          )}
        </label>

        <Popover open={showFilterPanel} onOpenChange={setShowFilterPanel}>
          <PopoverTrigger asChild>
            <Button variant="outline" size="sm" className="h-9">
              <Filter size={14} />
              Filter
              {activeFilterCount > 0 && (
                <span className="flex size-4 items-center justify-center rounded-full bg-primary text-[10px] font-semibold text-primary-foreground">{activeFilterCount}</span>
              )}
            </Button>
          </PopoverTrigger>
          <PopoverContent align="start" className="grid w-72 gap-3 p-3">
            {[
              {
                label: "Stage",
                value: filters.stage,
                any: "Any stage",
                onChange: (value: string) => updateFilters({ stage: value }),
                options: filterOptions.stages.map((stage) => ({ value: stage, label: stage.replace(/_/g, " ") })),
              },
              {
                label: "Source",
                value: filters.source,
                any: "Any source",
                onChange: (value: string) => updateFilters({ source: value }),
                options: filterOptions.sources.map((source) => ({ value: source, label: source })),
              },
              {
                label: "Owner",
                value: filters.ownerUserId,
                any: "Any owner",
                onChange: (value: string) => updateFilters({ ownerUserId: value }),
                options: teamMembers.map((member) => ({ value: member.userId, label: member.name })),
              },
              {
                label: "Tag",
                value: filters.tag,
                any: "Any tag",
                onChange: (value: string) => updateFilters({ tag: value }),
                options: filterOptions.tags.map((tag) => ({ value: tag.id, label: tag.name })),
              },
            ].map((field) => (
              <label key={field.label} className="grid gap-1 text-[12px]">
                <span className="text-muted-foreground">{field.label}</span>
                <select value={field.value} onChange={(e) => field.onChange(e.target.value)} className={cn(selectClass, "capitalize")}>
                  <option value="">{field.any}</option>
                  {field.options.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </label>
            ))}
            <Button variant="outline" size="sm" className="w-full" disabled={activeFilterCount === 0} onClick={() => updateFilters(EMPTY_CONTACT_FILTERS)}>
              Clear filters
            </Button>
          </PopoverContent>
        </Popover>

        <div className="ml-auto flex items-center gap-2">
          {canWrite && (
            <Button variant="ghost" size="sm" className="hidden h-9 sm:inline-flex" onClick={() => setShowImport(true)}>
              <Upload size={14} />
              Import
            </Button>
          )}
          <Button variant="ghost" size="sm" className="hidden h-9 sm:inline-flex" disabled={filtered.length === 0} onClick={handleExportCsv}>
            <Download size={14} />
            Export
          </Button>
          {canWrite && (
            <Button size="sm" className="h-9" onClick={() => setShowCreate(true)}>
              <Plus size={14} />
              New lead
            </Button>
          )}
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

      <Dialog open={showCreate && canWrite} onOpenChange={setShowCreate}>
        <DialogContent className="max-h-[calc(100dvh-2rem)] overflow-y-auto sm:max-w-2xl">
          <form onSubmit={handleCreateContact} className="grid gap-5">
            <DialogHeader>
              <DialogTitle>New lead</DialogTitle>
              <DialogDescription>Adds the person to your CRM. Nothing is sent to them.</DialogDescription>
            </DialogHeader>
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="grid gap-1.5 text-[13px]">
                <span className="font-medium text-foreground">Name</span>
                <Input value={form.name} onChange={(e) => setForm((current) => ({ ...current, name: e.target.value }))} placeholder="Customer name" required />
              </label>
              <label className="grid gap-1.5 text-[13px]">
                <span className="font-medium text-foreground">Phone</span>
                <Input value={form.phone} onChange={(e) => setForm((current) => ({ ...current, phone: e.target.value }))} placeholder="+91 98765 43210" required />
              </label>
              <label className="grid gap-1.5 text-[13px]">
                <span className="font-medium text-foreground">Email</span>
                <Input type="email" value={form.email} onChange={(e) => setForm((current) => ({ ...current, email: e.target.value }))} placeholder="customer@company.com" />
              </label>
              <label className="grid gap-1.5 text-[13px]">
                <span className="font-medium text-foreground">Tags</span>
                <Input value={form.tags} onChange={(e) => setForm((current) => ({ ...current, tags: e.target.value }))} placeholder="VIP, Sales, Support" />
              </label>
              {customFieldDefs.map((field) => (
                <label key={field.key} className="grid gap-1.5 text-[13px]">
                  <span className="font-medium text-foreground">{field.label}</span>
                  {field.type === "select" ? (
                    <select value={customFieldValues[field.key] || ""} onChange={(e) => setCustomFieldValues((current) => ({ ...current, [field.key]: e.target.value }))} className={selectClass}>
                      <option value="">Select…</option>
                      {field.options.map((option) => (
                        <option key={option} value={option}>
                          {option}
                        </option>
                      ))}
                    </select>
                  ) : (
                    <Input
                      type={field.type === "number" ? "number" : field.type === "date" ? "date" : "text"}
                      value={customFieldValues[field.key] || ""}
                      onChange={(e) => setCustomFieldValues((current) => ({ ...current, [field.key]: e.target.value }))}
                    />
                  )}
                </label>
              ))}
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setShowCreate(false)}>
                Cancel
              </Button>
              <Button type="submit" disabled={saving}>
                {saving ? "Saving…" : "Save lead"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <AlertDialog open={confirmDelete} onOpenChange={setConfirmDelete}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              Delete {selectedIds.length} contact{selectedIds.length === 1 ? "" : "s"}?
            </AlertDialogTitle>
            <AlertDialogDescription>Their CRM records are removed for everyone in the workspace. This can't be undone from here.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction className="bg-destructive text-white hover:bg-destructive/90" onClick={handleDeleteSelected}>
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <div className="flex min-h-0 flex-1">
        <div className="flex min-h-0 min-w-0 flex-1 flex-col">
          {canWrite && selectedIds.length > 0 && (
            <div className="flex flex-wrap items-center gap-2 border-b border-border bg-accent px-4 py-2 sm:px-6">
              <span className="text-[12.5px] font-medium text-foreground tabular-nums">{selectedIds.length} selected</span>
              <Button variant="outline" size="sm" className="h-8 bg-card" disabled={!onOpenContactChat} onClick={() => onOpenContactChat?.(selectedIds.length === 1 ? selectedIds[0] : selectedContact?.id || selectedIds[0])}>
                <MessageCircle size={13} />
                Message
              </Button>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="outline" size="sm" className="h-8 bg-card" disabled={assigning || teamMembers.length === 0}>
                    <UserRound size={13} />
                    {assigning ? "Assigning…" : "Assign"}
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="start" className="w-52">
                  <DropdownMenuLabel className="text-xs font-medium text-muted-foreground">Assign to</DropdownMenuLabel>
                  {teamMembers.map((member) => (
                    <DropdownMenuItem key={member.userId} onSelect={() => handleAssignSelected(member)}>
                      {member.name}
                    </DropdownMenuItem>
                  ))}
                </DropdownMenuContent>
              </DropdownMenu>
              <Button variant="outline" size="sm" className="h-8 border-destructive/30 bg-card text-destructive hover:bg-problem-soft" onClick={() => setConfirmDelete(true)}>
                <Trash2 size={13} />
                Delete
              </Button>
              <button type="button" onClick={() => setSelectedIds([])} className="ml-auto text-[12.5px] font-medium text-primary hover:underline">
                Clear selection
              </button>
            </div>
          )}

          {loading ? (
            <div className="grid gap-3 p-4 sm:px-6">
              {Array.from({ length: 8 }).map((_, i) => (
                <div key={i} className="flex items-center gap-3">
                  <div className="size-8 animate-pulse rounded-full bg-secondary" />
                  <div className="h-3 w-40 animate-pulse rounded bg-secondary" />
                  <div className="ml-auto h-3 w-24 animate-pulse rounded bg-secondary" />
                </div>
              ))}
            </div>
          ) : filtered.length === 0 ? (
            <div className="flex flex-1 items-center justify-center p-6">
              <EmptyState
                icon={<Users size={18} />}
                title={contacts.length === 0 ? "No contacts yet" : "No contacts match"}
                description={contacts.length === 0 ? "Add your first lead or import a CSV to get started." : "Try a different name, phone, tag or filter."}
                action={
                  canWrite && contacts.length === 0 ? (
                    <Button onClick={() => setShowCreate(true)}>
                      <Plus size={14} /> New lead
                    </Button>
                  ) : undefined
                }
              />
            </div>
          ) : (
            <>
              <div className="min-h-0 flex-1 overflow-y-auto md:hidden">
                <ul className="divide-y divide-border">
                  {filtered.map((contact) => {
                    const lifecycle = contactLifecycle(contact);
                    return (
                      <li key={contact.id} className={cn("flex items-start gap-3 px-4 py-3", selectedContact?.id === contact.id && previewOpen && "bg-accent")}>
                        {canWrite && (
                          <input type="checkbox" aria-label={`Select ${contact.name}`} checked={selectedIds.includes(contact.id)} onChange={() => toggleSelect(contact.id)} className="mt-2.5 size-4 rounded accent-[var(--primary)]" />
                        )}
                        <button type="button" onClick={() => openContact(contact)} className="flex min-w-0 flex-1 items-start gap-3 text-left">
                          <ContactAvatar contact={contact} />
                          <span className="min-w-0 flex-1">
                            <span className="flex items-center gap-2">
                              <span className="truncate text-[14px] font-medium text-foreground">{contact.name}</span>
                              <StageTag contact={contact} lifecycle={lifecycle} />
                            </span>
                            <span className="mt-0.5 block truncate text-[12.5px] text-muted-foreground tabular-nums">{contact.phone}</span>
                            <span className="mt-0.5 flex items-center gap-2 text-[11.5px] text-muted-foreground">
                              <span className="truncate">{contact.assignedTo || "Unassigned"}</span>
                              <span className="ml-auto shrink-0">{contact.lastActivity || "No activity"}</span>
                            </span>
                          </span>
                        </button>
                      </li>
                    );
                  })}
                </ul>
              </div>

              <div className="hidden min-h-0 flex-1 overflow-auto md:block">
                <table className="w-full min-w-[780px] border-separate border-spacing-0 text-[13px]">
                  <thead className="sticky top-0 z-10">
                    <tr className="bg-background/95 text-left text-[11.5px] text-muted-foreground backdrop-blur">
                      {canWrite && (
                        <th className="w-10 border-b border-border py-2 pl-6 pr-2 font-medium">
                          <input type="checkbox" aria-label="Select all on this page" checked={selectedIds.length === filtered.length && filtered.length > 0} onChange={toggleAll} className="size-4 rounded accent-[var(--primary)]" />
                        </th>
                      )}
                      {["Name", "Phone", "Stage", "Owner", "Source", "Tags", "Last activity", "Chats", ""].map((column, index) => (
                        <th key={column || index} className={cn("whitespace-nowrap border-b border-border px-3 py-2 font-medium", !canWrite && index === 0 && "pl-6", column === "Chats" && "text-right")}>
                          {column}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {filtered.map((contact) => {
                      const lifecycle = contactLifecycle(contact);
                      const active = selectedContact?.id === contact.id;
                      const checked = selectedIds.includes(contact.id);
                      return (
                        <tr
                          key={contact.id}
                          onClick={() => openContact(contact)}
                          aria-selected={active}
                          className={cn("group cursor-pointer transition-colors", active ? "bg-accent" : checked ? "bg-accent/50" : "hover:bg-foreground/[0.025]")}
                        >
                          {canWrite && (
                            <td className="border-b border-border py-2 pl-6 pr-2" onClick={(event) => event.stopPropagation()}>
                              <input type="checkbox" aria-label={`Select ${contact.name}`} checked={checked} onChange={() => toggleSelect(contact.id)} className="size-4 rounded accent-[var(--primary)]" />
                            </td>
                          )}
                          <td className={cn("border-b border-border px-3 py-2", !canWrite && "pl-6")}>
                            <div className="flex items-center gap-2.5">
                              <ContactAvatar contact={contact} size="sm" />
                              <div className="min-w-0">
                                <div className="max-w-[190px] truncate font-medium text-foreground">{contact.name}</div>
                                <div className="max-w-[190px] truncate text-[11.5px] text-muted-foreground">{contact.email || "No email"}</div>
                              </div>
                            </div>
                          </td>
                          <td className="whitespace-nowrap border-b border-border px-3 py-2 text-muted-foreground tabular-nums">{contact.phone}</td>
                          <td className="border-b border-border px-3 py-2">
                            <StageTag contact={contact} lifecycle={lifecycle} />
                          </td>
                          <td className="max-w-[140px] truncate border-b border-border px-3 py-2 text-foreground">{contact.assignedTo || <span className="text-muted-foreground">Unassigned</span>}</td>
                          <td className="max-w-[140px] truncate border-b border-border px-3 py-2 text-muted-foreground">{contact.source || "WhatsApp"}</td>
                          <td className="border-b border-border px-3 py-2">
                            <div className="flex max-w-[160px] flex-wrap gap-1">
                              {(contact.tags || []).length ? (
                                contact.tags.slice(0, 3).map((tag) => (
                                  <span key={tag} className="rounded bg-secondary px-1.5 py-px text-[11px] text-secondary-foreground">
                                    {tag}
                                  </span>
                                ))
                              ) : (
                                <span className="text-muted-foreground">—</span>
                              )}
                              {(contact.tags || []).length > 3 && <span className="text-[11px] text-muted-foreground">+{contact.tags.length - 3}</span>}
                            </div>
                          </td>
                          <td className="whitespace-nowrap border-b border-border px-3 py-2 text-muted-foreground">{contact.lastActivity || "No activity"}</td>
                          <td className="border-b border-border px-3 py-2 text-right text-muted-foreground tabular-nums">{contact.conversations || 0}</td>
                          <td className="border-b border-border py-2 pl-1 pr-4" onClick={(event) => event.stopPropagation()}>
                            <DropdownMenu>
                              <DropdownMenuTrigger asChild>
                                <button type="button" aria-label={`Actions for ${contact.name}`} className="flex size-7 items-center justify-center rounded-md text-muted-foreground opacity-0 transition-opacity hover:bg-secondary hover:text-foreground focus-visible:opacity-100 group-hover:opacity-100 data-[state=open]:opacity-100">
                                  <MoreHorizontal size={15} />
                                </button>
                              </DropdownMenuTrigger>
                              <DropdownMenuContent align="end" className="w-44">
                                <DropdownMenuItem disabled={!onOpenContactChat} onSelect={() => onOpenContactChat?.(contact.id)}>
                                  <MessageCircle /> Open chat
                                </DropdownMenuItem>
                                <DropdownMenuItem onSelect={() => openContact(contact)}>
                                  <PanelRight /> View details
                                </DropdownMenuItem>
                                {canWrite && (
                                  <DropdownMenuItem onSelect={() => toggleSelect(contact.id)}>
                                    <CheckSquare /> {checked ? "Unselect" : "Select"}
                                  </DropdownMenuItem>
                                )}
                              </DropdownMenuContent>
                            </DropdownMenu>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </>
          )}

          <div className="flex items-center justify-between gap-3 border-t border-border px-4 py-2.5 sm:px-6">
            <span className="text-[12px] text-muted-foreground tabular-nums">
              {total === 0 ? "No contacts" : `${page * PAGE_SIZE + 1}–${Math.min(total, (page + 1) * PAGE_SIZE)} of ${total}`}
            </span>
            <div className="flex items-center gap-1">
              <Button variant="ghost" size="sm" className="h-8" disabled={page === 0} onClick={() => setPage((current) => Math.max(0, current - 1))}>
                <ChevronLeft size={15} />
                <span className="hidden sm:inline">Previous</span>
              </Button>
              <span className="px-2 text-[12px] font-medium text-foreground tabular-nums">Page {page + 1}</span>
              <Button variant="ghost" size="sm" className="h-8" disabled={(page + 1) * PAGE_SIZE >= total} onClick={() => setPage((current) => current + 1)}>
                <span className="hidden sm:inline">Next</span>
                <ChevronRight size={15} />
              </Button>
            </div>
          </div>
        </div>

        {preview && <aside className="hidden w-[340px] shrink-0 border-l border-border bg-card xl:flex">{preview}</aside>}
      </div>

      <Sheet open={previewOpen && Boolean(preview) && !isWide} onOpenChange={setPreviewOpen}>
        <SheetContent side="right" className="w-[min(24rem,92vw)] gap-0 p-0">
          <SheetTitle className="sr-only">{selectedContact?.name || "Contact"}</SheetTitle>
          <SheetDescription className="sr-only">Contact details</SheetDescription>
          {preview}
        </SheetContent>
      </Sheet>
    </div>
  );
}

function StageTag({ contact, lifecycle }: { contact: Contact; lifecycle: string }) {
  return (
    <span className="inline-flex items-center gap-1.5 whitespace-nowrap text-[12px] capitalize text-foreground">
      <span className={cn("size-1.5 shrink-0 rounded-full", statusDot[lifecycle] || statusDot.active)} />
      {stageLabel(contact)}
    </span>
  );
}

type PreviewTask = { id: string; title: string; status: string; dueAt: string | null };
type PreviewInvoice = { id: string; invoiceNumber: string; status: string; balanceDue: number; total: number; currency: string };

// Right-hand record preview: who they are, what's open with them (tasks, unpaid invoices) and the
// basics - so you can act without losing your place in the list.
function ContactPreview({ contact, canSeeTasks, canSeeInvoices, onOpenChat }: { contact: Contact; canSeeTasks: boolean; canSeeInvoices: boolean; onOpenChat?: () => void }) {
  const [tasks, setTasks] = useState<PreviewTask[] | null>(null);
  const [invoices, setInvoices] = useState<PreviewInvoice[] | null>(null);

  useEffect(() => {
    let active = true;
    setTasks(null);
    setInvoices(null);
    if (canSeeTasks) {
      getTasks<{ data: PreviewTask[] }>({ contactId: contact.id })
        .then((response) => active && setTasks(response.data))
        .catch(() => active && setTasks([]));
    }
    if (canSeeInvoices) {
      getInvoices<{ data: PreviewInvoice[] }>({ contactId: contact.id })
        .then((response) => active && setInvoices(response.data))
        .catch(() => active && setInvoices([]));
    }
    return () => {
      active = false;
    };
  }, [contact.id, canSeeTasks, canSeeInvoices]);

  const openTasks = (tasks || []).filter((task) => task.status !== "completed");
  const unpaid = (invoices || []).filter((invoice) => invoice.balanceDue > 0 && invoice.status !== "cancelled" && invoice.status !== "draft");
  const due = unpaid.reduce((sum, invoice) => sum + invoice.balanceDue, 0);
  const lifecycle = contactLifecycle(contact);

  return (
    <div className="flex h-full w-full flex-col">
      <div className="flex flex-col items-center border-b border-border px-5 pb-4 pt-6 text-center">
        <ContactAvatar contact={contact} size="lg" />
        <h2 className="mt-3 max-w-full truncate text-[16px] font-semibold text-foreground">{contact.name}</h2>
        <p className="text-[12.5px] text-muted-foreground tabular-nums">{contact.phone}</p>
        <div className="mt-2">
          <StageTag contact={contact} lifecycle={lifecycle} />
        </div>
        {onOpenChat && (
          <Button className="mt-4 w-full" onClick={onOpenChat}>
            <MessageCircle size={14} />
            Open chat
          </Button>
        )}
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto">
        {canSeeInvoices && (
          <section className="grid gap-1 border-b border-border px-5 py-4">
            <h3 className="text-[10.5px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">Money</h3>
            {invoices === null ? (
              <div className="h-6 w-24 animate-pulse rounded bg-secondary" />
            ) : unpaid.length ? (
              <p className="text-[13px] text-foreground">
                <span className="font-serif text-[22px] text-money tabular-nums">{formatMoney(due, unpaid[0].currency)}</span> due on {unpaid.length} invoice{unpaid.length === 1 ? "" : "s"}
              </p>
            ) : (
              <p className="text-[12.5px] text-muted-foreground">{invoices.length ? "All invoices paid." : "No invoices yet."}</p>
            )}
          </section>
        )}

        {canSeeTasks && (
          <section className="grid gap-2 border-b border-border px-5 py-4">
            <h3 className="text-[10.5px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">Open tasks</h3>
            {tasks === null ? (
              <div className="h-4 w-40 animate-pulse rounded bg-secondary" />
            ) : openTasks.length ? (
              <ul className="grid gap-1.5">
                {openTasks.slice(0, 4).map((task) => {
                  const overdue = task.dueAt && new Date(task.dueAt).getTime() < Date.now();
                  return (
                    <li key={task.id} className="flex items-start gap-2 text-[13px]">
                      <Circle size={14} className="mt-0.5 shrink-0 text-muted-foreground" />
                      <span className="min-w-0 flex-1 text-foreground">{task.title}</span>
                      {task.dueAt && (
                        <span className={cn("shrink-0 text-[11.5px]", overdue ? "font-medium text-destructive" : "text-muted-foreground")}>
                          {new Date(task.dueAt).toLocaleDateString("en-IN", { day: "numeric", month: "short" })}
                        </span>
                      )}
                    </li>
                  );
                })}
                {openTasks.length > 4 && <li className="text-[12px] text-muted-foreground">+{openTasks.length - 4} more</li>}
              </ul>
            ) : (
              <p className="text-[12.5px] text-muted-foreground">Nothing open.</p>
            )}
          </section>
        )}

        <section className="grid gap-2 px-5 py-4">
          <h3 className="text-[10.5px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">Details</h3>
          <dl className="grid gap-1.5 text-[12.5px]">
            {[
              ["Email", contact.email || "—"],
              ["Owner", contact.assignedTo || "Unassigned"],
              ["Source", contact.source || "WhatsApp"],
              ["Chats", String(contact.conversations || 0)],
              ["Last activity", contact.lastActivity || "No activity"],
              ["In CRM since", formatDay(contact.crmAddedAt)],
            ].map(([label, value]) => (
              <div key={label} className="flex items-start justify-between gap-3">
                <dt className="text-muted-foreground">{label}</dt>
                <dd className="max-w-[62%] truncate text-right text-foreground">{value}</dd>
              </div>
            ))}
          </dl>
          {(contact.tags || []).length > 0 && (
            <div className="mt-1 flex flex-wrap gap-1">
              {contact.tags.map((tag) => (
                <span key={tag} className="rounded bg-secondary px-1.5 py-0.5 text-[11.5px] text-secondary-foreground">
                  {tag}
                </span>
              ))}
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
