import { Router } from "express";
import crypto from "crypto";
import mongoose from "mongoose";
import { z } from "zod";
import { AuditLog, GoogleMarketingAccount, SeoAudit } from "../models/index.js";
import { requireAuth, requireEntitlement, requirePermission } from "../middleware/auth.js";
import { actionPasswordGuard } from "../middleware/requireActionPassword.js";
import { requireWorkspaceContext } from "../middleware/workspace.js";
import { validateBody } from "../middleware/validate.js";
import { trimmedString } from "../utils/zodHelpers.js";
import { config } from "../config.js";
import { draftSeoRecommendation } from "../services/aiAssistant.js";
import { runPageSpeedAudit } from "../services/pageSpeedInsights.js";
import { querySummary as querySearchConsoleSummary, siteUrlCoversAuditUrl } from "../services/searchConsoleProvider.js";
import {
  buildGoogleMarketingAuthorizeUrl,
  encodeGoogleCredentials,
  exchangeGoogleMarketingCode,
  fetchGoogleProfile,
  listGa4Properties,
  listSearchConsoleSites,
  queryGa4Summary,
} from "../services/googleMarketingProvider.js";

// Marketing pillar (Phase 1-3): a workspace's own Google Analytics/Search Console connection, SEO
// audits against the client's own existing website, and AI-drafted (never AI-executed) growth
// recommendations. Two routers, same split as facebookPages.js: marketingRouter does its own
// internal requireAuth/requireWorkspaceContext so marketingPublicRouter (the OAuth popup callback,
// no JWT) can be mounted unauthenticated right beside it.
export const marketingRouter = Router();
export const marketingPublicRouter = Router();

marketingRouter.use(requireAuth, requireWorkspaceContext);

function serializeAccount(account) {
  return {
    id: account._id.toString(),
    googleEmail: account.googleEmail,
    ga4PropertyId: account.ga4PropertyId,
    ga4PropertyName: account.ga4PropertyName,
    searchConsoleSiteUrl: account.searchConsoleSiteUrl,
    status: account.status,
    lastError: account.lastError || "",
    lastSyncedAt: account.lastSyncedAt,
  };
}

function serializeAudit(audit) {
  return {
    id: audit._id.toString(),
    url: audit.url,
    status: audit.status,
    pageSpeed: audit.pageSpeed,
    searchConsole: audit.searchConsole,
    findings: audit.findings,
    aiRecommendation: audit.aiRecommendation,
    error: audit.error || "",
    createdAt: audit.createdAt,
  };
}

marketingRouter.get("/google/authorize-url", requirePermission("marketing:read"), async (_req, res) => {
  if (!config.googleMarketing.clientId || !config.googleMarketing.redirectUri) {
    return res.status(400).json({
      error: "GOOGLE_MARKETING_NOT_CONFIGURED",
      message: "Set GOOGLE_MARKETING_CLIENT_ID/GOOGLE_MARKETING_CLIENT_SECRET/GOOGLE_MARKETING_REDIRECT_URI first.",
    });
  }
  const state = crypto.randomBytes(16).toString("hex");
  res.json({ url: buildGoogleMarketingAuthorizeUrl(state), state });
});

marketingRouter.get("/google/account", requirePermission("marketing:read"), async (req, res) => {
  const account = await GoogleMarketingAccount.findOne({ workspaceId: req.user.workspaceId });
  res.json({ data: account ? serializeAccount(account) : null });
});

export const connectGoogleMarketingSchema = z.object({
  code: trimmedString("An authorization code is required."),
});

// Exchanges the code, stores the token, and returns the connecting account's available GA4
// properties/Search Console sites for the picker step below - status stays "needs_attention" until
// POST /google/select-properties finalizes a real property+site choice, nothing is auto-selected.
marketingRouter.post("/google/connect", requirePermission("marketing:write"), validateBody(connectGoogleMarketingSchema), async (req, res) => {
  try {
    const tokens = await exchangeGoogleMarketingCode(req.body.code);
    const [profile, properties, sites] = await Promise.all([
      fetchGoogleProfile(tokens.accessToken),
      listGa4Properties(tokens.accessToken).catch(() => []),
      listSearchConsoleSites(tokens.accessToken).catch(() => []),
    ]);

    const account = await GoogleMarketingAccount.findOneAndUpdate(
      { workspaceId: req.user.workspaceId },
      {
        organizationId: req.user.organizationId,
        workspaceId: req.user.workspaceId,
        googleEmail: profile.email,
        scopes: (tokens.scope || "").split(" ").filter(Boolean),
        encryptedCredentials: encodeGoogleCredentials(tokens),
        status: "needs_attention",
        lastError: "",
        credentialsUpdatedAt: new Date(),
      },
      { upsert: true, new: true, setDefaultsOnInsert: true }
    );

    res.status(201).json({ data: serializeAccount(account), ga4Properties: properties, searchConsoleSites: sites });
  } catch (error) {
    res.status(error.status || 502).json({ error: error.code || "GOOGLE_MARKETING_CONNECT_FAILED", message: error.message });
  }
});

