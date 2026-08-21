import fs from "fs/promises";
import path from "path";
import crypto from "crypto";
import { config } from "../config.js";
import { saveMediaBuffer, uploadRoot } from "./mediaStorage.js";

const encryptedCredentialPrefix = "v1";

function credentialEncryptionKey() {
  return crypto.createHash("sha256").update(config.credentialEncryptionSecret).digest();
}

function decodeStoredCredentials(stored = "") {
  if (stored.startsWith(`${encryptedCredentialPrefix}:`)) {
    const [, ivValue, tagValue, encryptedValue] = stored.split(":");
    if (!ivValue || !tagValue || !encryptedValue) return "";
    const decipher = crypto.createDecipheriv("aes-256-gcm", credentialEncryptionKey(), Buffer.from(ivValue, "base64"));
    decipher.setAuthTag(Buffer.from(tagValue, "base64"));
    return Buffer.concat([
      decipher.update(Buffer.from(encryptedValue, "base64")),
      decipher.final(),
    ]).toString("utf8");
  }

  return Buffer.from(stored || "", "base64").toString("utf8");
}

export function decodeCredentials(account) {
  const fallback = {
    accessToken: process.env.WHATSAPP_ACCESS_TOKEN || "",
    verifyToken: process.env.WHATSAPP_VERIFY_TOKEN || config.whatsappVerifyToken || "",
    appSecret: process.env.WHATSAPP_APP_SECRET || "",
  };

  let raw = "";
  try {
    raw = decodeStoredCredentials(account.encryptedCredentials || "");
  } catch {
    return fallback;
  }

  if (!raw) return fallback;

  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? mergeCredentialFallbacks(parsed, fallback) : { ...fallback, accessToken: raw };
  } catch {
    return { ...fallback, accessToken: raw };
  }
}

function mergeCredentialFallbacks(credentials, fallback) {
  return Object.fromEntries(
    Object.entries({ ...fallback, ...credentials }).map(([key, value]) => [
      key,
      value === "" || value === undefined || value === null ? fallback[key] || "" : value,
    ])
  );
}

export function encodeCredentials(credentials = {}) {
  const safeCredentials = Object.fromEntries(
    Object.entries(credentials)
      .filter(([, value]) => value !== undefined && value !== null)
      .map(([key, value]) => [key, typeof value === "string" ? value.trim() : value])
  );

  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", credentialEncryptionKey(), iv);
  const encrypted = Buffer.concat([
    cipher.update(JSON.stringify(safeCredentials), "utf8"),
    cipher.final(),
  ]);
  const tag = cipher.getAuthTag();

  return [
    encryptedCredentialPrefix,
    iv.toString("base64"),
    tag.toString("base64"),
    encrypted.toString("base64"),
  ].join(":");
}

export function credentialSummary(account) {
  const credentials = decodeCredentials(account);
  return {
    accessTokenConfigured: Boolean(primaryCredential(credentials)),
    verifyTokenConfigured: Boolean(credentials.verifyToken),
    appSecretConfigured: Boolean(credentials.appSecret),
    credentialsUpdatedAt: account.credentialsUpdatedAt || account.updatedAt || null,
    lastTestedAt: account.lastTestedAt || null,
    lastError: account.lastError || "",
  };
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
  // Exact match only - this is the literal sentinel the "connect WhatsApp account" flow
  // (routes/whatsapp.js) writes when no token is supplied. A broader startsWith("local-") prefix
  // check would misclassify - and silently never send - any real token that happens to start
  // with those characters.
  return !value || value === "local-placeholder-token";
}

function normalizeRecipient(phone = "") {
  return String(phone).replace(/[^\d]/g, "");
}

function attachmentMediaId(attachment = {}) {
  if (!attachment) return "";
  return attachment.providerMediaId || attachment.metaMediaId || "";
}

function firstAttachment(attachments = []) {
  return Array.isArray(attachments) ? attachments.find((item) => item?.url || attachmentMediaId(item)) : null;
}

function metaMediaType(attachment = {}) {
  attachment = attachment || {};
  if (["image", "video", "audio", "document"].includes(attachment.type)) return attachment.type;
  const mimeType = String(attachment.mimeType || "");
  if (mimeType.startsWith("image/")) return "image";
  if (mimeType.startsWith("video/")) return "video";
  if (mimeType.startsWith("audio/")) return "audio";
  return "document";
}

