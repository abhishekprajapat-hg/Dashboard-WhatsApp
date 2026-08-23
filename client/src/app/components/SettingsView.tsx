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
  AlertTriangle,
  Database,
  ExternalLink,
  LockKeyhole,
  Sparkles,
  Megaphone,
  Workflow,
  Instagram,
} from "lucide-react";
import { AdsSettingsPanel } from "./AdsSettingsPanel";
import { WhatsAppFlowsPanel } from "./WhatsAppFlowsPanel";
import { InstagramSettingsPanel } from "./InstagramSettingsPanel";
import { EmbeddedSignupButton } from "./EmbeddedSignupButton";
import {
  createWhatsAppAccount,
  createWhatsAppTemplate,
  deleteWhatsAppAccount,
  getCurrentWorkspace,
  getWhatsAppConsole,
  getSettings,
  syncWhatsAppTemplates,
  testConversionEvent,
  testWhatsAppAccount,
  testIntegrationWebhook,
  updateIntegrations,
  updateNotifications,
  updateCurrentWorkspace,
} from "../lib/api";

type SettingsTab = "workspace" | "whatsapp" | "flows" | "instagram" | "ads" | "api" | "integrations" | "billing" | "notifications" | "security";

interface WhatsAppAccount {
  id: string;
  provider: "meta" | "twilio" | "wati";
  displayName: string;
  phoneNumber: string;
  phoneNumberId: string;
  businessAccountId: string;
  conversionsDatasetId?: string;
  catalogId?: string;
  providerConfig?: { webhookPath?: string; tenantId?: string; apiBaseUrl?: string };
  status: "connected" | "disconnected" | "needs_attention";
  webhookStatus: string;
  templateSyncStatus: string;
  credentials?: {
    accessTokenConfigured?: boolean;
    verifyTokenConfigured?: boolean;
    appSecretConfigured?: boolean;
    credentialsUpdatedAt?: string | null;
    lastTestedAt?: string | null;
    lastError?: string;
  };
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
  notifications: NotificationsPayload;
  roles: { id: string; name: string; permissions: string[] }[];
}

interface NotificationsPayload {
  enabled: boolean;
  recipientEmail: string;
  events: { whatsappNeedsAttention: boolean; adsNeedsAttention: boolean };
}

interface AiProviderConfig {
  enabled: boolean;
  apiKey: string;
}

