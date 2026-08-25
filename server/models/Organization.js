import mongoose from "mongoose";

const organizationSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true },
    slug: { type: String, required: true, unique: true, trim: true },
    ownerUserId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, index: true },
    // Pack tier - gates which capabilities this organization's workspaces get, see
    // services/entitlements.js. Kept as a plain string (not a hard schema enum) so an unknown
    // legacy value never blocks a save; entitlements.js is the single source of truth for what's
    // valid and falls back to "basic" for anything it doesn't recognize.
    plan: { type: String, default: "basic" },
    // "trial" | "pending" (mandate authorized, awaiting Razorpay's subscription.activated webhook) |
    // "active" | "halted" (recurring charge failed, Razorpay is retrying) | "cancelling" (client
    // cancelled, access continues until the current cycle ends) | "cancelled". Loose string, not a
    // hard enum, same reasoning as `plan` above - Razorpay's own event vocabulary can grow.
    billingStatus: { type: String, default: "trial" },
    razorpayCustomerId: { type: String, trim: true, default: "" },
    razorpaySubscriptionId: { type: String, trim: true, default: "" },
    settings: { type: mongoose.Schema.Types.Mixed, default: {} },
  },
  { timestamps: true }
);

export const Organization = mongoose.model("Organization", organizationSchema);
