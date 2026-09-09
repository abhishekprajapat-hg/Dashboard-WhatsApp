import mongoose from "mongoose";
import { Organization } from "../models/index.js";

// Statuses that mean Meta's/Razorpay's own retry cycle is already exhausted, or the client
// explicitly ended their subscription and the paid period is over - by design, no extra grace
// period beyond what Razorpay itself already gives (Razorpay auto-retries a failed charge several
// times before ever marking a subscription "halted", so there's no real-world payment window left
// to wait out once it reaches this state). "past_due"/"suspended" are the admin-settable
// equivalents from PATCH /admin/tenants/:id/billing-status's own enum.
const LOCKED_BILLING_STATUSES = new Set(["halted", "past_due", "suspended", "cancelled"]);

// Pure function, no I/O - takes the fields it needs so callers (this middleware, the Billing page's
// own GET route, tests) can all share one definition of "is this org locked" without duplicating
// the logic three different ways.
export function getBillingGate({ isPlatformOwner, billingStatus, trialEndsAt } = {}) {
  // Nemnidhi's own organization(s) are never billing-gated, regardless of billingStatus.
  if (isPlatformOwner) return { locked: false };

  if (LOCKED_BILLING_STATUSES.has(billingStatus)) {
    return { locked: true, reason: billingStatus === "cancelled" ? "subscription_cancelled" : "payment_failed" };
  }

  // trialEndsAt is only ever set for a genuine self-serve signup (see
  // provisionWorkspaceForNewUser) - an org with billingStatus "trial" but no trialEndsAt is either
  // an admin-provisioned client that predates this field, or a pre-existing account grandfathered
  // in when trial enforcement first shipped. Neither should be locked out by a clock that was never
  // started for them.
  if (billingStatus === "trial" && trialEndsAt && new Date() > new Date(trialEndsAt)) {
    return { locked: true, reason: "trial_expired" };
  }

  return { locked: false };
}

export function billingLockedMessage(reason) {
  if (reason === "trial_expired") return "Your trial has ended. Subscribe to keep sending messages and running campaigns.";
  if (reason === "subscription_cancelled") return "Your subscription has ended. Resubscribe to keep sending messages and running campaigns.";
  return "Your last payment failed and Meta's automatic retries are exhausted. Update your payment method to keep sending messages and running campaigns.";
}

// Soft lock, by design (not a hard login block): this only gates the specific "core action" routes
// it's applied to (sending messages, launching campaigns) - Settings, Billing, and login remain
// reachable so a locked-out admin can actually fix the payment method or resubscribe. Every route
// this is applied to already runs after requireAuth + requireWorkspaceContext, so req.user.
// organizationId is guaranteed present and valid by the time this runs.
export function requireActiveBilling() {
  return async (req, res, next) => {
    if (mongoose.connection.readyState !== 1) return next();

    const organization = await Organization.findById(req.user.organizationId).select("isPlatformOwner billingStatus trialEndsAt");
    if (!organization) return next();

    const gate = getBillingGate(organization);
    if (!gate.locked) return next();

    res.status(402).json({ error: "BILLING_LOCKED", reason: gate.reason, message: billingLockedMessage(gate.reason) });
  };
}
