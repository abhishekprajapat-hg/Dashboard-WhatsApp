import { useEffect, useState } from "react";
import type React from "react";
import {
  AlertTriangle,
  BarChart3,
  CalendarClock,
  CheckCircle2,
  Copy,
  Eye,
  FileUp,
  MousePointerClick,
  Pause,
  Play,
  Plus,
  RefreshCcw,
  RotateCcw,
  Send,
  ShieldCheck,
  TimerReset,
  Trash2,
  Users,
  X,
} from "lucide-react";
import { Badge } from "./ui/badge";
import { Button } from "./ui/button";
import { Card } from "./ui/card";
import {
  campaignAction,
  createCampaign,
  deleteCampaign,
  getCampaignReport,
  getCampaigns,
  getWhatsAppTemplates,
  importCampaignContacts,
  previewCampaignAudience,
  sendCampaign,
  updateCampaign,
} from "../lib/api";

interface Campaign {
  id: string;
  name: string;
  status: "sent" | "scheduled" | "draft" | "running" | "paused" | "failed" | "pending_approval" | "approved" | "rejected" | "queued" | "cancelled";
  type: "template" | "bulk" | "scheduled" | "recurring" | "ab_test";
  campaignKind?: string;
  audience: string;
  audienceType: string;
  audienceFilters?: {
    audienceType?: string;
    leadStage?: string;
    tags?: string[];
    createdFrom?: string;
    createdTo?: string;
  };
  recipients: number;
  sent: number;
  delivered: number;
  read: number;
  replied: number;
  clicks: number;
  conversions: number;
  failed: number;
  queued: number;
  completed: number;
  retries: number;
  scheduledAt?: string;
  sentAt?: string;
  template: string;
  templateId: string;
  rateLimit: { perMinute: number; batchSize: number };
  approval: { required?: boolean; status?: string; reason?: string };
  abTest: { enabled?: boolean; split?: number; winnerMetric?: string };
  history: { type: string; at: string; status?: string }[];
}

interface WhatsAppTemplate {
  id: string;
  name: string;
  language: string;
  category: string;
  status: "approved" | "pending" | "rejected";
}

interface CampaignReport extends Campaign {
  recipients: {
    contactId: string;
    name: string;
    phone: string;
    status: string;
    providerMessageId: string;
    error: string;
    attempts: number;
    variant: string;
    sentAt: string;
  }[];
  timeline: {
    id: string;
    contact: string;
    phone: string;
    status: string;
    body: string;
    providerMessageId: string;
    error: string;
    campaignEvent: string;
    variant: string;
    time: string;
  }[];
}

const statusStyle: Record<string, string> = {
  sent: "bg-primary/20 text-primary border-primary/30",
  scheduled: "bg-blue-500/20 text-blue-400 border-blue-500/30",
  draft: "bg-secondary text-muted-foreground border-border",
  running: "bg-yellow-500/20 text-yellow-400 border-yellow-500/30",
  queued: "bg-cyan-500/20 text-cyan-400 border-cyan-500/30",
  paused: "bg-orange-500/20 text-orange-400 border-orange-500/30",
  failed: "bg-destructive/20 text-destructive border-destructive/30",
  pending_approval: "bg-purple-500/20 text-purple-300 border-purple-500/30",
  approved: "bg-emerald-500/20 text-emerald-300 border-emerald-500/30",
  rejected: "bg-red-500/20 text-red-300 border-red-500/30",
  cancelled: "bg-zinc-500/20 text-zinc-300 border-zinc-500/30",
};

const audienceLabels: Record<string, string> = {
  all: "All Contacts",
  opted_in: "Opted-in Contacts",
  leads: "Leads",
  hot_leads: "Hot Leads",
  customers: "Customers",
  imported: "Imported Contacts",
};

const leadStageLabels: Record<string, string> = {
  "": "Any lead stage",
  new_lead: "New lead",
  contacted: "Contacted",
  qualified: "Qualified",
  proposal_sent: "Proposal sent",
  won: "Won",
  lost: "Lost",
};

function percent(part: number, total: number) {
  if (!total) return "-";
  return `${Math.round((part / total) * 100)}%`;
}

const fieldClass =
  "h-9 w-full rounded-md border border-border bg-background/80 px-3 text-xs text-foreground shadow-inner shadow-black/10 outline-none transition placeholder:text-muted-foreground/60 focus:border-primary/50 focus:ring-2 focus:ring-primary/20 disabled:cursor-not-allowed disabled:opacity-60";

const textareaClass =
  "min-h-[72px] w-full rounded-md border border-border bg-background/80 px-3 py-2 text-xs leading-relaxed text-foreground shadow-inner shadow-black/10 outline-none transition placeholder:text-muted-foreground/60 focus:border-primary/50 focus:ring-2 focus:ring-primary/20 disabled:cursor-not-allowed disabled:opacity-60";

function formatDate(value?: string) {
  if (!value) return "Not scheduled";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" }).format(date);
}

function campaignDate(campaign: Campaign) {
  if (campaign.sentAt) return `Sent ${formatDate(campaign.sentAt)}`;
  if (campaign.scheduledAt) return `Scheduled ${formatDate(campaign.scheduledAt)}`;
  return "Draft timing";
}

