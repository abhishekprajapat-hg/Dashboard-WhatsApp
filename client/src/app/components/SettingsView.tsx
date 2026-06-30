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
  Copy,
  Plus,
  RefreshCw,
  Trash2,
  Send,
  Inbox,
  Activity,
  FileText,
} from "lucide-react";
import {
  createWhatsAppAccount,
  createWhatsAppTemplate,
  deleteWhatsAppAccount,
  getCurrentWorkspace,
  getWhatsAppConsole,
  getSettings,
  syncWhatsAppTemplates,
  testWhatsAppAccount,
  testIntegrationWebhook,
  updateIntegrations,
  updateCurrentWorkspace,
} from "../lib/api";

type SettingsTab = "workspace" | "whatsapp" | "api" | "integrations" | "billing" | "notifications" | "security";

interface WhatsAppAccount {
  id: string;
  provider: "meta" | "twilio" | "wati";
  displayName: string;
  phoneNumber: string;
  phoneNumberId: string;
  businessAccountId: string;
  providerConfig?: { webhookPath?: string; tenantId?: string; apiBaseUrl?: string };
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
  integrations: IntegrationsPayload;
  roles: { id: string; name: string; permissions: string[] }[];
}

interface IntegrationsPayload {
  outboundWebhook: { enabled: boolean; url: string; secret: string };
  googleSheets: { enabled: boolean; webhookUrl: string; secret: string };
}

interface WhatsAppConsolePayload {
  health: {
    status: string;
    connectedAccounts: number;
    healthyWebhooks: number;
    needsAttention: number;
  };
  messageStats: {
    inbound: number;
    outbound: number;
    sent: number;
    delivered: number;
    failed: number;
  };
  templateStats: {
    total: number;
    approved: number;
    pending: number;
    rejected: number;
  };
  recentMessages: {
    id: string;
    direction: string;
    type: string;
    body: string;
    status: string;
    contact: string;
    phone: string;
    account: string;
    providerMessageId: string;
    time: string;
  }[];
  recentWebhookEvents: {
    id: string;
    eventType: string;
    status: string;
    error: string;
    idempotencyKey: string;
    time: string;
  }[];
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
  integrations: {
    outboundWebhook: { enabled: false, url: "", secret: "" },
    googleSheets: { enabled: false, webhookUrl: "", secret: "" },
  },
  roles: [],
};

const initialConsole: WhatsAppConsolePayload = {
  health: { status: "offline", connectedAccounts: 0, healthyWebhooks: 0, needsAttention: 0 },
  messageStats: { inbound: 0, outbound: 0, sent: 0, delivered: 0, failed: 0 },
  templateStats: { total: 0, approved: 0, pending: 0, rejected: 0 },
  recentMessages: [],
  recentWebhookEvents: [],
};

const webhookCallbackUrl = import.meta.env.VITE_WHATSAPP_WEBHOOK_URL || "http://localhost:4000/webhooks/whatsapp";
const webhookVerifyToken = import.meta.env.VITE_WHATSAPP_VERIFY_TOKEN || "local-whatsapp-verify-token";
const apiBaseUrl = (import.meta.env.VITE_API_URL || "http://localhost:4000/api").replace(/\/api\/?$/, "");

const providerProfiles = {
  meta: {
    label: "Meta Cloud API",
    badge: "Meta",
    callback: `${apiBaseUrl}/webhooks/whatsapp`,
    phoneIdLabel: "Phone number ID",
    businessIdLabel: "Business account ID",
    tokenLabel: "Permanent access token",
    helper: "Use Meta app credentials and the WhatsApp Business Account phone number ID.",
  },
  twilio: {
    label: "Twilio WhatsApp",
    badge: "Twilio",
    callback: `${apiBaseUrl}/webhooks/whatsapp/twilio`,
    phoneIdLabel: "Twilio sender key",
    businessIdLabel: "Account SID",
    tokenLabel: "Auth token",
    helper: "Use the Twilio WhatsApp sender, Account SID, and Auth Token.",
  },
  wati: {
    label: "Wati",
    badge: "Wati",
    callback: `${apiBaseUrl}/webhooks/whatsapp/wati`,
    phoneIdLabel: "Wati channel ID",
    businessIdLabel: "Tenant ID",
    tokenLabel: "Access token",
    helper: "Use your Wati tenant endpoint and API access token.",
  },
} as const;

