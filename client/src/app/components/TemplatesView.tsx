import { useEffect, useMemo, useState } from "react";
import type React from "react";
import { Archive, Bot, Copy, Edit3, Eye, FileText, MessageSquareText, RefreshCcw, Search, Send, Sparkles, Tag, X } from "lucide-react";
import { Badge } from "./ui/badge";
import { Button } from "./ui/button";
import { Card } from "./ui/card";
import {
  archiveTemplate,
  createTemplate,
  duplicateTemplate,
  getTemplates,
  getWhatsAppAccounts,
  previewTemplate,
  submitTemplateForApproval,
  syncTemplateLibrary,
  updateTemplate,
} from "../lib/api";

interface TemplateItem {
  id: string;
  name: string;
  slug: string;
  type: "whatsapp" | "quick_reply" | "automation" | "campaign" | "follow_up" | "lead_stage";
  category: string;
  language: string;
  body: string;
  variables: string[];
  status: "draft" | "active" | "archived" | "approved" | "pending" | "rejected";
  providerTemplateId?: string;
  whatsappAccountId?: string;
  usageCount: number;
  lastUsedAt?: string;
  updatedAt?: string;
}

interface TemplatesViewProps {
  canWrite?: boolean;
}

const tabs = [
  { id: "all", label: "All" },
  { id: "whatsapp", label: "WhatsApp" },
  { id: "quick_reply", label: "Quick Replies" },
  { id: "automation", label: "Automation" },
  { id: "campaign", label: "Campaign" },
  { id: "follow_up", label: "Follow-up" },
  { id: "lead_stage", label: "Lead stage" },
];

const categories = ["all", "marketing", "utility", "support", "sales", "payment", "appointment", "general"];
const statuses = ["all", "draft", "active", "archived", "approved", "pending", "rejected"];
const languages = ["all", "en", "en_US", "hi", "es", "ar"];

const fieldClass =
  "h-9 w-full rounded-md border border-border bg-background/80 px-3 text-xs text-foreground shadow-inner shadow-black/10 outline-none transition placeholder:text-muted-foreground/60 focus:border-primary/50 focus:ring-2 focus:ring-primary/20 disabled:cursor-not-allowed disabled:opacity-60";

const textareaClass =
  "min-h-36 w-full rounded-md border border-border bg-background/80 px-3 py-2 text-sm leading-relaxed text-foreground shadow-inner shadow-black/10 outline-none transition placeholder:text-muted-foreground/60 focus:border-primary/50 focus:ring-2 focus:ring-primary/20 disabled:cursor-not-allowed disabled:opacity-60";

const sampleValues: Record<string, string> = {
  name: "Aarav",
  phone: "+91 98765 43210",
  requirement: "pricing details",
  company: "Acme Realty",
  agent: "Priya",
  stage: "Qualified",
  date: "12 Jul",
  time: "4:30 PM",
};

const emptyForm = {
  id: "",
  name: "",
  type: "quick_reply",
  category: "support",
  language: "en",
  status: "draft",
  body: "",
  variables: "",
  whatsappAccountId: "",
};

function statusClass(status: string) {
  if (status === "active" || status === "approved") return "border-primary/30 bg-primary/10 text-primary";
  if (status === "rejected" || status === "archived") return "border-destructive/30 bg-destructive/10 text-destructive";
  return "border-border bg-secondary text-muted-foreground";
}

function formatDate(value?: string) {
  if (!value) return "Never";
  return new Date(value).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });
}

function typeLabel(type: string) {
  return tabs.find((tab) => tab.id === type)?.label || type.replace("_", " ");
}

function typeIcon(type: string) {
  if (type === "whatsapp") return <MessageSquareText size={15} />;
  if (type === "automation") return <Bot size={15} />;
  if (type === "lead_stage") return <Tag size={15} />;
  if (type === "campaign") return <Send size={15} />;
  return <FileText size={15} />;
}

function renderSamplePreview(body: string, variables: string[] = []) {
  let preview = body || "Your template body preview will appear here.";
  variables.forEach((variable) => {
    const value = sampleValues[variable] || `${variable} sample`;
    preview = preview.replace(new RegExp(`{{\\s*${variable}\\s*}}`, "g"), value);
  });
  return preview;
}

