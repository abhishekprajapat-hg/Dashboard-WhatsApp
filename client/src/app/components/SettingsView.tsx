import { useEffect, useState } from "react";
import { Badge } from "./ui/badge";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { Label } from "./ui/label";
import { Card } from "./ui/card";
import {
  Building2,
  MessageCircle,
  Key,
  Plug,
  CreditCard,
  Bell,
  Shield,
  CheckCircle2,
  AlertCircle,
  Plus,
  RefreshCw,
  Trash2,
} from "lucide-react";
import {
  createWhatsAppAccount,
  createWhatsAppTemplate,
  deleteWhatsAppAccount,
  getCurrentWorkspace,
  getSettings,
  syncWhatsAppTemplates,
  updateCurrentWorkspace,
} from "../lib/api";

type SettingsTab = "workspace" | "whatsapp" | "api" | "integrations" | "billing" | "notifications" | "security";

interface WhatsAppAccount {
  id: string;
  displayName: string;
  phoneNumber: string;
  phoneNumberId: string;
  businessAccountId: string;
  status: "connected" | "disconnected" | "needs_attention";
  webhookStatus: string;
  templateSyncStatus: string;
}

interface Template {
  id: string;
  name: string;
  language: string;
  category: string;
  status: string;
}

interface SettingsPayload {
  whatsappAccounts: WhatsAppAccount[];
  templates: Template[];
  roles: { id: string; name: string; permissions: string[] }[];
}

const tabs: { id: SettingsTab; label: string; icon: React.ReactNode }[] = [
  { id: "workspace", label: "Workspace", icon: <Building2 size={14} /> },
  { id: "whatsapp", label: "WhatsApp", icon: <MessageCircle size={14} /> },
  { id: "api", label: "API Keys", icon: <Key size={14} /> },
  { id: "integrations", label: "Integrations", icon: <Plug size={14} /> },
  { id: "billing", label: "Billing", icon: <CreditCard size={14} /> },
  { id: "notifications", label: "Notifications", icon: <Bell size={14} /> },
  { id: "security", label: "Security", icon: <Shield size={14} /> },
];

const initialSettings: SettingsPayload = {
  whatsappAccounts: [],
  templates: [],
  roles: [],
};

const webhookCallbackUrl = import.meta.env.VITE_WHATSAPP_WEBHOOK_URL || "http://localhost:4000/webhooks/whatsapp";
const webhookVerifyToken = import.meta.env.VITE_WHATSAPP_VERIFY_TOKEN || "local-whatsapp-verify-token";

