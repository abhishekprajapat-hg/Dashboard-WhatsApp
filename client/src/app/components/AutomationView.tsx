import { useEffect, useState } from "react";
import { Badge } from "./ui/badge";
import { Button } from "./ui/button";
import { Switch } from "./ui/switch";
import { Card } from "./ui/card";
import { Plus, Zap, MessageCircle, Clock, Tag, ChevronRight, Play, Edit2, Trash2, Copy } from "lucide-react";
import { createAutomationFlow, deleteAutomationFlow, getAutomationFlows, updateAutomationFlow } from "../lib/api";

interface Flow {
  id: string;
  name: string;
  description: string;
  trigger: string;
  actions: number;
  status: "active" | "inactive" | "draft";
  runs: number;
  lastRun: string;
  category: string;
}

const statusStyle: Record<string, string> = {
  active: "bg-primary/20 text-primary border-primary/30",
  inactive: "bg-secondary text-muted-foreground border-border",
  draft: "bg-yellow-500/20 text-yellow-400 border-yellow-500/30",
};

const triggerIcon = (trigger: string) => {
  if (trigger.startsWith("Keyword")) return <Tag size={13} />;
  if (trigger.startsWith("Schedule") || trigger.startsWith("Outside")) return <Clock size={13} />;
  if (trigger.startsWith("Webhook")) return <Zap size={13} />;
  if (trigger.startsWith("Conversation") || trigger.startsWith("New")) return <MessageCircle size={13} />;
  return <Play size={13} />;
};

