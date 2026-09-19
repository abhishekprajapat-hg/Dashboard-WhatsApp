import mongoose from "mongoose";

// Platform-wide catalog, not tenant-scoped - deliberately no organizationId/workspaceId, the same
// way Role/permission *definitions* differ from a Membership's actual role assignment. Vega's
// Platform Admin console (Phase 7) lists these for staff to pick from; the provisioning API
// (Phase 8, routes/platformAdmin.js) clones a pack's templates into a target workspace as drafts.
//
// Originally scoped to templates only, because pipeline stages/custom fields/support categories
// weren't workspace-configurable yet (Lead.leadStages was a fixed platform-wide enum, support
// categories a hardcoded UI list). That gap is closed (see services/pipelineStages.js and
// routes/settings.js's crm/support config) - this pack now carries real CRM structure per
// industry, not just template text: pipelineStages/customFieldDefinitions/supportCategories are
// $set onto the target workspace's settings.crm/settings.support at provisioning time
// (routes/platformAdmin.js), same shapes routes/settings.js's own schemas validate. Automation
// flow cloning is still a natural v2 extension of the same mechanism, not done here.
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
    // Same shape services/pipelineStages.js resolves at runtime and routes/settings.js's
    // pipelineStagesSchema validates - `type` is the semantic won/lost/open tag every downstream
    // "is this deal won" check now keys off, independent of the stage's own label.
    pipelineStages: {
      type: [
        {
          key: { type: String, required: true, trim: true },
          label: { type: String, required: true, trim: true },
          color: { type: String, default: "primary" },
          type: { type: String, enum: ["open", "won", "lost"], required: true },
        },
      ],
      default: [],
    },
    customFieldDefinitions: {
      type: [
        {
          key: { type: String, required: true, trim: true },
          label: { type: String, required: true, trim: true },
          type: { type: String, enum: ["text", "number", "date", "select"], required: true },
          options: { type: [String], default: [] },
        },
      ],
      default: [],
    },
    supportCategories: {
      type: [
        {
          key: { type: String, required: true, trim: true },
          label: { type: String, required: true, trim: true },
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
