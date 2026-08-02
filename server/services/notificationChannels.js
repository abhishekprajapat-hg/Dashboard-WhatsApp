import { config } from "../config.js";

// Request-building is kept as pure functions, same reasoning as aiProviders.js: unit-testable
// against realistic sample shapes without network access or live credentials. sendEmail/sendSms
// are the only parts that actually perform the fetch.

export function buildEmailRequest({ apiKey, fromAddress, fromName, to, subject, body }) {
  return {
    url: "https://api.sendgrid.com/v3/mail/send",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: {
      personalizations: [{ to: [{ email: to }] }],
      from: fromName ? { email: fromAddress, name: fromName } : { email: fromAddress },
      subject,
      content: [{ type: "text/plain", value: body }],
    },
  };
}

// Twilio's SMS send is the exact same endpoint/auth/body shape whatsappProvider.js already uses
// for the Twilio WhatsApp channel (server/services/whatsappProvider.js) - just without the
// whatsapp: prefix on From/To.
export function buildSmsRequest({ accountSid, authToken, fromNumber, to, body }) {
  return {
    url: `https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Messages.json`,
    headers: {
      Authorization: `Basic ${Buffer.from(`${accountSid}:${authToken}`).toString("base64")}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    formBody: new URLSearchParams({ From: fromNumber, To: to, Body: body }),
  };
}

function withTimeout() {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), config.notifications.requestTimeoutMs);
  return { signal: controller.signal, clear: () => clearTimeout(timeout) };
}

export async function sendEmail({ apiKey, fromAddress, fromName, to, subject, body }) {
  if (!apiKey) throw new Error("Missing email provider API key");
  if (!fromAddress) throw new Error("Missing sender (from) address");
  if (!to) throw new Error("Missing recipient email address");

  const { url, headers, body: requestBody } = buildEmailRequest({ apiKey, fromAddress, fromName, to, subject, body });
  const { signal, clear } = withTimeout();
  try {
    const response = await fetch(url, { method: "POST", headers, body: JSON.stringify(requestBody), signal });
    if (!response.ok) {
      const payload = await response.json().catch(() => ({}));
      const message = payload?.errors?.[0]?.message || `SendGrid returned HTTP ${response.status}`;
      throw new Error(message);
    }
    return { status: "sent", messageId: response.headers.get("x-message-id") || "" };
  } catch (error) {
    if (error.name === "AbortError") throw new Error("Email provider request timed out");
    throw error;
  } finally {
    clear();
  }
}

export async function sendSms({ accountSid, authToken, fromNumber, to, body }) {
  if (!accountSid || !authToken) throw new Error("Missing Twilio Account SID/Auth Token");
  if (!fromNumber) throw new Error("Missing sender (from) number");
  if (!to) throw new Error("Missing recipient phone number");

  const { url, headers, formBody } = buildSmsRequest({ accountSid, authToken, fromNumber, to, body });
  const { signal, clear } = withTimeout();
  try {
    const response = await fetch(url, { method: "POST", headers, body: formBody, signal });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      const error = new Error(payload.message || `Twilio SMS send failed (HTTP ${response.status})`);
      error.code = payload.code;
      throw error;
    }
    return { status: "sent", messageId: payload.sid || "" };
  } catch (error) {
    if (error.name === "AbortError") throw new Error("SMS provider request timed out");
    throw error;
  } finally {
    clear();
  }
}
