import { useEffect, useMemo, useState, type ReactNode } from "react";
import {
  Activity,
  BadgeCheck,
  Building2,
  CheckCircle2,
  Clock3,
  Database,
  Download,
  Globe2,
  KeyRound,
  Link2,
  LockKeyhole,
  MessageSquareText,
  Palette,
  ReceiptText,
  RefreshCcw,
  Save,
  ServerCog,
  ShieldCheck,
  Trash2,
  Users2,
  Webhook,
  Zap,
} from "lucide-react";
import { motion } from "framer-motion";
import { Badge } from "./ui/badge";
import { Button } from "./ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "./ui/card";
import { getAdminOverview, getAuditLogExportUrl, pruneAuditLog, updateAdminSettings } from "../lib/api";
import { downloadFromUrl } from "../lib/download";

type AdminRow = Record<string, string | number | boolean | string[] | undefined>;

interface AdminOverview {
  companies: AdminRow[];
  tenants: AdminRow[];
  users: AdminRow[];
  roles: (AdminRow & { permissions?: string[] })[];
  permissions: string[];
  whatsappNumbers: AdminRow[];
  apiKeys: (AdminRow & { scopes?: string[] })[];
  apiTokens: AdminRow[];
  templates: AdminRow[];
  automation: AdminRow[];
  agents: AdminRow[];
  departments: AdminRow[];
  teams: AdminRow[];
  billing: AdminRow;
  subscriptions: AdminRow[];
  usage: Record<string, number>;
  logs: AdminRow[];
  auditTrail: AdminRow[];
  security: {
    mfaRequired?: boolean;
    ipAllowlist?: string[];
    sessionTimeoutMinutes?: number;
    dataRetentionDays?: number;
  };
  webhooks: AdminRow[];
  analytics: Record<string, number>;
  settings: AdminRow;
  whiteLabelBranding: {
    brandName?: string;
    logoUrl?: string;
    primaryColor?: string;
    customDomain?: string;
  };
}

const emptyOverview: AdminOverview = {
  companies: [],
  tenants: [],
  users: [],
  roles: [],
  permissions: [],
  whatsappNumbers: [],
  apiKeys: [],
  apiTokens: [],
  templates: [],
  automation: [],
  agents: [],
  departments: [],
  teams: [],
  billing: {},
  subscriptions: [],
  usage: {},
  logs: [],
  auditTrail: [],
  security: {},
  webhooks: [],
  analytics: {},
  settings: {},
  whiteLabelBranding: {},
};

const tabs = [
  "Overview",
  "Companies",
  "Tenants",
  "Users",
  "Access",
  "WhatsApp",
  "Automation",
  "Billing",
  "Security",
  "Logs",
  "Branding",
] as const;

type AdminTab = (typeof tabs)[number];

function text(value: unknown, fallback = "-") {
  if (Array.isArray(value)) return value.join(", ") || fallback;
  if (typeof value === "boolean") return value ? "Yes" : "No";
  if (value === 0) return "0";
  return value ? String(value) : fallback;
}

function statusClass(value: unknown) {
  const normalized = String(value).toLowerCase();
  if (["active", "connected", "enabled", "approved", "paid", "success", "healthy", "yes", "true"].some((item) => normalized.includes(item))) {
    return "border-primary/25 bg-primary/10 text-primary";
  }
  if (["pending", "trial", "draft", "paused", "away", "processing"].some((item) => normalized.includes(item))) {
    return "border-warning/25 bg-warning/10 text-warning";
  }
  if (["failed", "error", "inactive", "disabled", "expired", "blocked", "no", "false"].some((item) => normalized.includes(item))) {
    return "border-destructive/25 bg-destructive/10 text-destructive";
  }
  return "border-border/80 bg-surface-elevated/45 text-muted-foreground";
}

function isStatusColumn(key: string) {
  return /status|enabled|mfa|required|system|webhook/i.test(key);
}

function StatCard({
  icon,
  label,
  value,
  tone = "text-foreground",
}: {
  icon: ReactNode;
  label: string;
  value: string | number;
  tone?: string;
}) {
  return (
    <Card className="group rounded-lg border-border/70 bg-card/90 shadow-xl shadow-black/5 transition-colors hover:border-primary/25">
      <CardContent className="flex items-center gap-3 p-4">
        <div className={`flex size-10 items-center justify-center rounded-md border border-white/10 bg-white/[0.04] transition-colors group-hover:bg-primary/10 ${tone}`}>
          {icon}
        </div>
        <div className="min-w-0">
          <div className={`text-xl font-semibold tracking-normal ${tone}`}>{value}</div>
          <div className="truncate text-xs text-muted-foreground">{label}</div>
        </div>
      </CardContent>
    </Card>
  );
}

