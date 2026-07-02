import { Workspace } from "../models/index.js";

const sheetWebhookUrl = process.env.GOOGLE_SHEET_WEBHOOK_URL || "";
const sheetWebhookSecret = process.env.GOOGLE_SHEET_WEBHOOK_SECRET || "";

function toIso(value) {
  return value ? new Date(value).toISOString() : new Date().toISOString();
}

export function hasGoogleSheetWebhook() {
  return Boolean(sheetWebhookUrl);
}

async function getSheetConfig(workspaceId) {
  const workspace = workspaceId ? await Workspace.findById(workspaceId).select("settings") : null;
  const googleSheets = workspace?.settings?.integrations?.googleSheets || {};
  return {
    url: sheetWebhookUrl || (googleSheets.enabled ? googleSheets.webhookUrl : ""),
    secret: sheetWebhookSecret || googleSheets.secret || "",
  };
}

function pushSyncLog(items = [], entry) {
  return [...(Array.isArray(items) ? items : []), entry].slice(-50);
}

async function markLeadSheetSync(lead, patch) {
  if (!lead) return;
  lead.syncStatus = {
    ...(lead.syncStatus || {}),
    googleSheet: {
      ...(lead.syncStatus?.googleSheet || {}),
      ...patch,
    },
  };
  lead.syncLog = pushSyncLog(lead.syncLog, {
    provider: "google_sheet",
    at: new Date(),
    status: patch.status,
    error: patch.error || "",
  });
  lead.markModified("syncStatus");
  lead.markModified("syncLog");
  await lead.save();
}

async function markContactSheetSync(contact, patch) {
  if (!contact) return;
  const customFields = contact.customFields && typeof contact.customFields === "object" ? contact.customFields : {};
  const sheet = customFields.googleSheet && typeof customFields.googleSheet === "object" ? customFields.googleSheet : {};
  contact.customFields = {
    ...customFields,
    googleSheet: {
      ...sheet,
      status: patch.status,
      lastAttemptAt: patch.lastAttemptAt || new Date(),
      syncedAt: patch.lastSyncedAt || sheet.syncedAt,
      error: patch.error || "",
      response: patch.response || sheet.response || "",
    },
  };
  contact.markModified("customFields");
  await contact.save();
}

export async function syncLeadToGoogleSheet({ contact, conversation, message, lead }) {
  const config = await getSheetConfig(conversation?.workspaceId || contact?.workspaceId);

  if (!config.url || !contact || !conversation) {
    await markLeadSheetSync(lead, { status: "skipped", lastAttemptAt: new Date(), error: "missing_webhook" });
    await markContactSheetSync(contact, { status: "skipped", lastAttemptAt: new Date(), error: "missing_webhook" });
    return { skipped: true, reason: "missing_webhook" };
  }

  const customFields = contact.customFields && typeof contact.customFields === "object" ? contact.customFields : {};
  const sheet = customFields.googleSheet && typeof customFields.googleSheet === "object" ? customFields.googleSheet : {};

  if (sheet.syncedAt) {
    await markLeadSheetSync(lead, { status: "skipped", lastAttemptAt: new Date(), error: "already_synced" });
    await markContactSheetSync(contact, { status: "synced", lastAttemptAt: new Date(), error: "", lastSyncedAt: sheet.syncedAt });
    return { skipped: true, reason: "already_synced" };
  }

  await markLeadSheetSync(lead, { status: "syncing", lastAttemptAt: new Date(), error: "" });
  await markContactSheetSync(contact, { status: "syncing", lastAttemptAt: new Date(), error: "" });

  const payload = {
    secret: config.secret || undefined,
    timestamp: toIso(message?.receivedAt || conversation.lastMessageAt || contact.lastMessageAt),
    name: contact.name || contact.phone,
    phone: contact.phone,
    email: contact.email || "",
    message: message?.body || "",
    source: contact.customFields?.leadSource === "meta_ad" ? "Meta Ad" : contact.source || "WhatsApp",
    status: contact.lifecycleStatus || "lead",
    stage: contact.customFields?.crm?.stage || "new_lead",
    conversationId: conversation._id?.toString?.() || String(conversation._id || ""),
    contactId: contact._id?.toString?.() || String(contact._id || ""),
    providerMessageId: message?.providerMessageId || "",
    leadId: lead?._id?.toString?.() || "",
  };

  const response = await fetch(config.url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });

  const responseText = await response.text().catch(() => "");
  if (!response.ok) {
    const error = new Error(responseText || "Google Sheet webhook failed.");
    error.status = response.status;
    await markLeadSheetSync(lead, { status: "failed", lastAttemptAt: new Date(), error: error.message });
    await markContactSheetSync(contact, { status: "failed", lastAttemptAt: new Date(), error: error.message });
    throw error;
  }

  contact.customFields = {
    ...customFields,
    googleSheet: {
      ...sheet,
      syncedAt: new Date(),
      providerMessageId: payload.providerMessageId,
      leadId: payload.leadId,
      response: responseText.slice(0, 500),
    },
  };
  contact.markModified("customFields");
  await contact.save();
  await markLeadSheetSync(lead, {
    status: "synced",
    lastAttemptAt: new Date(),
    lastSyncedAt: new Date(),
    error: "",
    response: responseText.slice(0, 500),
  });
  await markContactSheetSync(contact, {
    status: "synced",
    lastAttemptAt: new Date(),
    lastSyncedAt: new Date(),
    error: "",
    response: responseText.slice(0, 500),
  });

  return { skipped: false };
}

export function syncLeadToGoogleSheetInBackground({ contact, conversation, message, lead, onError } = {}) {
  void syncLeadToGoogleSheet({ contact, conversation, message, lead }).catch((error) => {
    onError?.(error);
  });
}

