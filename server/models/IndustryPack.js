import mongoose from "mongoose";

// Platform-wide catalog, not tenant-scoped - deliberately no organizationId/workspaceId, the same
// way Role/permission *definitions* differ from a Membership's actual role assignment. Vega's
// Platform Admin console (Phase 7) lists these for staff to pick from; the provisioning API
// (Phase 8, routes/platformAdmin.js) clones a pack's templates into a target workspace as drafts.
//
// Scoped honestly against what's actually configurable in this codebase today: the master plan's
// "default CRM pipeline stages/lead fields" and "default support ticket categories" turned out to
// require schema changes this pass didn't make - Lead.leadStages (models/Lead.js) is a fixed
// platform-wide enum, not per-workspace, and support ticket categories are a hardcoded UI list
// (SupportView.tsx), not read from any workspace setting. Faking those fields here would imply a
// capability that doesn't exist. Only WhatsApp templates are real and workspace-scoped today - the
// master plan's own example ("pre-built campaign/automation templates, cloned into the workspace
// as drafts") is exactly what this does. Automation flow cloning is a natural v2 extension of the
// same mechanism once a flow-graph clone is worth building; not done here.
const industryPackSchema = new mongoose.Schema(
  {
    key: { type: String, required: true, trim: true, unique: true },
    label: { type: String, required: true, trim: true },
    industry: { type: String, required: true, trim: true },
    description: { type: String, default: "" },
    // Cloned 1:1 into new Template documents at provisioning time (status: "draft",
    // whatsappAccountId left unset - a freshly provisioned workspace may not have connected a
    // number yet). Same field shape as models/Template.js's own header/buttons, not a subset -
    // a pack template should be able to define everything a hand-authored one can.
    templates: {
      type: [
        {
          name: { type: String, required: true, trim: true },
          language: { type: String, default: "en" },
          category: { type: String, default: "utility" },
          body: { type: String, default: "" },
          variables: { type: [String], default: [] },
          header: {
            format: { type: String, enum: ["NONE", "TEXT", "IMAGE", "VIDEO", "DOCUMENT"], default: "NONE" },
            text: { type: String, default: "" },
          },
          buttons: {
            type: [
              {
                type: { type: String, enum: ["QUICK_REPLY", "URL", "PHONE_NUMBER"], required: true },
                text: { type: String, required: true },
                url: { type: String, default: "" },
                phoneNumber: { type: String, default: "" },
              },
            ],
            default: [],
          },
        },
      ],
      default: [],
    },
    isActive: { type: Boolean, default: true },
  },
  { timestamps: true }
);

industryPackSchema.index({ industry: 1, isActive: 1 });

export const IndustryPack = mongoose.model("IndustryPack", industryPackSchema);
