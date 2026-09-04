import { config } from "../config.js";
import { logger } from "./logger.js";

function withTimeout() {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), config.billstack.requestTimeoutMs);
  return { signal: controller.signal, clear: () => clearTimeout(timeout) };
}

// Calls BillStack's own real, already-shipped external-integration endpoint
// (POST /api/integrations/orders, see billstack/backend/src/services/integration.service.js) -
// this app never touches BillStack's database or session-only routes directly, only this one
// API-key-authenticated surface BillStack itself built for third-party systems. `apiKey` and
// `baseUrl` are per-workspace (each tenant's own BillStack credential/deployment), never a
// Nemnidhi-wide secret - baseUrl falls back to config.billstack.baseUrl (Nemnidhi's own shared
// BillStack instance) only when a workspace hasn't set its own, e.g. for a self-hosted BillStack.
export async function sendBillstackOrder({ baseUrl, apiKey, order }) {
  const targetUrl = String(baseUrl || config.billstack.baseUrl || "").replace(/\/+$/, "");
  if (!targetUrl || !apiKey) {
    return { ok: false, reason: "not_configured" };
  }

  const { signal, clear } = withTimeout();
  try {
    const response = await fetch(`${targetUrl}/api/integrations/orders`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Billstack-Api-Key": apiKey },
      body: JSON.stringify(order),
      signal,
    });
    const body = await response.json().catch(() => null);
    if (!response.ok) {
      const reason = body?.message || body?.error?.message || `http_${response.status}`;
      logger.warn({ status: response.status, reason, externalOrderId: order?.externalOrderId }, "sendBillstackOrder: BillStack rejected the order");
      return { ok: false, reason };
    }
    const event = body?.data?.event;
    return {
      ok: true,
      idempotent: Boolean(body?.data?.idempotent),
      invoiceId: event?.invoiceId?.toString?.() || event?.invoiceId || "",
      customerId: event?.customerId?.toString?.() || event?.customerId || "",
      eventStatus: event?.status || "",
    };
  } catch (error) {
    logger.warn({ err: error, externalOrderId: order?.externalOrderId }, "sendBillstackOrder: request failed");
    return { ok: false, reason: "request_failed" };
  } finally {
    clear();
  }
}
