import test from "node:test";
import assert from "node:assert/strict";
import { detectWhatsAppLead, normalizeLeadStage } from "../services/crm.js";

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
  assert.equal(normalizeLeadStage("proposal_sent"), "proposal_sent");
  assert.equal(normalizeLeadStage("bad_stage"), "new_lead");
});