interface IntegrationsPayload {
  outboundWebhook: { enabled: boolean; url: string; secret: string };
  googleSheets: { enabled: boolean; webhookUrl: string; secret: string };
  aiProviders: { openai: AiProviderConfig; claude: AiProviderConfig; gemini: AiProviderConfig };
  email: { enabled: boolean; apiKey: string; fromAddress: string; fromName: string };
  sms: { enabled: boolean; accountSid: string; authToken: string; fromNumber: string };
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
  { id: "flows", label: "Flows", icon: <Workflow size={14} /> },
  { id: "instagram", label: "Instagram", icon: <Instagram size={14} /> },
  { id: "ads", label: "Ads", icon: <Megaphone size={14} /> },
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
    aiProviders: {
      openai: { enabled: false, apiKey: "" },
      claude: { enabled: false, apiKey: "" },
      gemini: { enabled: false, apiKey: "" },
    },
    email: { enabled: false, apiKey: "", fromAddress: "", fromName: "" },
    sms: { enabled: false, accountSid: "", authToken: "", fromNumber: "" },
  },
  notifications: {
    enabled: false,
    recipientEmail: "",
    events: { whatsappNeedsAttention: true, adsNeedsAttention: true },
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

const cardClass = "rounded-lg border-border bg-card/90 shadow-xl shadow-black/5";
const fieldClass = "bg-background/80 border-border shadow-inner shadow-black/10 focus:border-primary/50 focus:ring-2 focus:ring-primary/20";

function statusBadgeClass(status = "") {
  if (status === "connected" || status === "healthy" || status === "processed" || status === "synced") return "border-primary/30 bg-primary/10 text-primary";
  if (status === "needs_attention" || status === "pending" || status === "syncing") return "border-yellow-500/30 bg-yellow-500/10 text-yellow-300";
  if (status === "disconnected" || status === "failed" || status === "error") return "border-destructive/30 bg-destructive/10 text-destructive";
  return "border-border bg-secondary text-muted-foreground";
}

function statusDotClass(status = "") {
  if (status === "connected" || status === "healthy" || status === "processed") return "bg-primary shadow-[0_0_14px_rgba(34,197,94,0.45)]";
  if (status === "needs_attention" || status === "pending") return "bg-yellow-400 shadow-[0_0_14px_rgba(250,204,21,0.35)]";
  return "bg-destructive";
}

function maskSecret(value?: string) {
  return value ? "••••••••••••" : "Not configured";
}

const aiProviderMeta: { id: "openai" | "claude" | "gemini"; label: string; placeholder: string }[] = [
  { id: "openai", label: "OpenAI", placeholder: "sk-..." },
  { id: "claude", label: "Claude (Anthropic)", placeholder: "sk-ant-..." },
  { id: "gemini", label: "Gemini (Google)", placeholder: "AIza..." },
];

interface SettingsViewProps {
  canWrite?: boolean;
}

export function SettingsView({ canWrite = false }: SettingsViewProps) {
  const [activeTab, setActiveTab] = useState<SettingsTab>("workspace");
  const [settings, setSettings] = useState<SettingsPayload>(initialSettings);
  const [whatsappConsole, setWhatsappConsole] = useState<WhatsAppConsolePayload>(initialConsole);
  const [showAccountForm, setShowAccountForm] = useState(false);
  const [loading, setLoading] = useState(true);
  const [settingsNotice, setSettingsNotice] = useState("");
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
    verifyToken: "",
    appSecret: "",
    conversionsDatasetId: "",
    conversionsTestEventCode: "",
    catalogId: "",
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
  const [notificationsForm, setNotificationsForm] = useState<NotificationsPayload>(initialSettings.notifications);
  const [notificationsSaving, setNotificationsSaving] = useState(false);
  const [notificationsNotice, setNotificationsNotice] = useState("");
  const [copiedValue, setCopiedValue] = useState("");
  const [accountTesting, setAccountTesting] = useState("");
  const [conversionTesting, setConversionTesting] = useState("");
  const [accountNotice, setAccountNotice] = useState<Record<string, string>>({});
  const [embeddedSignupPin, setEmbeddedSignupPin] = useState("");

  async function handleEmbeddedSignupConnected({ pin }: { accountId: string; pin: string }) {
    setEmbeddedSignupPin(pin);
    await loadSettings();
  }

  async function loadSettings() {
    setLoading(true);
    setSettingsNotice("");
    try {
      const [settingsResponse, consoleResponse] = await Promise.all([
        getSettings<SettingsPayload>(),
        getWhatsAppConsole<WhatsAppConsolePayload>(),
      ]);
      setSettings(settingsResponse);
      setWhatsappConsole(consoleResponse);
      setIntegrationForm(settingsResponse.integrations || initialSettings.integrations);
      setNotificationsForm(settingsResponse.notifications || initialSettings.notifications);
    } catch (error) {
      setSettingsNotice(error instanceof Error ? error.message : "Settings could not be loaded.");
      setSettings(initialSettings);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadSettings().catch(() => undefined);
    getCurrentWorkspace<{ workspace: { name: string; timezone: string } }>()
      .then((response) => setWorkspaceForm((current) => ({ ...current, name: response.workspace.name, timezone: response.workspace.timezone })))
      .catch(() => undefined);
  }, []);

  async function handleWorkspaceSave(event: React.FormEvent) {
    event.preventDefault();
    if (!canWrite) return;
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
    if (!canWrite) return;
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
        verifyToken: "",
        appSecret: "",
        conversionsDatasetId: "",
        conversionsTestEventCode: "",
        catalogId: "",
      });
      setShowAccountForm(false);
      await loadSettings();
    } finally {
      setSaving(false);
    }
  }

  async function handleDeleteAccount(id: string) {
    if (!canWrite) return;
    setSettings((current) => ({
      ...current,
      whatsappAccounts: current.whatsappAccounts.filter((account) => account.id !== id),
      templates: current.templates.filter((template) => template.id !== id),
    }));
    await deleteWhatsAppAccount(id).catch(() => undefined);
    await loadSettings().catch(() => undefined);
  }

  async function handleSyncTemplates(id: string) {
    if (!canWrite) return;
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
    if (!canWrite) return;
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

  async function handleTestConversionEvent(id: string) {
    if (!canWrite) return;
    setConversionTesting(id);
    setAccountNotice((current) => ({ ...current, [id]: "" }));
    try {
      const response = await testConversionEvent<{ result: { eventsReceived?: number; skipped?: boolean } }>(id);
      setAccountNotice((current) => ({
        ...current,
        [id]: response.result.skipped
          ? "Skipped - dataset or credentials not fully configured."
          : `Sent. Meta reported ${response.result.eventsReceived ?? 0} event(s) received - check Events Manager's Test Events tab.`,
      }));
    } catch (error) {
      setAccountNotice((current) => ({
        ...current,
        [id]: error instanceof Error ? error.message : "Test conversion event failed.",
      }));
    } finally {
      setConversionTesting("");
    }
  }

  async function handleCreateTemplate(event: React.FormEvent) {
    event.preventDefault();
    if (!canWrite) return;
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
    if (!canWrite) return;
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
    if (!canWrite) return;
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

  async function handleNotificationsSave(event: React.FormEvent) {
    event.preventDefault();
    if (!canWrite) return;
    setNotificationsSaving(true);
    setNotificationsNotice("");
    try {
      const response = await updateNotifications<{ notifications: NotificationsPayload }>(notificationsForm);
      setNotificationsForm(response.notifications);
      setNotificationsNotice("Notification preferences saved.");
    } catch (error) {
      setNotificationsNotice(error instanceof Error ? error.message : "Notification preferences could not be saved.");
    } finally {
      setNotificationsSaving(false);
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
    <div className="flex w-full min-w-0 flex-1 flex-col overflow-x-hidden overflow-y-visible bg-[radial-gradient(circle_at_top_left,rgba(34,197,94,0.08),transparent_32%),linear-gradient(135deg,rgba(15,23,42,0.45),rgba(2,6,23,0.1))] md:flex-row">
      <div className="shrink-0 border-b border-border bg-card/70 py-2 md:w-56 md:border-b-0 md:border-r md:py-4">
        <div className="hidden px-4 mb-3 md:block">
          <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">Settings</p>
          <p className="mt-1 text-[11px] text-muted-foreground">Workspace, WhatsApp, integrations, and security controls.</p>
        </div>
        <nav className="no-scrollbar flex gap-1 overflow-x-auto px-2 md:block md:space-y-0.5">
          {tabs.map((tab) => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`flex shrink-0 items-center gap-2.5 px-2.5 py-2 rounded-md text-xs transition-colors text-left md:w-full ${
                activeTab === tab.id
                  ? "bg-primary/10 text-primary shadow-[inset_0_0_0_1px_rgba(34,197,94,0.16)]"
                  : "text-muted-foreground hover:text-foreground hover:bg-secondary/80"
              }`}
            >
              {tab.icon}
              {tab.label}
            </button>
          ))}
        </nav>
      </div>

      <div className="min-w-0 flex-1 overflow-x-hidden overflow-y-auto p-3 sm:p-4 lg:p-6">
        {settingsNotice && (
          <div className="mb-4 rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs text-destructive">
            <AlertTriangle size={13} className="mr-1 inline" /> {settingsNotice}
          </div>
        )}
        {activeTab === "workspace" && (
          <div className="max-w-2xl space-y-6">
            <div className="rounded-lg border border-border bg-card/80 p-4">
              <Badge variant="outline" className="border-primary/30 bg-primary/10 text-primary">Workspace</Badge>
              <h2 className="mt-2 text-foreground">Workspace Settings</h2>
              <p className="text-xs text-muted-foreground mt-0.5">Manage organization profile and operating defaults.</p>
            </div>
            <form onSubmit={handleWorkspaceSave}>
            <Card className={`p-4 ${cardClass} space-y-4`}>
              <div className="space-y-1.5">
                <Label>Workspace name</Label>
                <Input value={workspaceForm.name} onChange={(e) => setWorkspaceForm((current) => ({ ...current, name: e.target.value }))} className={fieldClass} />
              </div>
              <div className="space-y-1.5">
                <Label>Timezone</Label>
                <Input value={workspaceForm.timezone} onChange={(e) => setWorkspaceForm((current) => ({ ...current, timezone: e.target.value }))} className={fieldClass} />
              </div>
              {canWrite && <Button type="submit" size="sm" className="h-8 text-xs bg-primary text-primary-foreground hover:bg-primary/90" disabled={workspaceSaving}>
                {workspaceSaving ? "Saving..." : "Save changes"}
              </Button>}
            </Card>
            </form>
          </div>
        )}

        {activeTab === "whatsapp" && (
          <div className="max-w-5xl space-y-6">
            <div className="flex flex-col gap-4 rounded-lg border border-border bg-card/80 p-4 sm:flex-row sm:items-start sm:justify-between">
              <div>
                <Badge variant="outline" className={statusBadgeClass(whatsappConsole.health.status)}>{whatsappConsole.health.status}</Badge>
                <h2 className="text-foreground">WhatsApp Console</h2>
                <p className="text-xs text-muted-foreground mt-0.5">Monitor account health, delivery, templates, and webhook traffic.</p>
              </div>
              {canWrite && <Button size="sm" className="h-8 text-xs bg-primary text-primary-foreground" onClick={() => setShowAccountForm((value) => !value)}>
                <Plus size={13} className="mr-1.5" />
                Add account
              </Button>}
            </div>

            {canWrite && embeddedSignupPin && (
              <Card className={`p-4 border-primary/40 bg-primary/5 ${cardClass}`}>
                <p className="text-sm font-medium text-foreground">Account connected - save this two-step verification PIN now</p>
                <p className="text-xs text-muted-foreground mt-1">
                  This is the number&apos;s new WhatsApp two-step verification PIN. It won&apos;t be shown again - store it somewhere safe.
                </p>
                <div className="mt-2 flex items-center gap-2">
                  <code className="rounded-md border border-border bg-background/80 px-3 py-1.5 text-sm font-semibold tracking-widest text-foreground">{embeddedSignupPin}</code>
                  <Button type="button" size="sm" variant="outline" className="h-8 text-xs border-border" onClick={() => setEmbeddedSignupPin("")}>Dismiss</Button>
                </div>
              </Card>
            )}

            {canWrite && <EmbeddedSignupButton onConnected={handleEmbeddedSignupConnected} />}

            <div className="grid grid-cols-1 gap-3 min-[380px]:grid-cols-2 xl:grid-cols-4">
              {[
                { label: "Connected accounts", value: whatsappConsole.health.connectedAccounts, icon: <MessageCircle size={15} />, tone: "text-primary" },
                { label: "Inbound messages", value: whatsappConsole.messageStats.inbound, icon: <Inbox size={15} />, tone: "text-blue-400" },
                { label: "Outbound messages", value: whatsappConsole.messageStats.outbound, icon: <Send size={15} />, tone: "text-primary" },
                { label: "Failed sends", value: whatsappConsole.messageStats.failed, icon: <AlertCircle size={15} />, tone: whatsappConsole.messageStats.failed ? "text-destructive" : "text-muted-foreground" },
              ].map((item) => (
                <Card key={item.label} className={`p-3 ${cardClass}`}>
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <div className="text-xl font-semibold text-foreground">{item.value.toLocaleString()}</div>
                      <div className="text-[11px] text-muted-foreground mt-0.5">{item.label}</div>
                    </div>
                    <div className={`flex h-9 w-9 items-center justify-center rounded-md border border-white/10 bg-background/70 ${item.tone}`}>{item.icon}</div>
                  </div>
                </Card>
              ))}
            </div>

            <div className="grid grid-cols-1 xl:grid-cols-3 gap-3">
              <Card className={`p-4 ${cardClass}`}>
                <div className="flex items-center justify-between">
                  <div>
                    <h3 className="text-sm font-medium text-foreground">Provider Health</h3>
                    <p className="text-xs text-muted-foreground mt-0.5">{whatsappConsole.health.healthyWebhooks} healthy webhooks</p>
                  </div>
                  <Badge variant="outline" className={`text-[10px] ${statusBadgeClass(whatsappConsole.health.status)}`}>
                    {whatsappConsole.health.status}
                  </Badge>
                </div>
                <div className="mt-4 grid grid-cols-1 gap-2 min-[380px]:grid-cols-2">
                    <div className="rounded border border-border bg-background/60 p-2">
                    <div className="text-sm text-foreground">{whatsappConsole.health.needsAttention}</div>
                    <div className="text-[10px] text-muted-foreground">Needs attention</div>
                  </div>
                    <div className="rounded border border-border bg-background/60 p-2">
                    <div className="text-sm text-foreground">{whatsappConsole.messageStats.delivered}</div>
                    <div className="text-[10px] text-muted-foreground">Delivered</div>
                  </div>
                </div>
              </Card>
              <Card className={`p-4 ${cardClass} xl:col-span-2`}>
                <div className="flex items-center justify-between mb-3">
                  <div>
                    <h3 className="text-sm font-medium text-foreground">Template Status</h3>
                    <p className="text-xs text-muted-foreground mt-0.5">Approved templates available for outbound replies.</p>
                  </div>
                  <FileText size={16} className="text-muted-foreground" />
                </div>
                <div className="grid grid-cols-2 gap-2 lg:grid-cols-4">
                  {[
                    ["Total", whatsappConsole.templateStats.total],
                    ["Approved", whatsappConsole.templateStats.approved],
                    ["Pending", whatsappConsole.templateStats.pending],
                    ["Rejected", whatsappConsole.templateStats.rejected],
                  ].map(([label, value]) => (
                    <div key={label} className="rounded border border-border bg-background/60 p-2">
                      <div className="text-sm text-foreground">{Number(value).toLocaleString()}</div>
                      <div className="text-[10px] text-muted-foreground">{label}</div>
                    </div>
                  ))}
                </div>
              </Card>
            </div>

            <Card className={`p-4 ${cardClass}`}>
              <h3 className="text-sm font-medium text-foreground mb-2">Webhook</h3>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                {webhookItems.map((item) => (
                  <div key={item.label}>
                    <p className="text-[10px] uppercase tracking-wider text-muted-foreground mb-1">{item.label}</p>
                    <div className="flex min-w-0 items-center gap-1 rounded-md border border-border bg-background/70 px-2 py-2">
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
                <div className="flex min-w-0 items-center gap-1 rounded-md border border-border bg-background/70 px-2 py-2">
                  <code className="min-w-0 flex-1 truncate text-xs text-foreground">{maskSecret(webhookVerifyToken)}</code>
                  <button type="button" className="shrink-0 rounded p-1 text-muted-foreground hover:bg-background hover:text-foreground" onClick={() => handleCopy(webhookVerifyToken)} title="Copy">
                    {copiedValue === webhookVerifyToken ? <CheckCircle2 size={13} /> : <Copy size={13} />}
                  </button>
                </div>
              </div>
            </Card>

            <Card className={`p-4 ${cardClass}`}>
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

            {canWrite && showAccountForm && (
              <form onSubmit={handleCreateAccount} className={`space-y-4 ${cardClass} p-4`}>
                <div className="space-y-1.5 md:col-span-2">
                  <div className="flex items-center gap-2">
                    <span className="flex h-5 w-5 items-center justify-center rounded-full bg-primary text-[10px] font-semibold text-primary-foreground">1</span>
                    <Label>Provider</Label>
                  </div>
                  <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
                    {(["meta", "twilio", "wati"] as const).map((provider) => (
                      <button
                        key={provider}
                        type="button"
                        onClick={() => setForm((current) => ({ ...current, provider }))}
                        className={`rounded border px-3 py-2 text-left text-xs transition-colors ${
                          form.provider === provider
                            ? "border-primary bg-primary/10 text-primary"
                            : "border-border bg-background/70 text-muted-foreground hover:text-foreground"
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
                      <Input value={form.displayName} onChange={(e) => setForm((current) => ({ ...current, displayName: e.target.value }))} required className={fieldClass} />
                    </div>
                    <div className="space-y-1.5">
                      <Label>{form.provider === "twilio" ? "WhatsApp sender" : "Phone number"}</Label>
                      <Input value={form.phoneNumber} onChange={(e) => setForm((current) => ({ ...current, phoneNumber: e.target.value }))} required className={fieldClass} />
                    </div>
                    <div className="space-y-1.5">
                      <Label>{providerProfile.phoneIdLabel}</Label>
                      <Input value={form.phoneNumberId} onChange={(e) => setForm((current) => ({ ...current, phoneNumberId: e.target.value }))} required className={fieldClass} />
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
                        className={fieldClass}
                      />
                    </div>
                    <div className="space-y-1.5 md:col-span-2">
                      <Label>{providerProfile.tokenLabel}</Label>
                      <Input
                        type={form.provider === "meta" ? "password" : "text"}
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
                        className={fieldClass}
                      />
                    </div>
                    {form.provider === "meta" && (
                      <>
                        <div className="space-y-1.5">
                          <Label>Webhook verify token</Label>
                          <Input
                            type="password"
                            value={form.verifyToken}
                            onChange={(e) => setForm((current) => ({ ...current, verifyToken: e.target.value }))}
                            placeholder="Must match Meta webhook setup"
                            className={fieldClass}
                          />
                        </div>
                        <div className="space-y-1.5">
                          <Label>App secret</Label>
                          <Input
                            type="password"
                            value={form.appSecret}
                            onChange={(e) => setForm((current) => ({ ...current, appSecret: e.target.value }))}
                            placeholder="Optional, used for signature checks"
                            className={fieldClass}
                          />
                        </div>
                        <div className="space-y-1.5">
                          <Label>Conversions Dataset ID</Label>
                          <Input
                            value={form.conversionsDatasetId}
                            onChange={(e) => setForm((current) => ({ ...current, conversionsDatasetId: e.target.value }))}
                            placeholder="Optional - from Meta Events Manager"
                            className={fieldClass}
                          />
                        </div>
                        <div className="space-y-1.5">
                          <Label>Conversions test event code</Label>
                          <Input
                            value={form.conversionsTestEventCode}
                            onChange={(e) => setForm((current) => ({ ...current, conversionsTestEventCode: e.target.value }))}
                            placeholder="Optional - from the dataset's Test Events tab"
                            className={fieldClass}
                          />
                        </div>
                        <div className="space-y-1.5">
                          <Label>Catalog ID</Label>
                          <Input
                            value={form.catalogId}
                            onChange={(e) => setForm((current) => ({ ...current, catalogId: e.target.value }))}
                            placeholder="Optional - from Meta Commerce Manager, needed to send products"
                            className={fieldClass}
                          />
                        </div>
                      </>
                    )}
                    {form.provider === "wati" && (
                      <div className="space-y-1.5 md:col-span-2">
                        <Label>Wati API endpoint</Label>
                        <Input value={form.apiBaseUrl} onChange={(e) => setForm((current) => ({ ...current, apiBaseUrl: e.target.value }))} placeholder="https://live-server.wati.io" className={fieldClass} />
                      </div>
                    )}
                  </div>
                </div>

                <div className="rounded-md border border-border bg-background/70 px-3 py-2">
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
                <div className="rounded-md border border-yellow-500/25 bg-yellow-500/10 px-3 py-2 text-[11px] text-yellow-200">
                  Secrets are masked after saving and are never shown again in this UI. Replace a token by entering a new value.
                </div>
              </form>
            )}

            <div className="space-y-3">
              {settings.whatsappAccounts.length === 0 && (
                <Card className={`p-4 ${cardClass}`}>
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
                <Card key={account.id} className={`overflow-hidden ${cardClass}`}>
                  <div className={`h-1 ${account.status === "connected" ? "bg-gradient-to-r from-primary/80 to-emerald-300/40" : account.status === "needs_attention" ? "bg-gradient-to-r from-yellow-400/80 to-orange-300/40" : "bg-gradient-to-r from-destructive/80 to-red-300/40"}`} />
                  <div className="p-4">
                  <div className="flex items-start gap-3">
                    <div className="w-10 h-10 rounded-md border border-primary/25 bg-primary/10 flex items-center justify-center shrink-0">
                      <MessageCircle size={18} className="text-primary" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="text-sm font-medium text-foreground">{account.displayName}</span>
                        <Badge variant="outline" className="text-[10px] border-border text-muted-foreground">
                          {providerProfiles[account.provider || "meta"]?.badge || account.provider}
                        </Badge>
                        <span className={`h-2 w-2 rounded-full ${statusDotClass(account.status)}`} />
                        <Badge variant="outline" className={`text-[10px] ${statusBadgeClass(account.status)}`}>{account.status.replace("_", " ")}</Badge>
                        <Badge variant="outline" className={`text-[10px] ${statusBadgeClass(account.webhookStatus)}`}>webhook {account.webhookStatus}</Badge>
                        <Badge variant="outline" className={`text-[10px] ${statusBadgeClass(account.templateSyncStatus)}`}>templates {account.templateSyncStatus}</Badge>
                        <Badge variant="outline" className={`text-[10px] ${account.credentials?.accessTokenConfigured ? "border-primary/30 text-primary" : "border-yellow-500/30 text-yellow-400"}`}>
                          token {account.credentials?.accessTokenConfigured ? "saved" : "missing"}
                        </Badge>
                        {account.provider === "meta" && (
                          <>
                            <Badge variant="outline" className={`text-[10px] ${account.credentials?.verifyTokenConfigured ? "border-primary/30 text-primary" : "border-yellow-500/30 text-yellow-400"}`}>
                              verify {account.credentials?.verifyTokenConfigured ? "saved" : "missing"}
                            </Badge>
                            <Badge variant="outline" className={`text-[10px] ${account.credentials?.appSecretConfigured ? "border-primary/30 text-primary" : "border-border text-muted-foreground"}`}>
                              signature {account.credentials?.appSecretConfigured ? "on" : "off"}
                            </Badge>
                          </>
                        )}
                      </div>
                      <p className="text-xs text-muted-foreground mt-0.5">{account.phoneNumber}</p>
                      <div className="mt-3 grid gap-2 text-[11px] text-muted-foreground md:grid-cols-3">
                        <div className="rounded-md border border-border bg-background/60 p-2"><span className="block truncate text-foreground">{account.phoneNumberId || "-"}</span>Phone ID</div>
                        <div className="rounded-md border border-border bg-background/60 p-2"><span className="block truncate text-foreground">{account.businessAccountId || "-"}</span>Business ID</div>
                        <div className="rounded-md border border-border bg-background/60 p-2"><span className="block text-foreground">{maskSecret(account.credentials?.accessTokenConfigured ? "configured" : "")}</span>Access token</div>
                      </div>
                      {account.credentials?.lastTestedAt && (
                        <p className="text-[11px] text-muted-foreground mt-1">Last tested: {new Date(account.credentials.lastTestedAt).toLocaleString()}</p>
                      )}
                      {account.credentials?.lastError && (
                        <p className="text-[11px] text-destructive mt-1">{account.credentials.lastError}</p>
                      )}
                    </div>
                    {canWrite && <div className="flex gap-1">
                      <Button variant="outline" size="sm" className="h-8 text-xs border-border" onClick={() => handleAccountTest(account.id)} disabled={accountTesting === account.id}>
                        {accountTesting === account.id ? "Testing" : "Test"}
                      </Button>
                      <Button variant="outline" size="sm" className="h-8 text-xs border-border" onClick={() => handleSyncTemplates(account.id)}>
                        <RefreshCw size={12} className="mr-1" />
                        Sync
                      </Button>
                      {account.conversionsDatasetId && (
                        <Button variant="outline" size="sm" className="h-8 text-xs border-border" onClick={() => handleTestConversionEvent(account.id)} disabled={conversionTesting === account.id}>
                          {conversionTesting === account.id ? "Sending" : "Send test conversion event"}
                        </Button>
                      )}
                      <Button variant="outline" size="sm" className="h-8 text-xs border-destructive/30 text-destructive" onClick={() => handleDeleteAccount(account.id)}>
                        <Trash2 size={12} />
                      </Button>
                    </div>}
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
                  </div>
                </Card>
              ))}
            </div>

            <Card className="bg-card border-border">
              <div className="px-4 py-3 border-b border-border flex items-center justify-between">
                <h3 className="text-sm font-medium text-foreground">Templates</h3>
                <span className="text-xs text-muted-foreground">{settings.templates.length} total</span>
              </div>
              {canWrite && <form onSubmit={handleCreateTemplate} className="grid grid-cols-1 gap-3 border-b border-border p-4 sm:grid-cols-2 lg:grid-cols-4">
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
              </form>}
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

        {activeTab === "flows" && (
          <div className="max-w-4xl">
            <WhatsAppFlowsPanel />
          </div>
        )}

        {activeTab === "instagram" && (
          <div className="max-w-4xl">
            <InstagramSettingsPanel />
          </div>
        )}

        {activeTab === "ads" && (
          <div className="max-w-4xl">
            <AdsSettingsPanel />
          </div>
        )}

        {activeTab === "integrations" && (
          <div className="max-w-4xl space-y-6">
            <div className="rounded-lg border border-border bg-card/80 p-4">
              <Badge variant="outline" className="border-primary/30 bg-primary/10 text-primary">Integrations</Badge>
              <h2 className="text-foreground">Integrations</h2>
              <p className="text-xs text-muted-foreground mt-0.5">Connect outbound webhooks, Zapier-style automations, and lead sync destinations.</p>
            </div>

            <form onSubmit={handleIntegrationsSave} className="space-y-4">
              <Card className={`p-4 ${cardClass} space-y-4`}>
                <div className="flex items-start justify-between gap-4">
                  <div className="flex items-start gap-3">
                    <span className="flex h-9 w-9 items-center justify-center rounded-md border border-blue-500/25 bg-blue-500/10 text-blue-300"><ExternalLink size={16} /></span>
                    <div>
                    <h3 className="text-sm font-medium text-foreground">Outbound webhook</h3>
                    <p className="text-xs text-muted-foreground mt-0.5">Used by automation webhook actions when no URL override is provided.</p>
                    </div>
                  </div>
                  <label className="flex items-center gap-2 text-xs text-muted-foreground">
                    <input
                      type="checkbox"
                      checked={integrationForm.outboundWebhook.enabled}
                      disabled={!canWrite}
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
                      className={fieldClass}
                      disabled={!canWrite}
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
                      className={fieldClass}
                      type="password"
                      disabled={!canWrite}
                    />
                  </div>
                </div>
                <div className="flex gap-2">
                  {canWrite && <Button type="button" variant="outline" size="sm" className="h-8 text-xs border-border" onClick={handleWebhookTest} disabled={integrationSaving || !integrationForm.outboundWebhook.url}>
                    Test webhook
                  </Button>}
                  <span className="self-center text-[11px] text-muted-foreground">Secret: {maskSecret(integrationForm.outboundWebhook.secret)}</span>
                </div>
              </Card>

              <Card className={`p-4 ${cardClass} space-y-4`}>
                <div className="flex items-start justify-between gap-4">
                  <div className="flex items-start gap-3">
                    <span className="flex h-9 w-9 items-center justify-center rounded-md border border-primary/25 bg-primary/10 text-primary"><Database size={16} /></span>
                    <div>
                    <h3 className="text-sm font-medium text-foreground">Google Sheets lead sync</h3>
                    <p className="text-xs text-muted-foreground mt-0.5">Stores the Apps Script webhook target for lead sync workflows.</p>
                    </div>
                  </div>
                  <label className="flex items-center gap-2 text-xs text-muted-foreground">
                    <input
                      type="checkbox"
                      checked={integrationForm.googleSheets.enabled}
                      disabled={!canWrite}
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
                      className={fieldClass}
                      disabled={!canWrite}
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
                      className={fieldClass}
                      type="password"
                      disabled={!canWrite}
                    />
                  </div>
                </div>
              </Card>

              <Card className={`p-4 ${cardClass} space-y-4`}>
                <div className="flex items-start gap-3">
                  <span className="flex h-9 w-9 items-center justify-center rounded-md border border-purple-500/25 bg-purple-500/10 text-purple-300"><Sparkles size={16} /></span>
                  <div>
                    <h3 className="text-sm font-medium text-foreground">AI providers</h3>
                    <p className="text-xs text-muted-foreground mt-0.5">API keys used by the automation OpenAI/Claude/Gemini nodes - read from workspace settings, never stored in flow config.</p>
                  </div>
                </div>
                <div className="space-y-3">
                  {aiProviderMeta.map((provider) => (
                    <div key={provider.id} className="space-y-2 rounded-md border border-border/70 bg-background/60 p-3">
                      <div className="flex items-center justify-between gap-3">
                        <span className="text-xs font-medium text-foreground">{provider.label}</span>
                        <label className="flex items-center gap-2 text-xs text-muted-foreground">
                          <input
                            type="checkbox"
                            checked={integrationForm.aiProviders[provider.id].enabled}
                            disabled={!canWrite}
                            onChange={(event) => setIntegrationForm((current) => ({
                              ...current,
                              aiProviders: {
                                ...current.aiProviders,
                                [provider.id]: { ...current.aiProviders[provider.id], enabled: event.target.checked },
                              },
                            }))}
                          />
                          Enabled
                        </label>
                      </div>
                      <div className="flex items-center gap-2">
                        <Input
                          value={integrationForm.aiProviders[provider.id].apiKey}
                          onChange={(event) => setIntegrationForm((current) => ({
                            ...current,
                            aiProviders: {
                              ...current.aiProviders,
                              [provider.id]: { ...current.aiProviders[provider.id], apiKey: event.target.value },
                            },
                          }))}
                          placeholder={provider.placeholder}
                          className={fieldClass}
                          type="password"
                          disabled={!canWrite}
                        />
                        <span className="shrink-0 text-[11px] text-muted-foreground">{maskSecret(integrationForm.aiProviders[provider.id].apiKey)}</span>
                      </div>
                    </div>
                  ))}
                </div>
              </Card>

              <Card className={`p-4 ${cardClass} space-y-4`}>
                <div className="flex items-start justify-between gap-4">
                  <div className="flex items-start gap-3">
                    <span className="flex h-9 w-9 items-center justify-center rounded-md border border-sky-500/25 bg-sky-500/10 text-sky-300"><Send size={16} /></span>
                    <div>
                      <h3 className="text-sm font-medium text-foreground">Email (SendGrid)</h3>
                      <p className="text-xs text-muted-foreground mt-0.5">Used by the automation email node to reply outside WhatsApp.</p>
                    </div>
                  </div>
                  <label className="flex items-center gap-2 text-xs text-muted-foreground">
                    <input
                      type="checkbox"
                      checked={integrationForm.email.enabled}
                      disabled={!canWrite}
                      onChange={(event) => setIntegrationForm((current) => ({
                        ...current,
                        email: { ...current.email, enabled: event.target.checked },
                      }))}
                    />
                    Enabled
                  </label>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  <div className="space-y-1.5">
                    <Label>From address</Label>
                    <Input
                      value={integrationForm.email.fromAddress}
                      onChange={(event) => setIntegrationForm((current) => ({
                        ...current,
                        email: { ...current.email, fromAddress: event.target.value },
                      }))}
                      placeholder="notifications@yourdomain.com"
                      className={fieldClass}
                      disabled={!canWrite}
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label>From name (optional)</Label>
                    <Input
                      value={integrationForm.email.fromName}
                      onChange={(event) => setIntegrationForm((current) => ({
                        ...current,
                        email: { ...current.email, fromName: event.target.value },
                      }))}
                      placeholder="Your Company"
                      className={fieldClass}
                      disabled={!canWrite}
                    />
                  </div>
                  <div className="space-y-1.5 md:col-span-2">
                    <Label>API key</Label>
                    <Input
                      value={integrationForm.email.apiKey}
                      onChange={(event) => setIntegrationForm((current) => ({
                        ...current,
                        email: { ...current.email, apiKey: event.target.value },
                      }))}
                      placeholder="SG...."
                      className={fieldClass}
                      type="password"
                      disabled={!canWrite}
                    />
                  </div>
                </div>
                <span className="text-[11px] text-muted-foreground">API key: {maskSecret(integrationForm.email.apiKey)}</span>
              </Card>

              <Card className={`p-4 ${cardClass} space-y-4`}>
                <div className="flex items-start justify-between gap-4">
                  <div className="flex items-start gap-3">
                    <span className="flex h-9 w-9 items-center justify-center rounded-md border border-emerald-500/25 bg-emerald-500/10 text-emerald-300"><MessageCircle size={16} /></span>
                    <div>
                      <h3 className="text-sm font-medium text-foreground">SMS (Twilio)</h3>
                      <p className="text-xs text-muted-foreground mt-0.5">Same Twilio account as the Twilio WhatsApp channel, if connected - used by the automation SMS node.</p>
                    </div>
                  </div>
                  <label className="flex items-center gap-2 text-xs text-muted-foreground">
                    <input
                      type="checkbox"
                      checked={integrationForm.sms.enabled}
                      disabled={!canWrite}
                      onChange={(event) => setIntegrationForm((current) => ({
                        ...current,
                        sms: { ...current.sms, enabled: event.target.checked },
                      }))}
                    />
                    Enabled
                  </label>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  <div className="space-y-1.5">
                    <Label>From number</Label>
                    <Input
                      value={integrationForm.sms.fromNumber}
                      onChange={(event) => setIntegrationForm((current) => ({
                        ...current,
                        sms: { ...current.sms, fromNumber: event.target.value },
                      }))}
                      placeholder="+15551234567"
                      className={fieldClass}
                      disabled={!canWrite}
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label>Account SID</Label>
                    <Input
                      value={integrationForm.sms.accountSid}
                      onChange={(event) => setIntegrationForm((current) => ({
                        ...current,
                        sms: { ...current.sms, accountSid: event.target.value },
                      }))}
                      placeholder="AC..."
                      className={fieldClass}
                      disabled={!canWrite}
                    />
                  </div>
                  <div className="space-y-1.5 md:col-span-2">
                    <Label>Auth token</Label>
                    <Input
                      value={integrationForm.sms.authToken}
                      onChange={(event) => setIntegrationForm((current) => ({
                        ...current,
                        sms: { ...current.sms, authToken: event.target.value },
                      }))}
                      placeholder="Twilio auth token"
                      className={fieldClass}
                      type="password"
                      disabled={!canWrite}
                    />
                  </div>
                </div>
                <span className="text-[11px] text-muted-foreground">Auth token: {maskSecret(integrationForm.sms.authToken)}</span>
              </Card>

              <div className="flex flex-wrap items-center gap-3">
                {canWrite && <Button type="submit" size="sm" className="h-8 text-xs bg-primary text-primary-foreground" disabled={integrationSaving}>
                  {integrationSaving ? "Saving..." : "Save integrations"}
                </Button>}
                {integrationNotice && (
                  <span className={`rounded-md border px-3 py-2 text-xs ${/failed|could not|error/i.test(integrationNotice) ? "border-destructive/30 bg-destructive/10 text-destructive" : "border-primary/30 bg-primary/10 text-primary"}`}>
                    {integrationNotice}
                  </span>
                )}
              </div>
              <div className="rounded-md border border-yellow-500/25 bg-yellow-500/10 px-3 py-2 text-[11px] text-yellow-200">
                Integration secrets are stored through the existing settings API and should be rotated from the provider console if exposed.
              </div>
            </form>
          </div>
        )}

        {activeTab === "notifications" && (
          <div className="max-w-xl space-y-4">
            <Card className={`p-4 ${cardClass}`}>
              <div className="flex items-center gap-2 mb-1">
                <Bell size={16} className="text-primary" />
                <h3 className="text-sm font-medium text-foreground">Notifications</h3>
              </div>
              <p className="text-xs text-muted-foreground">
                Get an email when a connected WhatsApp or Meta Ads account needs attention. Sent through the
                email provider configured on the Integrations tab.
              </p>
            </Card>

            <form onSubmit={handleNotificationsSave} className={`space-y-4 ${cardClass} p-4`}>
              <div className="flex items-center justify-between">
                <Label>Enable notifications</Label>
                <input
                  type="checkbox"
                  checked={notificationsForm.enabled}
                  onChange={(event) => setNotificationsForm((current) => ({ ...current, enabled: event.target.checked }))}
                  disabled={!canWrite}
                  className="h-4 w-4"
                />
              </div>
              <div className="space-y-1.5">
                <Label>Recipient email</Label>
                <Input
                  type="email"
                  value={notificationsForm.recipientEmail}
                  onChange={(event) => setNotificationsForm((current) => ({ ...current, recipientEmail: event.target.value }))}
                  placeholder="alerts@yourbusiness.com"
                  disabled={!canWrite}
                  className={fieldClass}
                />
              </div>
              <div className="space-y-2">
                <Label>Alert me when</Label>
                <div className="flex items-center justify-between">
                  <span className="text-xs text-muted-foreground">A connected WhatsApp account needs attention</span>
                  <input
                    type="checkbox"
                    checked={notificationsForm.events.whatsappNeedsAttention}
                    onChange={(event) => setNotificationsForm((current) => ({ ...current, events: { ...current.events, whatsappNeedsAttention: event.target.checked } }))}
                    disabled={!canWrite}
                    className="h-4 w-4"
                  />
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-xs text-muted-foreground">A connected Meta Ads account needs attention</span>
                  <input
                    type="checkbox"
                    checked={notificationsForm.events.adsNeedsAttention}
                    onChange={(event) => setNotificationsForm((current) => ({ ...current, events: { ...current.events, adsNeedsAttention: event.target.checked } }))}
                    disabled={!canWrite}
                    className="h-4 w-4"
                  />
                </div>
              </div>
              <div className="flex flex-wrap items-center gap-3">
                {canWrite && <Button type="submit" size="sm" className="h-8 text-xs bg-primary text-primary-foreground" disabled={notificationsSaving}>
                  {notificationsSaving ? "Saving..." : "Save notifications"}
                </Button>}
                {notificationsNotice && (
                  <span className={`rounded-md border px-3 py-2 text-xs ${/failed|could not|error/i.test(notificationsNotice) ? "border-destructive/30 bg-destructive/10 text-destructive" : "border-primary/30 bg-primary/10 text-primary"}`}>
                    {notificationsNotice}
                  </span>
                )}
              </div>
              {notificationsForm.enabled && !integrationForm.email.enabled && (
                <div className="rounded-md border border-yellow-500/25 bg-yellow-500/10 px-3 py-2 text-[11px] text-yellow-200">
                  Email delivery isn&apos;t configured yet - set it up on the Integrations tab first, otherwise these alerts won&apos;t actually send.
                </div>
              )}
            </form>
          </div>
        )}

        {activeTab !== "workspace" && activeTab !== "whatsapp" && activeTab !== "flows" && activeTab !== "instagram" && activeTab !== "integrations" && activeTab !== "ads" && activeTab !== "notifications" && (
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

