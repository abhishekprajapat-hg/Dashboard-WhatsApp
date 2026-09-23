import { IndustryPack, Template, Workspace } from "../models/index.js";

// Shared by both platformAdmin.js (Vega, staff-triggered) and onboarding.js (client self-service) -
// one implementation of "apply this industry pack to this workspace" so the two callers can never
// drift. Pure domain logic: no HTTP, no audit logging - each caller has its own auth model and
// audit semantics, so those stay in the route handlers.
export async function provisionWorkspaceWithIndustryPack({ organizationId, workspaceId, industryPackKey }) {
  const workspace = await Workspace.findOne({ _id: workspaceId, organizationId });
  if (!workspace) {
    const error = new Error("Workspace not found on this organization.");
    error.code = "WORKSPACE_NOT_FOUND";
    throw error;
  }

  const pack = await IndustryPack.findOne({ key: industryPackKey, isActive: true });
  if (!pack) {
    const error = new Error("Industry pack not found.");
    error.code = "PACK_NOT_FOUND";
    throw error;
  }

  const created = [];
  for (const templateDraft of pack.templates) {
    const template = await Template.create({
      organizationId,
      workspaceId: workspace._id,
      name: templateDraft.name,
      language: templateDraft.language,
      category: templateDraft.category,
      body: templateDraft.body,
      variables: templateDraft.variables,
      header: templateDraft.header,
      buttons: templateDraft.buttons,
      status: "draft",
    });
    created.push({ id: template._id.toString(), name: template.name });
  }

  // Full replace, not a merge - "provision this workspace as this industry" is a one-time
  // onboarding action. Only overwrites a section the pack actually defines - a pack with no
  // supportCategories must never wipe out a workspace's own already-configured categories.
  const settings = workspace.settings && typeof workspace.settings === "object" ? workspace.settings : {};
  const crm = { ...(settings.crm || {}) };
  const support = { ...(settings.support || {}) };
  if (pack.pipelineStages.length) crm.pipelineStages = pack.pipelineStages;
  if (pack.customFieldDefinitions.length) crm.customFieldDefinitions = pack.customFieldDefinitions;
  if (pack.supportCategories.length) support.categories = pack.supportCategories;
  workspace.settings = { ...settings, crm, support };
  workspace.markModified("settings");
  await workspace.save();

  return {
    pack,
    workspace,
    templatesCreated: created,
    crm,
    support,
  };
}