export function AutomationView() {
  const [flowList, setFlowList] = useState<Flow[]>([]);
  const [summary, setSummary] = useState({ runsToday: 0, automatedMessages: 0, handoffs: 0 });
  const [showCreate, setShowCreate] = useState(false);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({
    name: "",
    description: "",
    trigger: "New conversation",
    category: "Support",
    status: "draft",
  });

  async function loadFlows() {
    const response = await getAutomationFlows<{
      data: Flow[];
      total: number;
      summary: { runsToday: number; automatedMessages: number; handoffs: number };
    }>();
    setFlowList(response.data);
    setSummary(response.summary);
  }

  useEffect(() => {
    loadFlows().catch(() => undefined);
  }, []);

  async function toggleStatus(flow: Flow) {
    const response = await updateAutomationFlow<{ data: Flow }>(flow.id, {
      status: flow.status === "active" ? "inactive" : "active",
    });
    setFlowList((items) => items.map((item) => (item.id === flow.id ? response.data : item)));
  }

  async function handleCreateFlow(event: React.FormEvent) {
    event.preventDefault();
    if (!form.name.trim()) return;

    setSaving(true);
    try {
      const response = await createAutomationFlow<{ data: Flow }>({
        name: form.name.trim(),
        description: form.description.trim() || "Automation flow",
        trigger: form.trigger,
        category: form.category,
        status: form.status,
      });
      setFlowList((items) => [response.data, ...items]);
      setForm({ name: "", description: "", trigger: "New conversation", category: "Support", status: "draft" });
      setShowCreate(false);
    } finally {
      setSaving(false);
    }
  }

  async function handleCopy(flow: Flow) {
    const response = await createAutomationFlow<{ data: Flow }>({
      name: `${flow.name} Copy`,
      description: flow.description,
      trigger: flow.trigger,
      category: flow.category,
      status: "draft",
    });
    setFlowList((items) => [response.data, ...items]);
  }

  async function handleDelete(id: string) {
    setFlowList((items) => items.filter((flow) => flow.id !== id));
    await deleteAutomationFlow(id).catch(() => undefined);
  }

  const activeCount = flowList.filter((flow) => flow.status === "active").length;

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      <div className="flex items-center justify-between px-6 py-4 border-b border-border shrink-0">
        <div>
          <h1 className="text-foreground">Automation</h1>
          <p className="text-xs text-muted-foreground mt-0.5">{activeCount} active flows - {flowList.length} total</p>
        </div>
        <Button size="sm" className="h-8 text-xs bg-primary text-primary-foreground hover:bg-primary/90" onClick={() => setShowCreate((value) => !value)}>
          <Plus size={13} className="mr-1.5" /> New flow
        </Button>
      </div>

      {showCreate && (
        <form onSubmit={handleCreateFlow} className="grid grid-cols-1 md:grid-cols-6 gap-2 px-6 py-3 border-b border-border bg-secondary/20 shrink-0">
          <input value={form.name} onChange={(event) => setForm((current) => ({ ...current, name: event.target.value }))} placeholder="Flow name" className="h-8 text-xs bg-background border border-border rounded px-2 text-foreground" />
          <input value={form.description} onChange={(event) => setForm((current) => ({ ...current, description: event.target.value }))} placeholder="Description" className="h-8 text-xs bg-background border border-border rounded px-2 text-foreground md:col-span-2" />
          <select value={form.trigger} onChange={(event) => setForm((current) => ({ ...current, trigger: event.target.value }))} className="h-8 text-xs bg-background border border-border rounded px-2 text-foreground">
            <option>New conversation</option>
            <option>Keyword match</option>
            <option>Conversation resolved</option>
            <option>Webhook event</option>
          </select>
          <select value={form.status} onChange={(event) => setForm((current) => ({ ...current, status: event.target.value }))} className="h-8 text-xs bg-background border border-border rounded px-2 text-foreground">
            <option value="draft">Draft</option>
            <option value="active">Active</option>
            <option value="inactive">Inactive</option>
          </select>
          <div className="flex gap-2">
            <Button type="submit" size="sm" className="h-8 text-xs bg-primary text-primary-foreground" disabled={saving}>{saving ? "Saving..." : "Save"}</Button>
            <Button type="button" variant="outline" size="sm" className="h-8 text-xs border-border" onClick={() => setShowCreate(false)}>Cancel</Button>
          </div>
        </form>
      )}

      <div className="grid grid-cols-3 gap-3 px-6 py-4 border-b border-border shrink-0">
        {[
          { label: "Flow runs today", value: summary.runsToday.toLocaleString() },
          { label: "Messages automated", value: summary.automatedMessages.toLocaleString() },
          { label: "Handoff to agent", value: summary.handoffs.toLocaleString() },
        ].map((item) => (
          <Card key={item.label} className="p-3 bg-card border-border">
            <div className="text-lg font-semibold text-foreground">{item.value}</div>
            <div className="text-[11px] text-muted-foreground mt-0.5">{item.label}</div>
          </Card>
        ))}
      </div>

      <div className="flex-1 overflow-y-auto p-6 space-y-3">
        {flowList.map((flow) => (
          <Card key={flow.id} className="p-4 bg-card border-border hover:border-border/80 transition-colors">
            <div className="flex items-start gap-4">
              <div className="w-9 h-9 rounded-lg bg-primary/10 flex items-center justify-center shrink-0 mt-0.5">
                <Zap size={16} className="text-primary" />
              </div>

              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="font-medium text-sm text-foreground">{flow.name}</span>
                  <Badge variant="outline" className={`text-[10px] px-1.5 py-0 h-4 ${statusStyle[flow.status]}`}>{flow.status}</Badge>
                  <Badge variant="outline" className="text-[10px] px-1.5 py-0 h-4 border-border text-muted-foreground">{flow.category}</Badge>
                </div>
                <p className="text-xs text-muted-foreground mt-1">{flow.description}</p>
                <div className="flex items-center gap-4 mt-2 flex-wrap">
                  <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground">{triggerIcon(flow.trigger)}<span>{flow.trigger}</span></div>
                  <div className="text-[11px] text-muted-foreground">{flow.actions} actions</div>
                  <div className="text-[11px] text-muted-foreground">{flow.runs.toLocaleString()} runs</div>
                  <div className="text-[11px] text-muted-foreground">Last: {flow.lastRun}</div>
                </div>
              </div>

              <div className="flex items-center gap-2 shrink-0">
                {flow.status !== "draft" && <Switch checked={flow.status === "active"} onCheckedChange={() => toggleStatus(flow)} className="scale-75" />}
                <button className="w-7 h-7 rounded flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-secondary transition-colors" onClick={() => toggleStatus(flow)}><Edit2 size={13} /></button>
                <button className="w-7 h-7 rounded flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-secondary transition-colors" onClick={() => handleCopy(flow)}><Copy size={13} /></button>
                <button className="w-7 h-7 rounded flex items-center justify-center text-muted-foreground hover:text-destructive hover:bg-secondary transition-colors" onClick={() => handleDelete(flow.id)}><Trash2 size={13} /></button>
                <button className="w-7 h-7 rounded flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-secondary transition-colors"><ChevronRight size={13} /></button>
              </div>
            </div>
          </Card>
        ))}

        <Card className="p-4 bg-card border-border border-dashed hover:border-primary/30 transition-colors cursor-pointer" onClick={() => setShowCreate(true)}>
          <div className="flex flex-col items-center justify-center py-4 gap-2">
            <div className="w-9 h-9 rounded-full bg-primary/10 flex items-center justify-center">
              <Plus size={16} className="text-primary" />
            </div>
            <p className="text-sm font-medium text-foreground">Create a new automation flow</p>
            <p className="text-xs text-muted-foreground">Use the builder to automate responses, routing, and follow-ups</p>
          </div>
        </Card>
      </div>
    </div>
  );
}
