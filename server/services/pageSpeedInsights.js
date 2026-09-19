import { config } from "../config.js";

// Marketing pillar (Phase 2) - free, API-key-only, no OAuth (a public Google API unrelated to any
// workspace's own connected GoogleMarketingAccount). Trims the raw Lighthouse response (tens of KB
// of detail nobody queries against) down to just what SeoAudit.pageSpeed needs to render.
const PAGESPEED_URL = "https://www.googleapis.com/pagespeedonline/v5/runPagespeed";

function trimAudit(audit) {
  if (!audit) return null;
  return {
    id: audit.id,
    title: audit.title,
    description: audit.description,
    score: audit.score,
    displayValue: audit.displayValue || "",
  };
}

async function runOneStrategy(url, strategy) {
  const requestUrl = new URL(PAGESPEED_URL);
  requestUrl.searchParams.set("url", url);
  requestUrl.searchParams.set("strategy", strategy);
  requestUrl.searchParams.set("category", "performance");
  requestUrl.searchParams.append("category", "accessibility");
  requestUrl.searchParams.append("category", "best-practices");
  requestUrl.searchParams.append("category", "seo");
  if (config.googleMarketing.pageSpeedApiKey) requestUrl.searchParams.set("key", config.googleMarketing.pageSpeedApiKey);

  const response = await fetch(requestUrl.toString());
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || payload.error) {
    const error = new Error(payload.error?.message || "PageSpeed Insights request failed.");
    error.status = response.status || 502;
    error.code = "PAGESPEED_REQUEST_FAILED";
    throw error;
  }

  const categories = payload.lighthouseResult?.categories || {};
  const audits = payload.lighthouseResult?.audits || {};
  const vitalsIds = ["largest-contentful-paint", "cumulative-layout-shift", "interaction-to-next-paint"];

  return {
    strategy,
    scores: {
      performance: categories.performance?.score ?? null,
      accessibility: categories.accessibility?.score ?? null,
      bestPractices: categories["best-practices"]?.score ?? null,
      seo: categories.seo?.score ?? null,
    },
    coreWebVitals: vitalsIds.map((id) => trimAudit(audits[id])).filter(Boolean),
    // Only the audits Lighthouse actually flagged as failing (score below "passing"), capped to the
    // 10 most impactful - a full audit list is the tens-of-KB detail this function exists to trim.
    failingAudits: Object.values(audits)
      .filter((audit) => typeof audit.score === "number" && audit.score < 0.9 && audit.scoreDisplayMode !== "notApplicable")
      .sort((a, b) => (a.score ?? 1) - (b.score ?? 1))
      .slice(0, 10)
      .map(trimAudit),
  };
}

export async function runPageSpeedAudit(url) {
  const [mobile, desktop] = await Promise.all([runOneStrategy(url, "mobile"), runOneStrategy(url, "desktop")]);
  return { mobile, desktop, fetchedAt: new Date().toISOString() };
}