export const selectGoogleMarketingPropertiesSchema = z.object({
  ga4PropertyId: z.string().trim().default(""),
  ga4PropertyName: z.string().trim().default(""),
  searchConsoleSiteUrl: z.string().trim().default(""),
});

marketingRouter.post(
  "/google/select-properties",
  requirePermission("marketing:write"),
  validateBody(selectGoogleMarketingPropertiesSchema),
  async (req, res) => {
    const account = await GoogleMarketingAccount.findOne({ workspaceId: req.user.workspaceId });
    if (!account) return res.status(404).json({ error: "NOT_FOUND", message: "Connect a Google account first." });

    account.ga4PropertyId = req.body.ga4PropertyId;
    account.ga4PropertyName = req.body.ga4PropertyName;
    account.searchConsoleSiteUrl = req.body.searchConsoleSiteUrl;
    account.status = "connected";
    account.lastSyncedAt = new Date();
    await account.save();

    res.json({ data: serializeAccount(account) });
  }
);

marketingRouter.delete("/google/account", requirePermission("marketing:write"), ...actionPasswordGuard, async (req, res) => {
  const account = await GoogleMarketingAccount.findOne({ workspaceId: req.user.workspaceId });
  if (!account) return res.status(404).json({ error: "NOT_FOUND", message: "No Google account connected." });

  await GoogleMarketingAccount.deleteOne({ _id: account._id, workspaceId: req.user.workspaceId });

  await AuditLog.create({
    organizationId: req.user.organizationId,
    workspaceId: req.user.workspaceId,
    actorUserId: req.user.sub,
    action: "marketing.google_disconnected",
    entityType: "GoogleMarketingAccount",
    entityId: account._id.toString(),
    before: { googleEmail: account.googleEmail, ga4PropertyId: account.ga4PropertyId, searchConsoleSiteUrl: account.searchConsoleSiteUrl },
    ipAddress: req.ip,
    userAgent: req.get("user-agent") || "",
  });

  res.status(204).send();
});

marketingRouter.get("/analytics/summary", requirePermission("marketing:read"), requireEntitlement("marketing"), async (req, res) => {
  const account = await GoogleMarketingAccount.findOne({ workspaceId: req.user.workspaceId, status: "connected" });
  if (!account || !account.ga4PropertyId) {
    return res.status(404).json({ error: "NOT_CONNECTED", message: "Connect a Google Analytics property first." });
  }
  try {
    const summary = await queryGa4Summary(account);
    res.json({ data: summary });
  } catch (error) {
    res.status(error.status || 502).json({ error: error.code || "GA4_SUMMARY_FAILED", message: error.message });
  }
});

marketingRouter.get("/search-console/summary", requirePermission("marketing:read"), requireEntitlement("marketing"), async (req, res) => {
  const account = await GoogleMarketingAccount.findOne({ workspaceId: req.user.workspaceId, status: "connected" });
  if (!account || !account.searchConsoleSiteUrl) {
    return res.status(404).json({ error: "NOT_CONNECTED", message: "Connect a Search Console site first." });
  }
  try {
    const summary = await querySearchConsoleSummary(account);
    res.json({ data: summary });
  } catch (error) {
    res.status(error.status || 502).json({ error: error.code || "SEARCH_CONSOLE_SUMMARY_FAILED", message: error.message });
  }
});

marketingRouter.get("/audits", requirePermission("marketing:read"), requireEntitlement("marketing"), async (req, res) => {
  const audits = await SeoAudit.find({ workspaceId: req.user.workspaceId }).sort({ createdAt: -1 }).limit(50);
  res.json({ data: audits.map(serializeAudit), total: audits.length });
});

marketingRouter.get("/audits/:id", requirePermission("marketing:read"), requireEntitlement("marketing"), async (req, res) => {
  if (!mongoose.Types.ObjectId.isValid(req.params.id)) return res.status(404).json({ error: "NOT_FOUND", message: "Audit not found." });
  const audit = await SeoAudit.findOne({ _id: req.params.id, workspaceId: req.user.workspaceId });
  if (!audit) return res.status(404).json({ error: "NOT_FOUND", message: "Audit not found." });
  res.json({ data: serializeAudit(audit) });
});