export function SettingsView() {
  const [activeTab, setActiveTab] = useState<SettingsTab>("workspace");
  const [settings, setSettings] = useState<SettingsPayload>(initialSettings);
  const [whatsappConsole, setWhatsappConsole] = useState<WhatsAppConsolePayload>(initialConsole);
  const [showAccountForm, setShowAccountForm] = useState(false);
  const [saving, setSaving] = useState(false);
  const [workspaceSaving, setWorkspaceSaving] = useState(false);
  const [workspaceForm, setWorkspaceForm] = useState({
    name: "Main Workspace",
    timezone: "Asia/Kolkata",
    businessCategory: "Customer Support",
  });
  const [form, setForm] = useState({
    provider: "meta" as "meta" | "twilio" | "wati",
    displayName: "",
    phoneNumber: "",
    phoneNumberId: "",
    businessAccountId: "",
    accessToken: "",
    accountSid: "",
    authToken: "",
    apiKey: "",
    apiBaseUrl: "",
    tenantId: "",
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
  const [integrationForm, setIntegrationForm] = useState<IntegrationsPayload>(initialSettings.integrations);
  const [integrationSaving, setIntegrationSaving] = useState(false);
  const [integrationNotice, setIntegrationNotice] = useState("");
  const [copiedValue, setCopiedValue] = useState("");
  const [accountTesting, setAccountTesting] = useState("");
  const [accountNotice, setAccountNotice] = useState<Record<string, string>>({});

  async function loadSettings() {
    const [settingsResponse, consoleResponse] = await Promise.all([
      getSettings<SettingsPayload>(),
      getWhatsAppConsole<WhatsAppConsolePayload>(),
    ]);
    setSettings(settingsResponse);
    setWhatsappConsole(consoleResponse);
    setIntegrationForm(settingsResponse.integrations || initialSettings.integrations);
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
      await createWhatsAppAccount<{ data: WhatsAppAccount }>({
        ...form,
        businessAccountId: form.provider === "twilio" ? form.accountSid : form.provider === "wati" ? form.tenantId || form.businessAccountId : form.businessAccountId,
        accessToken: form.provider === "twilio" ? form.authToken : form.provider === "wati" ? form.apiKey : form.accessToken,
      });
      setForm({
        provider: "meta",
        displayName: "",
        phoneNumber: "",
        phoneNumberId: "",
        businessAccountId: "",
        accessToken: "",
        accountSid: "",
        authToken: "",
        apiKey: "",
        apiBaseUrl: "",
        tenantId: "",
      });
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

  async function handleAccountTest(id: string) {
    setAccountTesting(id);
    setAccountNotice((current) => ({ ...current, [id]: "" }));
    try {
      const response = await testWhatsAppAccount<{ result: { message: string }; account: WhatsAppAccount }>(id);
      setSettings((current) => ({
        ...current,
        whatsappAccounts: current.whatsappAccounts.map((account) => (account.id === id ? response.account : account)),
      }));
      setAccountNotice((current) => ({ ...current, [id]: response.result.message || "Connection test passed." }));
      await loadSettings();
    } catch (error) {
      setAccountNotice((current) => ({
        ...current,
        [id]: error instanceof Error ? error.message : "Connection test failed.",
      }));
      await loadSettings().catch(() => undefined);
    } finally {
      setAccountTesting("");
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

  async function handleIntegrationsSave(event: React.FormEvent) {
    event.preventDefault();
    setIntegrationSaving(true);
    setIntegrationNotice("");
    try {
      const response = await updateIntegrations<{ integrations: IntegrationsPayload }>(integrationForm);
      setIntegrationForm(response.integrations);
      setIntegrationNotice("Integrations saved.");
      await loadSettings();
    } catch (error) {
      setIntegrationNotice(error instanceof Error ? error.message : "Integrations could not be saved.");
    } finally {
      setIntegrationSaving(false);
    }
  }

  async function handleWebhookTest() {
    setIntegrationSaving(true);
    setIntegrationNotice("");
    try {
      await testIntegrationWebhook(integrationForm.outboundWebhook);
      setIntegrationNotice("Test webhook delivered.");
    } catch (error) {
      setIntegrationNotice(error instanceof Error ? error.message : "Test webhook failed.");
    } finally {
      setIntegrationSaving(false);
    }
  }

  async function handleCopy(value: string) {
    await navigator.clipboard?.writeText(value).catch(() => undefined);
    setCopiedValue(value);
    window.setTimeout(() => setCopiedValue((current) => (current === value ? "" : current)), 1600);
  }

  const providerProfile = providerProfiles[form.provider];
  const webhookItems = [
    { label: "Meta callback", value: webhookCallbackUrl },
    { label: "Twilio callback", value: providerProfiles.twilio.callback },
    { label: "Wati callback", value: providerProfiles.wati.callback },
  ];

  return (
    <div className="flex-1 flex flex-col overflow-hidden md:flex-row">
      <div className="shrink-0 border-b border-border py-2 md:w-48 md:border-b-0 md:border-r md:py-4">
        <div className="hidden px-4 mb-3 md:block">
          <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">Settings</p>
        </div>
        <nav className="no-scrollbar flex gap-1 overflow-x-auto px-2 md:block md:space-y-0.5">
          {tabs.map((tab) => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`flex shrink-0 items-center gap-2.5 px-2.5 py-2 rounded text-xs transition-colors text-left md:w-full ${
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

      <div className="flex-1 overflow-y-auto p-3 sm:p-4 lg:p-6">
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
                <h2 className="text-foreground">WhatsApp Console</h2>
                <p className="text-xs text-muted-foreground mt-0.5">Monitor account health, delivery, templates, and webhook traffic.</p>
              </div>
              <Button size="sm" className="h-8 text-xs bg-primary text-primary-foreground" onClick={() => setShowAccountForm((value) => !value)}>
                <Plus size={13} className="mr-1.5" />
                Add account
              </Button>
            </div>

            <div className="grid grid-cols-2 xl:grid-cols-4 gap-3">
              {[
                { label: "Connected accounts", value: whatsappConsole.health.connectedAccounts, icon: <MessageCircle size={15} />, tone: "text-primary" },
                { label: "Inbound messages", value: whatsappConsole.messageStats.inbound, icon: <Inbox size={15} />, tone: "text-blue-400" },
                { label: "Outbound messages", value: whatsappConsole.messageStats.outbound, icon: <Send size={15} />, tone: "text-primary" },
                { label: "Failed sends", value: whatsappConsole.messageStats.failed, icon: <AlertCircle size={15} />, tone: whatsappConsole.messageStats.failed ? "text-destructive" : "text-muted-foreground" },
              ].map((item) => (
                <Card key={item.label} className="p-3 bg-card border-border">
                  <div className={`mb-2 ${item.tone}`}>{item.icon}</div>
                  <div className="text-xl font-semibold text-foreground">{item.value.toLocaleString()}</div>
                  <div className="text-[11px] text-muted-foreground mt-0.5">{item.label}</div>
                </Card>
              ))}
            </div>

            <div className="grid grid-cols-1 xl:grid-cols-3 gap-3">
              <Card className="p-4 bg-card border-border">
                <div className="flex items-center justify-between">
                  <div>
                    <h3 className="text-sm font-medium text-foreground">Provider Health</h3>
                    <p className="text-xs text-muted-foreground mt-0.5">{whatsappConsole.health.healthyWebhooks} healthy webhooks</p>
                  </div>
                  <Badge variant="outline" className={`text-[10px] ${whatsappConsole.health.status === "healthy" ? "bg-primary/10 text-primary border-primary/30" : "bg-yellow-500/10 text-yellow-400 border-yellow-500/30"}`}>
                    {whatsappConsole.health.status}
                  </Badge>
                </div>
                <div className="grid grid-cols-2 gap-2 mt-4">
                  <div className="rounded border border-border p-2">
                    <div className="text-sm text-foreground">{whatsappConsole.health.needsAttention}</div>
                    <div className="text-[10px] text-muted-foreground">Needs attention</div>
                  </div>
                  <div className="rounded border border-border p-2">
                    <div className="text-sm text-foreground">{whatsappConsole.messageStats.delivered}</div>
                    <div className="text-[10px] text-muted-foreground">Delivered</div>
                  </div>
                </div>
              </Card>
              <Card className="p-4 bg-card border-border xl:col-span-2">
                <div className="flex items-center justify-between mb-3">
                  <div>
                    <h3 className="text-sm font-medium text-foreground">Template Status</h3>
                    <p className="text-xs text-muted-foreground mt-0.5">Approved templates available for outbound replies.</p>
                  </div>
                  <FileText size={16} className="text-muted-foreground" />
                </div>
                <div className="grid grid-cols-4 gap-2">
                  {[
                    ["Total", whatsappConsole.templateStats.total],
                    ["Approved", whatsappConsole.templateStats.approved],
                    ["Pending", whatsappConsole.templateStats.pending],
                    ["Rejected", whatsappConsole.templateStats.rejected],
                  ].map(([label, value]) => (
                    <div key={label} className="rounded border border-border p-2">
                      <div className="text-sm text-foreground">{Number(value).toLocaleString()}</div>
                      <div className="text-[10px] text-muted-foreground">{label}</div>
                    </div>
                  ))}
                </div>
              </Card>
            </div>

            <Card className="p-4 bg-card border-border">
              <h3 className="text-sm font-medium text-foreground mb-2">Webhook</h3>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                {webhookItems.map((item) => (
                  <div key={item.label}>
                    <p className="text-[10px] uppercase tracking-wider text-muted-foreground mb-1">{item.label}</p>
                    <div className="flex min-w-0 items-center gap-1 rounded bg-secondary px-2 py-2">
                      <code className="min-w-0 flex-1 truncate text-xs text-foreground">{item.value}</code>
                      <button type="button" className="shrink-0 rounded p-1 text-muted-foreground hover:bg-background hover:text-foreground" onClick={() => handleCopy(item.value)} title="Copy">
                        {copiedValue === item.value ? <CheckCircle2 size={13} /> : <Copy size={13} />}
                      </button>
                    </div>
                  </div>
                ))}
              </div>
              <div className="mt-3">
                <p className="text-[10px] uppercase tracking-wider text-muted-foreground mb-1">Meta verify token</p>
                <div className="flex min-w-0 items-center gap-1 rounded bg-secondary px-2 py-2">
                  <code className="min-w-0 flex-1 truncate text-xs text-foreground">{webhookVerifyToken}</code>
                  <button type="button" className="shrink-0 rounded p-1 text-muted-foreground hover:bg-background hover:text-foreground" onClick={() => handleCopy(webhookVerifyToken)} title="Copy">
                    {copiedValue === webhookVerifyToken ? <CheckCircle2 size={13} /> : <Copy size={13} />}
                  </button>
                </div>
              </div>
            </Card>

            <Card className="p-4 bg-card border-border">
              <h3 className="text-sm font-medium text-foreground mb-3">Provider Setup</h3>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                <div>
                  <p className="text-xs font-medium text-foreground">Meta Cloud API</p>
                  <p className="mt-1 text-[11px] text-muted-foreground">Add phone number ID, business account ID, and access token. Use the Meta callback and verify token above.</p>
                </div>
                <div>
                  <p className="text-xs font-medium text-foreground">Twilio WhatsApp</p>
                  <p className="mt-1 text-[11px] text-muted-foreground">Set the incoming message and status callback to the Twilio callback URL, then save sender, SID, and token.</p>
                </div>
                <div>
                  <p className="text-xs font-medium text-foreground">Wati</p>
                  <p className="mt-1 text-[11px] text-muted-foreground">Paste the Wati callback in webhook settings, then save tenant, API endpoint, channel, and access token.</p>
                </div>
              </div>
            </Card>

            {showAccountForm && (
              <form onSubmit={handleCreateAccount} className="space-y-4 rounded-md border border-border bg-card p-4">
                <div className="space-y-1.5 md:col-span-2">
                  <div className="flex items-center gap-2">
                    <span className="flex h-5 w-5 items-center justify-center rounded-full bg-primary text-[10px] font-semibold text-primary-foreground">1</span>
                    <Label>Provider</Label>
                  </div>
                  <div className="grid grid-cols-3 gap-2">
                    {(["meta", "twilio", "wati"] as const).map((provider) => (
                      <button
                        key={provider}
                        type="button"
                        onClick={() => setForm((current) => ({ ...current, provider }))}
                        className={`rounded border px-3 py-2 text-left text-xs transition-colors ${
                          form.provider === provider
                            ? "border-primary bg-primary/10 text-primary"
                            : "border-border bg-secondary text-muted-foreground hover:text-foreground"
                        }`}
                      >
                        <span className="block font-medium">{providerProfiles[provider].label}</span>
                        <span className="mt-0.5 block text-[10px] opacity-80">{providerProfiles[provider].badge}</span>
                      </button>
                    ))}
                  </div>
                  <p className="text-xs text-muted-foreground">{providerProfile.helper}</p>
                </div>

                <div className="space-y-3">
                  <div className="flex items-center gap-2">
                    <span className="flex h-5 w-5 items-center justify-center rounded-full bg-primary text-[10px] font-semibold text-primary-foreground">2</span>
                    <Label>Credentials</Label>
                  </div>
                  <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                    <div className="space-y-1.5">
                      <Label>Display name</Label>
                      <Input value={form.displayName} onChange={(e) => setForm((current) => ({ ...current, displayName: e.target.value }))} required />
                    </div>
                    <div className="space-y-1.5">
                      <Label>{form.provider === "twilio" ? "WhatsApp sender" : "Phone number"}</Label>
                      <Input value={form.phoneNumber} onChange={(e) => setForm((current) => ({ ...current, phoneNumber: e.target.value }))} required />
                    </div>
                    <div className="space-y-1.5">
                      <Label>{providerProfile.phoneIdLabel}</Label>
                      <Input value={form.phoneNumberId} onChange={(e) => setForm((current) => ({ ...current, phoneNumberId: e.target.value }))} required />
                    </div>
                    <div className="space-y-1.5">
                      <Label>{providerProfile.businessIdLabel}</Label>
                      <Input
                        value={form.provider === "twilio" ? form.accountSid : form.provider === "wati" ? form.tenantId : form.businessAccountId}
                        onChange={(e) => setForm((current) => ({
                          ...current,
                          ...(form.provider === "twilio"
                            ? { accountSid: e.target.value, businessAccountId: e.target.value }
                            : form.provider === "wati"
                              ? { tenantId: e.target.value, businessAccountId: e.target.value }
                              : { businessAccountId: e.target.value }),
                        }))}
                        required
                      />
                    </div>
                    <div className="space-y-1.5 md:col-span-2">
                      <Label>{providerProfile.tokenLabel}</Label>
                      <Input
                        value={form.provider === "twilio" ? form.authToken : form.provider === "wati" ? form.apiKey : form.accessToken}
                        onChange={(e) => setForm((current) => ({
                          ...current,
                          ...(form.provider === "twilio"
                            ? { authToken: e.target.value }
                            : form.provider === "wati"
                              ? { apiKey: e.target.value }
                              : { accessToken: e.target.value }),
                        }))}
                        placeholder="Use local-placeholder-token for local testing"
                      />
                    </div>
                    {form.provider === "wati" && (
                      <div className="space-y-1.5 md:col-span-2">
                        <Label>Wati API endpoint</Label>
                        <Input value={form.apiBaseUrl} onChange={(e) => setForm((current) => ({ ...current, apiBaseUrl: e.target.value }))} placeholder="https://live-server.wati.io" />
                      </div>
                    )}
                  </div>
                </div>

                <div className="rounded border border-border bg-secondary px-3 py-2">
                  <p className="text-[10px] uppercase tracking-wider text-muted-foreground mb-1">Webhook callback</p>
                  <div className="flex min-w-0 items-center gap-2">
                    <code className="min-w-0 flex-1 truncate text-xs text-foreground">{providerProfile.callback}</code>
                    <button type="button" className="shrink-0 rounded p-1 text-muted-foreground hover:bg-background hover:text-foreground" onClick={() => handleCopy(providerProfile.callback)} title="Copy">
                      {copiedValue === providerProfile.callback ? <CheckCircle2 size={13} /> : <Copy size={13} />}
                    </button>
                  </div>
                </div>
                <div className="flex gap-2">
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
                        <Badge variant="outline" className="text-[10px] border-border text-muted-foreground">
                          {providerProfiles[account.provider || "meta"]?.badge || account.provider}
                        </Badge>
                        <Badge variant="outline" className="text-[10px] bg-primary/10 text-primary border-primary/30">{account.status}</Badge>
                        <Badge variant="outline" className="text-[10px] border-border text-muted-foreground">webhook {account.webhookStatus}</Badge>
                        <Badge variant="outline" className="text-[10px] border-border text-muted-foreground">templates {account.templateSyncStatus}</Badge>
                      </div>
                      <p className="text-xs text-muted-foreground mt-0.5">{account.phoneNumber}</p>
                      <p className="text-[11px] text-muted-foreground mt-1">Phone ID: {account.phoneNumberId} | Business ID: {account.businessAccountId}</p>
                    </div>
                    <div className="flex gap-1">
                      <Button variant="outline" size="sm" className="h-8 text-xs border-border" onClick={() => handleAccountTest(account.id)} disabled={accountTesting === account.id}>
                        {accountTesting === account.id ? "Testing" : "Test"}
                      </Button>
                      <Button variant="outline" size="sm" className="h-8 text-xs border-border" onClick={() => handleSyncTemplates(account.id)}>
                        <RefreshCw size={12} className="mr-1" />
                        Sync
                      </Button>
                      <Button variant="outline" size="sm" className="h-8 text-xs border-destructive/30 text-destructive" onClick={() => handleDeleteAccount(account.id)}>
                        <Trash2 size={12} />
                      </Button>
                    </div>
                  </div>
                  {accountNotice[account.id] && (
                    <div className={`mt-3 rounded border px-3 py-2 text-xs ${
                      /failed|required|error/i.test(accountNotice[account.id])
                        ? "border-destructive/30 bg-destructive/10 text-destructive"
                        : "border-primary/30 bg-primary/10 text-primary"
                    }`}>
                      {accountNotice[account.id]}
                    </div>
                  )}
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

            <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
              <Card className="bg-card border-border">
                <div className="px-4 py-3 border-b border-border flex items-center justify-between">
                  <h3 className="text-sm font-medium text-foreground">Message Logs</h3>
                  <Activity size={14} className="text-muted-foreground" />
                </div>
                <div className="divide-y divide-border">
                  {whatsappConsole.recentMessages.map((message) => (
                    <div key={message.id} className="px-4 py-3">
                      <div className="flex items-center justify-between gap-3">
                        <div className="min-w-0">
                          <p className="text-sm text-foreground truncate">{message.contact}</p>
                          <p className="text-xs text-muted-foreground truncate">{message.body || message.type}</p>
                        </div>
                        <Badge variant="outline" className="text-[10px] border-border text-muted-foreground shrink-0">
                          {message.direction} / {message.status}
                        </Badge>
                      </div>
                      <p className="text-[10px] text-muted-foreground mt-1">{message.account} - {message.time}</p>
                    </div>
                  ))}
                  {whatsappConsole.recentMessages.length === 0 && (
                    <div className="px-4 py-6 text-sm text-muted-foreground">No WhatsApp messages logged yet.</div>
                  )}
                </div>
              </Card>

              <Card className="bg-card border-border">
                <div className="px-4 py-3 border-b border-border flex items-center justify-between">
                  <h3 className="text-sm font-medium text-foreground">Webhook Events</h3>
                  <Plug size={14} className="text-muted-foreground" />
                </div>
                <div className="divide-y divide-border">
                  {whatsappConsole.recentWebhookEvents.map((event) => (
                    <div key={event.id} className="px-4 py-3">
                      <div className="flex items-center justify-between gap-3">
                        <div className="min-w-0">
                          <p className="text-sm text-foreground">{event.eventType}</p>
                          <p className="text-xs text-muted-foreground truncate">{event.error || event.idempotencyKey}</p>
                        </div>
                        <Badge variant="outline" className={`text-[10px] shrink-0 ${event.status === "processed" ? "bg-primary/10 text-primary border-primary/30" : event.status === "failed" ? "bg-destructive/10 text-destructive border-destructive/30" : "border-border text-muted-foreground"}`}>
                          {event.status}
                        </Badge>
                      </div>
                      <p className="text-[10px] text-muted-foreground mt-1">{event.time}</p>
                    </div>
                  ))}
                  {whatsappConsole.recentWebhookEvents.length === 0 && (
                    <div className="px-4 py-6 text-sm text-muted-foreground">No webhook events received yet.</div>
                  )}
                </div>
              </Card>
            </div>
          </div>
        )}

        {activeTab === "integrations" && (
          <div className="max-w-3xl space-y-6">
            <div>
              <h2 className="text-foreground">Integrations</h2>
              <p className="text-xs text-muted-foreground mt-0.5">Connect outbound webhooks, Zapier-style automations, and lead sync destinations.</p>
            </div>

            <form onSubmit={handleIntegrationsSave} className="space-y-4">
              <Card className="p-4 bg-card border-border space-y-4">
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <h3 className="text-sm font-medium text-foreground">Outbound webhook</h3>
                    <p className="text-xs text-muted-foreground mt-0.5">Used by automation webhook actions when no URL override is provided.</p>
                  </div>
                  <label className="flex items-center gap-2 text-xs text-muted-foreground">
                    <input
                      type="checkbox"
                      checked={integrationForm.outboundWebhook.enabled}
                      onChange={(event) => setIntegrationForm((current) => ({
                        ...current,
                        outboundWebhook: { ...current.outboundWebhook, enabled: event.target.checked },
                      }))}
                    />
                    Enabled
                  </label>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  <div className="space-y-1.5">
                    <Label>Webhook URL</Label>
                    <Input
                      value={integrationForm.outboundWebhook.url}
                      onChange={(event) => setIntegrationForm((current) => ({
                        ...current,
                        outboundWebhook: { ...current.outboundWebhook, url: event.target.value },
                      }))}
                      placeholder="https://hooks.zapier.com/..."
                      className="bg-secondary border-transparent focus:border-border"
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label>Signing secret</Label>
                    <Input
                      value={integrationForm.outboundWebhook.secret}
                      onChange={(event) => setIntegrationForm((current) => ({
                        ...current,
                        outboundWebhook: { ...current.outboundWebhook, secret: event.target.value },
                      }))}
                      placeholder="Optional HMAC secret"
                      className="bg-secondary border-transparent focus:border-border"
                    />
                  </div>
                </div>
                <div className="flex gap-2">
                  <Button type="button" variant="outline" size="sm" className="h-8 text-xs border-border" onClick={handleWebhookTest} disabled={integrationSaving || !integrationForm.outboundWebhook.url}>
                    Test webhook
                  </Button>
                </div>
              </Card>

              <Card className="p-4 bg-card border-border space-y-4">
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <h3 className="text-sm font-medium text-foreground">Google Sheets lead sync</h3>
                    <p className="text-xs text-muted-foreground mt-0.5">Stores the Apps Script webhook target for lead sync workflows.</p>
                  </div>
                  <label className="flex items-center gap-2 text-xs text-muted-foreground">
                    <input
                      type="checkbox"
                      checked={integrationForm.googleSheets.enabled}
                      onChange={(event) => setIntegrationForm((current) => ({
                        ...current,
                        googleSheets: { ...current.googleSheets, enabled: event.target.checked },
                      }))}
                    />
                    Enabled
                  </label>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  <div className="space-y-1.5">
                    <Label>Apps Script webhook URL</Label>
                    <Input
                      value={integrationForm.googleSheets.webhookUrl}
                      onChange={(event) => setIntegrationForm((current) => ({
                        ...current,
                        googleSheets: { ...current.googleSheets, webhookUrl: event.target.value },
                      }))}
                      placeholder="https://script.google.com/macros/s/..."
                      className="bg-secondary border-transparent focus:border-border"
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label>Secret</Label>
                    <Input
                      value={integrationForm.googleSheets.secret}
                      onChange={(event) => setIntegrationForm((current) => ({
                        ...current,
                        googleSheets: { ...current.googleSheets, secret: event.target.value },
                      }))}
                      placeholder="Optional shared secret"
                      className="bg-secondary border-transparent focus:border-border"
                    />
                  </div>
                </div>
              </Card>

              <div className="flex items-center gap-3">
                <Button type="submit" size="sm" className="h-8 text-xs bg-primary text-primary-foreground" disabled={integrationSaving}>
                  {integrationSaving ? "Saving..." : "Save integrations"}
                </Button>
                {integrationNotice && <span className="text-xs text-muted-foreground">{integrationNotice}</span>}
              </div>
            </form>
          </div>
        )}

        {activeTab !== "workspace" && activeTab !== "whatsapp" && activeTab !== "integrations" && (
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

