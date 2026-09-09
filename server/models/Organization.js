import mongoose from "mongoose";

const organizationSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true },
    slug: { type: String, required: true, unique: true, trim: true },
    ownerUserId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, index: true },
    // True only for Nemnidhi's own organization(s) - gates platform-wide controls (global feature
    // flags, direct plan overrides bypassing billing) that must never be reachable by a paying
    // client's own admin, even though that admin's role otherwise carries wildcard permissions on
    // their own workspace. Defaults false so every new signup is correctly scoped from creation.
    isPlatformOwner: { type: Boolean, default: false },
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
    // Only ever set for a genuine self-serve signup (provisionWorkspaceForNewUser's default path) -
    // an admin-provisioned tenant (POST /admin/tenants, real sold/custom clients) is created with
    // billingStatus "active" and this left null instead, so it's never subject to trial-expiry
    // enforcement. Also null on every organization that existed before this field was introduced -
    // deliberately NOT backfilled, so a pre-existing "trial"-status org (there was never any
    // enforcement before, so plenty exist) is grandfathered rather than retroactively locked out
    // the moment enforcement ships. See services/billingGate.js.
    trialEndsAt: { type: Date, default: null },
    // Denormalized from the latest Razorpay `subscription.charged` webhook's current_start/
    // current_end (routes/billingWebhook.js) purely for fast display on the Billing page - the
    // Invoice documents remain the source of truth for per-cycle history.
    currentPeriodStart: { type: Date, default: null },
    currentPeriodEnd: { type: Date, default: null },
    razorpayCustomerId: { type: String, trim: true, default: "" },
    razorpaySubscriptionId: { type: String, trim: true, default: "" },
    settings: { type: mongoose.Schema.Types.Mixed, default: {} },
  },
  { timestamps: true }
);

export const Organization = mongoose.model("Organization", organizationSchema);
