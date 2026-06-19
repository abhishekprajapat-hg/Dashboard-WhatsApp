import { useEffect, useState } from "react";
import { Badge } from "./ui/badge";
import { Button } from "./ui/button";
import { Card } from "./ui/card";
import { Plus, Send, Clock, Users, MessageCircle, TrendingUp, Eye, Edit2, Trash2, Play, Pause, Copy } from "lucide-react";
import { createCampaign, deleteCampaign, getCampaigns, updateCampaign } from "../lib/api";

interface Campaign {
  id: string;
  name: string;
  status: "sent" | "scheduled" | "draft" | "running" | "paused";
  type: "broadcast" | "drip" | "transactional";
  audience: string;
  recipients: number;
  sent: number;
  delivered: number;
  read: number;
  replied: number;
  scheduledAt?: string;
  sentAt?: string;
  template: string;
}

const statusStyle: Record<string, string> = {
  sent: "bg-primary/20 text-primary border-primary/30",
  scheduled: "bg-blue-500/20 text-blue-400 border-blue-500/30",
  draft: "bg-secondary text-muted-foreground border-border",
  running: "bg-yellow-500/20 text-yellow-400 border-yellow-500/30",
  paused: "bg-orange-500/20 text-orange-400 border-orange-500/30",
};

const typeStyle: Record<string, string> = {
  broadcast: "bg-purple-500/20 text-purple-400 border-purple-500/30",
  drip: "bg-cyan-500/20 text-cyan-400 border-cyan-500/30",
  transactional: "bg-primary/20 text-primary border-primary/30",
};

function rate(a: number, b: number) {
  if (!b) return "—";
  return `${Math.round((a / b) * 100)}%`;
}

