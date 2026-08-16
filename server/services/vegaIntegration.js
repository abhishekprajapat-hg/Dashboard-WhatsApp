import { config } from "../config.js";
import { logger } from "./logger.js";

function withTimeout() {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), config.vega.requestTimeoutMs);
  return { signal: controller.signal, clear: () => clearTimeout(timeout) };
}

// Best-effort, fire-and-forget: a Vega outage or an unconfigured integration must never break
// whatever Dashboard-side action triggered this. Callers await it (so failures are observable in
// tests/logs) but should never let its result gate the response to their own caller - same
// defensive shape as notificationChannels.js's sendEmail/sendSms, just one level more forgiving
// since there's no user-facing "delivery failed" state for this, only a log line.
export async function notifyVega(organizationId, event, data = {}) {
  if (!config.vega.apiUrl || !config.vega.integrationSecret) {
    return { sent: false, reason: "not_configured" };
  }

  const { signal, clear } = withTimeout();
  try {
    const response = await fetch(`${config.vega.apiUrl}/api/integrations/dashboard-events`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-integration-secret": config.vega.integrationSecret },
      body: JSON.stringify({ dashboardOrganizationId: organizationId, event, data }),
      signal,
    });
    if (!response.ok) {
      logger.warn({ status: response.status, event, organizationId }, "notifyVega: Vega rejected the event");
      return { sent: false, reason: `http_${response.status}` };
    }
    return { sent: true };
  } catch (error) {
    logger.warn({ err: error, event, organizationId }, "notifyVega: request failed");
    return { sent: false, reason: "request_failed" };
  } finally {
    clear();
  }
}
