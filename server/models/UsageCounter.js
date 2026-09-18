import mongoose from "mongoose";

// One document per organization+period+metric, incremented atomically via findOneAndUpdate's
// $inc/upsert (see services/usageMetering.js) - never read-then-write, so concurrent sends from
// the same organization can't race and drop a count. Pure additive/observability for now: nothing
// reads this to block anything yet (that's PLAN_LIMITS/requireUnderUsageLimit, a later phase).
const usageCounterSchema = new mongoose.Schema(
  {
    organizationId: { type: mongoose.Schema.Types.ObjectId, ref: "Organization", required: true, index: true },
    // Calendar month, UTC, e.g. "2026-09" - matches how billing.js/entitlements.js already reason
    // about billing cycles, so a usage-limit check later can compare against "this month" without
    // a separate date-window calculation.
    period: { type: String, required: true },
    // "messagesSent" | "campaignsRun" | "automationRuns" - see services/usageMetering.js for the
    // exact call sites. Not a hard enum for the same reason plan/billingStatus aren't elsewhere in
    // this codebase - a metric added later must never fail to save on an older deploy.
    metric: { type: String, required: true },
    count: { type: Number, default: 0 },
  },
  { timestamps: true }
);

usageCounterSchema.index({ organizationId: 1, period: 1, metric: 1 }, { unique: true });

export const UsageCounter = mongoose.model("UsageCounter", usageCounterSchema);
