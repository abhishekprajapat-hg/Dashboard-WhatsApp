import { useEffect, useState } from "react";
import { Badge } from "./ui/badge";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { Label } from "./ui/label";
import { Card } from "./ui/card";
import { Workflow, Send, Trash2, CheckCircle2 } from "lucide-react";
import {
  createWhatsAppFlow,
  deleteWhatsAppFlow,
  getSettings,
  getWhatsAppFlowTemplates,
  getWhatsAppFlows,
  publishWhatsAppFlow,
  sendWhatsAppFlow,
} from "../lib/api";

const cardClass = "rounded-lg border-border bg-card/90 shadow-xl shadow-black/5";
const fieldClass = "bg-background/80 border-border shadow-inner shadow-black/10 focus:border-primary/50 focus:ring-2 focus:ring-primary/20";

interface WhatsAppAccountOption {
  id: string;
  displayName: string;
  status: string;
}

interface FlowTemplate {
  id: string;
  label: string;
  categories: string[];
}

interface WhatsAppFlow {
  id: string;
  whatsappAccountId: string;
  name: string;
  template: string;
  categories: string[];
  metaFlowId: string;
  status: "draft" | "published" | "deprecated";
  lastError: string;
  createdAt: string;
}

function statusVariant(status: string): "default" | "outline" | "destructive" | "warning" {
  if (status === "published") return "default";
  if (status === "deprecated") return "destructive";
  return "outline";
}