export function SettingsView() {
  const [activeTab, setActiveTab] = useState<SettingsTab>("workspace");
  const [settings, setSettings] = useState<SettingsPayload>(initialSettings);
  const [showAccountForm, setShowAccountForm] = useState(false);
  const [saving, setSaving] = useState(false);
  const [workspaceSaving, setWorkspaceSaving] = useState(false);
  const [workspaceForm, setWorkspaceForm] = useState({
    name: "Main Workspace",
    timezone: "Asia/Kolkata",
    businessCategory: "Customer Support",
  });
  const [form, setForm] = useState({
    displayName: "",
    phoneNumber: "",
    phoneNumberId: "",
    businessAccountId: "",
    accessToken: "",
  });
  const [templateForm, setTemplateForm] = useState({
    accountId: "",
    name: "",
    language: "en",
    category: "UTILITY",
    body: "",
  });
  const [templateSaving, setTemplateSaving] = useState(false);
  const [templateNotice, setTemplateNotice] = useState("");

  async function loadSettings() {
    const response = await getSettings<SettingsPayload>();
    setSettings(response);
  }

  useEffect(() => {
    loadSettings().catch(() => setSettings(initialSettings));
    getCurrentWorkspace<{ workspace: { name: string; timezone: string } }>()
      .then((response) => setWorkspaceForm((current) => ({ ...current, name: response.workspace.name, timezone: response.workspace.timezone })))
      .catch(() => undefined);
  }, []);

  async function handleWorkspaceSave(event: React.FormEvent) {
    event.preventDefault();
    setWorkspaceSaving(true);
    try {
      const response = await updateCurrentWorkspace<{ workspace: { name: string; timezone: string } }>(workspaceForm);
      setWorkspaceForm((current) => ({ ...current, name: response.workspace.name, timezone: response.workspace.timezone }));
    } finally {
      setWorkspaceSaving(false);
    }
  }

  async function handleCreateAccount(event: React.FormEvent) {
    event.preventDefault();
    setSaving(true);
    try {
      await createWhatsAppAccount<{ data: WhatsAppAccount }>(form);
      setForm({ displayName: "", phoneNumber: "", phoneNumberId: "", businessAccountId: "", accessToken: "" });
      setShowAccountForm(false);
      await loadSettings();
    } finally {
      setSaving(false);
    }
  }

  async function handleDeleteAccount(id: string) {
    setSettings((current) => ({
      ...current,
      whatsappAccounts: current.whatsappAccounts.filter((account) => account.id !== id),
      templates: current.templates.filter((template) => template.id !== id),
    }));
    await deleteWhatsAppAccount(id).catch(() => undefined);
    await loadSettings().catch(() => undefined);
  }

  async function handleSyncTemplates(id: string) {
    try {
      await syncWhatsAppTemplates(id);
      await loadSettings();
      setTemplateNotice("Templates synced.");
    } catch (error) {
      setTemplateNotice(error instanceof Error ? error.message : "Template sync failed. Add approved templates manually.");
      await loadSettings().catch(() => undefined);
    }
  }

  async function handleCreateTemplate(event: React.FormEvent) {
    event.preventDefault();
    setTemplateSaving(true);
    setTemplateNotice("");
    try {
      await createWhatsAppTemplate<{ data: Template }>({
        ...templateForm,
        accountId: templateForm.accountId || settings.whatsappAccounts[0]?.id,
      });
      setTemplateForm((current) => ({ ...current, name: "", body: "" }));
      setTemplateNotice("Template added. You can use it in Inbox now.");
      await loadSettings();
    } catch (error) {
      setTemplateNotice(error instanceof Error ? error.message : "Template could not be added.");
    } finally {
      setTemplateSaving(false);
    }
  }

  return (
    <div className="flex-1 flex overflow-hidden">
      <div className="w-48 border-r border-border flex flex-col py-4 shrink-0">
        <div className="px-4 mb-3">
          <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">Settings</p>
        </div>
        <nav className="space-y-0.5 px-2">
          {tabs.map((tab) => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`w-full flex items-center gap-2.5 px-2.5 py-2 rounded text-xs transition-colors text-left ${
                activeTab === tab.id
                  ? "bg-primary/10 text-primary"
                  : "text-muted-foreground hover:text-foreground hover:bg-secondary"
              }`}
            >
              {tab.icon}
              {tab.label}
            </button>
          ))}
        </nav>
      </div>

      <div className="flex-1 overflow-y-auto p-6">
        {activeTab === "workspace" && (
          <div className="max-w-xl space-y-6">
            <div>
              <h2 className="text-foreground">Workspace Settings</h2>
              <p className="text-xs text-muted-foreground mt-0.5">Manage organization profile and operating defaults.</p>
            </div>
            <form onSubmit={handleWorkspaceSave}>
            <Card className="p-4 bg-card border-border space-y-4">
              <div className="space-y-1.5">
                <Label>Workspace name</Label>
                <Input value={workspaceForm.name} onChange={(e) => setWorkspaceForm((current) => ({ ...current, name: e.target.value }))} className="bg-secondary border-transparent focus:border-border" />
              </div>
              <div className="space-y-1.5">
                <Label>Timezone</Label>
                <Input value={workspaceForm.timezone} onChange={(e) => setWorkspaceForm((current) => ({ ...current, timezone: e.target.value }))} className="bg-secondary border-transparent focus:border-border" />
              </div>
              <Button type="submit" size="sm" className="h-8 text-xs bg-primary text-primary-foreground hover:bg-primary/90" disabled={workspaceSaving}>
                {workspaceSaving ? "Saving..." : "Save changes"}
              </Button>
            </Card>
            </form>
          </div>
        )}

        {activeTab === "whatsapp" && (
          <div className="max-w-3xl space-y-6">
            <div className="flex items-start justify-between gap-4">
              <div>
                <h2 className="text-foreground">WhatsApp Accounts</h2>
                <p className="text-xs text-muted-foreground mt-0.5">Connect Meta WhatsApp Business accounts and manage templates.</p>
              </div>
              <Button size="sm" className="h-8 text-xs bg-primary text-primary-foreground" onClick={() => setShowAccountForm((value) => !value)}>
                <Plus size={13} className="mr-1.5" />
                Add account
              </Button>
            </div>

            <Card className="p-4 bg-card border-border">
              <h3 className="text-sm font-medium text-foreground mb-2">Webhook</h3>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <div>
                  <p className="text-[10px] uppercase tracking-wider text-muted-foreground mb-1">Callback URL</p>
                  <code className="block text-xs bg-secondary text-foreground rounded px-2 py-2 break-all">
                    {webhookCallbackUrl}
                  </code>
                </div>
                <div>
                  <p className="text-[10px] uppercase tracking-wider text-muted-foreground mb-1">Verify token</p>
                  <code className="block text-xs bg-secondary text-foreground rounded px-2 py-2 break-all">
                    {webhookVerifyToken}
                  </code>
                </div>
              </div>
            </Card>

            {showAccountForm && (
              <form onSubmit={handleCreateAccount} className="grid grid-cols-1 md:grid-cols-2 gap-3 p-4 bg-card border border-border rounded-md">
                <div className="space-y-1.5">
                  <Label>Display name</Label>
                  <Input value={form.displayName} onChange={(e) => setForm((current) => ({ ...current, displayName: e.target.value }))} required />
                </div>
                <div className="space-y-1.5">
                  <Label>Phone number</Label>
                  <Input value={form.phoneNumber} onChange={(e) => setForm((current) => ({ ...current, phoneNumber: e.target.value }))} required />
                </div>
                <div className="space-y-1.5">
                  <Label>Phone number ID</Label>
                  <Input value={form.phoneNumberId} onChange={(e) => setForm((current) => ({ ...current, phoneNumberId: e.target.value }))} required />
                </div>
                <div className="space-y-1.5">
                  <Label>Business account ID</Label>
                  <Input value={form.businessAccountId} onChange={(e) => setForm((current) => ({ ...current, businessAccountId: e.target.value }))} required />
                </div>
                <div className="space-y-1.5 md:col-span-2">
                  <Label>Access token</Label>
                  <Input value={form.accessToken} onChange={(e) => setForm((current) => ({ ...current, accessToken: e.target.value }))} placeholder="Stored locally as placeholder credentials" />
                </div>
                <div className="md:col-span-2 flex gap-2">
                  <Button type="submit" size="sm" className="h-8 text-xs bg-primary text-primary-foreground" disabled={saving}>
                    {saving ? "Saving..." : "Save account"}
                  </Button>
                  <Button type="button" size="sm" variant="outline" className="h-8 text-xs border-border" onClick={() => setShowAccountForm(false)}>
                    Cancel
                  </Button>
                </div>
              </form>
            )}

            <div className="space-y-3">
              {settings.whatsappAccounts.length === 0 && (
                <Card className="p-4 bg-card border-border">
                  <div className="flex items-start gap-3">
                    <AlertCircle size={16} className="text-yellow-400 mt-0.5" />
                    <div>
                      <p className="text-sm text-foreground">No WhatsApp account connected</p>
                      <p className="text-xs text-muted-foreground">Add account details to enable real webhook routing and provider sends.</p>
                    </div>
                  </div>
                </Card>
              )}

              {settings.whatsappAccounts.map((account) => (
                <Card key={account.id} className="p-4 bg-card border-border">
                  <div className="flex items-start gap-3">
                    <div className="w-10 h-10 rounded-full bg-primary/10 flex items-center justify-center shrink-0">
                      <MessageCircle size={18} className="text-primary" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="text-sm font-medium text-foreground">{account.displayName}</span>
                        <Badge variant="outline" className="text-[10px] bg-primary/10 text-primary border-primary/30">{account.status}</Badge>
                        <Badge variant="outline" className="text-[10px] border-border text-muted-foreground">webhook {account.webhookStatus}</Badge>
                        <Badge variant="outline" className="text-[10px] border-border text-muted-foreground">templates {account.templateSyncStatus}</Badge>
                      </div>
                      <p className="text-xs text-muted-foreground mt-0.5">{account.phoneNumber}</p>
                      <p className="text-[11px] text-muted-foreground mt-1">Phone ID: {account.phoneNumberId} | Business ID: {account.businessAccountId}</p>
                    </div>
                    <div className="flex gap-1">
                      <Button variant="outline" size="sm" className="h-8 text-xs border-border" onClick={() => handleSyncTemplates(account.id)}>
                        <RefreshCw size={12} className="mr-1" />
                        Sync
                      </Button>
                      <Button variant="outline" size="sm" className="h-8 text-xs border-destructive/30 text-destructive" onClick={() => handleDeleteAccount(account.id)}>
                        <Trash2 size={12} />
                      </Button>
                    </div>
                  </div>
                </Card>
              ))}
            </div>

            <Card className="bg-card border-border">
              <div className="px-4 py-3 border-b border-border flex items-center justify-between">
                <h3 className="text-sm font-medium text-foreground">Templates</h3>
                <span className="text-xs text-muted-foreground">{settings.templates.length} total</span>
              </div>
              <form onSubmit={handleCreateTemplate} className="grid grid-cols-1 md:grid-cols-4 gap-3 border-b border-border p-4">
                <div className="space-y-1.5 md:col-span-2">
                  <Label>Approved template name</Label>
                  <Input
                    value={templateForm.name}
                    onChange={(event) => setTemplateForm((current) => ({ ...current, name: event.target.value }))}
                    placeholder="hello_world"
                    required
                    className="h-8 bg-secondary border-transparent focus:border-border"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label>Language</Label>
                  <Input
                    value={templateForm.language}
                    onChange={(event) => setTemplateForm((current) => ({ ...current, language: event.target.value }))}
                    placeholder="en"
                    className="h-8 bg-secondary border-transparent focus:border-border"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label>Category</Label>
                  <Input
                    value={templateForm.category}
                    onChange={(event) => setTemplateForm((current) => ({ ...current, category: event.target.value }))}
                    placeholder="UTILITY"
                    className="h-8 bg-secondary border-transparent focus:border-border"
                  />
                </div>
                <div className="space-y-1.5 md:col-span-4">
                  <Label>Body text with variables</Label>
                  <Input
                    value={templateForm.body}
                    onChange={(event) => setTemplateForm((current) => ({ ...current, body: event.target.value }))}
                    placeholder="Hi {{1}}, thanks for contacting us."
                    className="h-8 bg-secondary border-transparent focus:border-border"
                  />
                </div>
                <div className="md:col-span-4 flex items-center gap-3">
                  <Button type="submit" size="sm" className="h-8 text-xs bg-primary text-primary-foreground" disabled={templateSaving || settings.whatsappAccounts.length === 0}>
                    {templateSaving ? "Adding..." : "Add approved template"}
                  </Button>
                  {templateNotice && <span className="text-xs text-muted-foreground">{templateNotice}</span>}
                </div>
              </form>
              <div className="divide-y divide-border">
                {settings.templates.map((template) => (
                  <div key={template.id} className="px-4 py-3 flex items-center justify-between">
                    <div>
                      <p className="text-sm text-foreground">{template.name}</p>
                      <p className="text-xs text-muted-foreground">{template.category} | {template.language}</p>
                    </div>
                    <Badge variant="outline" className="text-[10px] bg-primary/10 text-primary border-primary/30">
                      <CheckCircle2 size={10} className="mr-1" />
                      {template.status}
                    </Badge>
                  </div>
                ))}
                {settings.templates.length === 0 && (
                  <div className="px-4 py-6 text-sm text-muted-foreground">No templates synced yet.</div>
                )}
              </div>
            </Card>
          </div>
        )}

        {activeTab !== "workspace" && activeTab !== "whatsapp" && (
          <div className="max-w-xl space-y-4">
            <div>
              <h2 className="text-foreground capitalize">{activeTab}</h2>
              <p className="text-xs text-muted-foreground mt-0.5">This section is ready for the next implementation pass.</p>
            </div>
            <Card className="p-4 bg-card border-border">
              <p className="text-sm text-muted-foreground">Core settings are in place. WhatsApp integration is now connected to MongoDB.</p>
            </Card>
          </div>
        )}
      </div>
    </div>
  );
}

