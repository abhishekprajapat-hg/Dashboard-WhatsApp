import mongoose from "mongoose";
import { checkUsageLimit, usageLimitMessage, warnUsageSoftLimitOnce } from "../services/usageMetering.js";
import { getFlagSync } from "../services/featureFlags.js";
import { logger } from "../services/logger.js";

// Mirrors requireActiveBilling's shape (middleware/billingGate.js) - a soft lock on the specific
// send/launch routes it's applied to, not a login block. Runs after requireAuth +
// requireWorkspaceContext, so req.user.organizationId/workspaceId are guaranteed present.
//
// Fails open on any lookup error, deliberately unlike requireEntitlement/requireActiveBilling
// (which fail closed on a missing organization) - a usage-limit check is metering/cost-control,
// not access control, and an outage in it must never block a real customer's message.
export function requireUnderUsageLimit(metric) {
  return async (req, res, next) => {
    if (mongoose.connection.readyState !== 1) return next();

    try {
      const status = await checkUsageLimit(req.user.organizationId, metric);
      if (!status.limited) return next();

      if (status.softWarn) {
        warnUsageSoftLimitOnce(req.user.organizationId, req.user.workspaceId, status).catch(() => undefined);
      }

      if (status.exceeded && getFlagSync("usageLimitHardBlock")) {
        return res.status(429).json({
          error: "USAGE_LIMIT_EXCEEDED",
          metric,
          limit: status.limit,
          count: status.count,
          message: usageLimitMessage(metric, status.limit),
        });
      }
    } catch (error) {
      logger.warn({ err: error, metric }, "requireUnderUsageLimit: check failed, allowing request through");
    }
    next();
  };
}