// Deterministic findings from PageSpeed's own scores/Core Web Vitals - no AI needed to detect a
// problem, only to write up what to do about it (see POST /audits/:id/recommendation below).
function findingsFromPageSpeed(pageSpeed) {
  const findings = [];
  for (const strategy of ["mobile", "desktop"]) {
    const result = pageSpeed[strategy];
    if (!result) continue;
    for (const [key, score] of Object.entries(result.scores || {})) {
      if (typeof score !== "number") continue;
      if (score < 0.5) findings.push({ severity: "critical", category: `${strategy} ${key}`, message: `${key} score is ${Math.round(score * 100)}/100 on ${strategy} - well below Google's own threshold.` });
      else if (score < 0.9) findings.push({ severity: "warning", category: `${strategy} ${key}`, message: `${key} score is ${Math.round(score * 100)}/100 on ${strategy} - room to improve.` });
    }
    const lcp = result.coreWebVitals?.find((v) => v.id === "largest-contentful-paint");
    if (lcp && typeof lcp.score === "number" && lcp.score < 0.5) {
      findings.push({ severity: "critical", category: `${strategy} LCP`, message: `Largest Contentful Paint is slow on ${strategy} (${lcp.displayValue || "see audit"}) - visitors are waiting too long to see the main content.` });
    }
  }
  return findings;
}

export const createSeoAuditSchema = z.object({
  url: z.string().trim().url("Enter a valid URL, including https://."),
});

marketingRouter.post("/audits", requirePermission("marketing:write"), requireEntitlement("marketing"), validateBody(createSeoAuditSchema), async (req, res) => {
  const account = await GoogleMarketingAccount.findOne({ workspaceId: req.user.workspaceId, status: "connected" });
  const audit = await SeoAudit.create({
    organizationId: req.user.organizationId,
    workspaceId: req.user.workspaceId,
    url: req.body.url,
    status: "running",
    triggeredByUserId: req.user.sub,
  });

  try {
    const pageSpeed = await runPageSpeedAudit(req.body.url);
    const findings = findingsFromPageSpeed(pageSpeed);

    let searchConsole = null;
    if (account?.searchConsoleSiteUrl && siteUrlCoversAuditUrl(account.searchConsoleSiteUrl, req.body.url)) {
      try {
        searchConsole = await querySearchConsoleSummary(account);
      } catch {
        // A Search Console failure never fails the whole audit - PageSpeed's findings still stand
        // on their own, this just degrades to searchConsole: null same as a domain mismatch.
      }
    }

    audit.pageSpeed = pageSpeed;
    audit.searchConsole = searchConsole;
    audit.findings = findings;
    audit.status = "completed";
    await audit.save();

    res.status(201).json({ data: serializeAudit(audit) });
  } catch (error) {
    audit.status = "failed";
    audit.error = error.message || "Audit failed.";
    await audit.save();
    res.status(error.status || 502).json({ error: error.code || "SEO_AUDIT_FAILED", message: error.message, data: serializeAudit(audit) });
  }
});

marketingRouter.post("/audits/:id/recommendation", requirePermission("marketing:write"), requireEntitlement("marketing"), async (req, res) => {
  if (!mongoose.Types.ObjectId.isValid(req.params.id)) return res.status(404).json({ error: "NOT_FOUND", message: "Audit not found." });
  const audit = await SeoAudit.findOne({ _id: req.params.id, workspaceId: req.user.workspaceId });
  if (!audit) return res.status(404).json({ error: "NOT_FOUND", message: "Audit not found." });

  const recommendation = await draftSeoRecommendation({ workspaceId: req.user.workspaceId, audit, provider: req.body?.provider || "local" });
  audit.aiRecommendation = recommendation;
  await audit.save();

  res.json({ data: serializeAudit(audit) });
});

// Public: Google's consent screen redirects here after the user approves/denies access - no JWT.
// Same window.opener-hostility workaround as facebookPages.js's oauth-callback (Google's own
// consent pages set the same strict Cross-Origin-Opener-Policy) - write the result to localStorage
// instead of relying on window.opener, then close the popup.
marketingPublicRouter.get("/oauth-callback", (req, res) => {
  const code = String(req.query.code || "");
  const error = String(req.query.error_description || req.query.error || "");
  res.setHeader("Cross-Origin-Opener-Policy", "same-origin-allow-popups");
  const payload = JSON.stringify({ type: "GOOGLE_MARKETING_OAUTH_CALLBACK", code, error, at: Date.now() });
  res.set("Content-Type", "text/html").send(`<!doctype html><html><body>
<script>
  try { localStorage.setItem("google_marketing_oauth_result", ${JSON.stringify(payload)}); } catch (e) {}
  window.opener?.postMessage(JSON.parse(${JSON.stringify(payload)}), window.location.origin);
  window.close();
</script>
${error ? "Connection failed - you can close this window." : "Connected - you can close this window."}
</body></html>`);
});
