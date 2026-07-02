import { AuditLog, Lead, Membership, Tag } from "../models/index.js";

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

  const membership =
    (await Membership.findOne({ workspaceId, status: "active", role: { $in: ["admin", "manager"] } }).sort({ createdAt: 1 })) ||
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
}) {
  if (!contact || !conversation) return { contact, lead: null };

  const organizationId = contact.organizationId || conversation.organizationId;
  const workspaceId = contact.workspaceId || conversation.workspaceId;
  const now = new Date();
  const leadTag = await ensureLeadTag({ organizationId, workspaceId });
  const ownerUserId = await chooseOwner({ workspaceId, contact, conversation });
  const campaign = extractCampaign({ normalized, source });
  const location = extractLocation(normalized);
  const firstMessage = inboundMessage?.body || conversation.lastMessageId?.body || "";
  const messageId = inboundMessage?._id?.toString?.() || normalized?.providerMessageId || conversation._id.toString();

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
    },
    crm: {
      ...crm,
      stage: crm.stage || stage,
      leadScore: Number(crm.leadScore || 10),
      source,
      campaign,
      addedToCrmAt: crm.addedToCrmAt || now,
      addedFromConversationId: conversation._id,
      leadCreatedAt: crm.leadCreatedAt || now,
      lastConversationAt: conversation.lastMessageAt || now,
      ownerUserId: ownerUserId || crm.ownerUserId || null,
      followUpAt: crm.followUpAt || null,
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

  const lead = await Lead.findOneAndUpdate(
    { workspaceId, contactId: contact._id, status: "open" },
    {
      $setOnInsert: {
        organizationId,
        workspaceId,
        contactId: contact._id,
        firstMessage,
        firstMessageAt: inboundMessage?.receivedAt || now,
        status: "open",
      },
      $set: {
        conversationId: conversation._id,
        ownerUserId: ownerUserId || undefined,
        source,
        campaign,
        stage: crm.stage || stage,
        score: Number(crm.leadScore || 10),
        lastActivityAt: conversation.lastMessageAt || now,
        followUpAt: crm.followUpAt || undefined,
        location: location || undefined,
        customFields: {
          phone: contact.phone,
          waName: contact.waName || contact.name,
          profilePhoto: contact.profilePhoto || "",
          source,
          campaign,
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

  return { contact, lead };
}