function DataTable({ title, rows, columns }: { title: string; rows: AdminRow[]; columns: { key: string; label: string }[] }) {
  const displayValue = (key: string, value: unknown): ReactNode => {
    if (/secret|token|key/i.test(key)) {
      return value ? <span className="font-mono text-muted-foreground">************</span> : <span className="text-muted-foreground">-</span>;
    }

    if (Array.isArray(value)) {
      if (value.length === 0) return <span className="text-muted-foreground">-</span>;
      return (
        <div className="flex max-w-[260px] flex-wrap gap-1">
          {value.slice(0, 3).map((item) => (
            <Badge key={String(item)} variant="outline" className="font-mono text-[10px]">
              {String(item)}
            </Badge>
          ))}
          {value.length > 3 && (
            <Badge variant="outline" className="text-[10px]">
              +{value.length - 3}
            </Badge>
          )}
        </div>
      );
    }

    if (isStatusColumn(key) || typeof value === "boolean") {
      return (
        <Badge variant="outline" className={statusClass(value)}>
          <span className="size-1.5 rounded-full bg-current" />
          {text(value)}
        </Badge>
      );
    }

    return text(value);
  };

  return (
    <Card className="rounded-lg border-border/70 bg-card/90 shadow-xl shadow-black/5">
      <CardHeader className="flex flex-row items-center justify-between gap-3 px-4 pt-4">
        <CardTitle className="text-sm font-semibold">{title}</CardTitle>
        <Badge variant="outline" className="text-[10px]">
          {rows.length} records
        </Badge>
      </CardHeader>
      <CardContent className="px-4 pb-4">
        <div className="overflow-x-auto rounded-md border border-border/80">
          <table className="w-full min-w-[620px] text-left text-sm">
            <thead className="bg-surface-elevated/55 text-xs uppercase text-muted-foreground">
              <tr>
                {columns.map((column) => (
                  <th key={column.key} className="px-3 py-2 font-medium">
                    {column.label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {rows.length === 0 ? (
                <tr>
                  <td className="px-3 py-6 text-center text-sm text-muted-foreground" colSpan={columns.length}>
                    No records yet.
                  </td>
                </tr>
              ) : (
                rows.map((row, index) => (
                  <tr key={String(row.id || row.name || index)} className="bg-card/70 transition-colors hover:bg-surface-elevated/35">
                    {columns.map((column) => (
                      <td key={column.key} className="max-w-[260px] px-3 py-2 text-foreground">
                        {displayValue(column.key, row[column.key])}
                      </td>
                    ))}
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </CardContent>
    </Card>
  );
}

function SectionHeader({ icon, title, detail }: { icon: ReactNode; title: string; detail: string }) {
  return (
    <div className="flex items-center gap-3">
      <div className="flex size-9 items-center justify-center rounded-md bg-primary/10 text-primary">{icon}</div>
      <div>
        <h2 className="text-base font-semibold">{title}</h2>
        <p className="text-xs text-muted-foreground">{detail}</p>
      </div>
    </div>
  );
}

export function AdminView() {
  const [overview, setOverview] = useState<AdminOverview>(emptyOverview);
  const [activeTab, setActiveTab] = useState<AdminTab>("Overview");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [branding, setBranding] = useState(emptyOverview.whiteLabelBranding);
  const [security, setSecurity] = useState(emptyOverview.security);
  const [pruning, setPruning] = useState(false);
  const [pruneResult, setPruneResult] = useState("");

  async function loadOverview() {
    setLoading(true);
    setError("");
    try {
      const response = await getAdminOverview<AdminOverview>();
      setOverview(response);
      setBranding(response.whiteLabelBranding || {});
      setSecurity(response.security || {});
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "Admin overview could not be loaded.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadOverview();
  }, []);

  async function handlePruneAuditLog() {
    setPruning(true);
    setPruneResult("");
    try {
      const response = await pruneAuditLog<{ data: { deletedCount: number; retentionDays: number } }>();
      setPruneResult(`Deleted ${response.data.deletedCount} entries older than ${response.data.retentionDays} days.`);
      await loadOverview();
    } catch (nextError) {
      setPruneResult(nextError instanceof Error ? nextError.message : "Prune failed.");
    } finally {
      setPruning(false);
    }
  }

  const currentCompany = overview.companies[0];
  const metrics = useMemo(
    () => [
      { label: "Companies", value: overview.companies.length, icon: <Building2 size={18} /> },
      { label: "Tenants", value: overview.tenants.length, icon: <Database size={18} /> },
      { label: "Users", value: overview.users.length, icon: <Users2 size={18} /> },
      { label: "WhatsApp Numbers", value: overview.whatsappNumbers.length, icon: <MessageSquareText size={18} /> },
      { label: "Automations", value: overview.automation.length, icon: <Zap size={18} /> },
      { label: "Failed Webhooks", value: overview.analytics.failedWebhooks || 0, icon: <Webhook size={18} />, tone: "text-destructive" },
    ],
    [overview]
  );

  async function saveAdminSettings() {
    setSaving(true);
    setError("");
    try {
      await updateAdminSettings<{ ok: boolean }>({ security, whiteLabelBranding: branding });
      await loadOverview();
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "Settings could not be saved.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="w-full min-w-0 flex-1 overflow-x-hidden overflow-y-auto bg-muted/20">
      <div className="mx-auto flex w-full max-w-[1500px] flex-col gap-4 p-3 md:p-5">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <ShieldCheck size={14} />
              <span>Multi-tenant control plane</span>
            </div>
            <h1 className="mt-1 text-2xl font-semibold tracking-normal text-foreground">Enterprise Admin Dashboard</h1>
            <p className="text-sm text-muted-foreground">
              {text(currentCompany?.name, "Organization")} - {text(currentCompany?.plan, "starter")} - {text(currentCompany?.billingStatus, "trial")}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {error && <Badge variant="destructive">{error}</Badge>}
            <Button variant="outline" size="sm" onClick={loadOverview} disabled={loading}>
              <RefreshCcw size={15} />
              Refresh
            </Button>
            <Button size="sm" onClick={saveAdminSettings} disabled={saving}>
              <Save size={15} />
              {saving ? "Saving" : "Save Settings"}
            </Button>
          </div>
        </div>

        <div className="grid grid-cols-1 gap-3 min-[380px]:grid-cols-2 lg:grid-cols-6">
          {metrics.map((metric) => (
            <StatCard key={metric.label} {...metric} />
          ))}
        </div>

        <div className="flex min-w-0 gap-4">
          <aside className="hidden w-48 shrink-0 lg:block">
            <div className="sticky top-4 rounded-lg border border-border bg-card p-2">
              {tabs.map((tab) => (
                <button
                  key={tab}
                  onClick={() => setActiveTab(tab)}
                  className={`flex h-9 w-full items-center rounded-md px-3 text-left text-sm transition-colors ${
                    activeTab === tab ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-muted hover:text-foreground"
                  }`}
                >
                  {tab}
                </button>
              ))}
            </div>
          </aside>

          <main className="min-w-0 flex-1 overflow-x-hidden">
            <div className="mb-3 flex gap-2 overflow-x-auto pb-1 lg:hidden">
              {tabs.map((tab) => (
                <button
                  key={tab}
                  onClick={() => setActiveTab(tab)}
                  className={`h-8 shrink-0 rounded-md border px-3 text-xs ${
                    activeTab === tab ? "border-primary bg-primary text-primary-foreground" : "border-border bg-card text-muted-foreground"
                  }`}
                >
                  {tab}
                </button>
              ))}
            </div>

            <motion.div
              key={activeTab}
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.18 }}
              className="space-y-4"
            >
              {activeTab === "Overview" && (
                <>
                  <SectionHeader icon={<Activity size={17} />} title="Operating Overview" detail="Tenant health, usage, ownership, and live system posture." />
                  <div className="grid gap-4 xl:grid-cols-2">
                    <DataTable title="Companies" rows={overview.companies} columns={[{ key: "name", label: "Company" }, { key: "slug", label: "Slug" }, { key: "plan", label: "Plan" }, { key: "billingStatus", label: "Billing" }, { key: "tenants", label: "Tenants" }]} />
                    <DataTable title="Usage" rows={[overview.usage]} columns={[{ key: "messages", label: "Messages" }, { key: "campaigns", label: "Campaigns" }, { key: "automations", label: "Automations" }, { key: "templates", label: "Templates" }, { key: "users", label: "Users" }]} />
                  </div>
                </>
              )}

              {activeTab === "Companies" && (
                <>
                  <SectionHeader icon={<Building2 size={17} />} title="Companies" detail="Organization-level billing, ownership, subscriptions, and tenant counts." />
                  <DataTable title="Company Directory" rows={overview.companies} columns={[{ key: "name", label: "Name" }, { key: "slug", label: "Slug" }, { key: "ownerUserId", label: "Owner" }, { key: "plan", label: "Plan" }, { key: "billingStatus", label: "Status" }, { key: "createdAt", label: "Created" }]} />
                </>
              )}

              {activeTab === "Tenants" && (
                <>
                  <SectionHeader icon={<Database size={17} />} title="Tenants" detail="Workspace isolation for numbers, users, templates, automations, and CRM data." />
                  <DataTable title="Tenant Workspaces" rows={overview.tenants} columns={[{ key: "name", label: "Tenant" }, { key: "slug", label: "Slug" }, { key: "status", label: "Status" }, { key: "timezone", label: "Timezone" }, { key: "businessCategory", label: "Category" }, { key: "createdAt", label: "Created" }]} />
                </>
              )}

              {activeTab === "Users" && (
                <>
                  <SectionHeader icon={<Users2 size={17} />} title="Users, Agents, Departments and Teams" detail="People operations with tenant-aware assignment and ownership." />
                  <div className="grid gap-4 xl:grid-cols-2">
                    <DataTable title="Users" rows={overview.users} columns={[{ key: "name", label: "Name" }, { key: "email", label: "Email" }, { key: "role", label: "Role" }, { key: "tenant", label: "Tenant" }, { key: "status", label: "Status" }]} />
                    <DataTable title="Agents" rows={overview.agents} columns={[{ key: "name", label: "Agent" }, { key: "department", label: "Department" }, { key: "tenant", label: "Tenant" }, { key: "status", label: "Status" }]} />
                    <DataTable title="Departments" rows={overview.departments} columns={[{ key: "name", label: "Department" }, { key: "agents", label: "Agents" }, { key: "sla", label: "SLA" }]} />
                    <DataTable title="Teams" rows={overview.teams} columns={[{ key: "name", label: "Team" }, { key: "department", label: "Department" }, { key: "members", label: "Members" }]} />
                  </div>
                </>
              )}

              {activeTab === "Access" && (
                <>
                  <SectionHeader icon={<LockKeyhole size={17} />} title="Roles, Permissions and API Tokens" detail="Least-privilege controls for admins, agents, integrations, and automation." />
                  <div className="grid gap-4 xl:grid-cols-2">
                    <DataTable title="Roles" rows={overview.roles} columns={[{ key: "name", label: "Role" }, { key: "key", label: "Key" }, { key: "tenant", label: "Tenant" }, { key: "permissions", label: "Permissions" }, { key: "isSystemRole", label: "System" }]} />
                    <DataTable title="API Keys" rows={overview.apiKeys} columns={[{ key: "name", label: "Name" }, { key: "token", label: "Key" }, { key: "scopes", label: "Scopes" }, { key: "status", label: "Status" }, { key: "createdAt", label: "Created" }]} />
                    <DataTable title="API Tokens" rows={overview.apiTokens} columns={[{ key: "name", label: "Token" }, { key: "token", label: "Value" }, { key: "expiresAt", label: "Expires" }, { key: "status", label: "Status" }]} />
                    <Card className="rounded-lg border-border/70">
                      <CardHeader className="px-4 pt-4">
                        <CardTitle className="text-sm font-semibold">Permission Catalog</CardTitle>
                      </CardHeader>
                      <CardContent className="flex flex-wrap gap-2 px-4 pb-4">
                        {overview.permissions.map((permission) => (
                          <Badge key={permission} variant="outline" className="font-mono">
                            {permission}
                          </Badge>
                        ))}
                      </CardContent>
                    </Card>
                  </div>
                </>
              )}

              {activeTab === "WhatsApp" && (
                <>
                  <SectionHeader icon={<MessageSquareText size={17} />} title="WhatsApp, Templates and Webhooks" detail="Number provisioning, template review state, provider health, and webhook delivery." />
                  <div className="grid gap-4">
                    <DataTable title="WhatsApp Numbers" rows={overview.whatsappNumbers} columns={[{ key: "displayName", label: "Name" }, { key: "phoneNumber", label: "Phone" }, { key: "tenant", label: "Tenant" }, { key: "provider", label: "Provider" }, { key: "status", label: "Status" }, { key: "webhookStatus", label: "Webhook" }]} />
                    <DataTable title="Templates" rows={overview.templates} columns={[{ key: "name", label: "Template" }, { key: "language", label: "Language" }, { key: "category", label: "Category" }, { key: "status", label: "Status" }, { key: "updatedAt", label: "Updated" }]} />
                    <DataTable title="Webhooks" rows={overview.webhooks} columns={[{ key: "name", label: "Name" }, { key: "enabled", label: "Enabled" }, { key: "url", label: "URL" }, { key: "secret", label: "Secret" }]} />
                  </div>
                </>
              )}

              {activeTab === "Automation" && (
                <>
                  <SectionHeader icon={<Zap size={17} />} title="Automation" detail="Visual workflow inventory, versions, runs, and operational state." />
                  <DataTable title="Automation Flows" rows={overview.automation} columns={[{ key: "name", label: "Flow" }, { key: "status", label: "Status" }, { key: "version", label: "Version" }, { key: "nodes", label: "Nodes" }, { key: "runs", label: "Runs" }, { key: "updatedAt", label: "Updated" }]} />
                </>
              )}

              {activeTab === "Billing" && (
                <>
                  <SectionHeader icon={<ReceiptText size={17} />} title="Billing, Subscriptions and Usage" detail="Plan state, seats, limits, and tenant-wide resource usage." />
                  <div className="grid gap-4 xl:grid-cols-2">
                    <DataTable title="Billing" rows={[overview.billing]} columns={[{ key: "plan", label: "Plan" }, { key: "status", label: "Status" }, { key: "seats", label: "Seats" }, { key: "mrr", label: "MRR" }, { key: "nextInvoiceAt", label: "Next Invoice" }]} />
                    <DataTable title="Subscriptions" rows={overview.subscriptions} columns={[{ key: "plan", label: "Plan" }, { key: "status", label: "Status" }, { key: "seats", label: "Seats" }, { key: "usageLimit", label: "Usage Limit" }]} />
                  </div>
                </>
              )}

              {activeTab === "Security" && (
                <>
                  <SectionHeader icon={<ShieldCheck size={17} />} title="Security and Compliance" detail="Tenant security posture, session policy, retention, and network controls." />
                  <Card className="rounded-lg border-border/70">
                    <CardContent className="grid gap-4 p-4 md:grid-cols-2">
                      <label className="flex items-center justify-between gap-3 rounded-md border border-border p-3">
                        <span>
                          <span className="block text-sm font-medium">Require MFA</span>
                          <span className="text-xs text-muted-foreground">Apply to all tenant users.</span>
                        </span>
                        <input
                          type="checkbox"
                          checked={Boolean(security.mfaRequired)}
                          onChange={(event) => setSecurity((current) => ({ ...current, mfaRequired: event.target.checked }))}
                          className="size-4 accent-primary"
                        />
                      </label>
                      <label className="space-y-1">
                        <span className="text-xs font-medium text-muted-foreground">Session Timeout Minutes</span>
                        <input
                          type="number"
                          value={security.sessionTimeoutMinutes || 480}
                          onChange={(event) => setSecurity((current) => ({ ...current, sessionTimeoutMinutes: Number(event.target.value) }))}
                          className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm outline-none focus:border-primary"
                        />
                      </label>
                      <label className="space-y-1">
                        <span className="text-xs font-medium text-muted-foreground">Data Retention Days</span>
                        <input
                          type="number"
                          value={security.dataRetentionDays || 365}
                          onChange={(event) => setSecurity((current) => ({ ...current, dataRetentionDays: Number(event.target.value) }))}
                          className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm outline-none focus:border-primary"
                        />
                      </label>
                      <label className="space-y-1">
                        <span className="text-xs font-medium text-muted-foreground">IP Allowlist</span>
                        <input
                          value={(security.ipAllowlist || []).join(", ")}
                          onChange={(event) => setSecurity((current) => ({ ...current, ipAllowlist: event.target.value.split(",").map((item) => item.trim()).filter(Boolean) }))}
                          className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm outline-none focus:border-primary"
                          placeholder="203.0.113.10, 198.51.100.4"
                        />
                      </label>
                    </CardContent>
                  </Card>
                </>
              )}

              {activeTab === "Logs" && (
                <>
                  <SectionHeader icon={<ServerCog size={17} />} title="Logs and Audit Trail" detail="Webhook events, operational failures, admin actions, and entity changes." />
                  <div className="grid gap-4">
                    <DataTable title="Webhook Logs" rows={overview.logs} columns={[{ key: "eventType", label: "Event" }, { key: "provider", label: "Provider" }, { key: "status", label: "Status" }, { key: "error", label: "Error" }, { key: "createdAt", label: "Created" }]} />
                    <div className="flex flex-wrap items-center justify-end gap-2">
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => downloadFromUrl(getAuditLogExportUrl(), "audit-log.csv")}
                      >
                        <Download size={14} />
                        Export audit trail
                      </Button>
                      <Button variant="outline" size="sm" disabled={pruning} onClick={handlePruneAuditLog}>
                        <Trash2 size={14} />
                        {pruning ? "Pruning..." : "Prune now"}
                      </Button>
                    </div>
                    {pruneResult && <p className="text-right text-xs text-muted-foreground">{pruneResult}</p>}
                    <DataTable title="Audit Trail" rows={overview.auditTrail} columns={[{ key: "action", label: "Action" }, { key: "entityType", label: "Entity" }, { key: "entityId", label: "Entity ID" }, { key: "createdAt", label: "Created" }]} />
                  </div>
                </>
              )}

              {activeTab === "Branding" && (
                <>
                  <SectionHeader icon={<Palette size={17} />} title="White Label Branding and Settings" detail="Customer-facing brand identity and tenant domain controls." />
                  <Card className="rounded-lg border-border/70">
                    <CardContent className="grid gap-4 p-4 md:grid-cols-2">
                      <label className="space-y-1">
                        <span className="flex items-center gap-2 text-xs font-medium text-muted-foreground"><BadgeCheck size={14} /> Brand Name</span>
                        <input value={branding.brandName || ""} onChange={(event) => setBranding((current) => ({ ...current, brandName: event.target.value }))} className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm outline-none focus:border-primary" />
                      </label>
                      <label className="space-y-1">
                        <span className="flex items-center gap-2 text-xs font-medium text-muted-foreground"><Globe2 size={14} /> Custom Domain</span>
                        <input value={branding.customDomain || ""} onChange={(event) => setBranding((current) => ({ ...current, customDomain: event.target.value }))} className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm outline-none focus:border-primary" />
                      </label>
                      <label className="space-y-1">
                        <span className="flex items-center gap-2 text-xs font-medium text-muted-foreground"><Palette size={14} /> Primary Color</span>
                        <input type="color" value={branding.primaryColor || "#22c55e"} onChange={(event) => setBranding((current) => ({ ...current, primaryColor: event.target.value }))} className="h-9 w-full rounded-md border border-input bg-background px-2" />
                      </label>
                      <label className="space-y-1">
                        <span className="flex items-center gap-2 text-xs font-medium text-muted-foreground"><Link2 size={14} /> Logo URL</span>
                        <input value={branding.logoUrl || ""} onChange={(event) => setBranding((current) => ({ ...current, logoUrl: event.target.value }))} className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm outline-none focus:border-primary" />
                      </label>
                      <div className="flex flex-col gap-3 rounded-md border border-border p-3 sm:flex-row sm:items-center md:col-span-2">
                        <div className="flex size-11 items-center justify-center rounded-md text-white" style={{ backgroundColor: branding.primaryColor || "#22c55e" }}>
                          <KeyRound size={18} />
                        </div>
                        <div>
                          <div className="text-sm font-medium">{branding.brandName || "WhatsCRM"}</div>
                          <div className="text-xs text-muted-foreground">{branding.customDomain || "No custom domain configured"}</div>
                        </div>
                        <Badge className="sm:ml-auto" variant="outline">
                          Live Preview
                        </Badge>
                      </div>
                    </CardContent>
                  </Card>
                </>
              )}
            </motion.div>
          </main>
        </div>

        {loading && (
          <div className="fixed inset-x-0 bottom-14 z-30 mx-auto w-fit rounded-t-md border border-border bg-card px-4 py-2 text-xs text-muted-foreground shadow-sm md:bottom-0">
            <Clock3 className="mr-2 inline size-3" />
            Loading admin data...
          </div>
        )}

        {!loading && !error && (
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <CheckCircle2 size={14} className="text-primary" />
            Tenant-aware admin data synchronized.
          </div>
        )}
      </div>
    </div>
  );
}
