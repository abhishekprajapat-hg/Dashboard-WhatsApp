import { config } from "../config.js";
import { saveMediaBuffer } from "./mediaStorage.js";

export function decodeCredentials(account) {
  const raw = Buffer.from(account.encryptedCredentials || "", "base64").toString("utf8");
  if (!raw) return {};

  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? parsed : { accessToken: raw };
  } catch {
    return { accessToken: raw };
  }
}

function normalizeMetaAttachments(message = {}) {
  const type = ["image", "video", "audio", "document"].find((key) => message[key]);
  if (!type) return [];
  const media = message[type] || {};
  return [{
    providerMediaId: media.id,
    name: media.filename || `${type}-attachment`,
    type,
    mimeType: media.mime_type || "",
    caption: media.caption || "",
  }];
}

function normalizeTwilioAttachments(payload = {}) {
  const count = Number(payload.NumMedia || 0);
  return Array.from({ length: count }, (_, index) => {
    const mimeType = payload[`MediaContentType${index}`] || "";
    return {
      name: `twilio-media-${index + 1}`,
      url: payload[`MediaUrl${index}`],
      type: metaMediaType({ mimeType }),
      mimeType,
      providerMediaId: payload[`MediaSid${index}`] || "",
    };
  }).filter((item) => item.url);
}

function normalizeWatiAttachments(payload = {}) {
  const message = payload.message || payload;
  const candidates = [
    message.media,
    message.attachment,
    message.image,
    message.video,
    message.audio,
    message.document,
    payload.media,
    payload.attachment,
  ].filter(Boolean);

  return candidates.map((item, index) => {
    const url = typeof item === "string" ? item : item.url || item.link || item.mediaUrl || item.fileUrl;
    const mimeType = typeof item === "string" ? "" : item.mimeType || item.mime_type || item.contentType || "";
    return {
      name: typeof item === "string" ? `wati-media-${index + 1}` : item.fileName || item.filename || item.name || `wati-media-${index + 1}`,
      url,
      type: metaMediaType({ type: item.type, mimeType }),
      mimeType,
      providerMediaId: typeof item === "string" ? "" : item.id || item.mediaId || "",
    };
  }).filter((item) => item.url);
}

