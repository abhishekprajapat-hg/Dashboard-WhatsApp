import { useEffect, useState } from "react";
import { Badge } from "./ui/badge";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { Label } from "./ui/label";
import { Card } from "./ui/card";
import { Megaphone, Pause, Play, RefreshCw, Trash2 } from "lucide-react";
import {
  activateAdCampaign,
  createAdCampaign,
  createAdsAccount,
  deleteAdsAccount,
  getAdCampaigns,
  getAdsAccounts,
  pauseAdCampaign,
  testAdsAccount,
} from "../lib/api";

const cardClass = "rounded-lg border-border bg-card/90 shadow-xl shadow-black/5";
const fieldClass = "bg-background/80 border-border shadow-inner shadow-black/10 focus:border-primary/50 focus:ring-2 focus:ring-primary/20";

interface AdsAccount {
  id: string;
  adAccountId: string;
  pageId: string;
  whatsappPhoneNumber: string;
  status: string;
  lastError: string;
}

interface AdCampaign {
  id: string;
  metaAdsAccountId: string;
  name: string;
  dailyBudgetMinorUnits: number;
  message: string;
  status: string;
  metaCampaignId: string;
  metaAdSetId: string;
  metaAdId: string;
  lastError: string;
}

function statusVariant(status: string): "default" | "outline" | "destructive" | "warning" {
  if (status === "connected" || status === "paused" || status === "active") return "default";
  if (status === "needs_attention" || status === "failed") return "destructive";
  if (status === "creating") return "warning";
  return "outline";
}

function readFileAsBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ""));
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

