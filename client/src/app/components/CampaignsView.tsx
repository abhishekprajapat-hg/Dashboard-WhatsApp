import { useEffect, useState } from "react";
import { Badge } from "./ui/badge";
import { Button } from "./ui/button";
import { Card } from "./ui/card";
import { Clock, Copy, Edit2, Eye, MessageCircle, Pause, Play, Plus, Send, Trash2, TrendingUp, Users, X } from "lucide-react";
import { createCampaign, deleteCampaign, getCampaignReport, getCampaigns, getWhatsAppTemplates, sendCampaign, updateCampaign } from "../lib/api";

interface Campaign {
  id: string;
  name: string;
  status: "sent" | "scheduled" | "draft" | "running" | "paused" | "failed";
  type: "broadcast" | "drip" | "transactional";
  audience: string;
  recipients: number;
  sent: number;
  delivered: number;
  read: number;
  replied: number;
  failed: number;
  scheduledAt?: string;
  sentAt?: string;
  template: string;
  templateId: string;
}

interface WhatsAppTemplate {
  id: string;
  name: string;
  language: string;
  category: string;
  status: "approved" | "pending" | "rejected";
}

interface CampaignReport extends Campaign {
  account: {
    id: string;
    displayName: string;
    phoneNumber: string;
    phoneNumberId: string;
  } | null;
  recipients: {
    contactId: string;
    name: string;
    phone: string;
    status: string;
    providerMessageId: string;
    error: string;
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
    time: string;
  }[];
}

const statusStyle: Record<string, string> = {
  sent: "bg-primary/20 text-primary border-primary/30",
  scheduled: "bg-blue-500/20 text-blue-400 border-blue-500/30",
  draft: "bg-secondary text-muted-foreground border-border",
  running: "bg-yellow-500/20 text-yellow-400 border-yellow-500/30",
  paused: "bg-orange-500/20 text-orange-400 border-orange-500/30",
  failed: "bg-destructive/20 text-destructive border-destructive/30",
};

const typeStyle: Record<string, string> = {
  broadcast: "bg-purple-500/20 text-purple-400 border-purple-500/30",
  drip: "bg-cyan-500/20 text-cyan-400 border-cyan-500/30",
  transactional: "bg-primary/20 text-primary border-primary/30",
};

const audienceLabels: Record<string, string> = {
  all: "All Contacts",
  opted_in: "Opted-in Contacts",
  leads: "Leads",
  customers: "Customers",
};

function rate(a: number, b: number) {
  if (!b) return "-";
  return `${Math.round((a / b) * 100)}%`;
}

