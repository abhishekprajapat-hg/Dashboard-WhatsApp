// Master plan "CRM industry-specificity": a workspace's own configurable sales pipeline, replacing
// the platform-wide fixed leadStages enum (models/Lead.js) that made every workspace - a solar
// installer and a restaurant alike - use the identical 6 stages. Single source of truth for
// resolving a workspace's real stages, since type-resolution is now needed everywhere a "won"/
// "lost" decision used to be a literal string comparison (crm.js, leads.js, analytics.js).
//
// Every stage carries a semantic `type` ("open" | "won" | "lost") independent of its `key`/
// `label` - the same pattern Pipedrive/HubSpot use. A workspace can rename, reorder, or add as
// many "open" stages as it wants; Lead.status derivation and revenue analytics key off `type`,
// never off a stage's literal name, so "Booking Confirmed" (Real Estate) and "PO/Contract
// Confirmed" (Construction) both work as a workspace's own "won" stage without any code caring
// what it's called.

// Today's exact 6 values, typed - this is both the fallback for any workspace that hasn't
// configured its own stages (zero data migration needed for existing tenants) and the seed for
// PLAN_LIMITS-style "basic" default behavior.
export const DEFAULT_PIPELINE_STAGES = [
  { key: "new_lead", label: "New Lead", color: "sky", type: "open" },
  { key: "contacted", label: "Contacted", color: "amber", type: "open" },
  { key: "qualified", label: "Qualified", color: "violet", type: "open" },
  { key: "proposal_sent", label: "Proposal Sent", color: "indigo", type: "open" },
  { key: "won", label: "Won", color: "green", type: "won" },
  { key: "lost", label: "Lost", color: "red", type: "lost" },
];

export function getPipelineStages(workspace) {
  const configured = workspace?.settings?.crm?.pipelineStages;
  return Array.isArray(configured) && configured.length ? configured : DEFAULT_PIPELINE_STAGES;
}

// Unknown/legacy stage key (e.g. a lead written before a workspace reconfigured its stages) is
// treated as "open" rather than throwing - the same defensive default normalizeLeadStage below
// falls back to for an outright-unrecognized stage value.
export function resolveStageType(workspace, stageKey) {
  const stages = getPipelineStages(workspace);
  return stages.find((stage) => stage.key === stageKey)?.type || "open";
}

// Replaces services/crm.js's old normalizeLeadStage(stage) - same "lowercase/trim, fall back to a
// safe default if unrecognized" contract, now resolved against the workspace's real stages
// instead of the fixed platform-wide leadStages array. Falls back to the workspace's first
// "open"-typed stage (matching the old default of "new_lead", which was always stage index 0).
export function normalizeLeadStage(workspace, stage) {
  const stages = getPipelineStages(workspace);
  const value = String(stage || "").trim().toLowerCase();
  if (stages.some((s) => s.key === value)) return value;
  return stages.find((s) => s.type === "open")?.key || stages[0]?.key || "new_lead";
}

// Lead.status ("open"/"won"/"lost"/"archived") derivation - the replacement for the old
// `["won","lost"].includes(stage) ? stage : "open"` literal-string check (routes/leads.js,
// services/crm.js). "archived" is never derived here - that's a separate, explicit action
// (archiving a lead), not a pipeline-stage side effect.
export function deriveLeadStatus(workspace, stageKey) {
  const type = resolveStageType(workspace, stageKey);
  return type === "won" || type === "lost" ? type : "open";
}
