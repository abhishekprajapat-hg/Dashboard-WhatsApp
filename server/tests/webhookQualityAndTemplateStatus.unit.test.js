import test from "node:test";
import assert from "node:assert/strict";
import { normalizeWebhookPayload } from "../services/whatsappProvider.js";

test("normalizes a message_template_status_update webhook, using entry.id as the WABA lookup key", () => {
  const payload = {
    object: "whatsapp_business_account",
    entry: [
      {
        id: "102290129340398",
        time: 1743451903,
        changes: [
          {
            field: "message_template_status_update",
            value: {
              event: "APPROVED",
              message_template_id: 123456,
              message_template_name: "order_update",
              message_template_language: "en_US",
              message_template_category: "UTILITY",
            },
          },
        ],
      },
    ],
  };
  const normalized = normalizeWebhookPayload(payload);
  assert.equal(normalized.type, "template_status");
  assert.equal(normalized.businessAccountId, "102290129340398");
  assert.equal(normalized.templateId, "123456");
  assert.equal(normalized.templateName, "order_update");
  assert.equal(normalized.event, "APPROVED");
});

test("normalizes a phone_number_quality_update webhook", () => {
  const payload = {
    object: "whatsapp_business_account",
    entry: [
      {
        id: "102290129340398",
        time: 1748454394,
        changes: [
          {
            field: "phone_number_quality_update",
            value: {
              event: "QUALITY_UPDATED",
              phone_number_id: "123456789012345",
              display_phone_number: "15550001234",
              current_quality_rating: "YELLOW",
              previous_quality_rating: "GREEN",
            },
          },
        ],
      },
    ],
  };
  const normalized = normalizeWebhookPayload(payload);
  assert.equal(normalized.type, "quality_update");
  assert.equal(normalized.phoneNumberId, "123456789012345");
  assert.equal(normalized.currentQualityRating, "YELLOW");
  assert.equal(normalized.previousQualityRating, "GREEN");
});

test("falls back to the alternate quality_rating field name defensively", () => {
  // Real-world field-name uncertainty this build flagged explicitly - a differently-shaped but
  // plausible payload must still extract a usable rating rather than silently coming back empty.
  const payload = {
    entry: [{ id: "1", changes: [{ field: "phone_number_quality_update", value: { quality_rating: "RED" } }] }],
  };
  const normalized = normalizeWebhookPayload(payload);
  assert.equal(normalized.currentQualityRating, "RED");
});

test("an unrecognized field falls through to type unknown, not a crash", () => {
  const payload = { entry: [{ id: "1", changes: [{ field: "something_new", value: {} }] }] };
  const normalized = normalizeWebhookPayload(payload);
  assert.equal(normalized.type, "unknown");
});