export function CampaignsView() {
  const [activeTab, setActiveTab] = useState("All");
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [summary, setSummary] = useState({ totalSent: 0, deliveryRate: 0, readRate: 0, replyRate: 0 });
  const [showCreate, setShowCreate] = useState(false);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({ name: "", type: "broadcast", audience: "All Contacts", status: "draft" });
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
  }, []);

  const filtered = campaigns.filter(
    (c) => activeTab === "All" || c.type.toLowerCase() === activeTab.toLowerCase()
  );

  async function handleCreateCampaign(event: React.FormEvent) {
    event.preventDefault();
    if (!form.name.trim()) return;
    setSaving(true);
    try {
      const response = await createCampaign<{ data: Campaign }>({
        name: form.name.trim(),
        type: form.type,
        audience: form.audience,
        status: form.status,
      });
      setCampaigns((items) => [response.data, ...items]);
      setForm({ name: "", type: "broadcast", audience: "All Contacts", status: "draft" });
      setShowCreate(false);
      await loadCampaigns();
    } finally {
      setSaving(false);
    }
  }

  async function handleStatus(campaign: Campaign, status: string) {
    const response = await updateCampaign<{ data: Campaign }>(campaign.id, { status });
    setCampaigns((items) => items.map((item) => (item.id === campaign.id ? response.data : item)));
    await loadCampaigns();
  }

  async function handleCopy(campaign: Campaign) {
    const response = await createCampaign<{ data: Campaign }>({
      name: `${campaign.name} Copy`,
      type: campaign.type,
      audience: campaign.audience,
      status: "draft",
    });
    setCampaigns((items) => [response.data, ...items]);
    await loadCampaigns();
  }

  async function handleDelete(id: string) {
    setCampaigns((items) => items.filter((campaign) => campaign.id !== id));
    await deleteCampaign(id).catch(() => undefined);
    await loadCampaigns().catch(() => undefined);
  }

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-6 py-4 border-b border-border shrink-0">
        <div>
          <h1 className="text-foreground">Campaigns</h1>
          <p className="text-xs text-muted-foreground mt-0.5">{campaigns.length} campaigns · {campaigns.filter(c => c.status === "running").length} running</p>
        </div>
        <Button size="sm" className="h-8 text-xs bg-primary text-primary-foreground hover:bg-primary/90" onClick={() => setShowCreate((value) => !value)}>
          <Plus size={13} className="mr-1.5" /> New campaign
        </Button>
      </div>

      {showCreate && (
        <form onSubmit={handleCreateCampaign} className="grid grid-cols-1 md:grid-cols-5 gap-2 px-6 py-3 border-b border-border bg-secondary/20 shrink-0">
          <input
            value={form.name}
            onChange={(event) => setForm((current) => ({ ...current, name: event.target.value }))}
            placeholder="Campaign name"
            className="h-8 text-xs bg-background border border-border rounded px-2 text-foreground"
          />
          <select
            value={form.type}
            onChange={(event) => setForm((current) => ({ ...current, type: event.target.value }))}
            className="h-8 text-xs bg-background border border-border rounded px-2 text-foreground"
          >
            <option value="broadcast">Broadcast</option>
            <option value="drip">Drip</option>
            <option value="transactional">Transactional</option>
          </select>
          <input
            value={form.audience}
            onChange={(event) => setForm((current) => ({ ...current, audience: event.target.value }))}
            placeholder="Audience"
            className="h-8 text-xs bg-background border border-border rounded px-2 text-foreground"
          />
          <select
            value={form.status}
            onChange={(event) => setForm((current) => ({ ...current, status: event.target.value }))}
            className="h-8 text-xs bg-background border border-border rounded px-2 text-foreground"
          >
            <option value="draft">Draft</option>
            <option value="scheduled">Scheduled</option>
            <option value="running">Running</option>
          </select>
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

      {/* KPI row */}
      <div className="grid grid-cols-4 gap-3 px-6 py-4 border-b border-border shrink-0">
        {[
          { label: "Total sent", value: summary.totalSent.toLocaleString(), icon: <Send size={14} /> },
          { label: "Avg delivery rate", value: `${summary.deliveryRate}%`, icon: <TrendingUp size={14} /> },
          { label: "Avg read rate", value: `${summary.readRate}%`, icon: <Eye size={14} /> },
          { label: "Avg reply rate", value: `${summary.replyRate}%`, icon: <MessageCircle size={14} /> },
        ].map((s) => (
          <Card key={s.label} className="p-3 bg-card border-border">
            <div className="flex items-center gap-2 text-muted-foreground mb-1">{s.icon}</div>
            <div className="text-lg font-semibold text-foreground">{s.value}</div>
            <div className="text-[11px] text-muted-foreground">{s.label}</div>
          </Card>
        ))}
      </div>

      {/* Tabs */}
      <div className="flex gap-1 px-6 pt-3 border-b border-border shrink-0">
        {tabs.map((tab) => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab)}
            className={`text-xs px-3 py-1.5 rounded-t transition-colors border-b-2 -mb-px ${
              activeTab === tab
                ? "border-primary text-primary"
                : "border-transparent text-muted-foreground hover:text-foreground"
            }`}
          >
            {tab}
          </button>
        ))}
      </div>

      {/* Campaign list */}
      <div className="flex-1 overflow-y-auto p-6 space-y-3">
        {filtered.length === 0 && (
          <Card className="p-6 bg-card border-border text-sm text-muted-foreground">
            No campaigns yet.
          </Card>
        )}
        {filtered.map((campaign) => {
          const deliveryRate = rate(campaign.delivered, campaign.sent);
          const readRate = rate(campaign.read, campaign.delivered);
          const replyRate = rate(campaign.replied, campaign.delivered);

          return (
            <Card key={campaign.id} className="p-4 bg-card border-border hover:border-border/80 transition-colors">
              <div className="flex items-start gap-4">
                {/* Icon */}
                <div className="w-9 h-9 rounded-lg bg-secondary flex items-center justify-center shrink-0 mt-0.5">
                  <Send size={15} className="text-muted-foreground" />
                </div>

                {/* Main content */}
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

                  <div className="flex items-center gap-3 text-[11px] text-muted-foreground mb-3">
                    <span className="flex items-center gap-1"><Users size={10} />{campaign.audience}</span>
                    <span className="flex items-center gap-1"><MessageCircle size={10} />{campaign.template}</span>
                    {campaign.scheduledAt && (
                      <span className="flex items-center gap-1"><Clock size={10} />{campaign.scheduledAt}</span>
                    )}
                    {campaign.sentAt && (
                      <span className="flex items-center gap-1"><Send size={10} />{campaign.sentAt}</span>
                    )}
                  </div>

                  {/* Metrics */}
                  {campaign.status !== "draft" && (
                    <div className="grid grid-cols-4 gap-3">
                      {[
                        { label: "Recipients", value: campaign.recipients.toLocaleString() },
                        { label: "Delivered", value: deliveryRate },
                        { label: "Read", value: readRate },
                        { label: "Replied", value: replyRate },
                      ].map((m) => (
                        <div key={m.label}>
                          <div className="text-sm font-semibold text-foreground">{m.value}</div>
                          <div className="text-[10px] text-muted-foreground">{m.label}</div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                {/* Actions */}
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
    </div>
  );
}