function buildMetaMessagePayload({ recipient, body, attachment }) {
  const mediaId = attachmentMediaId(attachment);
  if (!attachment?.url && !mediaId) {
    return {
      messaging_product: "whatsapp",
      recipient_type: "individual",
      to: recipient,
      type: "text",
      text: { preview_url: false, body },
    };
  }

  const type = metaMediaType(attachment);
  const mediaPayload = mediaId
    ? { id: mediaId }
    : { link: attachment.url };
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

function localUploadPath(attachment = {}) {
  const storedPath = String(attachment.path || "");
  const uploadPrefix = "/api/uploads/";
  if (!storedPath.startsWith(uploadPrefix)) return "";
  const relativePath = storedPath.slice(uploadPrefix.length).replace(/\\/g, "/");
  const absolutePath = path.resolve(uploadRoot, relativePath);
  const relativeFromRoot = path.relative(uploadRoot, absolutePath);
  if (relativeFromRoot.startsWith("..") || path.isAbsolute(relativeFromRoot)) return "";
  return absolutePath;
}

async function attachmentBytes(attachment = {}) {
  const localPath = localUploadPath(attachment);
  if (localPath) {
    const buffer = await fs.readFile(localPath);
    return { buffer, name: attachment.name || path.basename(localPath) || "attachment", mimeType: attachment.mimeType || "application/octet-stream" };
  }

  if (!attachment.url) return null;
  const response = await fetch(attachment.url);
  if (!response.ok) return null;
  const buffer = Buffer.from(await response.arrayBuffer());
  return {
    buffer,
    name: attachment.name || "attachment",
    mimeType: attachment.mimeType || response.headers.get("content-type") || "application/octet-stream",
  };
}

async function uploadMetaAttachment({ account, accessToken, attachment }) {
  if (!attachment?.url || attachmentMediaId(attachment)) return attachment;

  const bytes = await attachmentBytes(attachment).catch(() => null);
  if (!bytes?.buffer?.length) return attachment;

  const form = new FormData();
  form.append("messaging_product", "whatsapp");
  form.append("type", bytes.mimeType);
  form.append("file", new Blob([bytes.buffer], { type: bytes.mimeType }), bytes.name);

  const response = await fetch(`https://graph.facebook.com/${config.metaGraphApiVersion}/${account.phoneNumberId}/media`, {
    method: "POST",
    headers: { Authorization: `Bearer ${accessToken}` },
    body: form,
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || !payload.id) {
    const error = new Error(payload?.error?.message || "Meta media upload failed.");
    error.meta = payload;
    error.code = payload?.error?.code || "META_MEDIA_UPLOAD_FAILED";
    error.status = response.status;
    throw error;
  }

  return { ...attachment, providerMediaId: payload.id, metaMediaId: payload.id };
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
  const metaAttachment = attachment
    ? await uploadMetaAttachment({ account, accessToken, attachment })
    : null;
  const url = `https://graph.facebook.com/${config.metaGraphApiVersion}/${account.phoneNumberId}/messages`;
  const response = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(buildMetaMessagePayload({ recipient, body, attachment: metaAttachment })),
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
    attachment: metaAttachment,
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

export async function sendWhatsAppTemplate({ account, to, template, parameters = [], useMarketingMessagesLite = false }) {
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

  // Marketing Messages Lite is a routing choice, not a different message shape - Meta's own docs
  // describe /marketing_messages as "a similar technical schema and same billing model" as the
  // regular /messages endpoint. Only send MARKETING-category templates through it (the campaign
  // route validates this before it ever reaches here); other categories always use /messages.
  const isMarketingCategory = String(template.category || "").toUpperCase() === "MARKETING";
  const endpoint = useMarketingMessagesLite && isMarketingCategory ? "marketing_messages" : "messages";
  const url = `https://graph.facebook.com/${config.metaGraphApiVersion}/${account.phoneNumberId}/${endpoint}`;
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
    viaMarketingMessagesLite: endpoint === "marketing_messages",
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
    const contact = value.contacts?.find((item) => item.wa_id === message.from) || value.contacts?.[0] || {};
    const nfmReply = message.interactive?.type === "nfm_reply" ? message.interactive.nfm_reply : null;
    let flowResponse = null;
    if (nfmReply) {
      try {
        flowResponse = { name: nfmReply.name || "", body: nfmReply.body || "", data: JSON.parse(nfmReply.response_json || "{}") };
      } catch {
        flowResponse = { name: nfmReply.name || "", body: nfmReply.body || "", data: {} };
      }
    }
    return {
      type: "message",
      idempotencyKey: message.id,
      phoneNumberId: value.metadata?.phone_number_id,
      from: message.from,
      body: message.text?.body || "",
      attachments: normalizeMetaAttachments(message),
      providerMessageId: message.id,
      referral: message.referral || null,
      flowResponse,
      profile: {
        waName: contact.profile?.name || "",
        waId: contact.wa_id || message.from,
        profilePhoto: contact.profile?.profile_picture_url || contact.profile?.picture || "",
      },
      location: message.location || null,
      campaign: message.referral?.headline || message.referral?.source_id || "",
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
    profile: {
      waName: payload.ProfileName || payload.WaName || "",
      waId: String(payload.WaId || payload.From || "").replace(/[^\d]/g, ""),
      profilePhoto: payload.ProfilePhoto || "",
    },
    location: payload.Latitude || payload.Longitude ? {
      latitude: payload.Latitude,
      longitude: payload.Longitude,
      address: payload.Address || "",
      name: payload.Label || "",
    } : null,
    campaign: payload.Campaign || payload.UtmCampaign || "",
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
    profile: {
      waName: message.senderName || message.sender?.name || payload.senderName || "",
      waId: String(message.waId || message.from || payload.waId || "").replace(/[^\d]/g, ""),
      profilePhoto: message.senderPhoto || message.profilePhoto || payload.profilePhoto || "",
    },
    location: message.location || payload.location || null,
    campaign: message.campaign || payload.campaign || "",
    raw: payload,
  };
}

