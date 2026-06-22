import { config } from "../config.js";

function decodeAccessToken(account) {
  const token = Buffer.from(account.encryptedCredentials || "", "base64").toString("utf8");
  return token || "";
}

function isLocalToken(token) {
  return !token || token === "local-placeholder-token" || token.startsWith("local-");
}

function normalizeRecipient(phone = "") {
  return String(phone).replace(/[^\d]/g, "");
}

export async function sendWhatsAppText({ account, to, body }) {
  if (!account) {
    return {
      providerMessageId: `local_${Date.now()}`,
      status: "sent",
      mode: "local",
    };
  }

  const accessToken = decodeAccessToken(account);

  if (isLocalToken(accessToken)) {
    return {
      providerMessageId: `local_${account._id}_${Date.now()}`,
      status: "sent",
      mode: "local",
      to,
      body,
    };
  }

  const recipient = normalizeRecipient(to);

  if (!recipient) {
    const error = new Error("Recipient phone number is missing.");
    error.code = "INVALID_RECIPIENT";
    throw error;
  }

  const url = `https://graph.facebook.com/${config.metaGraphApiVersion}/${account.phoneNumberId}/messages`;
  const response = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      messaging_product: "whatsapp",
      recipient_type: "individual",
      to: recipient,
      type: "text",
      text: {
        preview_url: false,
        body,
      },
    }),
  });

  const payload = await response.json().catch(() => ({}));

  if (!response.ok) {
    const message = payload?.error?.message || "Meta WhatsApp send failed.";
    const error = new Error(message);
    error.meta = payload;
    error.code = payload?.error?.code || "META_SEND_FAILED";
    error.status = response.status;
    throw error;
  }

  return {
    providerMessageId: payload?.messages?.[0]?.id || `meta_${Date.now()}`,
    status: "sent",
    mode: "meta",
    to: recipient,
    body,
  };
}

export async function fetchWhatsAppTemplates(account) {
  const accessToken = decodeAccessToken(account);

  if (isLocalToken(accessToken)) {
    return [
      { providerTemplateId: "order_update", name: "order_update", language: "en", category: "UTILITY", status: "approved" },
      { providerTemplateId: "support_follow_up", name: "support_follow_up", language: "en", category: "UTILITY", status: "approved" },
      { providerTemplateId: "campaign_announcement", name: "campaign_announcement", language: "en", category: "MARKETING", status: "approved" },
    ];
  }

  const url = `https://graph.facebook.com/${config.metaGraphApiVersion}/${account.businessAccountId}/message_templates?fields=id,name,language,category,status,components&limit=100`;
  const response = await fetch(url, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
    },
  });
  const payload = await response.json().catch(() => ({}));

  if (!response.ok) {
    const message = payload?.error?.message || "Meta template sync failed.";
    const error = new Error(message);
    error.meta = payload;
    throw error;
  }

  return (payload.data || []).map((template) => ({
    providerTemplateId: template.id,
    name: template.name,
    language: template.language,
    category: template.category,
    status: String(template.status || "pending").toLowerCase(),
    components: template.components || [],
  }));
}

export function normalizeWebhookPayload(payload) {
  const entry = payload?.entry?.[0];
  const change = entry?.changes?.[0];
  const value = change?.value || {};
  const message = value.messages?.[0];
  const status = value.statuses?.[0];

  if (message) {
    return {
      type: "message",
      idempotencyKey: message.id,
      phoneNumberId: value.metadata?.phone_number_id,
      from: message.from,
      body: message.text?.body || "",
      providerMessageId: message.id,
      referral: message.referral || null,
      raw: payload,
    };
  }

  if (status) {
    return {
      type: "status",
      idempotencyKey: `${status.id}:${status.status}`,
      phoneNumberId: value.metadata?.phone_number_id,
      providerMessageId: status.id,
      status: status.status,
      raw: payload,
    };
  }

  return {
    type: "unknown",
    idempotencyKey: `unknown:${Date.now()}`,
    raw: payload,
  };
}