function metricTone(label: string) {
  if (label === "Failed" || label === "Failures") return "text-destructive";
  if (label === "Delivered" || label === "Read" || label === "Replies") return "text-primary";
  return "text-foreground";
}

interface CampaignsViewProps {
  canWrite?: boolean;
}

export function CampaignsView({ canWrite = false }: CampaignsViewProps) {
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [summary, setSummary] = useState({ totalSent: 0, deliveryRate: 0, readRate: 0, replyRate: 0, clickRate: 0, conversionRate: 0, failures: 0 });
  const [templates, setTemplates] = useState<WhatsAppTemplate[]>([]);
  const [activeTab, setActiveTab] = useState("All");
  const [showCreate, setShowCreate] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [busyId, setBusyId] = useState("");
  const [notice, setNotice] = useState("");
  const [report, setReport] = useState<CampaignReport | null>(null);
  const [csvText, setCsvText] = useState("");
  const [previewing, setPreviewing] = useState(false);
  const [audiencePreview, setAudiencePreview] = useState<{ count: number; label: string; sample: { id: string; name: string; phone: string }[] } | null>(null);
  const [form, setForm] = useState({
    name: "",
    type: "template",
    campaignKind: "broadcast",
    audienceType: "all",
    templateId: "",
    templateBId: "",
    status: "draft",
    scheduledAt: "",
    recurring: false,
    recurrence: "weekly",
    requireApproval: true,
    perMinute: 60,
    batchSize: 50,
    abTest: false,
    split: 50,
    leadStage: "",
    tags: "",
    createdFrom: "",
    createdTo: "",
  });

  async function loadCampaigns() {
    setLoading(true);
    try {
      const response = await getCampaigns<{
        data: Campaign[];
        total: number;
        summary: typeof summary;
      }>();
      setCampaigns(response.data);
      setSummary(response.summary);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Campaigns could not be loaded.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadCampaigns().catch(() => undefined);
    getWhatsAppTemplates<{ data: WhatsAppTemplate[]; total: number }>()
      .then((response) => {
        const approved = response.data.filter((template) => template.status === "approved");
        setTemplates(approved);
        setForm((current) => ({ ...current, templateId: current.templateId || approved[0]?.id || "", templateBId: current.templateBId || approved[1]?.id || "" }));
      })
      .catch(() => undefined);
  }, []);

  const tabs = ["All", "template", "bulk", "scheduled", "recurring", "ab_test"];
  const filtered = campaigns.filter((campaign) => activeTab === "All" || campaign.type === activeTab);
  const selectedTemplate = templates.find((template) => template.id === form.templateId);
  const selectedTemplateB = templates.find((template) => template.id === form.templateBId);

  async function handleCreate(event: React.FormEvent) {
    event.preventDefault();
    if (!form.name.trim() || !form.templateId) return;
    setSaving(true);
    setNotice("");
    try {
      const audienceFilters = {
        audienceType: form.audienceType,
        leadStage: form.leadStage || undefined,
        tags: form.tags.split(",").map((tag) => tag.trim()).filter(Boolean),
        createdFrom: form.createdFrom || undefined,
        createdTo: form.createdTo || undefined,
      };
      const response = await createCampaign<{ data: Campaign }>({
        name: form.name.trim(),
        type: form.type,
        campaignKind: form.campaignKind,
        audience: audienceLabels[form.audienceType],
        audienceType: form.audienceType,
        audienceFilters,
        templateId: form.templateId,
        templateBId: form.abTest ? form.templateBId : undefined,
        status: form.status,
        scheduledAt: form.scheduledAt || undefined,
        recurring: form.recurring || form.type === "recurring",
        recurrence: form.recurrence,
        requireApproval: form.requireApproval,
        rateLimit: { perMinute: form.perMinute, batchSize: form.batchSize },
        abTest: { enabled: form.abTest || form.type === "ab_test", split: form.split, winnerMetric: "read" },
      });
      setCampaigns((items) => [response.data, ...items]);
      setShowCreate(false);
      setNotice("Campaign created.");
      setAudiencePreview(null);
      await loadCampaigns();
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Campaign could not be created.");
    } finally {
      setSaving(false);
    }
  }

  async function previewAudience() {
    setPreviewing(true);
    setNotice("");
    try {
      const response = await previewCampaignAudience<{ data: { count: number; label: string; sample: { id: string; name: string; phone: string }[] } }>({
        audienceType: form.audienceType,
        audienceFilters: {
          audienceType: form.audienceType,
          leadStage: form.leadStage || undefined,
          tags: form.tags.split(",").map((tag) => tag.trim()).filter(Boolean),
          createdFrom: form.createdFrom || undefined,
          createdTo: form.createdTo || undefined,
        },
      });
      setAudiencePreview(response.data);
      setNotice(`Preview matched ${response.data.count} contacts.`);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Audience preview failed.");
    } finally {
      setPreviewing(false);
    }
  }

  async function runAction(campaign: Campaign, action: string) {
    setBusyId(campaign.id);
    setNotice("");
    try {
      const response = await campaignAction<{ data: Campaign }>(campaign.id, action);
      setCampaigns((items) => items.map((item) => (item.id === campaign.id ? response.data : item)));
      setNotice(`${action.replace(/_/g, " ")} completed.`);
      if (report?.id === campaign.id) await openReport(campaign.id);
      await loadCampaigns();
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Campaign action failed.");
    } finally {
      setBusyId("");
    }
  }

  async function sendNow(campaign: Campaign) {
    setBusyId(campaign.id);
    setNotice("");
    try {
      const response = await sendCampaign<{ data: Campaign }>(campaign.id);
      setCampaigns((items) => items.map((item) => (item.id === campaign.id ? response.data : item)));
      setNotice(`Campaign processed for ${response.data.recipients} recipients.`);
      await loadCampaigns();
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Campaign could not be sent.");
    } finally {
      setBusyId("");
    }
  }

  async function openReport(id: string) {
    setBusyId(id);
    try {
      const response = await getCampaignReport<{ data: CampaignReport }>(id);
      setReport(response.data);
    } finally {
      setBusyId("");
    }
  }

  async function duplicate(campaign: Campaign) {
    const response = await createCampaign<{ data: Campaign }>({
      name: `${campaign.name} Copy`,
      type: campaign.type,
      campaignKind: campaign.campaignKind,
      audience: campaign.audience,
      audienceType: campaign.audienceType || "all",
      audienceFilters: campaign.audienceFilters,
      templateId: campaign.templateId,
      status: "draft",
      requireApproval: Boolean(campaign.approval?.required),
      rateLimit: campaign.rateLimit,
    });
    setCampaigns((items) => [response.data, ...items]);
  }

  async function remove(id: string) {
    setCampaigns((items) => items.filter((campaign) => campaign.id !== id));
    if (report?.id === id) setReport(null);
    await deleteCampaign(id).catch(() => undefined);
  }

  async function importCsv() {
    if (!csvText.trim()) return;
    const response = await importCampaignContacts<{ created: number; updated: number; failed: number }>({ csv: csvText });
    setNotice(`Imported ${response.created} new, updated ${response.updated}, failed ${response.failed}.`);
    setCsvText("");
  }

  return (
    <div className="flex w-full min-w-0 flex-1 flex-col overflow-x-hidden overflow-y-visible">
      <div className="shrink-0 border-b border-border bg-[radial-gradient(circle_at_top_left,rgba(34,197,94,0.12),transparent_34%),linear-gradient(135deg,rgba(15,23,42,0.78),rgba(2,6,23,0.22))] px-3 py-4 sm:px-6">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="min-w-0">
            <div className="mb-1 flex flex-wrap items-center gap-2">
              <Badge variant="outline" className="border-primary/30 bg-primary/10 text-primary">Marketing SaaS</Badge>
              <span className="text-[11px] text-muted-foreground">{campaigns.length} campaigns - {templates.length} approved WhatsApp templates</span>
            </div>
            <h1 className="text-foreground">Campaign Management</h1>
            <p className="mt-1 max-w-2xl text-xs text-muted-foreground">
              Plan template broadcasts, preview audiences, schedule delivery, and monitor every WhatsApp result.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button size="sm" variant="outline" className="h-8 border-border bg-card/60 text-xs" onClick={loadCampaigns} disabled={loading}>
              <RefreshCcw size={13} className="mr-1.5" /> {loading ? "Refreshing" : "Refresh"}
            </Button>
            {canWrite && (
              <Button size="sm" className="h-8 bg-primary text-xs text-primary-foreground" onClick={() => setShowCreate((value) => !value)}>
                <Plus size={13} className="mr-1.5" /> New campaign
              </Button>
            )}
          </div>
        </div>
      </div>

      {canWrite && showCreate && (
        <form onSubmit={handleCreate} className="shrink-0 border-b border-border bg-card/35 px-3 py-4 sm:px-6">
          <Card className="overflow-hidden border-border bg-card/85 shadow-xl shadow-black/10">
            <div className="flex flex-col gap-3 border-b border-border bg-background/45 p-4 sm:flex-row sm:items-center sm:justify-between">
              <div className="flex items-center gap-2">
                <span className="flex h-8 w-8 items-center justify-center rounded-md border border-primary/25 bg-primary/10 text-primary">
                  <Send size={15} />
                </span>
                <div>
                  <h2 className="text-sm font-semibold text-foreground">Create campaign</h2>
                  <p className="text-[11px] text-muted-foreground">WhatsApp campaigns must use an approved template before sending.</p>
                </div>
              </div>
              <div className="flex flex-wrap gap-2">
                <Button type="button" size="sm" variant="outline" className="h-8 border-border bg-card/60 text-xs" onClick={() => setShowCreate(false)}>Cancel</Button>
                <Button type="submit" size="sm" className="h-8 bg-primary text-xs text-primary-foreground" disabled={saving || !form.templateId}>
                  {saving ? "Saving" : "Save campaign"}
                </Button>
              </div>
            </div>

            <div className="grid grid-cols-1 gap-px bg-border xl:grid-cols-[1.05fr_1fr_1fr_0.9fr]">
              <section className="space-y-3 bg-card p-4">
                <div className="flex items-center gap-2">
                  <span className="flex h-7 w-7 items-center justify-center rounded-md bg-primary/10 text-primary"><BarChart3 size={14} /></span>
                  <div>
                    <h3 className="text-xs font-semibold uppercase tracking-wide text-foreground">Campaign info</h3>
                    <p className="text-[11px] text-muted-foreground">Name, type, approval, and experiment mode.</p>
                  </div>
                </div>
                <label className="block space-y-1.5">
                  <span className="text-[11px] font-medium text-muted-foreground">Campaign name</span>
                  <input value={form.name} onChange={(event) => setForm((current) => ({ ...current, name: event.target.value }))} placeholder="July offer broadcast" className={fieldClass} required />
                </label>
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-1">
                  <label className="block space-y-1.5">
                    <span className="text-[11px] font-medium text-muted-foreground">Campaign type</span>
                    <select value={form.type} onChange={(event) => setForm((current) => ({ ...current, type: event.target.value }))} className={fieldClass}>
                      <option value="template">Template</option>
                      <option value="bulk">Bulk</option>
                      <option value="scheduled">Scheduled</option>
                      <option value="recurring">Recurring</option>
                      <option value="ab_test">A/B Testing</option>
                    </select>
                  </label>
                  <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
                    <label className="flex items-center justify-between gap-2 rounded-md border border-border bg-background/60 px-2 py-2 text-[11px] text-muted-foreground">
                      Approval
                      <input type="checkbox" checked={form.requireApproval} onChange={(event) => setForm((current) => ({ ...current, requireApproval: event.target.checked }))} className="h-4 w-4 accent-primary" />
                    </label>
                    <label className="flex items-center justify-between gap-2 rounded-md border border-border bg-background/60 px-2 py-2 text-[11px] text-muted-foreground">
                      A/B
                      <input type="checkbox" checked={form.abTest} onChange={(event) => setForm((current) => ({ ...current, abTest: event.target.checked, type: event.target.checked ? "ab_test" : current.type }))} className="h-4 w-4 accent-primary" />
                    </label>
                    <label className="flex items-center justify-between gap-2 rounded-md border border-border bg-background/60 px-2 py-2 text-[11px] text-muted-foreground">
                      Repeat
                      <input type="checkbox" checked={form.recurring} onChange={(event) => setForm((current) => ({ ...current, recurring: event.target.checked, type: event.target.checked ? "recurring" : current.type }))} className="h-4 w-4 accent-primary" />
                    </label>
                  </div>
                </div>
              </section>

              <section className="space-y-3 bg-card p-4">
                <div className="flex items-center gap-2">
                  <span className="flex h-7 w-7 items-center justify-center rounded-md bg-blue-500/10 text-blue-300"><Users size={14} /></span>
                  <div>
                    <h3 className="text-xs font-semibold uppercase tracking-wide text-foreground">Audience</h3>
                    <p className="text-[11px] text-muted-foreground">Select and preview reachable contacts.</p>
                  </div>
                </div>
                <select value={form.audienceType} onChange={(event) => setForm((current) => ({ ...current, audienceType: event.target.value }))} className={fieldClass}>
                  {Object.entries(audienceLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
                </select>
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <select value={form.leadStage} onChange={(event) => setForm((current) => ({ ...current, leadStage: event.target.value }))} className={fieldClass}>
                    {Object.entries(leadStageLabels).map(([value, label]) => <option key={value || "any"} value={value}>{label}</option>)}
                  </select>
                  <input value={form.tags} onChange={(event) => setForm((current) => ({ ...current, tags: event.target.value }))} placeholder="Tags, comma separated" className={fieldClass} />
                  <input type="date" value={form.createdFrom} onChange={(event) => setForm((current) => ({ ...current, createdFrom: event.target.value }))} className={fieldClass} />
                  <input type="date" value={form.createdTo} onChange={(event) => setForm((current) => ({ ...current, createdTo: event.target.value }))} className={fieldClass} />
                </div>
                <Button type="button" size="sm" variant="outline" className="h-8 w-full border-border bg-background/60 text-xs" onClick={previewAudience} disabled={previewing}>
                  <Eye size={13} className="mr-1.5" /> {previewing ? "Previewing audience" : "Preview audience"}
                </Button>
                <div className="rounded-md border border-border bg-background/60 p-3 text-[11px] text-muted-foreground">
                  {audiencePreview ? (
                    <>
                      <div className="font-medium text-foreground">{audiencePreview.label}: {audiencePreview.count} contacts</div>
                      <div className="mt-1 line-clamp-2">{audiencePreview.sample.length ? audiencePreview.sample.slice(0, 4).map((contact) => contact.name || contact.phone).join(", ") : "No sample contacts returned."}</div>
                    </>
                  ) : (
                    "Preview this audience before sending to confirm targeting."
                  )}
                </div>
              </section>

              <section className="space-y-3 bg-card p-4">
                <div className="flex items-center gap-2">
                  <span className="flex h-7 w-7 items-center justify-center rounded-md bg-violet-500/10 text-violet-300"><ShieldCheck size={14} /></span>
                  <div>
                    <h3 className="text-xs font-semibold uppercase tracking-wide text-foreground">Template</h3>
                    <p className="text-[11px] text-muted-foreground">Choose approved WhatsApp content.</p>
                  </div>
                </div>
                <select value={form.templateId} onChange={(event) => setForm((current) => ({ ...current, templateId: event.target.value }))} className={fieldClass} required>
                  {templates.length === 0 && <option value="">No approved templates</option>}
                  {templates.map((template) => <option key={template.id} value={template.id}>{template.name}</option>)}
                </select>
                <select value={form.templateBId} onChange={(event) => setForm((current) => ({ ...current, templateBId: event.target.value }))} className={fieldClass}>
                  <option value="">Variant B template</option>
                  {templates.map((template) => <option key={template.id} value={template.id}>{template.name}</option>)}
                </select>
                {form.abTest && (
                  <label className="block space-y-1.5">
                    <span className="text-[11px] font-medium text-muted-foreground">A/B split</span>
                    <input type="number" min={1} max={99} value={form.split} onChange={(event) => setForm((current) => ({ ...current, split: Number(event.target.value) }))} className={fieldClass} />
                  </label>
                )}
                <div className="rounded-md border border-border bg-background/60 p-3 text-[11px] text-muted-foreground">
                  <div className="font-medium text-foreground">{selectedTemplate?.name || "No template selected"}</div>
                  <div className="mt-1">{selectedTemplate ? `${selectedTemplate.category} - ${selectedTemplate.language} - ${selectedTemplate.status}` : "Approved WhatsApp template is required."}</div>
                  {form.abTest && selectedTemplateB ? <div className="mt-1 text-violet-300">Variant B: {selectedTemplateB.name}</div> : null}
                </div>
              </section>

              <section className="space-y-3 bg-card p-4">
                <div className="flex items-center gap-2">
                  <span className="flex h-7 w-7 items-center justify-center rounded-md bg-cyan-500/10 text-cyan-300"><CalendarClock size={14} /></span>
                  <div>
                    <h3 className="text-xs font-semibold uppercase tracking-wide text-foreground">Schedule and limits</h3>
                    <p className="text-[11px] text-muted-foreground">Control send timing and throughput.</p>
                  </div>
                </div>
                <input type="datetime-local" value={form.scheduledAt} onChange={(event) => setForm((current) => ({ ...current, scheduledAt: event.target.value }))} className={fieldClass} />
                <select value={form.recurrence} onChange={(event) => setForm((current) => ({ ...current, recurrence: event.target.value }))} className={fieldClass}>
                  <option value="daily">Daily</option>
                  <option value="weekly">Weekly</option>
                  <option value="monthly">Monthly</option>
                </select>
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <label className="block space-y-1.5">
                    <span className="text-[11px] font-medium text-muted-foreground">Rate/min</span>
                    <input type="number" value={form.perMinute} onChange={(event) => setForm((current) => ({ ...current, perMinute: Number(event.target.value) }))} className={fieldClass} />
                  </label>
                  <label className="block space-y-1.5">
                    <span className="text-[11px] font-medium text-muted-foreground">Batch size</span>
                    <input type="number" value={form.batchSize} onChange={(event) => setForm((current) => ({ ...current, batchSize: Number(event.target.value) }))} className={fieldClass} />
                  </label>
                </div>
                <div className="rounded-md border border-border bg-background/60 p-3 text-[11px] text-muted-foreground">
                  {form.scheduledAt ? `Scheduled for ${formatDate(form.scheduledAt)}.` : "Leave schedule empty to keep as draft or send manually."}
                </div>
              </section>
            </div>
          </Card>
        </form>
      )}

      <div className="grid shrink-0 grid-cols-1 gap-3 border-b border-border bg-background/35 px-3 py-3 min-[380px]:grid-cols-2 md:grid-cols-5 sm:px-6">
        {[
          ["Total sent", summary.totalSent.toLocaleString(), <Send size={14} />, "from-primary/20 to-emerald-400/5"],
          ["Delivery rate", `${summary.deliveryRate}%`, <CheckCircle2 size={14} />, "from-blue-500/15 to-cyan-400/5"],
          ["Read rate", `${summary.readRate}%`, <Eye size={14} />, "from-violet-500/15 to-fuchsia-400/5"],
          ["Reply rate", `${summary.replyRate}%`, <Users size={14} />, "from-cyan-500/15 to-blue-400/5"],
          ["Failures", summary.failures.toLocaleString(), <AlertTriangle size={14} />, "from-red-500/15 to-orange-400/5"],
        ].map(([label, value, icon, accent]) => (
          <Card key={String(label)} className={`overflow-hidden border-border bg-gradient-to-br ${String(accent)} p-3`}>
            <div className="flex items-center justify-between gap-3">
              <div>
                <div className={`text-lg font-semibold ${metricTone(String(label))}`}>{String(value)}</div>
                <div className="text-[11px] text-muted-foreground">{String(label)}</div>
              </div>
              <div className="flex h-9 w-9 items-center justify-center rounded-md border border-white/10 bg-card/70 text-primary">{icon}</div>
            </div>
          </Card>
        ))}
      </div>

      {canWrite && (
      <div className="shrink-0 border-b border-border bg-card/35 px-3 py-3 sm:px-6">
        <div className="grid grid-cols-1 gap-2 md:grid-cols-[1fr_auto]">
          <textarea value={csvText} onChange={(event) => setCsvText(event.target.value)} placeholder="CSV import: name,phone,email" className={`${textareaClass} min-h-[44px]`} />
          <Button size="sm" variant="outline" className="h-11 border-border bg-background/60 text-xs" onClick={importCsv} disabled={!csvText.trim()}>
            <FileUp size={13} className="mr-1.5" /> Import contacts
          </Button>
        </div>
        {notice && (
          <div className={`mt-2 rounded-md border px-3 py-2 text-xs ${notice.toLowerCase().includes("failed") || notice.toLowerCase().includes("could not") ? "border-destructive/30 bg-destructive/10 text-destructive" : "border-primary/25 bg-primary/10 text-primary"}`}>
            {notice}
          </div>
        )}
      </div>
      )}

      <div className="no-scrollbar flex shrink-0 gap-1 overflow-x-auto border-b border-border bg-background/20 px-3 pt-3 sm:px-6">
        {tabs.map((tab) => (
          <button key={tab} onClick={() => setActiveTab(tab)} className={`-mb-px rounded-t-md border-b-2 px-3 py-2 text-xs capitalize transition-colors ${activeTab === tab ? "border-primary bg-primary/10 text-primary" : "border-transparent text-muted-foreground hover:bg-card/70 hover:text-foreground"}`}>
            {tab.replace("_", " ")}
          </button>
        ))}
      </div>

      <div className="flex min-h-0 flex-1 flex-col overflow-hidden xl:flex-row">
        <div className="flex-1 space-y-3 overflow-y-auto p-3 sm:p-6">
          {loading ? (
            <div className="space-y-3">
              {[1, 2, 3].map((item) => (
                <Card key={item} className="border-border bg-card p-4">
                  <div className="flex gap-4">
                    <div className="h-10 w-10 animate-pulse rounded-lg bg-secondary" />
                    <div className="flex-1">
                      <div className="h-4 w-1/3 animate-pulse rounded bg-secondary" />
                      <div className="mt-3 h-3 w-2/3 animate-pulse rounded bg-secondary" />
                      <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
                        {[1, 2, 3, 4].map((metric) => <div key={metric} className="h-12 animate-pulse rounded bg-secondary" />)}
                      </div>
                    </div>
                  </div>
                </Card>
              ))}
            </div>
          ) : filtered.map((campaign) => (
            <Card key={campaign.id} className="overflow-hidden border-border bg-card transition hover:border-primary/25 hover:shadow-xl hover:shadow-black/10">
              <div className="h-1 bg-gradient-to-r from-primary/70 via-blue-400/55 to-violet-400/55" />
              <div className="p-4">
              <div className="flex flex-col gap-4 xl:flex-row xl:items-start">
                <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg border border-primary/25 bg-primary/10 text-primary">
                  {campaign.type === "scheduled" ? <CalendarClock size={17} /> : campaign.type === "recurring" ? <TimerReset size={17} /> : <Send size={17} />}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <h3 className="truncate text-sm font-semibold text-foreground">{campaign.name}</h3>
                    <Badge variant="outline" className={`text-[10px] ${statusStyle[campaign.status] || statusStyle.draft}`}>{campaign.status.replace("_", " ")}</Badge>
                    <Badge variant="outline" className="border-border text-[10px] text-muted-foreground">{campaign.type.replace("_", " ")}</Badge>
                    {campaign.abTest?.enabled && <Badge variant="outline" className="border-purple-500/30 bg-purple-500/10 text-[10px] text-purple-300">A/B {campaign.abTest.split || 50}%</Badge>}
                    {campaign.approval?.required && <Badge variant="outline" className="border-emerald-500/30 bg-emerald-500/10 text-[10px] text-emerald-300">approval {campaign.approval.status}</Badge>}
                      </div>
                      <div className="mt-1 flex flex-wrap gap-3 text-[11px] text-muted-foreground">
                        <span className="flex items-center gap-1"><Users size={12} /> {campaign.audience}</span>
                        <span className="flex items-center gap-1"><ShieldCheck size={12} /> {campaign.template}</span>
                        <span className="flex items-center gap-1"><CalendarClock size={12} /> {campaignDate(campaign)}</span>
                        <span>{campaign.rateLimit?.perMinute || 60}/min - batch {campaign.rateLimit?.batchSize || 50}</span>
                      </div>
                    </div>
                    <div className="rounded-md border border-border bg-background/60 px-3 py-2 text-right">
                      <div className="text-sm font-semibold text-foreground">{campaign.recipients?.toLocaleString?.() || 0}</div>
                      <div className="text-[10px] text-muted-foreground">audience</div>
                    </div>
                  </div>
                  <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4 xl:grid-cols-8">
                    {[
                      ["Queued", campaign.queued],
                      ["Sent", campaign.sent],
                      ["Delivered", `${campaign.delivered} / ${percent(campaign.delivered, campaign.sent)}`],
                      ["Read", `${campaign.read} / ${percent(campaign.read, campaign.delivered)}`],
                      ["Replies", campaign.replied],
                      ["Clicks", campaign.clicks],
                      ["Conversions", campaign.conversions],
                      ["Failures", campaign.failed],
                    ].map(([label, value]) => (
                      <div key={String(label)} className="rounded-md border border-border bg-background/70 p-2">
                        <div className={`text-sm font-semibold ${metricTone(String(label))}`}>{String(value)}</div>
                        <div className="text-[10px] text-muted-foreground">{String(label)}</div>
                      </div>
                    ))}
                  </div>
                </div>
                <div className="flex flex-wrap gap-1 xl:justify-end">
                  {canWrite && campaign.status === "draft" && <IconButton title="Submit approval" icon={<ShieldCheck size={13} />} onClick={() => runAction(campaign, "submit_approval")} />}
                  {canWrite && campaign.status === "pending_approval" && <IconButton title="Approve" icon={<CheckCircle2 size={13} />} onClick={() => runAction(campaign, "approve")} />}
                  {canWrite && campaign.status === "pending_approval" && <IconButton title="Reject" icon={<AlertTriangle size={13} />} onClick={() => runAction(campaign, "reject")} />}
                  {canWrite && ["approved", "draft", "scheduled", "queued", "paused", "failed"].includes(campaign.status) && <IconButton title="Send" icon={<Send size={13} />} onClick={() => sendNow(campaign)} disabled={busyId === campaign.id} />}
                  {canWrite && campaign.status === "running" && <IconButton title="Pause" icon={<Pause size={13} />} onClick={() => runAction(campaign, "pause")} />}
                  {canWrite && campaign.status === "paused" && <IconButton title="Resume" icon={<Play size={13} />} onClick={() => runAction(campaign, "resume")} />}
                  {canWrite && campaign.failed > 0 && <IconButton title="Retry failures" icon={<RotateCcw size={13} />} onClick={() => runAction(campaign, "retry")} />}
                  {canWrite && !["sent", "cancelled"].includes(campaign.status) && <IconButton title="Cancel" icon={<X size={13} />} onClick={() => runAction(campaign, "cancel")} />}
                  <IconButton title="Report" icon={<Eye size={13} />} onClick={() => openReport(campaign.id)} />
                  {canWrite && <IconButton title="Duplicate" icon={<Copy size={13} />} onClick={() => duplicate(campaign)} />}
                  {canWrite && <IconButton title="Delete" icon={<Trash2 size={13} />} danger onClick={() => remove(campaign.id)} />}
                </div>
              </div>
              </div>
            </Card>
          ))}
          {!loading && !filtered.length && (
            <Card className="border-dashed border-border bg-card/70 p-8 text-center">
              <div className="mx-auto flex h-11 w-11 items-center justify-center rounded-md border border-primary/25 bg-primary/10 text-primary">
                <Send size={18} />
              </div>
              <div className="mt-3 text-sm font-medium text-foreground">No campaigns found</div>
              <p className="mt-1 text-xs text-muted-foreground">Create a campaign or change the selected filter to see saved sends.</p>
            </Card>
          )}
        </div>

        {report && (
          <aside className="max-h-[46dvh] shrink-0 overflow-y-auto border-t border-border bg-card xl:max-h-none xl:w-[450px] xl:border-l xl:border-t-0">
            <div className="sticky top-0 z-10 flex items-start justify-between gap-3 border-b border-border bg-card/95 px-4 py-3 backdrop-blur">
              <div>
                <div className="flex flex-wrap items-center gap-2">
                  <h2 className="text-sm font-semibold text-foreground">{report.name}</h2>
                  <Badge variant="outline" className={`text-[10px] ${statusStyle[report.status] || statusStyle.draft}`}>{report.status.replace("_", " ")}</Badge>
                </div>
                <p className="mt-1 text-xs text-muted-foreground">{report.template} - {report.audience}</p>
              </div>
              <button className="flex h-7 w-7 items-center justify-center rounded text-muted-foreground hover:bg-secondary hover:text-foreground" onClick={() => setReport(null)}>
                <X size={14} />
              </button>
            </div>
            <div className="space-y-4 p-4">
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                {[
                  ["Sent", report.sent],
                  ["Delivered", report.delivered],
                  ["Read", report.read],
                  ["Failed", report.failed],
                ].map(([label, value]) => (
                  <div key={String(label)} className="rounded-md border border-border bg-background p-2">
                    <div className={`text-sm font-semibold ${metricTone(String(label))}`}>{String(value)}</div>
                    <div className="text-[10px] text-muted-foreground">{String(label)}</div>
                  </div>
                ))}
              </div>
              <Card className="border-border bg-background p-3">
                <h3 className="mb-2 flex items-center gap-2 text-xs font-semibold uppercase text-muted-foreground"><TimerReset size={13} /> Campaign History</h3>
                <div className="space-y-1">
                  {(report.history || []).length ? (
                    (report.history || []).slice(-8).map((event, index) => (
                      <div key={`${event.at}-${index}`} className="rounded-md border border-border/70 bg-card/70 px-2 py-1.5 text-[11px] text-muted-foreground">
                        <div className="flex items-center justify-between gap-2">
                          <span className="font-medium text-foreground">{event.type.replace(/_/g, " ")}</span>
                          <span>{formatDate(event.at)}</span>
                        </div>
                        {event.status ? <div className="mt-0.5 text-primary">{event.status}</div> : null}
                      </div>
                    ))
                  ) : (
                    <div className="rounded-md border border-dashed border-border px-3 py-4 text-center text-[11px] text-muted-foreground">No campaign history yet.</div>
                  )}
                </div>
              </Card>
              <Card className="border-border bg-background p-3">
                <h3 className="mb-2 flex items-center gap-2 text-xs font-semibold uppercase text-muted-foreground"><CalendarClock size={13} /> Execution Timeline</h3>
                <div className="space-y-2">
                  {report.timeline.length ? (
                    report.timeline.slice(0, 10).map((event) => (
                      <div key={event.id} className="flex gap-2 rounded-md border border-border/70 bg-card/60 p-2">
                        <span className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${event.status === "failed" ? "bg-destructive" : "bg-primary"}`} />
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center justify-between gap-2">
                            <p className="truncate text-xs text-foreground">{event.contact || event.phone}</p>
                            <Badge variant="outline" className={`text-[10px] ${event.status === "failed" ? "border-destructive/30 bg-destructive/10 text-destructive" : "border-primary/30 bg-primary/10 text-primary"}`}>{event.status}</Badge>
                          </div>
                          <p className="truncate text-[11px] text-muted-foreground">{event.error || event.providerMessageId || event.campaignEvent}</p>
                          <p className="text-[10px] text-muted-foreground">{event.variant ? `Variant ${event.variant} - ` : ""}{formatDate(event.time)}</p>
                        </div>
                      </div>
                    ))
                  ) : (
                    <div className="rounded-md border border-dashed border-border px-3 py-4 text-center text-[11px] text-muted-foreground">Timeline will appear after this campaign runs.</div>
                  )}
                </div>
              </Card>
              {report.recipients.some((recipient) => recipient.status === "failed") && (
                <Card className="border-destructive/25 bg-destructive/10 p-3">
                  <h3 className="mb-2 flex items-center gap-2 text-xs font-semibold uppercase text-destructive"><AlertTriangle size={13} /> Failed Messages</h3>
                  <div className="space-y-2">
                    {report.recipients.filter((recipient) => recipient.status === "failed").slice(0, 5).map((recipient) => (
                      <div key={`failed-${recipient.contactId}-${recipient.providerMessageId}`} className="rounded-md border border-destructive/20 bg-background/70 px-2 py-1.5">
                        <div className="flex items-center justify-between gap-2">
                          <span className="truncate text-xs text-foreground">{recipient.name || recipient.phone}</span>
                          <span className="text-[10px] text-destructive">{recipient.attempts} attempts</span>
                        </div>
                        <p className="mt-0.5 truncate text-[11px] text-destructive/90">{recipient.error || "Provider rejected this message."}</p>
                      </div>
                    ))}
                  </div>
                </Card>
              )}
              <Card className="overflow-hidden border-border bg-background">
                <div className="flex items-center justify-between gap-2 border-b border-border px-3 py-2">
                  <span className="text-xs font-semibold uppercase text-muted-foreground">Recipient Delivery Results</span>
                  <Badge variant="outline" className="border-border text-[10px] text-muted-foreground">{report.recipients.length}</Badge>
                </div>
                <div className="divide-y divide-border">
                  {report.recipients.length ? report.recipients.map((recipient) => (
                    <div key={`${recipient.contactId}-${recipient.providerMessageId}`} className="px-3 py-2">
                      <div className="flex items-center justify-between gap-2">
                        <div className="min-w-0">
                          <p className="truncate text-xs text-foreground">{recipient.name}</p>
                          <p className="text-[11px] text-muted-foreground">{recipient.phone}</p>
                        </div>
                        <Badge variant="outline" className={`text-[10px] ${recipient.status === "failed" ? "border-destructive/30 bg-destructive/10 text-destructive" : "border-primary/30 bg-primary/10 text-primary"}`}>{recipient.status}</Badge>
                      </div>
                      <p className="mt-1 truncate text-[10px] text-muted-foreground">{recipient.error || recipient.providerMessageId}</p>
                    </div>
                  )) : (
                    <div className="px-3 py-6 text-center text-xs text-muted-foreground">No recipient delivery results yet.</div>
                  )}
                </div>
              </Card>
            </div>
          </aside>
        )}
      </div>
    </div>
  );
}

function IconButton({ icon, title, onClick, disabled, danger }: { icon: React.ReactNode; title: string; onClick: () => void; disabled?: boolean; danger?: boolean }) {
  return (
    <button
      title={title}
      disabled={disabled}
      className={`flex h-8 w-8 items-center justify-center rounded transition disabled:opacity-50 ${danger ? "text-muted-foreground hover:bg-secondary hover:text-destructive" : "text-muted-foreground hover:bg-secondary hover:text-foreground"}`}
      onClick={onClick}
    >
      {icon}
    </button>
  );
}
