import { Tag } from "../models/index.js";

function getId(value) {
  return value?._id || value;
}

export async function ensureConversationInCrm({ contact, conversation, source = "conversation", stage = "new_lead" }) {
  if (!contact || !conversation) return contact;

  const organizationId = contact.organizationId || conversation.organizationId;
  const workspaceId = contact.workspaceId || conversation.workspaceId;

  const leadTag = await Tag.findOneAndUpdate(
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

  const tagIds = (contact.tagIds || []).map(getId).filter(Boolean);
  const hasLeadTag = tagIds.some((tagId) => tagId.toString() === leadTag._id.toString());
  if (!hasLeadTag) {
    tagIds.push(leadTag._id);
  }

  const customFields = contact.customFields && typeof contact.customFields === "object" ? contact.customFields : {};
  const crm = customFields.crm && typeof customFields.crm === "object" ? customFields.crm : {};

  contact.lifecycleStatus = "lead";
  contact.source = contact.source || "WhatsApp";
  contact.tagIds = tagIds;
  contact.customFields = {
    ...customFields,
    crm: {
      ...crm,
      stage: crm.stage || stage,
      source,
      addedToCrmAt: crm.addedToCrmAt || new Date(),
      addedFromConversationId: conversation._id,
      lastConversationAt: conversation.lastMessageAt || new Date(),
    },
  };
  contact.lastMessageAt = conversation.lastMessageAt || contact.lastMessageAt || new Date();
  contact.markModified("customFields");

  await contact.save();
  return contact;
}
