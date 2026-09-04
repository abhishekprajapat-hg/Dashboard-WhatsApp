import mongoose from "mongoose";
import { AuditLog, Lead, Membership, Role, Tag, WhatsAppAccount } from "../models/index.js";
import { leadStages } from "../models/Lead.js";
import { sendConversionEvent } from "./metaConversionsApi.js";
import { pushLeadToVega } from "./vegaIntegration.js";
import { logger } from "./logger.js";

const requirementPattern = /\b(need|require|requirement|looking|interested|want|buy|purchase|price|pricing|quote|quotation|demo|plan|package|service|proposal|call back|callback)\b/i;
const emailPattern = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i;
const phonePattern = /(?:\+?\d[\d\s().-]{7,}\d)/;
const namePattern = /\b(my name is|i am|i'm|this is)\s+[a-z][a-z\s]{1,40}\b/i;

export function normalizeLeadStage(stage = "new_lead") {
  const value = String(stage || "").trim().toLowerCase();
  return leadStages.includes(value) ? value : "new_lead";
}

export function detectWhatsAppLead({ normalized, message, isAdLead = false, isFirstConversation = false } = {}) {
  const body = String(message?.body || normalized?.body || "").trim();
  const reasons = [];

  if (isAdLead && isFirstConversation) reasons.push("click_to_whatsapp_ad");
  if (emailPattern.test(body)) reasons.push("email");
  if (phonePattern.test(body)) reasons.push("phone");
  if (namePattern.test(body)) reasons.push("name");
  if (requirementPattern.test(body)) reasons.push("requirement");

  return {
    isLead: reasons.length > 0,
    reasons,
    stage: "new_lead",
    extracted: {
      email: body.match(emailPattern)?.[0] || "",
      phone: body.match(phonePattern)?.[0] || "",
    },
  };
}

function getId(value) {
  return value?._id || value;
}

function pushTimeline(items = [], event) {
  const next = Array.isArray(items) ? [...items] : [];
  const duplicate = next.some((item) => item.id && item.id === event.id);
  if (!duplicate) next.push(event);
  return next.slice(-200);
}

function extractCampaign({ normalized, source }) {
  const referral = normalized?.referral || {};
  return (
    referral.ctwa_clid ||
    referral.source_id ||
    referral.headline ||
    normalized?.campaign ||
    (source === "meta_ad" ? "Meta Ad" : "Organic WhatsApp")
  );
}

function extractLocation(normalized) {
  const message = normalized?.raw?.entry?.[0]?.changes?.[0]?.value?.messages?.[0] || normalized?.raw?.message || normalized?.raw;
  const location = normalized?.location || message?.location;
  if (!location) return null;
  return {
    latitude: location.latitude,
    longitude: location.longitude,
    name: location.name || "",
    address: location.address || "",
    url: location.url || "",
  };
}

async function ensureLeadTag({ organizationId, workspaceId }) {
  return Tag.findOneAndUpdate(
    { workspaceId, name: "Lead" },
    {
      organizationId,
      workspaceId,
      name: "Lead",
      color: "#22c55e",
      description: "Contacts captured from WhatsApp conversations",
    },
    { upsert: true, new: true, setDefaultsOnInsert: true }
  );
}

async function chooseOwner({ workspaceId, contact, conversation }) {
  if (conversation.assignedToUserId) return getId(conversation.assignedToUserId);
  if (contact.ownerUserId) return getId(contact.ownerUserId);

  // Membership has no `role` field of its own (only roleId, a reference to Role) - this used to
  // query Membership directly on `role`, which never matched anything, so the "prefer an
  // admin/manager" step silently always fell through to "earliest active member" below.
  const preferredRoles = await Role.find({ workspaceId, key: mongoose.trusted({ $in: ["admin", "manager"] }) }).select("_id");
  const membership =
    (preferredRoles.length
      ? await Membership.findOne({
          workspaceId,
          status: "active",
          roleId: mongoose.trusted({ $in: preferredRoles.map((role) => role._id) }),
        }).sort({ createdAt: 1 })
      : null) ||
    (await Membership.findOne({ workspaceId, status: "active" }).sort({ createdAt: 1 }));
  return membership?.userId;
}

export async function ensureConversationInCrm({
  contact,
  conversation,
  inboundMessage,
  normalized,
  source = "conversation",
  stage = "new_lead",
  detection = null,
  manual = false,
}) {
  if (!contact || !conversation) return { contact, lead: null };

  const organizationId = contact.organizationId || conversation.organizationId;
  const workspaceId = contact.workspaceId || conversation.workspaceId;
  const now = new Date();
  const leadTag = await ensureLeadTag({ organizationId, workspaceId });
  const ownerUserId = await chooseOwner({ workspaceId, contact, conversation });
  const campaign = extractCampaign({ normalized, source });
  const ctwaClid = contact?.customFields?.metaAdReferral?.ctwa_clid || "";
  const location = extractLocation(normalized);
  const normalizedStage = normalizeLeadStage(stage);
  // Broader than leadFilter below on purpose - leadFilter requires status:"open" to match, so it
  // stops seeing a lead the moment it's already won. This read is only used to detect a genuine
  // open->won transition (see the conversion-event call after the upsert), which needs the lead's
  // real current status regardless of whether the upsert's own filter would still match it.
  const existingLead = await Lead.findOne({ workspaceId, contactId: contact._id })
    .sort({ createdAt: -1 })
    .select("status metaCtwaClid");
  const firstMessage = inboundMessage?.body || conversation.lastMessageId?.body || "";
  const providerMessageId = inboundMessage?.providerMessageId || normalized?.providerMessageId || "";
  const messageId = inboundMessage?._id?.toString?.() || providerMessageId || conversation._id.toString();

  const tagIds = (contact.tagIds || []).map(getId).filter(Boolean);
  if (!tagIds.some((tagId) => tagId.toString() === leadTag._id.toString())) {
    tagIds.push(leadTag._id);
  }

  const customFields = contact.customFields && typeof contact.customFields === "object" ? contact.customFields : {};
  const crm = customFields.crm && typeof customFields.crm === "object" ? customFields.crm : {};
  const whatsapp = customFields.whatsapp && typeof customFields.whatsapp === "object" ? customFields.whatsapp : {};
  const timelineEvent = {
    id: `whatsapp:first:${messageId}`,
    type: "whatsapp_message",
    title: crm.addedToCrmAt ? "WhatsApp message received" : "First WhatsApp message received",
    body: firstMessage,
    at: inboundMessage?.receivedAt || conversation.lastMessageAt || now,
    source,
  };

  contact.lifecycleStatus = "lead";
  contact.source = source === "meta_ad" ? "Meta Ad" : contact.source || "WhatsApp";
  contact.ownerUserId = ownerUserId || contact.ownerUserId;
  contact.tagIds = tagIds;
  contact.lastMessageAt = conversation.lastMessageAt || contact.lastMessageAt || now;
  contact.customFields = {
    ...customFields,
    whatsapp: {
      ...whatsapp,
      phone: contact.phone,
      waName: contact.waName || whatsapp.waName || contact.name,
      profilePhoto: contact.profilePhoto || whatsapp.profilePhoto || "",
      firstMessage: whatsapp.firstMessage || firstMessage,
      firstMessageAt: whatsapp.firstMessageAt || inboundMessage?.receivedAt || now,
      lastMessageAt: conversation.lastMessageAt || now,
      source,
      campaign,
      location: location || whatsapp.location || null,
      duplicateDetected: Boolean(customFields.crm?.addedToCrmAt),
      leadDetection: detection || whatsapp.leadDetection || null,
    },
    crm: {
      ...crm,
      stage: normalizeLeadStage(crm.stage || normalizedStage),
      leadScore: Number(crm.leadScore || 10),
      source,
      campaign,
      addedToCrmAt: crm.addedToCrmAt || now,
      addedFromConversationId: conversation._id,
      leadCreatedAt: crm.leadCreatedAt || now,
      lastConversationAt: conversation.lastMessageAt || now,
      ownerUserId: ownerUserId || crm.ownerUserId || null,
      followUpAt: crm.followUpAt || null,
      lastManualLeadAt: manual ? now : crm.lastManualLeadAt,
      customFields: crm.customFields || {},
    },
    notes: customFields.notes || [],
    tasks: customFields.tasks || [],
    deals: customFields.deals || [],
    calendar: customFields.calendar || [],
    internalComments: customFields.internalComments || [],
    customerHistory: pushTimeline(customFields.customerHistory, timelineEvent),
    orderHistory: customFields.orderHistory || [],
    paymentHistory: customFields.paymentHistory || [],
    timeline: pushTimeline(customFields.timeline, timelineEvent),
  };
  contact.markModified("customFields");
  await contact.save();

  if (ownerUserId && !conversation.assignedToUserId) {
    conversation.assignedToUserId = ownerUserId;
    conversation.metadata = {
      ...(conversation.metadata || {}),
      assignment: {
        assignedBy: "crm_auto_owner",
        assignedAt: now,
        assignedToUserId: ownerUserId,
      },
    };
  }

  const leadFilter = providerMessageId
    ? {
        workspaceId,
        status: "open",
        $or: [{ providerMessageId }, { contactId: contact._id }],
      }
    : { workspaceId, contactId: contact._id, status: "open" };

  const lead = await Lead.findOneAndUpdate(
    leadFilter,
    {
      $setOnInsert: {
        organizationId,
        workspaceId,
        contactId: contact._id,
        firstMessage,
        firstMessageAt: inboundMessage?.receivedAt || now,
        // status and providerMessageId are intentionally not set here - $set below always
        // computes both identically regardless of insert-vs-update, and Mongo rejects
        // $setOnInsert and $set writing the same path in one update.
        syncStatus: {
          googleSheet: {
            status: "pending",
            lastAttemptAt: null,
            lastSyncedAt: null,
            error: "",
          },
        },
      },
      $set: {
        conversationId: conversation._id,
        ownerUserId: ownerUserId || undefined,
        source,
        campaign,
        metaCtwaClid: ctwaClid || existingLead?.metaCtwaClid || "",
        stage: normalizeLeadStage(crm.stage || normalizedStage),
        status: ["won", "lost"].includes(normalizeLeadStage(crm.stage || normalizedStage)) ? normalizeLeadStage(crm.stage || normalizedStage) : "open",
        score: Number(crm.leadScore || 10),
        lastActivityAt: conversation.lastMessageAt || now,
        followUpAt: crm.followUpAt || undefined,
        location: location || undefined,
        providerMessageId: providerMessageId || undefined,
        customFields: {
          phone: contact.phone,
          waName: contact.waName || contact.name,
          profilePhoto: contact.profilePhoto || "",
          source,
          campaign,
          detection: detection || undefined,
        },
      },
      $push: {
        timeline: {
          $each: [timelineEvent],
          $slice: -200,
        },
      },
    },
    { upsert: true, new: true, setDefaultsOnInsert: true }
  );

  if (normalizedStage === "won" && existingLead?.status !== "won" && lead.metaCtwaClid) {
    try {
      const whatsappAccount = await WhatsAppAccount.findOne({ workspaceId, provider: "meta" });
      if (whatsappAccount) {
        await sendConversionEvent(whatsappAccount, { eventName: "Purchase", ctwaClid: lead.metaCtwaClid });
      }
    } catch (error) {
      // A Meta outage (or a misconfigured/missing Conversions dataset) must never break marking a
      // real deal as won - this is best-effort reporting, not part of the CRM write itself.
      logger.warn({ err: error }, "Meta Conversions API event failed");
    }
  }

  await AuditLog.create({
    organizationId,
    workspaceId,
    actorUserId: ownerUserId || undefined,
    action: crm.addedToCrmAt ? "crm.whatsapp_activity_synced" : "crm.whatsapp_lead_created",
    entityType: "Contact",
    entityId: contact._id.toString(),
    after: {
      contactId: contact._id,
      leadId: lead._id,
      conversationId: conversation._id,
      source,
      campaign,
      duplicateDetected: Boolean(crm.addedToCrmAt),
      firstMessage,
    },
  });

  // Only on this contact's first-ever CRM lead creation, not every subsequent message in the
  // same conversation - crm.addedToCrmAt is the pre-update value captured above, so this is true
  // exactly once per contact, same condition the AuditLog action distinction above already uses.
  if (!crm.addedToCrmAt) {
    pushLeadToVega({
      organizationId: organizationId.toString(),
      conversationId: conversation._id.toString(),
      contactName: contact.waName || contact.name || "",
      phone: contact.phone,
      campaign,
      ctwaClid,
      firstMessage,
    }).catch(() => undefined);
  }

  return { contact, lead };
}
