import { getValidAccessToken } from "./googleMarketingProvider.js";

// Marketing pillar (Phase 1 dashboard + Phase 2 audits) - real Search Console data using the
// workspace's OWN connected GoogleMarketingAccount (see routes/marketing.js), never a shared
// Nemnidhi account. Read-only (webmasters.readonly scope).
const SEARCH_ANALYTICS_URL = (siteUrl) =>
  `https://www.googleapis.com/webmasters/v3/sites/${encodeURIComponent(siteUrl)}/searchAnalytics/query`;

async function queryDimensions(account, dimensions, rowLimit = 10) {
  const accessToken = await getValidAccessToken(account);
  const end = new Date();
  const start = new Date(end);
  start.setDate(start.getDate() - 28);

  const response = await fetch(SEARCH_ANALYTICS_URL(account.searchConsoleSiteUrl), {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${accessToken}` },
    body: JSON.stringify({
      startDate: start.toISOString().slice(0, 10),
      endDate: end.toISOString().slice(0, 10),
      dimensions,
      rowLimit,
    }),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || payload.error) {
    const error = new Error(payload.error?.message || "Search Console request failed.");
    error.status = response.status || 502;
    error.code = "SEARCH_CONSOLE_REQUEST_FAILED";
    throw error;
  }
  return payload.rows || [];
}

// One 28-day summary (impressions/clicks/CTR/average position with no dimension) plus top
// queries/pages - used by both the Marketing dashboard (GET /search-console/summary) and an SEO
// audit's searchConsole field.
export async function querySummary(account) {
  const [totals, queries, pages] = await Promise.all([
    queryDimensions(account, [], 1),
    queryDimensions(account, ["query"], 10),
    queryDimensions(account, ["page"], 10),
  ]);
  const totalsRow = totals[0] || { clicks: 0, impressions: 0, ctr: 0, position: 0 };
  return {
    clicks: totalsRow.clicks || 0,
    impressions: totalsRow.impressions || 0,
    ctr: totalsRow.ctr || 0,
    averagePosition: totalsRow.position || 0,
    topQueries: queries.map((row) => ({ query: row.keys?.[0] || "", clicks: row.clicks, impressions: row.impressions, ctr: row.ctr, position: row.position })),
    topPages: pages.map((row) => ({ page: row.keys?.[0] || "", clicks: row.clicks, impressions: row.impressions, ctr: row.ctr, position: row.position })),
    periodDays: 28,
  };
}

// A Search Console property covers a whole verified site (exact URL-prefix match, or
// "sc-domain:example.com" covering every subdomain/scheme) - this only loosely checks the audited
// URL's hostname against the connected site so a mismatch degrades to `searchConsole: null` in
// routes/marketing.js rather than a confusing wrong-data mix-up.
export function siteUrlCoversAuditUrl(searchConsoleSiteUrl, auditUrl) {
  if (!searchConsoleSiteUrl) return false;
  try {
    const auditHost = new URL(auditUrl).hostname.replace(/^www\./, "");
    if (searchConsoleSiteUrl.startsWith("sc-domain:")) {
      return searchConsoleSiteUrl.slice("sc-domain:".length).replace(/^www\./, "") === auditHost;
    }
    const siteHost = new URL(searchConsoleSiteUrl).hostname.replace(/^www\./, "");
    return siteHost === auditHost;
  } catch {
    return false;
  }
}
