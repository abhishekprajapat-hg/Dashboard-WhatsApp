import { UsageCounter } from "../models/index.js";
import { logger } from "./logger.js";

function currentPeriod() {
  const now = new Date();
  return `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, "0")}`;
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
