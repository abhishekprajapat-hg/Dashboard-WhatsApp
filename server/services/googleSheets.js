const sheetWebhookUrl = process.env.GOOGLE_SHEET_WEBHOOK_URL || "";
const sheetWebhookSecret = process.env.GOOGLE_SHEET_WEBHOOK_SECRET || "";

function toIso(value) {
  return value ? new Date(value).toISOString() : new Date().toISOString();
}

export function hasGoogleSheetWebhook() {
  return Boolean(sheetWebhookUrl);
}

export async function syncLeadToGoogleSheet({ contact, conversation, message }) {
  if (!sheetWebhookUrl || !contact || !conversation) {
    return { skipped: true, reason: "missing_webhook" };
  }

  const customFields = contact.customFields && typeof contact.customFields === "object" ? contact.customFields : {};
  const sheet = customFields.googleSheet && typeof customFields.googleSheet === "object" ? customFields.googleSheet : {};

  if (sheet.syncedAt) {
    return { skipped: true, reason: "already_synced" };
  }

  const payload = {
    secret: sheetWebhookSecret || undefined,
    timestamp: toIso(message?.receivedAt || conversation.lastMessageAt || contact.lastMessageAt),
    name: contact.name || contact.phone,
    phone: contact.phone,
    email: contact.email || "",
    message: message?.body || "",
    source: contact.source || "WhatsApp",
    status: contact.lifecycleStatus || "lead",
    stage: contact.customFields?.crm?.stage || "new_lead",
    conversationId: conversation._id?.toString?.() || String(conversation._id || ""),
    contactId: contact._id?.toString?.() || String(contact._id || ""),
    providerMessageId: message?.providerMessageId || "",
  };

  const response = await fetch(sheetWebhookUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });

  const responseText = await response.text().catch(() => "");
  if (!response.ok) {
    const error = new Error(responseText || "Google Sheet webhook failed.");
    error.status = response.status;
    throw error;
  }

  contact.customFields = {
    ...customFields,
    googleSheet: {
      ...sheet,
      syncedAt: new Date(),
      providerMessageId: payload.providerMessageId,
      response: responseText.slice(0, 500),
    },
  };
  contact.markModified("customFields");
  await contact.save();

  return { skipped: false };
}
