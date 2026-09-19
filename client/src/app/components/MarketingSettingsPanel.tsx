import { useEffect, useRef, useState } from "react";
import { Badge } from "./ui/badge";
import { Button } from "./ui/button";
import { Card } from "./ui/card";
import { LineChart, Trash2 } from "lucide-react";
import {
  connectGoogleMarketingAccount,
  disconnectGoogleMarketingAccount,
  getGoogleMarketingAccount,
  getGoogleMarketingAuthorizeUrl,
  selectGoogleMarketingProperties,
} from "../lib/api";

const cardClass = "rounded-lg border-border bg-card/90 shadow-xl shadow-black/5";
const selectClass =
  "h-9 w-full rounded-md border border-input bg-input-background px-2 text-xs text-foreground outline-none focus:border-ring focus:ring-2 focus:ring-ring/20";

interface GoogleMarketingAccount {
  id: string;
  googleEmail: string;
  ga4PropertyId: string;
  ga4PropertyName: string;
  searchConsoleSiteUrl: string;
  status: "connected" | "disconnected" | "needs_attention";
  lastError: string;
}

interface Ga4Property {
  propertyId: string;
  displayName: string;
}

interface SearchConsoleSite {
  siteUrl: string;
  permissionLevel: string;
}

function statusVariant(status: string) {
  if (status === "connected") return "default";
  if (status === "needs_attention") return "destructive";
  return "outline";
}