export function CampaignsView() {
  const [activeTab, setActiveTab] = useState("All");
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [summary, setSummary] = useState({ totalSent: 0, deliveryRate: 0, readRate: 0, replyRate: 0 });
  const [templates, setTemplates] = useState<WhatsAppTemplate[]>([]);
  const [showCreate, setShowCreate] = useState(false);
  const [saving, setSaving] = useState(false);
  const [sendingId, setSendingId] = useState("");
  const [notice, setNotice] = useState("");
  const [report, setReport] = useState<CampaignReport | null>(null);
  const [reportLoading, setReportLoading] = useState("");
  const [form, setForm] = useState({
    name: "",
    type: "broadcast",
    audienceType: "all",
    templateId: "",
    status: "draft",
  });
  const tabs = ["All", "Broadcast", "Drip", "Transactional"];

  async function loadCampaigns() {
    const response = await getCampaigns<{
      data: Campaign[];
      total: number;
      summary: { totalSent: number; deliveryRate: number; readRate: number; replyRate: number };
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
        setForm((current) => ({ ...current, templateId: current.templateId || approved[0]?.id || "" }));
      })
      .catch(() => undefined);
  }, []);

  const filtered = campaigns.filter((campaign) => activeTab === "All" || campaign.type.toLowerCase() === activeTab.toLowerCase());

  async function handleCreateCampaign(event: React.FormEvent) {
    event.preventDefault();
    if (!form.name.trim() || !form.templateId) return;

    setSaving(true);
    setNotice("");
    try {
      const response = await createCampaign<{ data: Campaign }>({
        name: form.name.trim(),
        type: form.type,
        audience: audienceLabels[form.audienceType],
        audienceType: form.audienceType,
        templateId: form.templateId,
        status: form.status,
      });
      setCampaigns((items) => [response.data, ...items]);
      setForm({ name: "", type: "broadcast", audienceType: "all", templateId: templates[0]?.id || "", status: "draft" });
      setShowCreate(false);
      await loadCampaigns();
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Campaign could not be created.");
    } finally {
      setSaving(false);
    }
  }

  async function handleStatus(campaign: Campaign, status: string) {
    const response = await updateCampaign<{ data: Campaign }>(campaign.id, { status });
    setCampaigns((items) => items.map((item) => (item.id === campaign.id ? response.data : item)));
    await loadCampaigns();
  }

  async function handleSendCampaign(campaign: Campaign) {
    setSendingId(campaign.id);
    setNotice("");
    try {
      const response = await sendCampaign<{ data: Campaign; recipients: unknown[] }>(campaign.id);
      setCampaigns((items) => items.map((item) => (item.id === campaign.id ? response.data : item)));
      setNotice(`Campaign sent to ${response.data.recipients} contacts.`);
      if (report?.id === campaign.id) {
        await handleOpenReport(campaign.id);
      }
      await loadCampaigns();
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Campaign could not be sent.");
    } finally {
      setSendingId("");
    }
  }

  async function handleCopy(campaign: Campaign) {
    const response = await createCampaign<{ data: Campaign }>({
      name: `${campaign.name} Copy`,
      type: campaign.type,
      audience: campaign.audience,
      audienceType: "all",
      templateId: campaign.templateId,
      status: "draft",
    });
    setCampaigns((items) => [response.data, ...items]);
    await loadCampaigns();
  }

  async function handleDelete(id: string) {
    setCampaigns((items) => items.filter((campaign) => campaign.id !== id));
    if (report?.id === id) setReport(null);
    await deleteCampaign(id).catch(() => undefined);
    await loadCampaigns().catch(() => undefined);
  }

  async function handleOpenReport(id: string) {
    setReportLoading(id);
    try {
      const response = await getCampaignReport<{ data: CampaignReport }>(id);
      setReport(response.data);
    } finally {
      setReportLoading("");
    }
  }

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      <div className="flex items-center justify-between px-6 py-4 border-b border-border shrink-0">
        <div>
          <h1 className="text-foreground">Campaigns</h1>
          <p className="text-xs text-muted-foreground mt-0.5">
            {campaigns.length} campaigns - {campaigns.filter((campaign) => campaign.status === "running").length} running
          </p>
        </div>
        <Button size="sm" className="h-8 text-xs bg-primary text-primary-foreground hover:bg-primary/90" onClick={() => setShowCreate((value) => !value)}>
          <Plus size={13} className="mr-1.5" /> New campaign
        </Button>
      </div>

      {showCreate && (
        <form onSubmit={handleCreateCampaign} className="grid grid-cols-1 md:grid-cols-7 gap-2 px-6 py-3 border-b border-border bg-secondary/20 shrink-0">
          <input
            value={form.name}
            onChange={(event) => setForm((current) => ({ ...current, name: event.target.value }))}
            placeholder="Campaign name"
            className="h-8 text-xs bg-background border border-border rounded px-2 text-foreground"
          />
          <select value={form.type} onChange={(event) => setForm((current) => ({ ...current, type: event.target.value }))} className="h-8 text-xs bg-background border border-border rounded px-2 text-foreground">
            <option value="broadcast">Broadcast</option>
            <option value="drip">Drip</option>
            <option value="transactional">Transactional</option>
          </select>
          <select value={form.audienceType} onChange={(event) => setForm((current) => ({ ...current, audienceType: event.target.value }))} className="h-8 text-xs bg-background border border-border rounded px-2 text-foreground">
            <option value="all">All Contacts</option>
            <option value="opted_in">Opted-in Contacts</option>
            <option value="leads">Leads</option>
            <option value="customers">Customers</option>
          </select>
          <select value={form.templateId} onChange={(event) => setForm((current) => ({ ...current, templateId: event.target.value }))} className="h-8 text-xs bg-background border border-border rounded px-2 text-foreground md:col-span-2">
            {templates.length === 0 && <option value="">No approved templates</option>}
            {templates.map((template) => (
              <option key={template.id} value={template.id}>
                {template.name} ({template.language})
              </option>
            ))}
          </select>
          <select value={form.status} onChange={(event) => setForm((current) => ({ ...current, status: event.target.value }))} className="h-8 text-xs bg-background border border-border rounded px-2 text-foreground">
            <option value="draft">Draft</option>
            <option value="scheduled">Scheduled</option>
          </select>
          <div className="flex gap-2">
            <Button type="submit" size="sm" className="h-8 text-xs bg-primary text-primary-foreground" disabled={saving || !form.templateId}>
              {saving ? "Saving..." : "Save"}
            </Button>
            <Button type="button" variant="outline" size="sm" className="h-8 text-xs border-border" onClick={() => setShowCreate(false)}>
              Cancel
            </Button>
          </div>
          {notice && <div className="md:col-span-7 text-xs text-muted-foreground">{notice}</div>}
        </form>
      )}

      {!showCreate && notice && (
        <div className="px-6 py-2 border-b border-border bg-secondary/20 text-xs text-muted-foreground">
          {notice}
        </div>
      )}

      <div className="grid grid-cols-4 gap-3 px-6 py-4 border-b border-border shrink-0">
        {[
          { label: "Total sent", value: summary.totalSent.toLocaleString(), icon: <Send size={14} /> },
          { label: "Avg delivery rate", value: `${summary.deliveryRate}%`, icon: <TrendingUp size={14} /> },
          { label: "Avg read rate", value: `${summary.readRate}%`, icon: <Eye size={14} /> },
          { label: "Avg reply rate", value: `${summary.replyRate}%`, icon: <MessageCircle size={14} /> },
        ].map((item) => (
          <Card key={item.label} className="p-3 bg-card border-border">
            <div className="flex items-center gap-2 text-muted-foreground mb-1">{item.icon}</div>
            <div className="text-lg font-semibold text-foreground">{item.value}</div>
            <div className="text-[11px] text-muted-foreground">{item.label}</div>
          </Card>
        ))}
      </div>

      <div className="flex gap-1 px-6 pt-3 border-b border-border shrink-0">
        {tabs.map((tab) => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab)}
            className={`text-xs px-3 py-1.5 rounded-t transition-colors border-b-2 -mb-px ${
              activeTab === tab ? "border-primary text-primary" : "border-transparent text-muted-foreground hover:text-foreground"
            }`}
          >
            {tab}
          </button>
        ))}
      </div>

      <div className="flex-1 overflow-hidden flex">
        <div className="flex-1 overflow-y-auto p-6 space-y-3">
        {filtered.length === 0 && <Card className="p-6 bg-card border-border text-sm text-muted-foreground">No campaigns yet.</Card>}
        {filtered.map((campaign) => {
          const deliveryRate = rate(campaign.delivered, campaign.sent);
          const readRate = rate(campaign.read, campaign.delivered);

          return (
            <Card key={campaign.id} className="p-4 bg-card border-border hover:border-border/80 transition-colors">
              <div className="flex items-start gap-4">
                <div className="w-9 h-9 rounded-lg bg-secondary flex items-center justify-center shrink-0 mt-0.5">
                  <Send size={15} className="text-muted-foreground" />
                </div>

                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap mb-1">
                    <span className="font-medium text-sm text-foreground">{campaign.name}</span>
                    <Badge variant="outline" className={`text-[10px] px-1.5 py-0 h-4 ${statusStyle[campaign.status]}`}>
                      {campaign.status}
                    </Badge>
                    <Badge variant="outline" className={`text-[10px] px-1.5 py-0 h-4 ${typeStyle[campaign.type]}`}>
                      {campaign.type}
                    </Badge>
                  </div>

                  <div className="flex items-center gap-3 text-[11px] text-muted-foreground mb-3 flex-wrap">
                    <span className="flex items-center gap-1"><Users size={10} />{campaign.audience}</span>
                    <span className="flex items-center gap-1"><MessageCircle size={10} />{campaign.template}</span>
                    {campaign.scheduledAt && <span className="flex items-center gap-1"><Clock size={10} />{campaign.scheduledAt}</span>}
                    {campaign.sentAt && <span className="flex items-center gap-1"><Send size={10} />{campaign.sentAt}</span>}
                  </div>

                  {campaign.status !== "draft" && (
                    <div className="grid grid-cols-4 gap-3">
                      {[
                        { label: "Recipients", value: campaign.recipients.toLocaleString() },
                        { label: "Delivered", value: deliveryRate },
                        { label: "Read", value: readRate },
                        { label: "Failed", value: campaign.failed.toLocaleString() },
                      ].map((metric) => (
                        <div key={metric.label}>
                          <div className="text-sm font-semibold text-foreground">{metric.value}</div>
                          <div className="text-[10px] text-muted-foreground">{metric.label}</div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                <div className="flex items-center gap-1 shrink-0">
                  {campaign.status === "running" && (
                    <button className="w-7 h-7 rounded flex items-center justify-center text-muted-foreground hover:text-yellow-400 hover:bg-secondary transition-colors" onClick={() => handleStatus(campaign, "paused")}>
                      <Pause size={13} />
                    </button>
                  )}
                  {campaign.status === "paused" && (
                    <button className="w-7 h-7 rounded flex items-center justify-center text-muted-foreground hover:text-primary hover:bg-secondary transition-colors" onClick={() => handleStatus(campaign, "running")}>
                      <Play size={13} />
                    </button>
                  )}
                  {["draft", "scheduled", "paused", "failed"].includes(campaign.status) && (
                    <button className="w-7 h-7 rounded flex items-center justify-center text-muted-foreground hover:text-primary hover:bg-secondary transition-colors disabled:opacity-50" onClick={() => handleSendCampaign(campaign)} disabled={sendingId === campaign.id} title="Send now">
                      <Send size={13} />
                    </button>
                  )}
                  <button className="w-7 h-7 rounded flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-secondary transition-colors disabled:opacity-50" onClick={() => handleOpenReport(campaign.id)} disabled={reportLoading === campaign.id} title="View report">
                    <Eye size={13} />
                  </button>
                  <button className="w-7 h-7 rounded flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-secondary transition-colors" onClick={() => handleStatus(campaign, campaign.status === "draft" ? "scheduled" : "draft")}>
                    <Edit2 size={13} />
                  </button>
                  <button className="w-7 h-7 rounded flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-secondary transition-colors" onClick={() => handleCopy(campaign)}>
                    <Copy size={13} />
                  </button>
                  <button className="w-7 h-7 rounded flex items-center justify-center text-muted-foreground hover:text-destructive hover:bg-secondary transition-colors" onClick={() => handleDelete(campaign.id)}>
                    <Trash2 size={13} />
                  </button>
                </div>
              </div>
            </Card>
          );
        })}
        </div>

        {report && (
          <aside className="w-[420px] border-l border-border bg-card overflow-y-auto shrink-0">
            <div className="sticky top-0 z-10 flex items-start justify-between gap-3 border-b border-border bg-card px-4 py-3">
              <div>
                <h2 className="text-sm font-semibold text-foreground">{report.name}</h2>
                <p className="text-xs text-muted-foreground">{report.template} - {report.audience}</p>
              </div>
              <button className="w-7 h-7 rounded flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-secondary" onClick={() => setReport(null)}>
                <X size={14} />
              </button>
            </div>

            <div className="p-4 space-y-4">
              <div className="grid grid-cols-4 gap-2">
                {[
                  { label: "Recipients", value: report.recipients.length },
                  { label: "Sent", value: report.sent },
                  { label: "Delivered", value: report.delivered },
                  { label: "Failed", value: report.failed },
                ].map((item) => (
                  <div key={item.label} className="rounded border border-border p-2">
                    <div className="text-sm font-semibold text-foreground">{item.value.toLocaleString()}</div>
                    <div className="text-[10px] text-muted-foreground">{item.label}</div>
                  </div>
                ))}
              </div>

              <Card className="p-3 bg-background border-border">
                <h3 className="text-xs font-semibold text-foreground mb-2">Delivery Timeline</h3>
                <div className="space-y-2">
                  {report.timeline.slice(0, 8).map((event) => (
                    <div key={event.id} className="flex items-start gap-2">
                      <span className={`mt-1 h-2 w-2 rounded-full ${event.status === "failed" ? "bg-destructive" : "bg-primary"}`} />
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center justify-between gap-2">
                          <p className="text-xs text-foreground truncate">{event.contact}</p>
                          <Badge variant="outline" className={`text-[10px] ${event.status === "failed" ? "bg-destructive/10 text-destructive border-destructive/30" : "bg-primary/10 text-primary border-primary/30"}`}>
                            {event.status}
                          </Badge>
                        </div>
                        <p className="text-[11px] text-muted-foreground truncate">{event.error || event.body}</p>
                        <p className="text-[10px] text-muted-foreground">{event.time}</p>
                      </div>
                    </div>
                  ))}
                  {report.timeline.length === 0 && <p className="text-xs text-muted-foreground">No delivery events yet.</p>}
                </div>
              </Card>

              <Card className="bg-background border-border overflow-hidden">
                <div className="px-3 py-2 border-b border-border">
                  <h3 className="text-xs font-semibold text-foreground">Recipients</h3>
                </div>
                <div className="divide-y divide-border">
                  {report.recipients.map((recipient) => (
                    <div key={`${recipient.contactId}-${recipient.providerMessageId}`} className="px-3 py-2">
                      <div className="flex items-center justify-between gap-2">
                        <div className="min-w-0">
                          <p className="text-xs text-foreground truncate">{recipient.name}</p>
                          <p className="text-[11px] text-muted-foreground">{recipient.phone}</p>
                        </div>
                        <Badge variant="outline" className={`text-[10px] shrink-0 ${recipient.status === "failed" ? "bg-destructive/10 text-destructive border-destructive/30" : "bg-primary/10 text-primary border-primary/30"}`}>
                          {recipient.status}
                        </Badge>
                      </div>
                      <p className="mt-1 text-[10px] text-muted-foreground truncate">{recipient.error || recipient.providerMessageId}</p>
                    </div>
                  ))}
                  {report.recipients.length === 0 && <div className="px-3 py-6 text-xs text-muted-foreground">No recipients yet. Send the campaign to generate a report.</div>}
                </div>
              </Card>
            </div>
          </aside>
        )}
      </div>
    </div>
  );
}
