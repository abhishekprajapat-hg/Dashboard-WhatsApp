import test from "node:test";
import assert from "node:assert/strict";
import { hasEntitlementForActor } from "../middleware/auth.js";

// Pure logic, no Mongo/Express needed - hasEntitlementForActor takes plain values. Direct
// instruction: the platform owner (Nemnidhi's own organization) always has every capability,
// regardless of its own plan field - see the function's own comment in auth.js for why.

test("platform owner has every capability regardless of plan", () => {
  const owner = { isPlatformOwner: true };
  assert.equal(hasEntitlementForActor(owner, "basic", "aiAssistant"), true);
  assert.equal(hasEntitlementForActor(owner, "basic", "automationBuilder"), true);
  assert.equal(hasEntitlementForActor(owner, undefined, "ads"), true);
});

test("a non-platform-owner still follows the normal plan->capability rules", () => {
  const client = { isPlatformOwner: false };
  assert.equal(hasEntitlementForActor(client, "basic", "aiAssistant"), false);
  assert.equal(hasEntitlementForActor(client, "pro", "aiAssistant"), true);
});

test("a missing/undefined actor is treated as a normal (non-owner) plan check", () => {
  assert.equal(hasEntitlementForActor(undefined, "basic", "automationBuilder"), false);
  assert.equal(hasEntitlementForActor(null, "medium", "automationBuilder"), true);
});