// Same window.opener-hostility popup pattern as FacebookSettingsPanel.tsx (Google's own consent
// pages set the same strict Cross-Origin-Opener-Policy), extended with a property/site picker step
// since a Google login can see multiple GA4 properties/Search Console sites - the workspace picks
// exactly one of each rather than everything visible being auto-ingested.
export function MarketingSettingsPanel() {
  const [account, setAccount] = useState<GoogleMarketingAccount | null>(null);
  const [loading, setLoading] = useState(true);
  const [connecting, setConnecting] = useState(false);
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const popupRef = useRef<Window | null>(null);
  const processedResultRef = useRef(false);

  const [pickerOpen, setPickerOpen] = useState(false);
  const [properties, setProperties] = useState<Ga4Property[]>([]);
  const [sites, setSites] = useState<SearchConsoleSite[]>([]);
  const [selectedPropertyId, setSelectedPropertyId] = useState("");
  const [selectedSiteUrl, setSelectedSiteUrl] = useState("");

  async function loadAccount() {
    setLoading(true);
    try {
      const response = await getGoogleMarketingAccount<{ data: GoogleMarketingAccount | null }>();
      setAccount(response.data);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Google account status could not be loaded.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadAccount().catch(() => undefined);
  }, []);

  async function handleOAuthResult(raw: string) {
    if (processedResultRef.current) return;
    let data: { type?: string; code?: string; error?: string };
    try {
      data = JSON.parse(raw);
    } catch {
      return;
    }
    if (data?.type !== "GOOGLE_MARKETING_OAUTH_CALLBACK") return;
    processedResultRef.current = true;
    localStorage.removeItem("google_marketing_oauth_result");

    if (data.error) {
      setNotice(data.error);
      return;
    }
    if (!data.code) return;

    setConnecting(true);
    setNotice("");
    try {
      const response = await connectGoogleMarketingAccount<{
        data: GoogleMarketingAccount;
        ga4Properties: Ga4Property[];
        searchConsoleSites: SearchConsoleSite[];
      }>(data.code);
      setAccount(response.data);
      setProperties(response.ga4Properties);
      setSites(response.searchConsoleSites);
      setSelectedPropertyId(response.ga4Properties[0]?.propertyId || "");
      setSelectedSiteUrl(response.searchConsoleSites[0]?.siteUrl || "");
      setPickerOpen(true);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Could not connect the Google account.");
    } finally {
      setConnecting(false);
    }
  }

  useEffect(() => {
    function onStorage(event: StorageEvent) {
      if (event.key !== "google_marketing_oauth_result" || !event.newValue) return;
      handleOAuthResult(event.newValue);
    }
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);

  async function handleConnect() {
    setNotice("");
    processedResultRef.current = false;
    localStorage.removeItem("google_marketing_oauth_result");
    try {
      const response = await getGoogleMarketingAuthorizeUrl<{ url: string }>();
      popupRef.current = window.open(response.url, "google_marketing_oauth", "width=520,height=720");

      const pollId = window.setInterval(() => {
        if (!popupRef.current || popupRef.current.closed) {
          window.clearInterval(pollId);
          const stored = localStorage.getItem("google_marketing_oauth_result");
          if (stored) handleOAuthResult(stored);
        }
      }, 500);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Google Marketing connect is not configured yet.");
    }
  }

  async function handleSaveSelection() {
    setBusy(true);
    setNotice("");
    try {
      const chosenProperty = properties.find((property) => property.propertyId === selectedPropertyId);
      const response = await selectGoogleMarketingProperties<{ data: GoogleMarketingAccount }>({
        ga4PropertyId: selectedPropertyId,
        ga4PropertyName: chosenProperty?.displayName || "",
        searchConsoleSiteUrl: selectedSiteUrl,
      });
      setAccount(response.data);
      setPickerOpen(false);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Could not save your selection.");
    } finally {
      setBusy(false);
    }
  }

  async function handleDisconnect() {
    setBusy(true);
    setNotice("");
    try {
      await disconnectGoogleMarketingAccount();
      setAccount(null);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Could not disconnect the Google account.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-4">
      <Card className={`p-4 ${cardClass}`}>
        <div className="mb-1 flex items-center gap-2">
          <LineChart size={16} className="text-primary" />
          <h3 className="text-sm font-medium text-foreground">Google Analytics & Search Console</h3>
        </div>
        <p className="mb-3 text-xs text-muted-foreground">
          Connect your own Google account to see your own GA4 property and Search Console site right here - your
          data stays yours, we only read it. You'll need to already have a GA4 property and a verified Search
          Console site under this Google account (this app doesn't create either for you).
        </p>
        {!account && (
          <Button type="button" size="sm" className="h-8 bg-primary text-xs text-primary-foreground" onClick={handleConnect} disabled={connecting}>
            {connecting ? "Connecting..." : "Connect Google account"}
          </Button>
        )}
      </Card>

      {notice && (
        <Card className={`p-3 border-destructive/40 bg-destructive/5 ${cardClass}`}>
          <p className="text-xs text-destructive">{notice}</p>
        </Card>
      )}

      {!loading && account && (
        <Card className={`p-4 ${cardClass}`}>
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-sm font-medium text-foreground">{account.googleEmail}</span>
                <Badge variant={statusVariant(account.status)}>{account.status.replace("_", " ")}</Badge>
              </div>
              {account.lastError && <p className="mt-1 text-xs text-destructive">{account.lastError}</p>}
              <div className="mt-2 space-y-1 text-xs text-muted-foreground">
                <div>GA4 property: {account.ga4PropertyName || account.ga4PropertyId || "Not selected"}</div>
                <div>Search Console site: {account.searchConsoleSiteUrl || "Not selected"}</div>
              </div>
              {account.status === "needs_attention" && !pickerOpen && (
                <Button type="button" size="sm" variant="outline" className="mt-3 h-8 text-xs" onClick={() => setPickerOpen(true)}>
                  Choose property & site
                </Button>
              )}
            </div>
            <Button type="button" variant="ghost" size="sm" className="h-8 w-8 p-0 text-muted-foreground hover:text-destructive" onClick={handleDisconnect} disabled={busy}>
              <Trash2 size={14} />
            </Button>
          </div>

          {pickerOpen && (
            <div className="mt-4 space-y-3 border-t border-border pt-4">
              <div>
                <label className="mb-1 block text-xs font-medium text-foreground">GA4 property</label>
                {properties.length ? (
                  <select className={selectClass} value={selectedPropertyId} onChange={(event) => setSelectedPropertyId(event.target.value)}>
                    <option value="">Select a property...</option>
                    {properties.map((property) => (
                      <option key={property.propertyId} value={property.propertyId}>
                        {property.displayName}
                      </option>
                    ))}
                  </select>
                ) : (
                  <p className="text-xs text-muted-foreground">No GA4 properties found on this Google account.</p>
                )}
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium text-foreground">Search Console site</label>
                {sites.length ? (
                  <select className={selectClass} value={selectedSiteUrl} onChange={(event) => setSelectedSiteUrl(event.target.value)}>
                    <option value="">Select a site...</option>
                    {sites.map((site) => (
                      <option key={site.siteUrl} value={site.siteUrl}>
                        {site.siteUrl}
                      </option>
                    ))}
                  </select>
                ) : (
                  <p className="text-xs text-muted-foreground">
                    No verified sites found. Add and verify your site at{" "}
                    <a href="https://search.google.com/search-console" target="_blank" rel="noreferrer" className="text-primary underline">
                      search.google.com/search-console
                    </a>{" "}
                    first, then reconnect.
                  </p>
                )}
              </div>
              <Button type="button" size="sm" className="h-8 bg-primary text-xs text-primary-foreground" onClick={handleSaveSelection} disabled={busy || (!selectedPropertyId && !selectedSiteUrl)}>
                Save selection
              </Button>
            </div>
          )}
        </Card>
      )}
    </div>
  );
}