export function AdsSettingsPanel() {
  const [accounts, setAccounts] = useState<AdsAccount[]>([]);
  const [campaigns, setCampaigns] = useState<AdCampaign[]>([]);
  const [loading, setLoading] = useState(true);
  const [notice, setNotice] = useState("");
  const [showAccountForm, setShowAccountForm] = useState(false);
  const [accountSaving, setAccountSaving] = useState(false);
  const [accountForm, setAccountForm] = useState({
    adAccountId: "",
    pageId: "",
    whatsappPhoneNumber: "",
    accessToken: "",
  });
  const [showCampaignForm, setShowCampaignForm] = useState(false);
  const [campaignSaving, setCampaignSaving] = useState(false);
  const [campaignForm, setCampaignForm] = useState({
    metaAdsAccountId: "",
    name: "",
    dailyBudgetRupees: "",
    message: "",
  });
  const [creativeFile, setCreativeFile] = useState<File | null>(null);
  const [testingAccountId, setTestingAccountId] = useState("");
  const [campaignActionId, setCampaignActionId] = useState("");

  async function loadData() {
    setLoading(true);
    setNotice("");
    try {
      const [accountsResponse, campaignsResponse] = await Promise.all([
        getAdsAccounts<{ data: AdsAccount[] }>(),
        getAdCampaigns<{ data: AdCampaign[] }>(),
      ]);
      setAccounts(accountsResponse.data);
      setCampaigns(campaignsResponse.data);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Ads settings could not be loaded.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadData().catch(() => undefined);
  }, []);

  async function handleCreateAccount(event: React.FormEvent) {
    event.preventDefault();
    setAccountSaving(true);
    setNotice("");
    try {
      await createAdsAccount({
        adAccountId: accountForm.adAccountId,
        pageId: accountForm.pageId,
        whatsappPhoneNumber: accountForm.whatsappPhoneNumber || undefined,
        accessToken: accountForm.accessToken || undefined,
      });
      setAccountForm({ adAccountId: "", pageId: "", whatsappPhoneNumber: "", accessToken: "" });
      setShowAccountForm(false);
      await loadData();
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Could not connect the ad account.");
    } finally {
      setAccountSaving(false);
    }
  }

  async function handleTestAccount(id: string) {
    setTestingAccountId(id);
    setNotice("");
    try {
      await testAdsAccount(id);
      await loadData();
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Connection test failed.");
    } finally {
      setTestingAccountId("");
    }
  }

  async function handleDeleteAccount(id: string) {
    try {
      await deleteAdsAccount(id);
      await loadData();
    } catch {
      // loadData below reflects whatever the server actually did either way
    }
  }

  async function handleCreateCampaign(event: React.FormEvent) {
    event.preventDefault();
    if (!creativeFile) {
      setNotice("An ad creative image is required.");
      return;
    }
    setCampaignSaving(true);
    setNotice("");
    try {
      const imageBase64 = await readFileAsBase64(creativeFile);
      await createAdCampaign({
        metaAdsAccountId: campaignForm.metaAdsAccountId,
        name: campaignForm.name,
        dailyBudgetMinorUnits: Math.round(Number(campaignForm.dailyBudgetRupees || 0) * 100),
        message: campaignForm.message,
        imageBase64,
      });
      setCampaignForm({ metaAdsAccountId: "", name: "", dailyBudgetRupees: "", message: "" });
      setCreativeFile(null);
      setShowCampaignForm(false);
      await loadData();
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Could not create the ad campaign.");
    } finally {
      setCampaignSaving(false);
    }
  }

  async function handleActivateCampaign(campaign: AdCampaign) {
    if (!window.confirm(`Activate "${campaign.name}"? This starts spending real ad budget (₹${(campaign.dailyBudgetMinorUnits / 100).toFixed(2)}/day) on Meta immediately.`)) {
      return;
    }
    setCampaignActionId(campaign.id);
    setNotice("");
    try {
      await activateAdCampaign(campaign.id);
      await loadData();
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Could not activate the campaign.");
    } finally {
      setCampaignActionId("");
    }
  }

  async function handlePauseCampaign(id: string) {
    setCampaignActionId(id);
    setNotice("");
    try {
      await pauseAdCampaign(id);
      await loadData();
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Could not pause the campaign.");
    } finally {
      setCampaignActionId("");
    }
  }

  return (
    <div className="space-y-4">
      <Card className={`p-4 ${cardClass}`}>
        <div className="flex items-center gap-2 mb-1">
          <Megaphone size={16} className="text-primary" />
          <h3 className="text-sm font-medium text-foreground">Click-to-WhatsApp Ads</h3>
        </div>
        <p className="text-xs text-muted-foreground">
          Connect a Meta Ads account and create Click-to-WhatsApp ad campaigns via the Marketing API.
          Every campaign is created <span className="font-medium text-foreground">paused</span> — nothing
          spends until you explicitly activate it below.
        </p>
      </Card>

      {notice && (
        <Card className={`p-3 border-destructive/40 bg-destructive/5 ${cardClass}`}>
          <p className="text-xs text-destructive">{notice}</p>
        </Card>
      )}

      <div className="flex items-center justify-between">
        <h4 className="text-xs font-medium text-foreground uppercase tracking-wider">Ad accounts</h4>
        <Button type="button" size="sm" variant="outline" className="h-8 text-xs border-border" onClick={() => setShowAccountForm((current) => !current)}>
          {showAccountForm ? "Cancel" : "Connect ad account"}
        </Button>
      </div>

      {showAccountForm && (
        <form onSubmit={handleCreateAccount} className={`space-y-3 ${cardClass} p-4`}>
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
            <div className="space-y-1.5">
              <Label>Ad account ID</Label>
              <Input
                value={accountForm.adAccountId}
                onChange={(event) => setAccountForm((current) => ({ ...current, adAccountId: event.target.value }))}
                placeholder="act_1234567890"
                required
                className={fieldClass}
              />
            </div>
            <div className="space-y-1.5">
              <Label>Page ID</Label>
              <Input
                value={accountForm.pageId}
                onChange={(event) => setAccountForm((current) => ({ ...current, pageId: event.target.value }))}
                required
                className={fieldClass}
              />
            </div>
            <div className="space-y-1.5">
              <Label>WhatsApp phone number (optional)</Label>
              <Input
                value={accountForm.whatsappPhoneNumber}
                onChange={(event) => setAccountForm((current) => ({ ...current, whatsappPhoneNumber: event.target.value }))}
                placeholder="Defaults to the account's Meta-side destination"
                className={fieldClass}
              />
            </div>
            <div className="space-y-1.5">
              <Label>Access token</Label>
              <Input
                type="password"
                value={accountForm.accessToken}
                onChange={(event) => setAccountForm((current) => ({ ...current, accessToken: event.target.value }))}
                placeholder="Use local-placeholder-token for local testing"
                className={fieldClass}
              />
            </div>
          </div>
          <div className="flex gap-2">
            <Button type="submit" size="sm" className="h-8 text-xs bg-primary text-primary-foreground" disabled={accountSaving}>
              {accountSaving ? "Saving..." : "Save account"}
            </Button>
          </div>
          <div className="rounded-md border border-yellow-500/25 bg-yellow-500/10 px-3 py-2 text-[11px] text-yellow-200">
            Secrets are masked after saving and are never shown again in this UI. Replace a token by entering a new value.
          </div>
        </form>
      )}

      <div className="space-y-2">
        {!loading && accounts.length === 0 && (
          <Card className={`p-4 ${cardClass}`}>
            <p className="text-sm text-foreground">No ad account connected</p>
            <p className="text-xs text-muted-foreground">Connect one to start creating Click-to-WhatsApp campaigns.</p>
          </Card>
        )}
        {accounts.map((account) => (
          <Card key={account.id} className={`p-4 ${cardClass}`}>
            <div className="flex items-start justify-between gap-3">
              <div>
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-sm font-medium text-foreground">{account.adAccountId}</span>
                  <Badge variant={statusVariant(account.status)}>{account.status}</Badge>
                </div>
                <p className="text-xs text-muted-foreground mt-1">Page {account.pageId}</p>
                {account.lastError && <p className="text-xs text-destructive mt-1">{account.lastError}</p>}
              </div>
              <div className="flex gap-1">
                <Button type="button" size="icon-sm" variant="outline" className="border-border" title="Test connection" onClick={() => handleTestAccount(account.id)} disabled={testingAccountId === account.id}>
                  <RefreshCw size={14} className={testingAccountId === account.id ? "animate-spin" : ""} />
                </Button>
                <Button type="button" size="icon-sm" variant="outline" className="border-border" title="Disconnect" onClick={() => handleDeleteAccount(account.id)}>
                  <Trash2 size={14} />
                </Button>
              </div>
            </div>
          </Card>
        ))}
      </div>

      <div className="flex items-center justify-between pt-2">
        <h4 className="text-xs font-medium text-foreground uppercase tracking-wider">Campaigns</h4>
        <Button
          type="button"
          size="sm"
          variant="outline"
          className="h-8 text-xs border-border"
          onClick={() => setShowCampaignForm((current) => !current)}
          disabled={accounts.length === 0}
        >
          {showCampaignForm ? "Cancel" : "Create campaign"}
        </Button>
      </div>

      {showCampaignForm && (
        <form onSubmit={handleCreateCampaign} className={`space-y-3 ${cardClass} p-4`}>
          <div className="space-y-1.5">
            <Label>Ad account</Label>
            <select
              value={campaignForm.metaAdsAccountId}
              onChange={(event) => setCampaignForm((current) => ({ ...current, metaAdsAccountId: event.target.value }))}
              required
              className={`w-full rounded-md border px-3 py-2 text-sm ${fieldClass}`}
            >
              <option value="">Select an ad account</option>
              {accounts.map((account) => (
                <option key={account.id} value={account.id}>
                  {account.adAccountId}
                </option>
              ))}
            </select>
          </div>
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
            <div className="space-y-1.5">
              <Label>Campaign name</Label>
              <Input
                value={campaignForm.name}
                onChange={(event) => setCampaignForm((current) => ({ ...current, name: event.target.value }))}
                required
                className={fieldClass}
              />
            </div>
            <div className="space-y-1.5">
              <Label>Daily budget (₹)</Label>
              <Input
                type="number"
                min="1"
                step="1"
                value={campaignForm.dailyBudgetRupees}
                onChange={(event) => setCampaignForm((current) => ({ ...current, dailyBudgetRupees: event.target.value }))}
                required
                className={fieldClass}
              />
            </div>
          </div>
          <div className="space-y-1.5">
            <Label>Ad message</Label>
            <Input
              value={campaignForm.message}
              onChange={(event) => setCampaignForm((current) => ({ ...current, message: event.target.value }))}
              placeholder="Text shown in the ad, opens a WhatsApp chat on click"
              required
              className={fieldClass}
            />
          </div>
          <div className="space-y-1.5">
            <Label>Ad creative image</Label>
            <input
              type="file"
              accept="image/*"
              onChange={(event) => setCreativeFile(event.target.files?.[0] || null)}
              required
              className="block w-full text-xs text-muted-foreground"
            />
          </div>
          <div className="flex gap-2">
            <Button type="submit" size="sm" className="h-8 text-xs bg-primary text-primary-foreground" disabled={campaignSaving}>
              {campaignSaving ? "Creating..." : "Create campaign (paused)"}
            </Button>
          </div>
        </form>
      )}

      <div className="space-y-2">
        {!loading && campaigns.length === 0 && (
          <Card className={`p-4 ${cardClass}`}>
            <p className="text-sm text-foreground">No ad campaigns created yet</p>
          </Card>
        )}
        {campaigns.map((campaign) => (
          <Card key={campaign.id} className={`p-4 ${cardClass}`}>
            <div className="flex items-start justify-between gap-3">
              <div>
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-sm font-medium text-foreground">{campaign.name}</span>
                  <Badge variant={statusVariant(campaign.status)}>{campaign.status}</Badge>
                </div>
                <p className="text-xs text-muted-foreground mt-1">₹{(campaign.dailyBudgetMinorUnits / 100).toFixed(2)}/day · {campaign.message}</p>
                {campaign.metaCampaignId && (
                  <p className="text-[11px] text-muted-foreground mt-1">
                    Meta campaign {campaign.metaCampaignId} · ad set {campaign.metaAdSetId} · ad {campaign.metaAdId}
                  </p>
                )}
                {campaign.lastError && <p className="text-xs text-destructive mt-1">{campaign.lastError}</p>}
              </div>
              {campaign.metaCampaignId && (
                <div className="flex gap-1">
                  {campaign.status === "active" ? (
                    <Button type="button" size="icon-sm" variant="outline" className="border-border" title="Pause" onClick={() => handlePauseCampaign(campaign.id)} disabled={campaignActionId === campaign.id}>
                      <Pause size={14} />
                    </Button>
                  ) : (
                    <Button type="button" size="icon-sm" variant="outline" className="border-border" title="Activate" onClick={() => handleActivateCampaign(campaign)} disabled={campaignActionId === campaign.id}>
                      <Play size={14} />
                    </Button>
                  )}
                </div>
              )}
            </div>
          </Card>
        ))}
      </div>
    </div>
  );
}
