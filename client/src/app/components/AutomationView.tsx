import { useEffect, useState } from "react";
import { Badge } from "./ui/badge";
import { Button } from "./ui/button";
import { Switch } from "./ui/switch";
import { Card } from "./ui/card";
import { Plus, Zap, MessageCircle, Clock, Tag, ChevronRight, Play, Edit2, Trash2, Copy, CheckCircle2, AlertCircle } from "lucide-react";
import { createAutomationFlow, deleteAutomationFlow, getAutomationFlows, getTeamMembers, testAutomationFlow, updateAutomationFlow } from "../lib/api";

interface Flow {
  id: string;
  name: string;
  description: string;
  trigger: string;
  keyword: string;
  actionSummary: string[];
  actions: number;
  status: "active" | "inactive" | "draft";
  runs: number;
  lastRun: string;
  category: string;
}

interface TeamMember {
  id: string;
  userId: string;
  name: string;
  role: "admin" | "manager" | "agent";
  status: string;
}

interface TestResult {
  matched: boolean;
  message: string;
  actions: { flowId: string; type: string; status?: string; tag?: string; messageId?: string; error?: string }[];
  flow?: Flow;
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
  const [members, setMembers] = useState<TeamMember[]>([]);
  const [showCreate, setShowCreate] = useState(false);
  const [saving, setSaving] = useState(false);
  const [testingFlowId, setTestingFlowId] = useState("");
  const [testMessages, setTestMessages] = useState<Record<string, string>>({});
  const [testResults, setTestResults] = useState<Record<string, TestResult | { error: string }>>({});
  const [form, setForm] = useState({
    name: "",
    description: "",
    trigger: "New conversation",
    category: "Support",
    status: "draft",
    keyword: "",
    sendReply: true,
    actionMessage: "Thanks for reaching out. Our team will reply shortly.",
    assignmentUserId: "",
    nextStatus: "",
    tagName: "",
    addToCrm: false,
    callWebhook: false,
    webhookUrl: "",
    webhookSecret: "",
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
    getTeamMembers<{ data: TeamMember[]; total: number }>()
      .then((response) => setMembers(response.data.filter((member) => member.userId)))
      .catch(() => undefined);
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
        keyword: form.keyword.trim(),
        sendReply: form.sendReply,
        actionMessage: form.actionMessage.trim() || "Thanks for reaching out. Our team will reply shortly.",
        assignmentUserId: form.assignmentUserId,
        nextStatus: form.nextStatus,
        tagName: form.tagName.trim(),
        addToCrm: form.addToCrm,
        callWebhook: form.callWebhook,
        webhookUrl: form.webhookUrl.trim(),
        webhookSecret: form.webhookSecret,
      });
      setFlowList((items) => [response.data, ...items]);
      setForm({
        name: "",
        description: "",
        trigger: "New conversation",
        category: "Support",
        status: "draft",
        keyword: "",
        sendReply: true,
        actionMessage: "Thanks for reaching out. Our team will reply shortly.",
        assignmentUserId: "",
        nextStatus: "",
        tagName: "",
        addToCrm: false,
        callWebhook: false,
        webhookUrl: "",
        webhookSecret: "",
      });
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
      keyword: flow.keyword,
      sendReply: true,
      actionMessage: flow.description || "Thanks for reaching out. Our team will reply shortly.",
    });
    setFlowList((items) => [response.data, ...items]);
  }

  async function handleDelete(id: string) {
    setFlowList((items) => items.filter((flow) => flow.id !== id));
    await deleteAutomationFlow(id).catch(() => undefined);
  }

  async function handleTest(flow: Flow) {
    const message = (testMessages[flow.id] || flow.keyword || "hello").trim();
    if (!message) return;

    setTestingFlowId(flow.id);
    setTestResults((current) => ({ ...current, [flow.id]: { error: "" } }));
    try {
      const response = await testAutomationFlow<TestResult>(flow.id, message);
      setTestResults((current) => ({ ...current, [flow.id]: response }));
      if (response.flow) {
        setFlowList((items) => items.map((item) => (item.id === flow.id ? response.flow as Flow : item)));
      }
      await loadFlows().catch(() => undefined);
    } catch (error) {
      setTestResults((current) => ({
        ...current,
        [flow.id]: { error: error instanceof Error ? error.message : "Automation test failed." },
      }));
    } finally {
      setTestingFlowId("");
    }
  }

  const activeCount = flowList.filter((flow) => flow.status === "active").length;
  const needsKeyword = form.trigger === "Keyword match";
  const hasAction = form.sendReply || Boolean(form.assignmentUserId) || Boolean(form.nextStatus) || Boolean(form.tagName.trim()) || form.addToCrm || form.callWebhook;
  const canSaveFlow = Boolean(form.name.trim()) && (!needsKeyword || Boolean(form.keyword.trim())) && hasAction;

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      <div className="flex flex-col gap-3 px-3 py-3 border-b border-border shrink-0 sm:flex-row sm:items-center sm:justify-between sm:px-6 sm:py-4">
        <div className="min-w-0">
          <h1 className="text-foreground">Automation</h1>
          <p className="text-xs text-muted-foreground mt-0.5">{activeCount} active flows - {flowList.length} total</p>
        </div>
        <Button size="sm" className="h-8 text-xs bg-primary text-primary-foreground hover:bg-primary/90" onClick={() => setShowCreate((value) => !value)}>
          <Plus size={13} className="mr-1.5" /> New flow
        </Button>
      </div>

      {showCreate && (
        <form onSubmit={handleCreateFlow} className="grid grid-cols-1 md:grid-cols-6 gap-2 px-3 sm:px-6 py-3 border-b border-border bg-secondary/20 shrink-0">
          <input value={form.name} onChange={(event) => setForm((current) => ({ ...current, name: event.target.value }))} placeholder="Flow name" className="h-8 text-xs bg-background border border-border rounded px-2 text-foreground" />
          <input value={form.description} onChange={(event) => setForm((current) => ({ ...current, description: event.target.value }))} placeholder="Description" className="h-8 text-xs bg-background border border-border rounded px-2 text-foreground md:col-span-2" />
          <select value={form.trigger} onChange={(event) => setForm((current) => ({ ...current, trigger: event.target.value }))} className="h-8 text-xs bg-background border border-border rounded px-2 text-foreground">
            <option>New conversation</option>
            <option>Keyword match</option>
            <option>Conversation resolved</option>
            <option>Webhook event</option>
          </select>
          {form.trigger === "Keyword match" && (
            <input value={form.keyword} onChange={(event) => setForm((current) => ({ ...current, keyword: event.target.value }))} placeholder="Keyword, e.g. price" className="h-8 text-xs bg-background border border-border rounded px-2 text-foreground" />
          )}
          <select value={form.status} onChange={(event) => setForm((current) => ({ ...current, status: event.target.value }))} className="h-8 text-xs bg-background border border-border rounded px-2 text-foreground">
            <option value="draft">Draft</option>
            <option value="active">Active</option>
            <option value="inactive">Inactive</option>
          </select>
          <div className="flex gap-2">
            <Button type="submit" size="sm" className="h-8 text-xs bg-primary text-primary-foreground" disabled={saving || !canSaveFlow}>{saving ? "Saving..." : "Save"}</Button>
            <Button type="button" variant="outline" size="sm" className="h-8 text-xs border-border" onClick={() => setShowCreate(false)}>Cancel</Button>
          </div>
          <label className="flex h-8 items-center gap-2 rounded border border-border bg-background px-2 text-xs text-foreground">
            <input type="checkbox" checked={form.sendReply} onChange={(event) => setForm((current) => ({ ...current, sendReply: event.target.checked }))} />
            Send auto-reply
          </label>
          <select value={form.assignmentUserId} onChange={(event) => setForm((current) => ({ ...current, assignmentUserId: event.target.value }))} className="h-8 text-xs bg-background border border-border rounded px-2 text-foreground">
            <option value="">Assign: no change</option>
            {members.map((member) => (
              <option key={member.userId} value={member.userId}>Assign to {member.name}</option>
            ))}
          </select>
          <select value={form.nextStatus} onChange={(event) => setForm((current) => ({ ...current, nextStatus: event.target.value }))} className="h-8 text-xs bg-background border border-border rounded px-2 text-foreground">
            <option value="">Status: no change</option>
            <option value="open">Open</option>
            <option value="waiting">Waiting</option>
            <option value="resolved">Resolved</option>
          </select>
          <input value={form.tagName} onChange={(event) => setForm((current) => ({ ...current, tagName: event.target.value }))} placeholder="Add tag, e.g. Hot lead" className="h-8 text-xs bg-background border border-border rounded px-2 text-foreground" />
          <label className="flex h-8 items-center gap-2 rounded border border-border bg-background px-2 text-xs text-foreground">
            <input type="checkbox" checked={form.addToCrm} onChange={(event) => setForm((current) => ({ ...current, addToCrm: event.target.checked }))} />
            Add to CRM
          </label>
          <label className="flex h-8 items-center gap-2 rounded border border-border bg-background px-2 text-xs text-foreground">
            <input type="checkbox" checked={form.callWebhook} onChange={(event) => setForm((current) => ({ ...current, callWebhook: event.target.checked }))} />
            Call webhook
          </label>
          {form.callWebhook && (
            <>
              <input value={form.webhookUrl} onChange={(event) => setForm((current) => ({ ...current, webhookUrl: event.target.value }))} placeholder="Webhook URL, or leave blank to use Settings" className="h-8 text-xs bg-background border border-border rounded px-2 text-foreground md:col-span-3" />
              <input value={form.webhookSecret} onChange={(event) => setForm((current) => ({ ...current, webhookSecret: event.target.value }))} placeholder="Webhook secret override" className="h-8 text-xs bg-background border border-border rounded px-2 text-foreground md:col-span-2" />
            </>
          )}
          {form.sendReply && (
            <input value={form.actionMessage} onChange={(event) => setForm((current) => ({ ...current, actionMessage: event.target.value }))} placeholder="Auto-reply message" className="h-8 text-xs bg-background border border-border rounded px-2 text-foreground md:col-span-6" />
          )}
        </form>
      )}

      <div className="grid grid-cols-1 gap-3 px-3 py-3 border-b border-border shrink-0 sm:grid-cols-3 sm:px-6 sm:py-4">
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

      <div className="flex-1 overflow-y-auto p-3 sm:p-6 space-y-3">
        {flowList.map((flow) => (
          <Card key={flow.id} className="p-3 sm:p-4 bg-card border-border hover:border-border/80 transition-colors">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:gap-4">
              <div className="w-9 h-9 rounded-lg bg-primary/10 flex items-center justify-center shrink-0 mt-0.5">
                <Zap size={16} className="text-primary" />
              </div>

              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="min-w-0 truncate font-medium text-sm text-foreground">{flow.name}</span>
                  <Badge variant="outline" className={`text-[10px] px-1.5 py-0 h-4 ${statusStyle[flow.status]}`}>{flow.status}</Badge>
                  <Badge variant="outline" className="text-[10px] px-1.5 py-0 h-4 border-border text-muted-foreground">{flow.category}</Badge>
                </div>
                <p className="text-xs text-muted-foreground mt-1">{flow.description}</p>
                <div className="flex items-center gap-4 mt-2 flex-wrap">
                  <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground">{triggerIcon(flow.trigger)}<span>{flow.trigger}</span></div>
                  {flow.keyword && <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground"><Tag size={13} /><span>{flow.keyword}</span></div>}
                  <div className="text-[11px] text-muted-foreground">{flow.actions} actions</div>
                  {flow.actionSummary?.slice(0, 4).map((action) => (
                    <Badge key={action} variant="outline" className="text-[10px] px-1.5 py-0 h-4 border-border text-muted-foreground">
                      {action}
                    </Badge>
                  ))}
                  <div className="text-[11px] text-muted-foreground">{flow.runs.toLocaleString()} runs</div>
                  <div className="text-[11px] text-muted-foreground">Last: {flow.lastRun}</div>
                </div>
                {flow.status === "active" && (
                  <div className="mt-3 rounded-md border border-border bg-secondary/30 p-3">
                    <div className="flex flex-col gap-2 md:flex-row">
                      <input
                        value={testMessages[flow.id] ?? flow.keyword ?? ""}
                        onChange={(event) => setTestMessages((current) => ({ ...current, [flow.id]: event.target.value }))}
                        placeholder="Type a test inbound message"
                        className="h-8 flex-1 rounded border border-border bg-background px-2 text-xs text-foreground"
                      />
                      <Button size="sm" className="h-8 shrink-0 bg-primary text-xs text-primary-foreground" onClick={() => handleTest(flow)} disabled={testingFlowId === flow.id}>
                        <Play size={12} className="mr-1" />
                        {testingFlowId === flow.id ? "Testing" : "Test automation"}
                      </Button>
                    </div>
                    {testResults[flow.id] && (
                      <div className="mt-2 text-xs">
                        {"error" in testResults[flow.id] && testResults[flow.id].error ? (
                          <div className="flex items-center gap-1.5 rounded border border-destructive/30 bg-destructive/10 px-2 py-1.5 text-destructive">
                            <AlertCircle size={13} />
                            {testResults[flow.id].error}
                          </div>
                        ) : (
                          <div className="space-y-1.5">
                            <div className={`flex items-center gap-1.5 rounded border px-2 py-1.5 ${
                              (testResults[flow.id] as TestResult).matched
                                ? "border-primary/30 bg-primary/10 text-primary"
                                : "border-yellow-500/30 bg-yellow-500/10 text-yellow-400"
                            }`}>
                              <CheckCircle2 size={13} />
                              {(testResults[flow.id] as TestResult).matched ? "Flow matched and ran." : "No matching action ran."}
                            </div>
                            {(testResults[flow.id] as TestResult).actions.length > 0 && (
                              <div className="flex flex-wrap gap-1">
                                {(testResults[flow.id] as TestResult).actions.map((action, index) => (
                                  <Badge key={`${action.type}_${index}`} variant="outline" className="border-border text-[10px] text-muted-foreground">
                                    {action.type.replace(/_/g, " ")}{action.status ? `: ${action.status}` : ""}{action.tag ? `: ${action.tag}` : ""}
                                  </Badge>
                                ))}
                              </div>
                            )}
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                )}
              </div>

              <div className="flex flex-wrap items-center gap-2 shrink-0 sm:justify-end">
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
