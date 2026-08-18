import { config } from "../config.js";
import { decodeCredentials } from "./whatsappProvider.js";

// Reports a real business outcome (a lead converting) back to Meta, tied to the WhatsApp ad click
// that originated the conversation, so ad delivery can optimize for revenue instead of just
// lead-form-fills. No-ops whenever the account isn't configured for this or there's no click id to
// attribute the event to - callers never need their own guard logic before calling this.
export async function sendConversionEvent(account, { eventName, ctwaClid, value, currency, testEventCode } = {}) {
  if (!account?.conversionsDatasetId || !ctwaClid) {
    return { ok: true, skipped: true };
  }

  const credentials = decodeCredentials(account);
  if (!credentials.accessToken || credentials.accessToken === "local-placeholder-token") {
    return { ok: true, skipped: true, reason: "local_credentials" };
  }

  const url = `https://graph.facebook.com/${config.metaGraphApiVersion}/${account.conversionsDatasetId}/events`;

  const event = {
    event_name: eventName || "QualifiedLead",
    event_time: Math.floor(Date.now() / 1000),
    action_source: "business_messaging",
    messaging_channel: "whatsapp",
    user_data: {
      whatsapp_business_account_id: account.businessAccountId,
      ctwa_clid: ctwaClid,
    },
    ...(value ? { custom_data: { currency: currency || "INR", value } } : {}),
  };

  const body = {
    data: [event],
    ...(testEventCode || account.conversionsTestEventCode
      ? { test_event_code: testEventCode || account.conversionsTestEventCode }
      : {}),
  };

  const response = await fetch(`${url}?access_token=${encodeURIComponent(credentials.accessToken)}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const payload = await response.json().catch(() => ({}));

  if (!response.ok || payload.error) {
    const error = new Error(payload.error?.message || "Meta Conversions API request failed.");
    error.status = response.status || 502;
    error.code = payload.error?.code || "META_CONVERSIONS_REQUEST_FAILED";
    error.meta = payload;
    throw error;
  }

  return { ok: true, eventsReceived: payload.events_received ?? 0, messages: payload.messages || [] };
}