export async function resolveInboundMedia({ account, normalized, baseUrl }) {
  const attachments = Array.isArray(normalized.attachments) ? normalized.attachments : [];
  if (!attachments.length) return [];

  if (account.provider !== "meta") {
    return attachments;
  }

  const credentials = decodeCredentials(account);
  const accessToken = credentials.accessToken;
  if (!accessToken || isLocalCredential(credentials)) return attachments;

  const resolved = [];
  for (const attachment of attachments) {
    if (!attachment.providerMediaId) {
      resolved.push(attachment);
      continue;
    }

    const infoResponse = await fetch(`https://graph.facebook.com/${config.metaGraphApiVersion}/${attachment.providerMediaId}`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    const info = await infoResponse.json().catch(() => ({}));
    if (!infoResponse.ok || !info.url) {
      resolved.push(attachment);
      continue;
    }

    const mediaResponse = await fetch(info.url, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (!mediaResponse.ok) {
      resolved.push(attachment);
      continue;
    }

    const buffer = Buffer.from(await mediaResponse.arrayBuffer());
    resolved.push(await saveMediaBuffer({
      workspaceId: account.workspaceId,
      buffer,
      name: attachment.name,
      mimeType: info.mime_type || attachment.mimeType || "application/octet-stream",
      baseUrl,
    }));
  }

  return resolved;
}

function primaryCredential(credentials = {}) {
  return credentials.accessToken || credentials.authToken || credentials.apiKey || "";
}

function isLocalCredential(credentials = {}) {
  const value = primaryCredential(credentials);
  return !value || value === "local-placeholder-token" || value.startsWith("local-");
}

function normalizeRecipient(phone = "") {
  return String(phone).replace(/[^\d]/g, "");
}

function firstAttachment(attachments = []) {
  return Array.isArray(attachments) ? attachments.find((item) => item?.url) : null;
}

function metaMediaType(attachment = {}) {
  if (["image", "video", "audio", "document"].includes(attachment.type)) return attachment.type;
  const mimeType = String(attachment.mimeType || "");
  if (mimeType.startsWith("image/")) return "image";
  if (mimeType.startsWith("video/")) return "video";
  if (mimeType.startsWith("audio/")) return "audio";
  return "document";
}

function buildMetaMessagePayload({ recipient, body, attachment }) {
  if (!attachment?.url) {
    return {
      messaging_product: "whatsapp",
      recipient_type: "individual",
      to: recipient,
      type: "text",
      text: { preview_url: false, body },
    };
  }

  const type = metaMediaType(attachment);
  const mediaPayload = { link: attachment.url };
  if (type === "document") {
    mediaPayload.filename = attachment.name || "Attachment";
    if (body) mediaPayload.caption = body;
  } else if (["image", "video"].includes(type) && body) {
    mediaPayload.caption = body;
  }

  return {
    messaging_product: "whatsapp",
    recipient_type: "individual",
    to: recipient,
    type,
    [type]: mediaPayload,
  };
}

export async function sendWhatsAppText({ account, to, body, attachments = [] }) {
  if (!account) {
    return {
      providerMessageId: `local_${Date.now()}`,
      status: "sent",
      mode: "local",
    };
  }

  const credentials = decodeCredentials(account);
  const attachment = firstAttachment(attachments);

  if (isLocalCredential(credentials)) {
    return {
      providerMessageId: `local_${account._id}_${Date.now()}`,
      status: "sent",
      mode: "local",
      to,
      body,
      attachment,
    };
  }

  const recipient = normalizeRecipient(to);

  if (!recipient) {
    const error = new Error("Recipient phone number is missing.");
    error.code = "INVALID_RECIPIENT";
    throw error;
  }

  if (account.provider === "twilio") {
    if (!credentials.accountSid || !credentials.authToken) {
      const error = new Error("Twilio Account SID and Auth Token are required.");
      error.code = "TWILIO_CREDENTIALS_REQUIRED";
      throw error;
    }

    const response = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${credentials.accountSid}/Messages.json`, {
      method: "POST",
      headers: {
        Authorization: `Basic ${Buffer.from(`${credentials.accountSid}:${credentials.authToken}`).toString("base64")}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({
        From: account.phoneNumber.startsWith("whatsapp:") ? account.phoneNumber : `whatsapp:${account.phoneNumber}`,
        To: `whatsapp:+${recipient}`,
        Body: body,
        ...(attachment?.url ? { MediaUrl: attachment.url } : {}),
      }),
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      const error = new Error(payload.message || "Twilio WhatsApp send failed.");
      error.meta = payload;
      error.code = payload.code || "TWILIO_SEND_FAILED";
      error.status = response.status;
      throw error;
    }
    return { providerMessageId: payload.sid || `twilio_${Date.now()}`, status: "sent", mode: "twilio", to: recipient, body };
  }

  if (account.provider === "wati") {
    if (!credentials.apiKey || !credentials.apiBaseUrl) {
      const error = new Error("Wati API endpoint and access token are required.");
      error.code = "WATI_CREDENTIALS_REQUIRED";
      throw error;
    }

    const url = `${String(credentials.apiBaseUrl).replace(/\/$/, "")}/api/v1/sendSessionMessage/${recipient}?messageText=${encodeURIComponent(body)}`;
    const response = await fetch(url, {
      method: "POST",
      headers: { Authorization: `Bearer ${credentials.apiKey}` },
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok || payload.result === false) {
      const error = new Error(payload.info || payload.message || "Wati WhatsApp send failed.");
      error.meta = payload;
      error.code = "WATI_SEND_FAILED";
      error.status = response.status || 502;
      throw error;
    }
    return { providerMessageId: payload.messageId || payload.id || `wati_${Date.now()}`, status: "sent", mode: "wati", to: recipient, body, attachment };
  }

  const accessToken = credentials.accessToken;
  const url = `https://graph.facebook.com/${config.metaGraphApiVersion}/${account.phoneNumberId}/messages`;
  const response = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(buildMetaMessagePayload({ recipient, body, attachment })),
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
    attachment,
  };
}

function countPlaceholders(text = "") {
  const matches = String(text).match(/{{\s*\d+\s*}}/g);
  return matches ? matches.length : 0;
}

function textParameters(values = [], count = 0) {
  return Array.from({ length: count }, (_, index) => ({
    type: "text",
    text: String(values[index] ?? "-"),
  }));
}

function buildTemplateComponents(template, parameters = []) {
  const components = [];
  let parameterIndex = 0;

  for (const component of template.components || []) {
    const type = String(component.type || "").toUpperCase();
    if (!["HEADER", "BODY"].includes(type)) continue;

    const count = countPlaceholders(component.text || "");
    if (!count) continue;

    const values = parameters.slice(parameterIndex, parameterIndex + count);
    parameterIndex += count;
    components.push({
      type: type.toLowerCase(),
      parameters: textParameters(values, count),
    });
  }

  return components;
}

export async function sendWhatsAppTemplate({ account, to, template, parameters = [] }) {
  if (!account || !template) {
    return {
      providerMessageId: `local_template_${Date.now()}`,
      status: "sent",
      mode: "local",
    };
  }

  const credentials = decodeCredentials(account);

  if (isLocalCredential(credentials)) {
    return {
      providerMessageId: `local_template_${account._id}_${Date.now()}`,
      status: "sent",
      mode: "local",
      to,
      template: template.name,
    };
  }

  const recipient = normalizeRecipient(to);
  if (!recipient) {
    const error = new Error("Recipient phone number is missing.");
    error.code = "INVALID_RECIPIENT";
    throw error;
  }

  if (account.provider === "twilio") {
    return sendWhatsAppText({
      account,
      to,
      body: `Template sent: ${template.name}`,
    });
  }

  if (account.provider === "wati") {
    if (!credentials.apiKey || !credentials.apiBaseUrl) {
      const error = new Error("Wati API endpoint and access token are required.");
      error.code = "WATI_CREDENTIALS_REQUIRED";
      throw error;
    }

    const customParams = parameters.map((value, index) => ({ name: String(index + 1), value: String(value ?? "-") }));
    const response = await fetch(`${String(credentials.apiBaseUrl).replace(/\/$/, "")}/api/v1/sendTemplateMessage?whatsappNumber=${recipient}`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${credentials.apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        template_name: template.name,
        broadcast_name: template.name,
        parameters: customParams,
      }),
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok || payload.result === false) {
      const error = new Error(payload.info || payload.message || "Wati template send failed.");
      error.meta = payload;
      error.code = "WATI_TEMPLATE_SEND_FAILED";
      error.status = response.status || 502;
      throw error;
    }
    return { providerMessageId: payload.messageId || payload.id || `wati_template_${Date.now()}`, status: "sent", mode: "wati", to: recipient, template: template.name };
  }

  const accessToken = credentials.accessToken;
  const templatePayload = {
    name: template.name,
    language: { code: template.language || "en" },
  };
  const components = buildTemplateComponents(template, parameters);
  if (components.length) templatePayload.components = components;

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
      type: "template",
      template: templatePayload,
    }),
  });

  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const message = payload?.error?.message || "Meta WhatsApp template send failed.";
    const error = new Error(message);
    error.meta = payload;
    error.code = payload?.error?.code || "META_TEMPLATE_SEND_FAILED";
    error.status = response.status;
    throw error;
  }

  return {
    providerMessageId: payload?.messages?.[0]?.id || `meta_template_${Date.now()}`,
    status: "sent",
    mode: "meta",
    to: recipient,
    template: template.name,
  };
}
export async function fetchWhatsAppTemplates(account) {
  const credentials = decodeCredentials(account);

  if (isLocalCredential(credentials) || account.provider !== "meta") {
    return [
      { providerTemplateId: "order_update", name: "order_update", language: "en", category: "UTILITY", status: "approved" },
      { providerTemplateId: "support_follow_up", name: "support_follow_up", language: "en", category: "UTILITY", status: "approved" },
      { providerTemplateId: "campaign_announcement", name: "campaign_announcement", language: "en", category: "MARKETING", status: "approved" },
    ];
  }

  const accessToken = credentials.accessToken;
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

export async function testWhatsAppConnection(account) {
  if (!account) {
    const error = new Error("WhatsApp account not found.");
    error.code = "ACCOUNT_NOT_FOUND";
    throw error;
  }

  const credentials = decodeCredentials(account);
  if (isLocalCredential(credentials)) {
    return {
      ok: true,
      mode: "local",
      provider: account.provider || "meta",
      message: "Local placeholder credentials are valid for development testing.",
    };
  }

  if (account.provider === "twilio") {
    if (!credentials.accountSid || !credentials.authToken) {
      const error = new Error("Twilio Account SID and Auth Token are required.");
      error.code = "TWILIO_CREDENTIALS_REQUIRED";
      throw error;
    }

    const response = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${credentials.accountSid}.json`, {
      headers: {
        Authorization: `Basic ${Buffer.from(`${credentials.accountSid}:${credentials.authToken}`).toString("base64")}`,
      },
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      const error = new Error(payload.message || "Twilio connection test failed.");
      error.status = response.status;
      error.meta = payload;
      throw error;
    }
    return { ok: true, mode: "twilio", provider: "twilio", message: `Twilio account ${payload.friendly_name || payload.sid} is reachable.` };
  }

  if (account.provider === "wati") {
    if (!credentials.apiKey || !credentials.apiBaseUrl) {
      const error = new Error("Wati API endpoint and access token are required.");
      error.code = "WATI_CREDENTIALS_REQUIRED";
      throw error;
    }

    const response = await fetch(`${String(credentials.apiBaseUrl).replace(/\/$/, "")}/api/v1/getMessageTemplates`, {
      headers: { Authorization: `Bearer ${credentials.apiKey}` },
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok || payload.result === false) {
      const error = new Error(payload.info || payload.message || "Wati connection test failed.");
      error.status = response.status || 502;
      error.meta = payload;
      throw error;
    }
    return { ok: true, mode: "wati", provider: "wati", message: "Wati API is reachable." };
  }

  const templates = await fetchWhatsAppTemplates(account);
  return {
    ok: true,
    mode: "meta",
    provider: "meta",
    message: `Meta Cloud API is reachable. ${templates.length} templates returned.`,
  };
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
      attachments: normalizeMetaAttachments(message),
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

export function normalizeTwilioWebhookPayload(payload = {}) {
  const messageId = payload.MessageSid || payload.SmsMessageSid || `twilio:${Date.now()}`;
  return {
    type: payload.MessageStatus ? "status" : "message",
    idempotencyKey: payload.MessageStatus ? `${messageId}:${payload.MessageStatus}` : messageId,
    phoneNumberId: payload.To || payload.ToCountry || "twilio",
    from: String(payload.From || "").replace(/^whatsapp:/, "").replace(/^\+/, ""),
    body: payload.Body || "",
    attachments: normalizeTwilioAttachments(payload),
    providerMessageId: messageId,
    status: payload.MessageStatus || payload.SmsStatus,
    raw: payload,
  };
}

export function normalizeWatiWebhookPayload(payload = {}) {
  const message = payload.message || payload;
  const messageId = message.id || message.messageId || payload.id || `wati:${Date.now()}`;
  const eventType = String(payload.eventType || payload.type || "").toLowerCase();
  const status = message.statusString || message.status || payload.status;
  return {
    type: eventType.includes("status") || status ? "status" : "message",
    idempotencyKey: status ? `${messageId}:${status}` : messageId,
    phoneNumberId: payload.tenantId || payload.channelId || "wati",
    from: String(message.waId || message.from || payload.waId || payload.whatsappNumber || "").replace(/[^\d]/g, ""),
    body: message.text || message.messageText || message.body || payload.text || "",
    attachments: normalizeWatiAttachments(payload),
    providerMessageId: messageId,
    status,
    raw: payload,
  };
}