export function WhatsAppFlowsPanel() {
  const [accounts, setAccounts] = useState<WhatsAppAccountOption[]>([]);
  const [templates, setTemplates] = useState<FlowTemplate[]>([]);
  const [flows, setFlows] = useState<WhatsAppFlow[]>([]);
  const [loading, setLoading] = useState(true);
  const [notice, setNotice] = useState("");
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [creating, setCreating] = useState(false);
  const [createForm, setCreateForm] = useState({ whatsappAccountId: "", template: "", name: "" });
  const [busyFlowId, setBusyFlowId] = useState("");
  const [sendTargets, setSendTargets] = useState<Record<string, string>>({});

  async function loadData() {
    setLoading(true);
    setNotice("");
    try {
      const [settingsResponse, templatesResponse, flowsResponse] = await Promise.all([
        getSettings<{ whatsappAccounts: WhatsAppAccountOption[] }>(),
        getWhatsAppFlowTemplates<{ data: FlowTemplate[] }>(),
        getWhatsAppFlows<{ data: WhatsAppFlow[] }>(),
      ]);
      setAccounts(settingsResponse.whatsappAccounts || []);
      setTemplates(templatesResponse.data);
      setFlows(flowsResponse.data);
      setCreateForm((current) => ({
        ...current,
        whatsappAccountId: current.whatsappAccountId || settingsResponse.whatsappAccounts?.[0]?.id || "",
        template: current.template || templatesResponse.data[0]?.id || "",
      }));
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "WhatsApp Flows could not be loaded.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadData().catch(() => undefined);
  }, []);

  async function handleCreate(event: React.FormEvent) {
    event.preventDefault();
    setCreating(true);
    setNotice("");
    try {
      await createWhatsAppFlow({
        whatsappAccountId: createForm.whatsappAccountId,
        template: createForm.template,
        name: createForm.name,
      });
      setCreateForm((current) => ({ ...current, name: "" }));
      setShowCreateForm(false);
      await loadData();
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Could not create the flow.");
    } finally {
      setCreating(false);
    }
  }

  async function handlePublish(id: string) {
    setBusyFlowId(id);
    setNotice("");
    try {
      await publishWhatsAppFlow(id);
      await loadData();
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Could not publish the flow.");
    } finally {
      setBusyFlowId("");
    }
  }

  async function handleSend(id: string) {
    const to = sendTargets[id];
    if (!to) {
      setNotice("Enter a recipient phone number first.");
      return;
    }
    setBusyFlowId(id);
    setNotice("");
    try {
      await sendWhatsAppFlow(id, { to });
      setNotice(`Flow sent to ${to}.`);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Could not send the flow.");
    } finally {
      setBusyFlowId("");
    }
  }

  async function handleDelete(id: string) {
    setBusyFlowId(id);
    try {
      await deleteWhatsAppFlow(id);
      await loadData();
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Could not delete the flow.");
    } finally {
      setBusyFlowId("");
    }
  }

  return (
    <div className="space-y-4">
      <Card className={`p-4 ${cardClass}`}>
        <div className="flex items-center gap-2 mb-1">
          <Workflow size={16} className="text-primary" />
          <h3 className="text-sm font-medium text-foreground">WhatsApp Flows</h3>
        </div>
        <p className="text-xs text-muted-foreground">
          Native in-chat forms - lead capture, appointment requests, and surveys a customer fills out without
          leaving WhatsApp. Static flows only for now (no server-side data exchange).
        </p>
      </Card>

      {notice && (
        <Card className={`p-3 border-destructive/40 bg-destructive/5 ${cardClass}`}>
          <p className="text-xs text-destructive">{notice}</p>
        </Card>
      )}

      <div className="flex items-center justify-between">
        <h4 className="text-xs font-medium text-foreground uppercase tracking-wider">Flows</h4>
        <Button
          type="button"
          size="sm"
          variant="outline"
          className="h-8 text-xs border-border"
          onClick={() => setShowCreateForm((current) => !current)}
          disabled={accounts.length === 0}
        >
          {showCreateForm ? "Cancel" : "New flow"}
        </Button>
      </div>

      {showCreateForm && (
        <form onSubmit={handleCreate} className={`space-y-3 ${cardClass} p-4`}>
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
            <div className="space-y-1.5">
              <Label>WhatsApp account</Label>
              <select
                value={createForm.whatsappAccountId}
                onChange={(event) => setCreateForm((current) => ({ ...current, whatsappAccountId: event.target.value }))}
                required
                className={`w-full rounded-md border px-3 py-2 text-sm ${fieldClass}`}
              >
                {accounts.map((account) => (
                  <option key={account.id} value={account.id}>
                    {account.displayName}
                  </option>
                ))}
              </select>
            </div>
            <div className="space-y-1.5">
              <Label>Template</Label>
              <select
                value={createForm.template}
                onChange={(event) => setCreateForm((current) => ({ ...current, template: event.target.value }))}
                required
                className={`w-full rounded-md border px-3 py-2 text-sm ${fieldClass}`}
              >
                {templates.map((template) => (
                  <option key={template.id} value={template.id}>
                    {template.label}
                  </option>
                ))}
              </select>
            </div>
          </div>
          <div className="space-y-1.5">
            <Label>Flow name</Label>
            <Input
              value={createForm.name}
              onChange={(event) => setCreateForm((current) => ({ ...current, name: event.target.value }))}
              placeholder="Website lead capture"
              required
              className={fieldClass}
            />
          </div>
          <Button type="submit" size="sm" className="h-8 text-xs bg-primary text-primary-foreground" disabled={creating}>
            {creating ? "Creating..." : "Create flow (draft)"}
          </Button>
        </form>
      )}

      <div className="space-y-2">
        {!loading && flows.length === 0 && (
          <Card className={`p-4 ${cardClass}`}>
            <p className="text-sm text-foreground">No flows yet</p>
            <p className="text-xs text-muted-foreground">Create one from a template to start collecting structured replies in-chat.</p>
          </Card>
        )}
        {flows.map((flow) => (
          <Card key={flow.id} className={`p-4 ${cardClass}`}>
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-sm font-medium text-foreground">{flow.name}</span>
                  <Badge variant={statusVariant(flow.status)}>{flow.status}</Badge>
                </div>
                <p className="text-xs text-muted-foreground mt-1">{flow.categories.join(", ")} · Meta flow {flow.metaFlowId}</p>
                {flow.lastError && <p className="text-xs text-destructive mt-1">{flow.lastError}</p>}

                {flow.status === "published" && (
                  <div className="mt-3 flex flex-wrap items-center gap-2">
                    <Input
                      value={sendTargets[flow.id] || ""}
                      onChange={(event) => setSendTargets((current) => ({ ...current, [flow.id]: event.target.value }))}
                      placeholder="+91 98765 43210"
                      className={`h-8 w-48 text-xs ${fieldClass}`}
                    />
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      className="h-8 text-xs border-border"
                      onClick={() => handleSend(flow.id)}
                      disabled={busyFlowId === flow.id}
                    >
                      <Send size={12} className="mr-1" /> Send
                    </Button>
                  </div>
                )}
              </div>
              <div className="flex gap-1">
                {flow.status === "draft" && (
                  <Button
                    type="button"
                    size="icon-sm"
                    variant="outline"
                    className="border-border"
                    title="Publish"
                    onClick={() => handlePublish(flow.id)}
                    disabled={busyFlowId === flow.id}
                  >
                    <CheckCircle2 size={14} />
                  </Button>
                )}
                {flow.status === "draft" && (
                  <Button
                    type="button"
                    size="icon-sm"
                    variant="outline"
                    className="border-border"
                    title="Delete"
                    onClick={() => handleDelete(flow.id)}
                    disabled={busyFlowId === flow.id}
                  >
                    <Trash2 size={14} />
                  </Button>
                )}
              </div>
            </div>
          </Card>
        ))}
      </div>
    </div>
  );
}
