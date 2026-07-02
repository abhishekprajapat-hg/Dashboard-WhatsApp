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

interface CampaignsViewProps {
  canWrite?: boolean;
}

export function CampaignsView({ canWrite = false }: CampaignsViewProps) {
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [summary, setSummary] = useState({ totalSent: 0, deliveryRate: 0, readRate: 0, replyRate: 0, clickRate: 0, conversionRate: 0, failures: 0 });
  const [templates, setTemplates] = useState<WhatsAppTemplate[]>([]);
  const [activeTab, setActiveTab] = useState("All");
  const [showCreate, setShowCreate] = useState(false);
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
    const response = await getCampaigns<{
      data: Campaign[];
      total: number;
      summary: typeof summary;
    }>();
    setCampaigns(response.data);
    setSummary(response.summary);
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
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
      <div className="flex flex-col gap-3 border-b border-border px-3 py-3 shrink-0 sm:flex-row sm:items-center sm:justify-between sm:px-6 sm:py-4">
        <div className="min-w-0">
          <h1 className="text-foreground">Campaign Management</h1>
          <p className="mt-0.5 text-xs text-muted-foreground">
            Template, bulk, scheduled, recurring, A/B, approval, queue and analytics
          </p>
        </div>
        <div className="flex gap-2">
          <Button size="sm" variant="outline" className="h-8 border-border text-xs" onClick={loadCampaigns}>
            <RefreshCcw size={13} className="mr-1.5" /> Refresh
          </Button>
          {canWrite && (
            <Button size="sm" className="h-8 bg-primary text-xs text-primary-foreground" onClick={() => setShowCreate((value) => !value)}>
              <Plus size={13} className="mr-1.5" /> New campaign
            </Button>
          )}
        </div>
      </div>

      {canWrite && showCreate && (
        <form onSubmit={handleCreate} className="grid grid-cols-1 gap-2 border-b border-border bg-secondary/20 px-3 py-3 shrink-0 md:grid-cols-8 sm:px-6">
          <input value={form.name} onChange={(event) => setForm((current) => ({ ...current, name: event.target.value }))} placeholder="Campaign name" className="h-8 rounded border border-border bg-background px-2 text-xs text-foreground" />
          <select value={form.type} onChange={(event) => setForm((current) => ({ ...current, type: event.target.value }))} className="h-8 rounded border border-border bg-background px-2 text-xs text-foreground">
            <option value="template">Template</option>
            <option value="bulk">Bulk</option>
            <option value="scheduled">Scheduled</option>
            <option value="recurring">Recurring</option>
            <option value="ab_test">A/B Testing</option>
          </select>
          <select value={form.audienceType} onChange={(event) => setForm((current) => ({ ...current, audienceType: event.target.value }))} className="h-8 rounded border border-border bg-background px-2 text-xs text-foreground">
            {Object.entries(audienceLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
          </select>
          <select value={form.templateId} onChange={(event) => setForm((current) => ({ ...current, templateId: event.target.value }))} className="h-8 rounded border border-border bg-background px-2 text-xs text-foreground">
            {templates.length === 0 && <option value="">No approved templates</option>}
            {templates.map((template) => <option key={template.id} value={template.id}>{template.name}</option>)}
          </select>
          <select value={form.templateBId} onChange={(event) => setForm((current) => ({ ...current, templateBId: event.target.value }))} className="h-8 rounded border border-border bg-background px-2 text-xs text-foreground">
            <option value="">Variant B template</option>
            {templates.map((template) => <option key={template.id} value={template.id}>{template.name}</option>)}
          </select>
          <input type="datetime-local" value={form.scheduledAt} onChange={(event) => setForm((current) => ({ ...current, scheduledAt: event.target.value }))} className="h-8 rounded border border-border bg-background px-2 text-xs text-foreground" />
          <input type="number" value={form.perMinute} onChange={(event) => setForm((current) => ({ ...current, perMinute: Number(event.target.value) }))} placeholder="Rate/min" className="h-8 rounded border border-border bg-background px-2 text-xs text-foreground" />
          <div className="flex gap-2">
            <Button type="submit" size="sm" className="h-8 bg-primary text-xs text-primary-foreground" disabled={saving || !form.templateId}>{saving ? "Saving" : "Save"}</Button>
            <Button type="button" size="sm" variant="outline" className="h-8 border-border text-xs" onClick={() => setShowCreate(false)}>Cancel</Button>
          </div>
          <label className="flex h-8 items-center gap-2 rounded border border-border bg-background px-2 text-xs text-foreground">
            <input type="checkbox" checked={form.requireApproval} onChange={(event) => setForm((current) => ({ ...current, requireApproval: event.target.checked }))} />
            Approval
          </label>
          <label className="flex h-8 items-center gap-2 rounded border border-border bg-background px-2 text-xs text-foreground">
            <input type="checkbox" checked={form.abTest} onChange={(event) => setForm((current) => ({ ...current, abTest: event.target.checked, type: event.target.checked ? "ab_test" : current.type }))} />
            A/B
          </label>
          <label className="flex h-8 items-center gap-2 rounded border border-border bg-background px-2 text-xs text-foreground">
            <input type="checkbox" checked={form.recurring} onChange={(event) => setForm((current) => ({ ...current, recurring: event.target.checked, type: event.target.checked ? "recurring" : current.type }))} />
            Recurring
          </label>
          <select value={form.recurrence} onChange={(event) => setForm((current) => ({ ...current, recurrence: event.target.value }))} className="h-8 rounded border border-border bg-background px-2 text-xs text-foreground">
            <option value="daily">Daily</option>
            <option value="weekly">Weekly</option>
            <option value="monthly">Monthly</option>
          </select>
          <input type="number" value={form.batchSize} onChange={(event) => setForm((current) => ({ ...current, batchSize: Number(event.target.value) }))} placeholder="Batch size" className="h-8 rounded border border-border bg-background px-2 text-xs text-foreground" />
          <select value={form.leadStage} onChange={(event) => setForm((current) => ({ ...current, leadStage: event.target.value }))} className="h-8 rounded border border-border bg-background px-2 text-xs text-foreground">
            {Object.entries(leadStageLabels).map(([value, label]) => <option key={value || "any"} value={value}>{label}</option>)}
          </select>
          <input value={form.tags} onChange={(event) => setForm((current) => ({ ...current, tags: event.target.value }))} placeholder="Tags, comma separated" className="h-8 rounded border border-border bg-background px-2 text-xs text-foreground" />
          <input type="date" value={form.createdFrom} onChange={(event) => setForm((current) => ({ ...current, createdFrom: event.target.value }))} className="h-8 rounded border border-border bg-background px-2 text-xs text-foreground" />
          <input type="date" value={form.createdTo} onChange={(event) => setForm((current) => ({ ...current, createdTo: event.target.value }))} className="h-8 rounded border border-border bg-background px-2 text-xs text-foreground" />
          <Button type="button" size="sm" variant="outline" className="h-8 border-border text-xs" onClick={previewAudience} disabled={previewing}>
            <Eye size={13} className="mr-1.5" /> {previewing ? "Previewing" : "Preview"}
          </Button>
          {audiencePreview && (
            <div className="md:col-span-3 rounded border border-border bg-background px-2 py-1 text-[11px] text-muted-foreground">
              {audiencePreview.label}: <span className="text-foreground">{audiencePreview.count}</span>
              {audiencePreview.sample.length > 0 && <span> - {audiencePreview.sample.slice(0, 3).map((contact) => contact.name || contact.phone).join(", ")}</span>}
            </div>
          )}
        </form>
      )}

      <div className="grid grid-cols-2 gap-3 border-b border-border px-3 py-3 shrink-0 md:grid-cols-6 sm:px-6">
        {[
          ["Sent", summary.totalSent, <Send size={14} />],
          ["Delivered", `${summary.deliveryRate}%`, <CheckCircle2 size={14} />],
          ["Read", `${summary.readRate}%`, <Eye size={14} />],
          ["Replies", `${summary.replyRate}%`, <Users size={14} />],
          ["Clicks", `${summary.clickRate}%`, <MousePointerClick size={14} />],
          ["Conversions", `${summary.conversionRate}%`, <BarChart3 size={14} />],
        ].map(([label, value, icon]) => (
          <Card key={String(label)} className="border-border bg-card p-3">
            <div className="mb-1 text-muted-foreground">{icon}</div>
            <div className="text-lg font-semibold text-foreground">{String(value)}</div>
            <div className="text-[11px] text-muted-foreground">{String(label)}</div>
          </Card>
        ))}
      </div>

      {canWrite && (
      <div className="border-b border-border bg-secondary/20 px-3 py-2 shrink-0 sm:px-6">
        <div className="grid grid-cols-1 gap-2 md:grid-cols-[1fr_auto]">
          <textarea value={csvText} onChange={(event) => setCsvText(event.target.value)} placeholder="CSV import: name,phone,email" className="h-10 rounded border border-border bg-background px-2 py-1 text-xs text-foreground" />
          <Button size="sm" variant="outline" className="h-10 border-border text-xs" onClick={importCsv} disabled={!csvText.trim()}>
            <FileUp size={13} className="mr-1.5" /> Import contacts
          </Button>
        </div>
        {notice && <div className="mt-2 text-xs text-muted-foreground">{notice}</div>}
      </div>
      )}

      <div className="no-scrollbar flex gap-1 overflow-x-auto border-b border-border px-3 pt-3 shrink-0 sm:px-6">
        {tabs.map((tab) => (
          <button key={tab} onClick={() => setActiveTab(tab)} className={`-mb-px rounded-t border-b-2 px-3 py-1.5 text-xs transition-colors ${activeTab === tab ? "border-primary text-primary" : "border-transparent text-muted-foreground hover:text-foreground"}`}>
            {tab.replace("_", " ")}
          </button>
        ))}
      </div>

      <div className="flex min-h-0 flex-1 overflow-hidden">
        <div className="flex-1 space-y-3 overflow-y-auto p-3 sm:p-6">
          {filtered.map((campaign) => (
            <Card key={campaign.id} className="border-border bg-card p-4">
              <div className="flex flex-col gap-4 xl:flex-row xl:items-start">
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
                  {campaign.type === "scheduled" ? <CalendarClock size={17} /> : campaign.type === "recurring" ? <TimerReset size={17} /> : <Send size={17} />}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <h3 className="truncate text-sm font-semibold text-foreground">{campaign.name}</h3>
                    <Badge variant="outline" className={`text-[10px] ${statusStyle[campaign.status] || statusStyle.draft}`}>{campaign.status.replace("_", " ")}</Badge>
                    <Badge variant="outline" className="border-border text-[10px] text-muted-foreground">{campaign.type.replace("_", " ")}</Badge>
                    {campaign.abTest?.enabled && <Badge variant="outline" className="border-purple-500/30 bg-purple-500/10 text-[10px] text-purple-300">A/B {campaign.abTest.split || 50}%</Badge>}
                    {campaign.approval?.required && <Badge variant="outline" className="border-emerald-500/30 bg-emerald-500/10 text-[10px] text-emerald-300">approval {campaign.approval.status}</Badge>}
                  </div>
                  <div className="mt-1 flex flex-wrap gap-3 text-[11px] text-muted-foreground">
                    <span>{campaign.audience}</span>
                    <span>{campaign.template}</span>
                    {campaign.scheduledAt && <span>Scheduled {campaign.scheduledAt}</span>}
                    <span>{campaign.rateLimit?.perMinute || 60}/min</span>
                  </div>
                  <div className="mt-3 grid grid-cols-2 gap-3 md:grid-cols-8">
                    {[
                      ["Queued", campaign.queued],
                      ["Sent", campaign.sent],
                      ["Delivered", percent(campaign.delivered, campaign.sent)],
                      ["Read", percent(campaign.read, campaign.delivered)],
                      ["Replies", campaign.replied],
                      ["Clicks", campaign.clicks],
                      ["Conversions", campaign.conversions],
                      ["Failures", campaign.failed],
                    ].map(([label, value]) => (
                      <div key={String(label)} className="rounded border border-border bg-background p-2">
                        <div className="text-sm font-semibold text-foreground">{String(value)}</div>
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
            </Card>
          ))}
          {!filtered.length && <Card className="border-border bg-card p-6 text-sm text-muted-foreground">No campaigns yet.</Card>}
        </div>

        {report && (
          <aside className="hidden w-[430px] shrink-0 overflow-y-auto border-l border-border bg-card xl:block">
            <div className="sticky top-0 z-10 flex items-start justify-between gap-3 border-b border-border bg-card px-4 py-3">
              <div>
                <h2 className="text-sm font-semibold text-foreground">{report.name}</h2>
                <p className="text-xs text-muted-foreground">{report.template} - {report.audience}</p>
              </div>
              <button className="flex h-7 w-7 items-center justify-center rounded text-muted-foreground hover:bg-secondary hover:text-foreground" onClick={() => setReport(null)}>
                <X size={14} />
              </button>
            </div>
            <div className="space-y-4 p-4">
              <Card className="border-border bg-background p-3">
                <h3 className="mb-2 text-xs font-semibold uppercase text-muted-foreground">Campaign History</h3>
                <div className="space-y-1">
                  {(report.history || []).slice(-8).map((event, index) => (
                    <div key={`${event.at}-${index}`} className="rounded bg-card px-2 py-1 text-[11px] text-muted-foreground">
                      {event.type.replace(/_/g, " ")} {event.status ? `- ${event.status}` : ""}
                    </div>
                  ))}
                </div>
              </Card>
              <Card className="border-border bg-background p-3">
                <h3 className="mb-2 text-xs font-semibold uppercase text-muted-foreground">Execution Timeline</h3>
                <div className="space-y-2">
                  {report.timeline.slice(0, 10).map((event) => (
                    <div key={event.id} className="flex gap-2">
                      <span className={`mt-1.5 h-2 w-2 rounded-full ${event.status === "failed" ? "bg-destructive" : "bg-primary"}`} />
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center justify-between gap-2">
                          <p className="truncate text-xs text-foreground">{event.contact}</p>
                          <Badge variant="outline" className={`text-[10px] ${event.status === "failed" ? "border-destructive/30 bg-destructive/10 text-destructive" : "border-primary/30 bg-primary/10 text-primary"}`}>{event.status}</Badge>
                        </div>
                        <p className="truncate text-[11px] text-muted-foreground">{event.error || event.providerMessageId}</p>
                        <p className="text-[10px] text-muted-foreground">{event.variant ? `Variant ${event.variant} - ` : ""}{event.time}</p>
                      </div>
                    </div>
                  ))}
                </div>
              </Card>
              <Card className="overflow-hidden border-border bg-background">
                <div className="border-b border-border px-3 py-2 text-xs font-semibold uppercase text-muted-foreground">Recipients</div>
                <div className="divide-y divide-border">
                  {report.recipients.map((recipient) => (
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
                  ))}
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
