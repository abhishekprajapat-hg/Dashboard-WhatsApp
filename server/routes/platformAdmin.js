import { Router } from "express";
import mongoose from "mongoose";
import { z } from "zod";
import {
  AuditLog,
  AutomationFlow,
  Campaign,
  IndustryPack,
  Membership,
  Organization,
  Template,
  WhatsAppAccount,
  Workspace,
} from "../models/index.js";
import { requireVegaSecret } from "../middleware/requireVegaSecret.js";
import { validateBody } from "../middleware/validate.js";
import { getEntitlements, PACK_TIERS } from "../services/entitlements.js";
import { getOrganizationUsageSummary } from "../services/usageMetering.js";
import { provisionWorkspaceWithIndustryPack } from "../services/industryProvisioning.js";

// Master plan Phase 7 (Vega admin console): the external-caller counterpart to routes/admin.js's
// tenant-management endpoints. Those are session+requirePlatformOwner-gated for Nemnidhi staff
// browsing Dashboard-WhatsApp's own admin UI; these are shared-secret-gated (requireVegaSecret)
// for Vega's Platform Admin section to call server-to-server, no user session involved - the same
// "not a new data store, a control plane calling into Dashboard-WhatsApp's admin API" role the
// master plan describes for Vega. Deliberately a separate router with its own handlers rather than
// reusing admin.js's route functions directly - different auth model, different caller, and this
// keeps the already-verified staff admin UI's behavior untouched.
export const platformAdminRouter = Router();

platformAdminRouter.use(requireVegaSecret);

function requireDatabase(req, res, next) {
  if (mongoose.connection.readyState !== 1) {
    return res.status(503).json({ error: "DATABASE_UNAVAILABLE", message: "MongoDB is required." });
  }
  next();
}

// AuditLog.workspaceId is required, and a platform-admin action isn't scoped to any one workspace
// - logged against the tenant's oldest (primary) workspace, same convention admin.js's own
// PATCH /tenants/:organizationId/plan already uses for the identical reason. actorUserId is left
// unset (no user session exists on this path) and "actor: vega" in the payload records who did it.
async function logPlatformAdminAction(organization, action, { before, after } = {}) {
  const primaryWorkspace = await Workspace.findOne({ organizationId: organization._id }).sort({ createdAt: 1 });
  if (!primaryWorkspace) return;
  await AuditLog.create({
    organizationId: organization._id,
    workspaceId: primaryWorkspace._id,
    action,
    entityType: "Organization",
    entityId: organization._id.toString(),
    before,
    after: { ...after, actor: "vega" },
  });
}

// Nemnidhi's own organization(s) are excluded - Vega's console manages *client* businesses running
// on the platform, not Nemnidhi itself (which never shows up as a "client" anywhere else in this
// admin surface either). isPlatformOwner's $ne needs mongoose.trusted() - this app runs with
// mongoose.set("sanitizeFilter", true) (server/db.js), which otherwise casts the whole {$ne: true}
// object against the field's own boolean type and throws instead of applying it as an operator.
platformAdminRouter.get("/organizations", requireDatabase, async (req, res) => {
  const organizations = await Organization.find({ isPlatformOwner: mongoose.trusted({ $ne: true }) }).sort({ createdAt: -1 });
  const data = await Promise.all(
    organizations.map(async (organization) => {
      const [workspaceCount, memberCount] = await Promise.all([
        Workspace.countDocuments({ organizationId: organization._id }),
        Membership.countDocuments({ organizationId: organization._id, status: "active" }),
      ]);
      return {
        id: organization._id.toString(),
        name: organization.name,
        slug: organization.slug,
        plan: organization.plan,
        billingStatus: organization.billingStatus,
        workspaceCount,
        memberCount,
        createdAt: organization.createdAt,
      };
    })
  );
  res.json({ data });
});

platformAdminRouter.get("/organizations/:id", requireDatabase, async (req, res) => {
  if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
    return res.status(404).json({ error: "NOT_FOUND", message: "Organization not found." });
  }
  const organization = await Organization.findOne({ _id: req.params.id, isPlatformOwner: mongoose.trusted({ $ne: true }) });
  if (!organization) {
    return res.status(404).json({ error: "NOT_FOUND", message: "Organization not found." });
  }

  const workspaces = await Workspace.find({ organizationId: organization._id }).sort({ createdAt: 1 });
  const workspaceIds = workspaces.map((workspace) => workspace._id.toString());

  const [memberships, templateCount, automationFlowCount, campaignCount, whatsappAccounts, usage] = await Promise.all([
    Membership.find({ organizationId: organization._id, status: "active" })
      .populate("userId", "name email")
      .populate("workspaceId", "name")
      .sort({ createdAt: 1 }),
    Template.countDocuments({ workspaceId: mongoose.trusted({ $in: workspaceIds }) }),
    AutomationFlow.countDocuments({ workspaceId: mongoose.trusted({ $in: workspaceIds }) }),
    Campaign.countDocuments({ workspaceId: mongoose.trusted({ $in: workspaceIds }) }),
    WhatsAppAccount.find({ workspaceId: mongoose.trusted({ $in: workspaceIds }) }).select("displayName phoneNumber status workspaceId"),
    getOrganizationUsageSummary(organization._id),
  ]);

  res.json({
    data: {
      organization: {
        id: organization._id.toString(),
        name: organization.name,
        slug: organization.slug,
        plan: organization.plan,
        billingStatus: organization.billingStatus,
        createdAt: organization.createdAt,
      },
      entitlements: getEntitlements(organization.plan),
      usage,
      workspaces: workspaces.map((workspace) => ({
        id: workspace._id.toString(),
        name: workspace.name,
        slug: workspace.slug,
        businessCategory: workspace.businessCategory,
        createdAt: workspace.createdAt,
      })),
      members: memberships.map((membership) => ({
        id: membership._id.toString(),
        name: membership.userId?.name || "",
        email: membership.userId?.email || "",
        workspace: membership.workspaceId?.name || "",
      })),
      summary: {
        templates: templateCount,
        automationFlows: automationFlowCount,
        campaigns: campaignCount,
        whatsappAccounts: whatsappAccounts.length,
      },
      whatsappAccounts: whatsappAccounts.map((account) => ({
        id: account._id.toString(),
        displayName: account.displayName,
        phoneNumber: account.phoneNumber,
        status: account.status,
        workspace: account.workspaceId?.name || "",
      })),
    },
  });
});

