import test from "node:test";
import assert from "node:assert/strict";
import { getBillingGate } from "../middleware/billingGate.js";

const DAY_MS = 24 * 60 * 60 * 1000;

test("never locks Nemnidhi's own (isPlatformOwner) organizations, regardless of billingStatus", () => {
  assert.equal(getBillingGate({ isPlatformOwner: true, billingStatus: "cancelled" }).locked, false);
  assert.equal(getBillingGate({ isPlatformOwner: true, billingStatus: "halted" }).locked, false);
});

test("locks on halted/past_due/suspended/cancelled, with no extra grace period", () => {
  for (const billingStatus of ["halted", "past_due", "suspended", "cancelled"]) {
    const gate = getBillingGate({ isPlatformOwner: false, billingStatus });
    assert.equal(gate.locked, true, `expected ${billingStatus} to lock`);
  }
});

test("does not lock active or pending or cancelling (access continues through the paid cycle)", () => {
  for (const billingStatus of ["active", "pending", "cancelling"]) {
    assert.equal(getBillingGate({ isPlatformOwner: false, billingStatus }).locked, false, `expected ${billingStatus} to stay unlocked`);
  }
});

test("locks a self-serve trial once trialEndsAt has passed", () => {
  const gate = getBillingGate({
    isPlatformOwner: false,
    billingStatus: "trial",
    trialEndsAt: new Date(Date.now() - DAY_MS),
  });
  assert.equal(gate.locked, true);
  assert.equal(gate.reason, "trial_expired");
});

test("does not lock a self-serve trial before trialEndsAt", () => {
  const gate = getBillingGate({
    isPlatformOwner: false,
    billingStatus: "trial",
    trialEndsAt: new Date(Date.now() + DAY_MS),
  });
  assert.equal(gate.locked, false);
});

// The real reason this grandfather case exists: every organization created before this feature
// shipped is billingStatus "trial" with no trialEndsAt at all (the field didn't exist yet), and an
// admin-provisioned real client (POST /admin/tenants) is also created with no trialEndsAt, on
// purpose - neither should be retroactively locked out by a trial clock that was never started for
// them.
test("does not lock a trial-status org with no trialEndsAt (grandfathered pre-existing / admin-provisioned org)", () => {
  const gate = getBillingGate({ isPlatformOwner: false, billingStatus: "trial", trialEndsAt: null });
  assert.equal(gate.locked, false);
});
