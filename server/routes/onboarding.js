import { Router } from "express";
import { z } from "zod";
import { requirePermission } from "../middleware/auth.js";
import { validateBody } from "../middleware/validate.js";
import { AuditLog, IndustryPack } from "../models/index.js";
import { provisionWorkspaceWithIndustryPack } from "../services/industryProvisioning.js";

// Client-facing counterpart to platformAdmin.js's Vega-only (shared-secret) provisioning route -
// lets a real signed-in client pick and apply their own industry pack during onboarding, instead of
// waiting on a staffer. Session-scoped: organizationId/workspaceId always come from req.user (set
// by requireAuth), never from the request body - a client can never provision another tenant's
// workspace no matter what it sends.
export const onboardingRouter = Router();

onboardingRouter.get("/industry-packs", requirePermission("settings:read"), async (req, res) => {
  const packs = await IndustryPack.find({ isActive: true }).sort({ industry: 1, label: 1 });
  res.json({
    data: packs.map((pack) => ({
      id: pack._id.toString(),
      key: pack.key,
      label: pack.label,
      industry: pack.industry,
      description: pack.description,
      templateCount: pack.templates.length,
      pipelineStageCount: pack.pipelineStages.length,
      customFieldCount: pack.customFieldDefinitions.length,
      supportCategoryCount: pack.supportCategories.length,
    })),
  });
});

const provisionSchema = z.object({
  industryPackKey: z.string().min(1, "industryPackKey is required."),
});

onboardingRouter.post("/provision", requirePermission("settings:write"), validateBody(provisionSchema), async (req, res) => {
  let result;
  try {
    result = await provisionWorkspaceWithIndustryPack({
      organizationId: req.user.organizationId,
      workspaceId: req.user.workspaceId,
      industryPackKey: req.body.industryPackKey,
    });
  } catch (error) {
    if (error.code === "PACK_NOT_FOUND") {
      return res.status(404).json({ error: "NOT_FOUND", message: "Industry pack not found." });
    }
    throw error;
  }
  const { pack, workspace, templatesCreated, crm, support } = result;

  // Distinct action name from platformAdmin.provisioned so an audit-log reader can tell client
  // self-service apart from staff-assisted provisioning. actorUserId is set here (unlike Vega's
  // shared-secret path, which has no real user session to attribute the action to).
  await AuditLog.create({
    organizationId: req.user.organizationId,
    workspaceId: workspace._id,
    actorUserId: req.user.sub,
    action: "onboarding.industry_pack_provisioned",
    entityType: "Workspace",
    entityId: workspace._id.toString(),
    after: {
      industryPackKey: pack.key,
      templatesCreated: templatesCreated.length,
      pipelineStagesApplied: pack.pipelineStages.length,
      customFieldsApplied: pack.customFieldDefinitions.length,
      supportCategoriesApplied: pack.supportCategories.length,
    },
  });

  res.status(201).json({
    data: {
      industryPackKey: pack.key,
      workspaceId: workspace._id.toString(),
      templatesCreated,
      pipelineStages: crm.pipelineStages || [],
      customFieldDefinitions: crm.customFieldDefinitions || [],
      supportCategories: support.categories || [],
    },
  });
});
