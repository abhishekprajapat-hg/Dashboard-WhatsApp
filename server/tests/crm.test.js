import test from "node:test";
import assert from "node:assert/strict";
import { detectWhatsAppLead } from "../services/crm.js";
import { normalizeLeadStage } from "../services/pipelineStages.js";

test("detects click-to-whatsapp first messages as leads", () => {
  const result = detectWhatsAppLead({
    isAdLead: true,
    isFirstConversation: true,
    message: { body: "Hi" },
  });

  assert.equal(result.isLead, true);
  assert.equal(result.reasons.includes("click_to_whatsapp_ad"), true);
});

test("detects lead details in message body", () => {
  const result = detectWhatsAppLead({
    message: { body: "My name is Abhi, need pricing. email me at test@example.com" },
  });

  assert.equal(result.isLead, true);
  assert.equal(result.reasons.includes("name"), true);
  assert.equal(result.reasons.includes("requirement"), true);
  assert.equal(result.extracted.email, "test@example.com");
});

test("normalizes supported CRM lead stages", () => {
  // No workspace (null) falls back to DEFAULT_PIPELINE_STAGES - same values every workspace used
  // to be hard-locked to before pipeline stages became per-workspace configurable.
  assert.equal(normalizeLeadStage(null, "proposal_sent"), "proposal_sent");
  assert.equal(normalizeLeadStage(null, "bad_stage"), "new_lead");
});

test("normalizeLeadStage resolves against a workspace's own configured stages, not the platform default", () => {
  const workspace = {
    settings: {
      crm: {
        pipelineStages: [
          { key: "new_enquiry", label: "New Enquiry", color: "sky", type: "open" },
          { key: "booking_confirmed", label: "Booking Confirmed", color: "green", type: "won" },
          { key: "dropped", label: "Dropped", color: "red", type: "lost" },
        ],
      },
    },
  };
  assert.equal(normalizeLeadStage(workspace, "booking_confirmed"), "booking_confirmed");
  // "proposal_sent" isn't one of this workspace's stages - falls back to its own first "open"
  // stage ("new_enquiry"), not the platform default ("new_lead").
  assert.equal(normalizeLeadStage(workspace, "proposal_sent"), "new_enquiry");
});
