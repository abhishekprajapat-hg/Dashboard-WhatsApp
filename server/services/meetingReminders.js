import mongoose from "mongoose";
import { Contact, Conversation, Message, Organization, WhatsAppAccount, Workspace } from "../models/index.js";
import { fetchUpcomingVegaMeetings, markVegaMeetingReminded } from "./vegaIntegration.js";
import { sendWhatsAppInteractive } from "./whatsappProvider.js";
import { logger } from "./logger.js";

// Same normalization shape as whatsapp.js's phoneLookupValues (private to that file) - kept
// local rather than exported/shared, since this is the only other place that needs to go
// phone -> Contact starting from a bare string with no workspace already known.
function phoneLookupValues(phone) {
  const raw = String(phone || "").trim();
  const digits = raw.replace(/[^\d]/g, "");
  const values = new Set([raw, digits]);
  if (digits) {
    values.add(`+${digits}`);
    values.add(`whatsapp:+${digits}`);
  }
  const last10 = digits.length > 10 ? digits.slice(-10) : digits;
  if (last10.length === 10) {
    values.add(last10);
    values.add(`+${last10}`);
    values.add(`91${last10}`);
    values.add(`+91${last10}`);
  }
  return [...values].filter(Boolean);
}

// Vega itself has no concept of workspaces - it's Nemnidhi's own single internal system (see
// Organization.isPlatformOwner), not a per-tenant integration. Every meeting it returns belongs to
// whichever workspace(s) the platform owner operates, never a paying client's own workspace.
// Cached briefly since this runs on every reminder in every sweep tick, not once per process -
// still cheap enough (a handful of workspace IDs) to just re-fetch on every sweep rather than
// invalidate a longer-lived cache when a platform-owner workspace is added/removed.
async function platformOwnerWorkspaceIds() {
  const platformOwnerOrgs = await Organization.find({ isPlatformOwner: true }).select("_id");
  if (!platformOwnerOrgs.length) return [];
  const workspaces = await Workspace.find({ organizationId: { $in: platformOwnerOrgs.map((org) => org._id) } }).select("_id");
  return workspaces.map((workspace) => workspace._id);
}

// A Vega meeting only carries a raw contactPhone, not a workspace/conversation reference - this is
// the reverse lookup, phone -> the real WhatsApp thread to send the reminder into. Scoped to
// platform-owner workspaces only (see above) - without this, a phone number that happens to match
// a contact in a completely unrelated paying client's own workspace would have Nemnidhi's own
// meeting reminder sent through that client's WhatsApp account into that client's conversation, a
// real cross-tenant message-misdelivery risk once a second workspace exists in this database.
// Picks the contact's most recently active conversation, same "most recent wins" convention as
// findReusableContactAndConversation in whatsapp.js.
async function findConversationForPhone(phone) {
  const values = phoneLookupValues(phone);
  if (!values.length) return null;

  const workspaceIds = await platformOwnerWorkspaceIds();
  if (!workspaceIds.length) return null;

  const contact = await Contact.findOne({
    phone: mongoose.trusted({ $in: values }),
    workspaceId: mongoose.trusted({ $in: workspaceIds }),
  }).sort({ lastMessageAt: -1, updatedAt: -1 });
  if (!contact) return null;

  const conversation = await Conversation.findOne({ workspaceId: contact.workspaceId, contactId: contact._id }).sort({
    lastMessageAt: -1,
    createdAt: -1,
  });
  if (!conversation?.whatsappAccountId) return null;

  const account = await WhatsAppAccount.findById(conversation.whatsappAccountId);
  if (!account) return null;

  return { contact, conversation, account };
}

function formatMeetingTime(startAt) {
  return new Date(startAt).toLocaleString("en-IN", {
    timeZone: "Asia/Kolkata",
    weekday: "short",
    day: "numeric",
    month: "short",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  });
}

async function sendReminder(meeting, window) {
  const found = await findConversationForPhone(meeting.contactPhone);
  if (!found) {
    logger.warn({ meetingId: meeting._id, phone: meeting.contactPhone }, "meetingReminders: no matching WhatsApp conversation, skipping");
    return;
  }
  const { contact, conversation, account } = found;
  const when = formatMeetingTime(meeting.startAt);
  const body =
    window === "24h"
      ? `Reminder: your demo is tomorrow, ${when}. Still good for you?`
      : `Quick reminder - your demo is in about an hour, ${when}.`;

  let sendResult;
  try {
    sendResult = await sendWhatsAppInteractive({
      account,
      to: contact.phone,
      body,
      buttons: [
        { id: "confirm", title: "Confirm" },
        { id: "reschedule", title: "Reschedule" },
      ],
    });
  } catch (error) {
    logger.error({ meetingId: meeting._id, error: error.message }, "meetingReminders: send failed");
    return;
  }

  const outboundMessage = await Message.create({
    organizationId: conversation.organizationId,
    workspaceId: conversation.workspaceId,
    conversationId: conversation._id,
    contactId: contact._id,
    whatsappAccountId: account._id,
    direction: "outbound",
    type: "interactive",
    body,
    providerMessageId: sendResult.providerMessageId,
    status: sendResult.status || "sent",
    sentAt: new Date(),
    metadata: { automationGenerated: true, meetingReminder: window },
  });
  await Conversation.updateOne(
    { _id: conversation._id },
    {
      $set: {
        lastMessageId: outboundMessage._id,
        lastMessageAt: outboundMessage.sentAt,
        // Correlates a later Confirm/Reschedule tap back to this meeting - "most recent reminder
        // wins" (same convention as findConversationForPhone above), simpler than threading
        // WhatsApp's message.context reply-reference through the webhook normalizer for a case
        // that's realistically never ambiguous (a contact doesn't have two reminders in flight).
        "metadata.pendingMeetingReminder": { meetingId: String(meeting._id), window, sentAt: new Date() },
      },
    }
  );

  const mark = await markVegaMeetingReminded(meeting._id, window);
  if (!mark.ok) {
    logger.warn({ meetingId: meeting._id, window, reason: mark.reason }, "meetingReminders: sent but failed to mark reminded in Vega");
  }
}

// The scheduled sweep entry point - see jobs.js's repeatable "reminders.sweep" job. Reads are
// resilient by design (fetchUpcomingVegaMeetings/sendWhatsAppInteractive both degrade instead of
// throwing) so one bad meeting or a Vega outage never blocks the rest of the sweep or crashes
// the worker.
export async function sweepMeetingReminders() {
  const summary = { "24h": 0, "1h": 0 };
  for (const window of ["24h", "1h"]) {
    const result = await fetchUpcomingVegaMeetings(window);
    if (!result.ok) {
      if (result.reason !== "not_configured") {
        logger.warn({ window, reason: result.reason }, "meetingReminders: sweep fetch failed");
      }
      continue;
    }
    for (const meeting of result.meetings || []) {
      await sendReminder(meeting, window);
      summary[window] += 1;
    }
  }
  return { ok: true, sweptAt: new Date().toISOString(), ...summary };
}
