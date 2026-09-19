import test from "node:test";
import assert from "node:assert/strict";
import {
  DEFAULT_PIPELINE_STAGES,
  deriveLeadStatus,
  getPipelineStages,
  normalizeLeadStage,
  resolveStageType,
} from "../services/pipelineStages.js";

// Pure logic, no Mongo needed - covers the type-tagged-stage resolution that replaced literal
// stage === "won"/"lost" string checks across crm.js/leads.js/analytics.js (master plan "CRM
// industry-specificity").

const realEstateWorkspace = {
  settings: {
    crm: {
      pipelineStages: [
        { key: "new_enquiry", label: "New Enquiry", color: "sky", type: "open" },
        { key: "site_visit", label: "Site Visit Scheduled", color: "amber", type: "open" },
        { key: "booking_confirmed", label: "Booking Confirmed", color: "green", type: "won" },
        { key: "dropped", label: "Dropped", color: "red", type: "lost" },
      ],
    },
  },
};

test("getPipelineStages falls back to DEFAULT_PIPELINE_STAGES for a workspace with no custom config", () => {
  assert.deepEqual(getPipelineStages(null), DEFAULT_PIPELINE_STAGES);
  assert.deepEqual(getPipelineStages({ settings: {} }), DEFAULT_PIPELINE_STAGES);
  assert.deepEqual(getPipelineStages({ settings: { crm: { pipelineStages: [] } } }), DEFAULT_PIPELINE_STAGES);
});

test("getPipelineStages returns a workspace's own configured stages when set", () => {
  assert.equal(getPipelineStages(realEstateWorkspace).length, 4);
  assert.equal(getPipelineStages(realEstateWorkspace)[0].key, "new_enquiry");
});

test("resolveStageType resolves a workspace's own stage naming, not the platform default", () => {
  assert.equal(resolveStageType(realEstateWorkspace, "booking_confirmed"), "won");
  assert.equal(resolveStageType(realEstateWorkspace, "dropped"), "lost");
  assert.equal(resolveStageType(realEstateWorkspace, "site_visit"), "open");
  // An unrecognized/legacy key defaults to "open", never throws.
  assert.equal(resolveStageType(realEstateWorkspace, "won"), "open");
});

test("deriveLeadStatus maps a resolved stage type to Lead.status", () => {
  assert.equal(deriveLeadStatus(realEstateWorkspace, "booking_confirmed"), "won");
  assert.equal(deriveLeadStatus(realEstateWorkspace, "dropped"), "lost");
  assert.equal(deriveLeadStatus(realEstateWorkspace, "site_visit"), "open");
});

test("normalizeLeadStage falls back to a workspace's own first open stage, not the platform default", () => {
  assert.equal(normalizeLeadStage(realEstateWorkspace, "booking_confirmed"), "booking_confirmed");
  assert.equal(normalizeLeadStage(realEstateWorkspace, "not_a_real_stage"), "new_enquiry");
  assert.equal(normalizeLeadStage(realEstateWorkspace, ""), "new_enquiry");
});

test("default platform behavior is unchanged for any workspace without custom stages (backward compatibility)", () => {
  assert.equal(resolveStageType(null, "won"), "won");
  assert.equal(resolveStageType(null, "lost"), "lost");
  assert.equal(deriveLeadStatus(null, "won"), "won");
  assert.equal(normalizeLeadStage(null, "bad_stage"), "new_lead");
});
