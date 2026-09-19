import mongoose from "mongoose";
import { Notification, Organization, UsageCounter } from "../models/index.js";
import { getUsageLimit } from "./entitlements.js";
import { logger } from "./logger.js";
import { notifyWorkspaceInApp } from "./notifications.js";

// Below this ratio of a plan's monthly limit, requireUnderUsageLimit/checkUsageLimit stay
// silent - a workspace at 10% of its cap doesn't need to hear about it yet.
const SOFT_WARN_RATIO = 0.8;
const METRIC_LABELS = { messagesSent: "messages sent" };

// Every metric any incrementUsage() call site actually writes (campaignSender.js,
// automationSender.js, conversations.js, routes/campaigns.js) - kept as one list so
// getOrganizationUsageSummary always reports a consistent metric set even for a period with zero
// recorded usage, rather than only showing whatever happens to have a UsageCounter document.
const TRACKED_METRICS = ["messagesSent", "campaignsRun", "automationRuns"];

// Shared message text for both requireUnderUsageLimit (the HTTP gate) and the queue-processed
// send paths (campaignSender.js/automationSender.js) that hard-block a per-recipient send inline -
// one wording for "why did this get blocked", not one per call site.
export function usageLimitMessage(metric, limit) {
  const label = METRIC_LABELS[metric] || metric;
  return `This workspace has reached its plan's monthly limit of ${limit} ${label}. Upgrade your plan to keep sending.`;
}

function currentPeriod() {
  const now = new Date();
  return `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, "0")}`;
}

function periodStartDate(period) {
  const [year, month] = period.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, 1));
}

// Fire-and-forget by design, same shape as notifyVega/notifyWorkspace elsewhere in this codebase -
// swallows its own errors so a metering write can never fail or delay the real send/action that
// triggered it. Callers don't need their own .catch(); this never throws.
export async function incrementUsage(organizationId, metric, amount = 1) {
  if (!organizationId || !metric) return;
  try {
    await UsageCounter.findOneAndUpdate(
      { organizationId, period: currentPeriod(), metric },
      { $inc: { count: amount } },
      { upsert: true, setDefaultsOnInsert: true }
    );
  } catch (error) {
    logger.warn({ err: error, organizationId, metric }, "incrementUsage: failed to record usage counter");
  }
}

// Single source of truth for "is this organization over its plan's usage limit for this metric" -
// shared by requireUnderUsageLimit (the synchronous HTTP gate on the manual-send/campaign-launch
// routes) and the queue-processed send paths (campaignSender.js/automationSender.js), so a
// hard-block, once enabled via the usageLimitHardBlock feature flag, applies consistently
// wherever a message actually goes out - not just at the two or three routes a browser hits
// directly. The platform owner's own organization is never metered, same rule requireEntitlement
// already applies via hasEntitlementForActor.
export async function checkUsageLimit(organizationId, metric) {
  const organization = await Organization.findById(organizationId).select("plan isPlatformOwner");
  if (!organization || organization.isPlatformOwner) return { limited: false };

  const limit = getUsageLimit(organization.plan, metric);
  if (limit == null) return { limited: false };

  const period = currentPeriod();
  const counter = await UsageCounter.findOne({ organizationId, period, metric }).select("count");
  const count = counter?.count || 0;
  const ratio = count / limit;

  return {
    limited: true,
    plan: organization.plan,
    metric,
    period,
    limit,
    count,
    ratio,
    softWarn: ratio >= SOFT_WARN_RATIO,
    exceeded: count >= limit,
  };
}

// Fires one in-app notification per organization+metric+period, not one per over-limit request -
// dedupes by checking whether a notification of this same type already exists since this period
// started, rather than a separate "already warned" flag to keep in sync. Swallows its own errors,
// same "never let a side-channel failure surface as the real operation's own failure" rule as
// notifyWorkspace/notifyWorkspaceInApp themselves.
export async function warnUsageSoftLimitOnce(organizationId, workspaceId, status) {
  if (!status?.softWarn) return;
  try {
    const type = `usage.softWarn.${status.metric}`;
    // This app runs with mongoose.set("sanitizeFilter", true) (see db.js) - a plain $gte object
    // built by the app itself still needs mongoose.trusted() or it gets treated the same as
    // untrusted user input and mangled instead of applied (Mongoose tries to cast the whole
    // {$gte: date} object as a single Date value and throws), same known pitfall documented in
    // meetingService.js/otpService.js.
    const alreadyWarned = await Notification.exists({
      workspaceId,
      type,
      createdAt: mongoose.trusted({ $gte: periodStartDate(status.period) }),
    });
    if (alreadyWarned) return;

    await notifyWorkspaceInApp({
      organizationId,
      workspaceId,
      type,
      title: `Approaching this month's ${status.metric} limit`,
      body: `This workspace has used ${status.count} of ${status.limit} ${status.metric} included in its plan this month (${status.period}). Consider upgrading before the limit is reached.`,
    });
  } catch (error) {
    logger.warn({ err: error, organizationId, workspaceId, metric: status?.metric }, "warnUsageSoftLimitOnce: failed to record warning");
  }
}

// Vega's Platform Admin console (master plan, Phase 7) reads this to show a client org's real
// usage against its plan - the first real consumer of UsageCounter's data beyond the enforcement
// path above. Queries the real count for every tracked metric directly (not just the metered
// ones checkUsageLimit short-circuits past) so campaignsRun/automationRuns show real numbers too,
// even though they have no PLAN_LIMITS entry yet - and reuses getUsageLimit for the limit/ratio
// so "what Vega sees" can never silently disagree with what actually gets soft-warned/hard-blocked.
export async function getOrganizationUsageSummary(organizationId) {
  const organization = await Organization.findById(organizationId).select("plan isPlatformOwner");
  const period = currentPeriod();

  if (!organization) return { period, metrics: [] };

  // metric's $in needs mongoose.trusted() too - same sanitizeFilter reasoning as createdAt's
  // $gte above.
  const counters = await UsageCounter.find({ organizationId, period, metric: mongoose.trusted({ $in: TRACKED_METRICS }) }).select("metric count");
  const countByMetric = Object.fromEntries(counters.map((counter) => [counter.metric, counter.count]));

  return {
    period,
    metrics: TRACKED_METRICS.map((metric) => {
      const count = countByMetric[metric] || 0;
      const limit = organization.isPlatformOwner ? null : getUsageLimit(organization.plan, metric);
      const ratio = limit != null ? count / limit : null;
      return {
        metric,
        count,
        limit,
        ratio,
        softWarn: ratio != null && ratio >= SOFT_WARN_RATIO,
        exceeded: limit != null && count >= limit,
      };
    }),
  };
}
