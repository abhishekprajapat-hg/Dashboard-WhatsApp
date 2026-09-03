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

// Unlike notifyVega above, these three back real automation-flow branches (check_office_hours,
// book_meeting) - a caller genuinely needs to know if the call failed, not just log it and move
// on. Still never throws: an unreachable/unconfigured Vega degrades to "closed"/"no slots"
// rather than crashing the run, same fire-and-forget spirit, just with a real return value.

export async function checkVegaOfficeHours() {
  if (!config.vega.apiUrl || !config.vega.integrationSecret) {
    return { ok: false, reason: "not_configured" };
  }

  const { signal, clear } = withTimeout();
  try {
    const response = await fetch(`${config.vega.apiUrl}/api/integrations/office-hours`, {
      method: "GET",
      headers: { "x-integration-secret": config.vega.integrationSecret },
      signal,
    });
    if (!response.ok) {
      logger.warn({ status: response.status }, "checkVegaOfficeHours: Vega rejected the request");
      return { ok: false, reason: `http_${response.status}` };
    }
    const body = await response.json();
    return { ok: true, ...body.data };
  } catch (error) {
    logger.warn({ err: error }, "checkVegaOfficeHours: request failed");
    return { ok: false, reason: "request_failed" };
  } finally {
    clear();
  }
}

export async function fetchVegaMeetingSlots({ type = "online", days } = {}) {
  if (!config.vega.apiUrl || !config.vega.integrationSecret) {
    return { ok: false, reason: "not_configured" };
  }

  const { signal, clear } = withTimeout();
  try {
    const params = new URLSearchParams({ type });
    if (days) params.set("days", String(days));
    const response = await fetch(`${config.vega.apiUrl}/api/integrations/meetings/slots?${params}`, {
      method: "GET",
      headers: { "x-integration-secret": config.vega.integrationSecret },
      signal,
    });
    if (!response.ok) {
      logger.warn({ status: response.status }, "fetchVegaMeetingSlots: Vega rejected the request");
      return { ok: false, reason: `http_${response.status}` };
    }
    const body = await response.json();
    return { ok: true, ...body.data };
  } catch (error) {
    logger.warn({ err: error }, "fetchVegaMeetingSlots: request failed");
    return { ok: false, reason: "request_failed" };
  } finally {
    clear();
  }
}

export async function bookVegaMeeting(payload) {
  if (!config.vega.apiUrl || !config.vega.integrationSecret) {
    return { ok: false, reason: "not_configured" };
  }

  const { signal, clear } = withTimeout();
  try {
    const response = await fetch(`${config.vega.apiUrl}/api/integrations/meetings/book`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-integration-secret": config.vega.integrationSecret },
      body: JSON.stringify(payload),
      signal,
    });
    const body = await response.json().catch(() => null);
    if (!response.ok) {
      logger.warn({ status: response.status, error: body?.error?.message }, "bookVegaMeeting: Vega rejected the booking");
      return { ok: false, reason: body?.error?.message || `http_${response.status}` };
    }
    return { ok: true, ...body.data };
  } catch (error) {
    logger.warn({ err: error }, "bookVegaMeeting: request failed");
    return { ok: false, reason: "request_failed" };
  } finally {
    clear();
  }
}

// The reminder sweep's read/write pair - see meetingReminders.js for the caller. Same
// not-configured/timeout/non-2xx degradation as the three functions above.

export async function fetchUpcomingVegaMeetings(window) {
  if (!config.vega.apiUrl || !config.vega.integrationSecret) {
    return { ok: false, reason: "not_configured" };
  }

  const { signal, clear } = withTimeout();
  try {
    const response = await fetch(`${config.vega.apiUrl}/api/integrations/meetings/upcoming?window=${window}`, {
      method: "GET",
      headers: { "x-integration-secret": config.vega.integrationSecret },
      signal,
    });
    if (!response.ok) {
      logger.warn({ status: response.status, window }, "fetchUpcomingVegaMeetings: Vega rejected the request");
      return { ok: false, reason: `http_${response.status}` };
    }
    const body = await response.json();
    return { ok: true, ...body.data };
  } catch (error) {
    logger.warn({ err: error, window }, "fetchUpcomingVegaMeetings: request failed");
    return { ok: false, reason: "request_failed" };
  } finally {
    clear();
  }
}

export async function markVegaMeetingReminded(meetingId, window) {
  if (!config.vega.apiUrl || !config.vega.integrationSecret) {
    return { ok: false, reason: "not_configured" };
  }

  const { signal, clear } = withTimeout();
  try {
    const response = await fetch(`${config.vega.apiUrl}/api/integrations/meetings/${meetingId}/remind`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-integration-secret": config.vega.integrationSecret },
      body: JSON.stringify({ window }),
      signal,
    });
    if (!response.ok) {
      logger.warn({ status: response.status, meetingId, window }, "markVegaMeetingReminded: Vega rejected the request");
      return { ok: false, reason: `http_${response.status}` };
    }
    return { ok: true };
  } catch (error) {
    logger.warn({ err: error, meetingId, window }, "markVegaMeetingReminded: request failed");
    return { ok: false, reason: "request_failed" };
  } finally {
    clear();
  }
}

// Used by the "CTWA - meeting reschedule" satellite flow's cancel_meeting node, before it books a
// fresh slot - same not-configured/timeout/non-2xx degradation as every function above.
export async function cancelVegaMeeting(meetingId, reason) {
  if (!config.vega.apiUrl || !config.vega.integrationSecret) {
    return { ok: false, reason: "not_configured" };
  }

  const { signal, clear } = withTimeout();
  try {
    const response = await fetch(`${config.vega.apiUrl}/api/integrations/meetings/${meetingId}/cancel`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-integration-secret": config.vega.integrationSecret },
      body: JSON.stringify({ reason }),
      signal,
    });
    if (!response.ok) {
      logger.warn({ status: response.status, meetingId }, "cancelVegaMeeting: Vega rejected the request");
      return { ok: false, reason: `http_${response.status}` };
    }
    return { ok: true };
  } catch (error) {
    logger.warn({ err: error, meetingId }, "cancelVegaMeeting: request failed");
    return { ok: false, reason: "request_failed" };
  } finally {
    clear();
  }
}