export function TemplatesView({ canWrite = false }: TemplatesViewProps) {
  const [templates, setTemplates] = useState<TemplateItem[]>([]);
  const [activeTab, setActiveTab] = useState("all");
  const [status, setStatus] = useState("all");
  const [category, setCategory] = useState("all");
  const [language, setLanguage] = useState("all");
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState("");
  const [editing, setEditing] = useState<typeof emptyForm | null>(null);
  const [selectedId, setSelectedId] = useState("");
  const [previewValues, setPreviewValues] = useState<Record<string, string>>({});
  const [previewText, setPreviewText] = useState("");
  const [whatsappAccounts, setWhatsappAccounts] = useState<{ id: string; displayName: string; phoneNumber: string }[]>([]);

  useEffect(() => {
    getWhatsAppAccounts<{ data: { id: string; displayName: string; phoneNumber: string }[] }>()
      .then((response) => setWhatsappAccounts(response.data))
      .catch(() => undefined);
  }, []);

  const selected = templates.find((item) => item.id === selectedId) || templates[0] || null;

  async function loadTemplates() {
    setLoading(true);
    try {
      const response = await getTemplates<{ data: TemplateItem[]; total: number }>({
        search,
        type: activeTab,
        status,
        category,
        language,
      });
      setTemplates(response.data);
      setSelectedId((current) => response.data.some((item) => item.id === current) ? current : response.data[0]?.id || "");
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Templates could not be loaded.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadTemplates().catch(() => undefined);
  }, [activeTab, status, category, language]);

  const counts = useMemo(() => ({
    total: templates.length,
    whatsapp: templates.filter((item) => item.type === "whatsapp").length,
    active: templates.filter((item) => item.status === "active" || item.status === "approved").length,
    archived: templates.filter((item) => item.status === "archived").length,
  }), [templates]);

  useEffect(() => {
    if (!selected) {
      setPreviewText("");
      return;
    }
    previewTemplate<{ data: { preview: string } }>({ body: selected.body, variables: previewValues })
      .then((response) => setPreviewText(response.data.preview))
      .catch(() => setPreviewText(selected.body));
  }, [selected?.id, selected?.body, previewValues]);

  function openCreate() {
    setEditing(emptyForm);
  }

  function openEdit(template: TemplateItem) {
    setEditing({
      id: template.id,
      name: template.name,
      type: template.type,
      category: template.category,
      language: template.language,
      status: template.status,
      body: template.body,
      variables: (template.variables || []).join(", "),
      whatsappAccountId: template.whatsappAccountId || "",
    });
  }

  async function submitTemplate(event: React.FormEvent) {
    event.preventDefault();
    if (!editing) return;
    setSaving(true);
    setNotice("");
    const payload = {
      name: editing.name.trim(),
      type: editing.type,
      category: editing.category,
      language: editing.language,
      status: editing.status,
      body: editing.body,
      variables: editing.variables.split(",").map((item) => item.trim()).filter(Boolean),
      whatsappAccountId: editing.type === "whatsapp" ? (editing.whatsappAccountId || undefined) : undefined,
    };
    try {
      if (editing.id) await updateTemplate<{ data: TemplateItem }>(editing.id, payload);
      else await createTemplate<{ data: TemplateItem }>(payload);
      setEditing(null);
      setNotice(editing.id ? "Template updated." : "Template created.");
      await loadTemplates();
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Template could not be saved.");
    } finally {
      setSaving(false);
    }
  }

  async function duplicate(id: string) {
    const response = await duplicateTemplate<{ data: TemplateItem }>(id);
    setTemplates((items) => [response.data, ...items]);
    setSelectedId(response.data.id);
    setNotice("Template duplicated.");
  }

  async function archive(id: string) {
    const response = await archiveTemplate<{ data: TemplateItem }>(id);
    setTemplates((items) => items.map((item) => item.id === id ? response.data : item));
    setNotice("Template archived.");
  }

  async function submitForApproval(id: string) {
    setSaving(true);
    setNotice("");
    try {
      const response = await submitTemplateForApproval<{ data: TemplateItem }>(id);
      setTemplates((items) => items.map((item) => item.id === id ? response.data : item));
      setNotice("Submitted to Meta for review.");
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Submission to Meta failed.");
    } finally {
      setSaving(false);
    }
  }

  async function syncWhatsApp() {
    setSaving(true);
    setNotice("");
    try {
      const response = await syncTemplateLibrary<{ synced: number; accounts: number }>();
      setNotice(`Synced ${response.synced} WhatsApp templates from ${response.accounts} account(s).`);
      await loadTemplates();
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "WhatsApp sync failed.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="flex w-full min-w-0 flex-1 flex-col overflow-x-hidden overflow-y-visible">
      <div className="shrink-0 border-b border-border bg-[radial-gradient(circle_at_top_left,rgba(34,197,94,0.12),transparent_34%),linear-gradient(135deg,rgba(15,23,42,0.78),rgba(2,6,23,0.22))] px-3 py-4 sm:px-6">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="min-w-0">
            <div className="mb-1 flex flex-wrap items-center gap-2">
              <Badge variant="outline" className="border-primary/30 bg-primary/10 text-primary">Template Library</Badge>
              <span className="text-[11px] text-muted-foreground">{counts.active} active - {counts.whatsapp} WhatsApp - {counts.archived} archived</span>
            </div>
            <h1 className="text-foreground">Template Library</h1>
            <p className="mt-1 max-w-2xl text-xs text-muted-foreground">Manage approved WhatsApp templates, quick replies, automation copy, campaign content, follow-ups, and lead-stage messages.</p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button size="sm" variant="outline" className="h-8 border-border bg-card/60 text-xs" onClick={loadTemplates} disabled={loading}>
              <RefreshCcw size={13} className="mr-1.5" /> {loading ? "Refreshing" : "Refresh"}
            </Button>
            {canWrite && <Button size="sm" variant="outline" className="h-8 border-border bg-card/60 text-xs" onClick={syncWhatsApp} disabled={saving}>
              <Sparkles size={13} className="mr-1.5" /> Sync WhatsApp
            </Button>}
            {canWrite && <Button size="sm" className="h-8 bg-primary text-xs text-primary-foreground" onClick={openCreate}>
              <FileText size={13} className="mr-1.5" /> New template
            </Button>}
          </div>
        </div>
      </div>

      <div className="grid shrink-0 grid-cols-1 gap-3 border-b border-border bg-background/35 px-3 py-3 min-[380px]:grid-cols-2 md:grid-cols-4 sm:px-6">
        {[
          ["Total", counts.total, <FileText size={14} />, "from-primary/20 to-emerald-400/5"],
          ["WhatsApp", counts.whatsapp, <MessageSquareText size={14} />, "from-blue-500/15 to-cyan-400/5"],
          ["Active", counts.active, <Sparkles size={14} />, "from-violet-500/15 to-fuchsia-400/5"],
          ["Archived", counts.archived, <Archive size={14} />, "from-red-500/15 to-orange-400/5"],
        ].map(([label, value, icon, accent]) => (
          <Card key={String(label)} className={`overflow-hidden border-border bg-gradient-to-br ${String(accent)} p-3`}>
            <div className="flex items-center justify-between gap-3">
              <div>
                <div className="text-lg font-semibold text-foreground">{String(value)}</div>
                <div className="text-[11px] text-muted-foreground">{String(label)}</div>
              </div>
              <div className="flex h-9 w-9 items-center justify-center rounded-md border border-white/10 bg-card/70 text-primary">{icon}</div>
            </div>
          </Card>
        ))}
      </div>

      <div className="shrink-0 border-b border-border bg-card/35 px-3 py-3 sm:px-6">
        <div className="grid grid-cols-1 gap-2 md:grid-cols-[1fr_auto_auto_auto_auto]">
          <div className="relative">
            <Search size={14} className="absolute left-2 top-2.5 text-muted-foreground" />
            <input value={search} onChange={(event) => setSearch(event.target.value)} onKeyDown={(event) => event.key === "Enter" && loadTemplates()} placeholder="Search templates" className={`${fieldClass} pl-8`} />
          </div>
          <select value={status} onChange={(event) => setStatus(event.target.value)} className={fieldClass}>
            {statuses.map((item) => <option key={item} value={item}>{item.replace("_", " ")}</option>)}
          </select>
          <select value={category} onChange={(event) => setCategory(event.target.value)} className={fieldClass}>
            {categories.map((item) => <option key={item} value={item}>{item}</option>)}
          </select>
          <select value={language} onChange={(event) => setLanguage(event.target.value)} className={fieldClass}>
            {languages.map((item) => <option key={item} value={item}>{item}</option>)}
          </select>
          <Button size="sm" variant="outline" className="h-9 border-border bg-background/60 text-xs" onClick={loadTemplates}>Apply</Button>
        </div>
        {notice && (
          <div className={`mt-2 rounded-md border px-3 py-2 text-xs ${notice.toLowerCase().includes("failed") || notice.toLowerCase().includes("could not") ? "border-destructive/30 bg-destructive/10 text-destructive" : "border-primary/25 bg-primary/10 text-primary"}`}>
            {notice}
          </div>
        )}
      </div>

      <div className="no-scrollbar flex w-full min-w-0 shrink-0 gap-1 overflow-x-auto overscroll-x-contain border-b border-border bg-background/20 px-3 pt-3 sm:px-6">
        {tabs.map((tab) => (
          <button key={tab.id} onClick={() => setActiveTab(tab.id)} className={`-mb-px shrink-0 whitespace-nowrap rounded-t-md border-b-2 px-3 py-2 text-xs transition-colors ${activeTab === tab.id ? "border-primary bg-primary/10 text-primary" : "border-transparent text-muted-foreground hover:bg-card/70 hover:text-foreground"}`}>
            {tab.label}
          </button>
        ))}
      </div>

      <div className="flex min-h-0 flex-1 flex-col overflow-hidden xl:flex-row">
        <div className="flex-1 overflow-y-auto p-3 sm:p-6">
          {loading && (
            <div className="grid gap-3 xl:grid-cols-2">
              {[1, 2, 3, 4].map((item) => (
                <Card key={item} className="border-border bg-card p-4">
                  <div className="flex gap-3">
                    <div className="h-10 w-10 animate-pulse rounded-md bg-secondary" />
                    <div className="flex-1">
                      <div className="h-4 w-1/2 animate-pulse rounded bg-secondary" />
                      <div className="mt-3 h-3 w-full animate-pulse rounded bg-secondary" />
                      <div className="mt-2 h-3 w-3/4 animate-pulse rounded bg-secondary" />
                    </div>
                  </div>
                </Card>
              ))}
            </div>
          )}
          {!loading && templates.length === 0 && (
            <Card className="border-dashed border-border bg-card/70 p-8 text-center">
              <div className="mx-auto flex h-11 w-11 items-center justify-center rounded-md border border-primary/25 bg-primary/10 text-primary">
                <FileText size={18} />
              </div>
              <div className="mt-3 text-sm font-medium text-foreground">No templates found</div>
              <p className="mt-1 text-xs text-muted-foreground">Create a template, sync WhatsApp templates, or adjust the current filters.</p>
            </Card>
          )}
          <div className="grid gap-3 xl:grid-cols-2">
            {!loading && templates.map((template) => (
              <Card key={template.id} className={`cursor-pointer overflow-hidden border-border bg-card transition hover:border-primary/25 hover:shadow-xl hover:shadow-black/10 ${selected?.id === template.id ? "ring-1 ring-primary" : ""}`} onClick={() => setSelectedId(template.id)}>
                <div className="h-1 bg-gradient-to-r from-primary/70 via-blue-400/55 to-violet-400/55" />
                <div className="p-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="flex min-w-0 gap-3">
                    <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md border border-primary/25 bg-primary/10 text-primary">
                      {typeIcon(template.type)}
                    </div>
                    <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <h3 className="truncate text-sm font-semibold text-foreground">{template.name}</h3>
                      <Badge variant="outline" className={`text-[10px] ${statusClass(template.status)}`}>{template.status}</Badge>
                      <Badge variant="outline" className="border-border text-[10px] text-muted-foreground">{typeLabel(template.type)}</Badge>
                    </div>
                    <p className="mt-1 line-clamp-2 text-xs text-muted-foreground">{template.body || template.providerTemplateId || "No body saved."}</p>
                    <div className="mt-3 flex flex-wrap gap-3 text-[11px] text-muted-foreground">
                      <span className="capitalize">{template.category}</span>
                      <span>{template.language}</span>
                      <span>{template.usageCount} uses</span>
                      <span>Last used {formatDate(template.lastUsedAt)}</span>
                    </div>
                    </div>
                  </div>
                  <div className="flex shrink-0 gap-1">
                    <IconButton title="Preview" icon={<Eye size={13} />} onClick={() => setSelectedId(template.id)} />
                    {canWrite && <IconButton title="Edit" icon={<Edit3 size={13} />} onClick={() => openEdit(template)} />}
                    {canWrite && <IconButton title="Duplicate" icon={<Copy size={13} />} onClick={() => duplicate(template.id)} />}
                    {canWrite && template.status !== "archived" && <IconButton title="Archive" icon={<Archive size={13} />} onClick={() => archive(template.id)} danger />}
                  </div>
                </div>
                </div>
              </Card>
            ))}
          </div>
        </div>

        <aside className="max-h-[46dvh] shrink-0 overflow-y-auto border-t border-border bg-card xl:max-h-none xl:w-[410px] xl:border-l xl:border-t-0">
          <div className="sticky top-0 z-10 border-b border-border bg-card/95 px-4 py-3 backdrop-blur">
            <div className="flex items-center justify-between gap-2">
              <div>
                <h2 className="text-sm font-semibold text-foreground">Live Preview</h2>
                <p className="text-xs text-muted-foreground">{selected ? selected.name : "Select a template"}</p>
              </div>
              {selected && <Badge variant="outline" className={`text-[10px] ${statusClass(selected.status)}`}>{selected.status}</Badge>}
            </div>
          </div>
          {selected ? (
            <div className="space-y-4 p-4">
              <Card className="overflow-hidden border-border bg-background">
                <div className="border-b border-border bg-card/70 px-3 py-2">
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-2 text-xs font-semibold uppercase text-muted-foreground">
                      <Send size={13} /> Message Preview
                    </div>
                    <Badge variant="outline" className="border-border text-[10px] text-muted-foreground">{typeLabel(selected.type)}</Badge>
                  </div>
                </div>
                <div className="p-3">
                  <div className="rounded-lg border border-primary/20 bg-primary/10 p-3">
                    <p className="whitespace-pre-wrap text-sm leading-relaxed text-foreground">{previewText || selected.body || "No preview available."}</p>
                  </div>
                </div>
              </Card>
              <Card className="border-border bg-background p-3">
                <div className="mb-2 flex items-center gap-2 text-xs font-semibold uppercase text-muted-foreground">
                  <FileText size={13} /> Template Details
                </div>
                <div className="grid grid-cols-1 gap-2 text-[11px] text-muted-foreground min-[380px]:grid-cols-2">
                  <div className="rounded-md border border-border bg-card/60 p-2"><span className="block text-foreground">{selected.category}</span>Category</div>
                  <div className="rounded-md border border-border bg-card/60 p-2"><span className="block text-foreground">{selected.language}</span>Language</div>
                  <div className="rounded-md border border-border bg-card/60 p-2"><span className="block text-foreground">{selected.usageCount}</span>Usage</div>
                  <div className="rounded-md border border-border bg-card/60 p-2"><span className="block text-foreground">{formatDate(selected.updatedAt)}</span>Updated</div>
                </div>
              </Card>
              {selected.variables.length > 0 && (
                <Card className="border-border bg-background p-3">
                  <h3 className="mb-2 text-xs font-semibold uppercase text-muted-foreground">Variables</h3>
                  <div className="space-y-2">
                    {selected.variables.map((variable) => (
                      <label key={variable} className="block space-y-1">
                        <span className="text-[11px] text-muted-foreground">{variable}</span>
                        <input value={previewValues[variable] || ""} onChange={(event) => setPreviewValues((current) => ({ ...current, [variable]: event.target.value }))} placeholder={sampleValues[variable] || `${variable} sample`} className={fieldClass} />
                      </label>
                    ))}
                  </div>
                </Card>
              )}
              <Card className="border-border bg-background p-3 text-xs text-muted-foreground">
                <div>Slug: {selected.slug || "-"}</div>
                <div>Provider: {selected.providerTemplateId || "Internal"}</div>
              </Card>
              {canWrite && selected.type === "whatsapp" && !selected.providerTemplateId && (
                <Button
                  size="sm"
                  className="h-8 w-full bg-primary text-xs text-primary-foreground"
                  disabled={saving}
                  onClick={() => submitForApproval(selected.id)}
                >
                  <Send size={13} className="mr-1.5" /> Submit to Meta for review
                </Button>
              )}
            </div>
          ) : (
            <div className="p-4">
              <Card className="border-dashed border-border bg-background p-6 text-center text-xs text-muted-foreground">Select a template to preview content and variables.</Card>
            </div>
          )}
        </aside>
      </div>

      {editing && (
        <div className="fixed inset-0 z-50 flex items-center justify-center overflow-y-auto bg-black/70 p-3 backdrop-blur-sm sm:p-4">
          <form onSubmit={submitTemplate} className="max-h-[calc(100dvh-1.5rem)] w-full max-w-5xl overflow-hidden rounded-lg border border-border bg-card shadow-2xl">
            <div className="flex items-center justify-between border-b border-border bg-background/45 px-4 py-3">
              <div>
                <h2 className="text-sm font-semibold text-foreground">{editing.id ? "Edit template" : "Create template"}</h2>
                <p className="text-[11px] text-muted-foreground">Keep WhatsApp, campaign, automation, and CRM template fields compatible.</p>
              </div>
              <button type="button" className="text-muted-foreground hover:text-foreground" onClick={() => setEditing(null)}><X size={17} /></button>
            </div>
            <div className="grid max-h-[calc(92vh-118px)] overflow-y-auto lg:grid-cols-[minmax(0,1fr)_360px]">
              <div className="grid gap-3 p-4 md:grid-cols-2">
                <label className="block space-y-1.5">
                  <span className="text-[11px] font-medium text-muted-foreground">Template name</span>
                  <input value={editing.name} onChange={(event) => setEditing((current) => current && ({ ...current, name: event.target.value }))} placeholder="Template name" className={fieldClass} required />
                </label>
                <label className="block space-y-1.5">
                  <span className="text-[11px] font-medium text-muted-foreground">Type</span>
                  <select value={editing.type} onChange={(event) => setEditing((current) => current && ({ ...current, type: event.target.value }))} className={fieldClass}>
                    {tabs.filter((tab) => tab.id !== "all").map((tab) => <option key={tab.id} value={tab.id}>{tab.label}</option>)}
                  </select>
                </label>
                <label className="block space-y-1.5">
                  <span className="text-[11px] font-medium text-muted-foreground">Category</span>
                  <select value={editing.category} onChange={(event) => setEditing((current) => current && ({ ...current, category: event.target.value }))} className={fieldClass}>
                    {categories.filter((item) => item !== "all").map((item) => <option key={item} value={item}>{item}</option>)}
                  </select>
                </label>
                {editing.type === "whatsapp" && (
                  <label className="block space-y-1.5">
                    <span className="text-[11px] font-medium text-muted-foreground">WhatsApp account</span>
                    <select
                      value={editing.whatsappAccountId}
                      onChange={(event) => setEditing((current) => current && ({ ...current, whatsappAccountId: event.target.value }))}
                      className={fieldClass}
                    >
                      <option value="">Choose an account...</option>
                      {whatsappAccounts.map((account) => (
                        <option key={account.id} value={account.id}>{account.displayName || account.phoneNumber}</option>
                      ))}
                    </select>
                    <span className="block text-[10px] text-muted-foreground">Required before this template can be submitted to Meta for review.</span>
                  </label>
                )}
                <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                  <label className="block space-y-1.5">
                    <span className="text-[11px] font-medium text-muted-foreground">Language</span>
                    <input value={editing.language} onChange={(event) => setEditing((current) => current && ({ ...current, language: event.target.value }))} placeholder="en" className={fieldClass} />
                  </label>
                  <label className="block space-y-1.5">
                    <span className="text-[11px] font-medium text-muted-foreground">Status</span>
                    <select value={editing.status} onChange={(event) => setEditing((current) => current && ({ ...current, status: event.target.value }))} className={fieldClass}>
                      {statuses.filter((item) => item !== "all").map((item) => <option key={item} value={item}>{item}</option>)}
                    </select>
                  </label>
                </div>
                <label className="block space-y-1.5 md:col-span-2">
                  <span className="text-[11px] font-medium text-muted-foreground">Body</span>
                  <textarea value={editing.body} onChange={(event) => setEditing((current) => current && ({ ...current, body: event.target.value }))} placeholder="Message body. Use {{name}} variables." className={textareaClass} />
                </label>
                <label className="block space-y-1.5 md:col-span-2">
                  <span className="text-[11px] font-medium text-muted-foreground">Variables</span>
                  <input value={editing.variables} onChange={(event) => setEditing((current) => current && ({ ...current, variables: event.target.value }))} placeholder="name, phone, requirement" className={fieldClass} />
                </label>
              </div>
              <aside className="border-t border-border bg-background/45 p-4 lg:border-l lg:border-t-0">
                <div className="mb-3 flex items-center justify-between gap-2">
                  <div>
                    <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Live sample</h3>
                    <p className="text-[11px] text-muted-foreground">Variables are replaced with sample data.</p>
                  </div>
                  <Badge variant="outline" className={statusClass(editing.status)}>{editing.status}</Badge>
                </div>
                <div className="rounded-lg border border-primary/20 bg-primary/10 p-3">
                  <p className="whitespace-pre-wrap text-sm leading-relaxed text-foreground">
                    {renderSamplePreview(editing.body, editing.variables.split(",").map((item) => item.trim()).filter(Boolean))}
                  </p>
                </div>
                <div className="mt-3 grid grid-cols-1 gap-2 text-[11px] text-muted-foreground min-[380px]:grid-cols-2">
                  <div className="rounded-md border border-border bg-card/70 p-2"><span className="block text-foreground">{typeLabel(editing.type)}</span>Type</div>
                  <div className="rounded-md border border-border bg-card/70 p-2"><span className="block text-foreground">{editing.language || "-"}</span>Language</div>
                  <div className="rounded-md border border-border bg-card/70 p-2"><span className="block text-foreground">{editing.category}</span>Category</div>
                  <div className="rounded-md border border-border bg-card/70 p-2"><span className="block text-foreground">{editing.variables.split(",").filter((item) => item.trim()).length}</span>Variables</div>
                </div>
              </aside>
            </div>
            <div className="flex flex-col-reverse gap-2 border-t border-border px-4 py-3 sm:flex-row sm:justify-end">
              <Button type="button" variant="outline" className="w-full border-border sm:w-auto" onClick={() => setEditing(null)}>Cancel</Button>
              <Button type="submit" className="w-full bg-primary text-primary-foreground sm:w-auto" disabled={saving}>{saving ? "Saving" : "Save template"}</Button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}

function IconButton({ icon, title, onClick, danger }: { icon: React.ReactNode; title: string; onClick: () => void; danger?: boolean }) {
  return (
    <button
      title={title}
      className={`flex h-8 w-8 items-center justify-center rounded transition ${danger ? "text-muted-foreground hover:bg-secondary hover:text-destructive" : "text-muted-foreground hover:bg-secondary hover:text-foreground"}`}
      onClick={(event) => {
        event.stopPropagation();
        onClick();
      }}
    >
      {icon}
    </button>
  );
}
