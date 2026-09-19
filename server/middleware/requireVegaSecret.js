import crypto from "crypto";
import { config } from "../config.js";
import { logger } from "../services/logger.js";

const HEADER = "x-integration-secret";

function secretsMatch(a, b) {
  if (!a || !b) return false;
  const bufferA = Buffer.from(String(a));
  const bufferB = Buffer.from(String(b));
  return bufferA.length === bufferB.length && crypto.timingSafeEqual(bufferA, bufferB);
}

// Server-to-server only, mirrors Vega's own assertValidDashboardSecret (src/lib/auth/dashboard-
// actor.ts) in reverse: Vega's Platform Admin console calls every /api/platform-admin/* route
// directly, no user session involved. Deliberately reuses the SAME shared secret this server
// already sends when calling OUT to Vega (config.vega.integrationSecret / VEGA_INTEGRATION_SECRET,
// see services/vegaIntegration.js) rather than minting a second one - it's one shared secret
// between two Nemnidhi-owned systems, and Vega's own DASHBOARD_INTEGRATION_SECRET env var must
// already hold this same value for the existing dashboard-events/dashboard-leads calls to work.
// Fails CLOSED if unconfigured, same reasoning as requireActionPassword.
export function requireVegaSecret(req, res, next) {
  if (!config.vega.integrationSecret) {
    logger.error("requireVegaSecret: VEGA_INTEGRATION_SECRET is not set - refusing a platform-admin call");
    return res.status(503).json({
      error: "NOT_CONFIGURED",
      message: "Platform admin integration secret is not configured on this server.",
    });
  }

  const supplied = req.get(HEADER) || "";
  if (!secretsMatch(supplied, config.vega.integrationSecret)) {
    logger.warn({ path: req.originalUrl }, "requireVegaSecret: rejected an invalid or missing integration secret");
    return res.status(401).json({ error: "UNAUTHORIZED", message: "Invalid integration secret." });
  }

  next();
}