const updateOrganizationSchema = z.object({
  plan: z.enum(PACK_TIERS).optional(),
  billingStatus: z.enum(["trial", "active", "pending", "cancelling", "past_due", "suspended", "halted", "cancelled"]).optional(),
});

platformAdminRouter.patch(
  "/organizations/:id",
  requireDatabase,
  validateBody(updateOrganizationSchema),
  async (req, res) => {
    if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
      return res.status(404).json({ error: "NOT_FOUND", message: "Organization not found." });
    }
    const organization = await Organization.findOne({ _id: req.params.id, isPlatformOwner: mongoose.trusted({ $ne: true }) });
    if (!organization) {
      return res.status(404).json({ error: "NOT_FOUND", message: "Organization not found." });
    }
    if (!req.body.plan && !req.body.billingStatus) {
      return res.status(400).json({ error: "VALIDATION_ERROR", message: "Provide plan and/or billingStatus to update." });
    }

    const before = { plan: organization.plan, billingStatus: organization.billingStatus };
    if (req.body.plan) organization.plan = req.body.plan;
    if (req.body.billingStatus) organization.billingStatus = req.body.billingStatus;
    await organization.save();

    await logPlatformAdminAction(organization, "platformAdmin.organization_updated", {
      before,
      after: { plan: organization.plan, billingStatus: organization.billingStatus },
    });

    res.json({
      data: {
        id: organization._id.toString(),
        plan: organization.plan,
        billingStatus: organization.billingStatus,
        entitlements: getEntitlements(organization.plan),
      },
    });
  }
);

// Master plan Phase 8 (onboarding auto-configuration), fallback path: Vega's admin console lists
// these for a staffer to manually pick/activate when a client's industry isn't auto-configured
// (or at all, until the questionnaire-driven primary path exists).
platformAdminRouter.get("/industry-packs", requireDatabase, async (req, res) => {
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
  workspaceId: z.string().min(1, "workspaceId is required."),
  industryPackKey: z.string().min(1, "industryPackKey is required."),
});

// Clones an IndustryPack's templates into the target workspace as drafts (status: "draft", no
// whatsappAccountId - the workspace connects/submits them for real later, same as any
// hand-authored template). Same mechanism whether triggered by a future auto-configuration
// questionnaire (Phase 8's primary path) or, today, a staffer picking one by hand in Vega's
// console (the fallback path) - this endpoint doesn't know or care which triggered it.
platformAdminRouter.post(
  "/organizations/:id/provision",
  requireDatabase,
  validateBody(provisionSchema),
  async (req, res) => {
    if (!mongoose.Types.ObjectId.isValid(req.params.id) || !mongoose.Types.ObjectId.isValid(req.body.workspaceId)) {
      return res.status(404).json({ error: "NOT_FOUND", message: "Organization or workspace not found." });
    }
    const organization = await Organization.findOne({ _id: req.params.id, isPlatformOwner: mongoose.trusted({ $ne: true }) });
    if (!organization) {
      return res.status(404).json({ error: "NOT_FOUND", message: "Organization not found." });
    }

    let result;
    try {
      result = await provisionWorkspaceWithIndustryPack({
        organizationId: organization._id,
        workspaceId: req.body.workspaceId,
        industryPackKey: req.body.industryPackKey,
      });
    } catch (error) {
      if (error.code === "WORKSPACE_NOT_FOUND") {
        return res.status(404).json({ error: "NOT_FOUND", message: "Workspace not found on this organization." });
      }
      if (error.code === "PACK_NOT_FOUND") {
        return res.status(404).json({ error: "NOT_FOUND", message: "Industry pack not found." });
      }
      throw error;
    }
    const { pack, workspace, templatesCreated, crm, support } = result;

    await logPlatformAdminAction(organization, "platformAdmin.provisioned", {
      after: {
        workspaceId: workspace._id.toString(),
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
  }
);
