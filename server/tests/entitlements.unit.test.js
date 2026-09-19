import test from "node:test";
import assert from "node:assert/strict";
import {
  CAPABILITY_DEFINITIONS,
  getEntitlements,
  getUsageLimit,
  hasEntitlement,
  isValidPackTier,
  PACK_TIERS,
  PLAN_LIMITS,
} from "../services/entitlements.js";

// Pure logic, no Mongo needed - this covers the tier->capability mapping directly. The
// requireEntitlement middleware's DB-backed lookup is covered separately wherever
// automation.js/assistant.js get e2e coverage.

test("PACK_TIERS is basic < medium < pro < custom, in that order", () => {
  assert.deepEqual(PACK_TIERS, ["basic", "medium", "pro", "custom"]);
});

test("isValidPackTier accepts the four known tiers and rejects anything else", () => {
  for (const tier of PACK_TIERS) assert.equal(isValidPackTier(tier), true);
  assert.equal(isValidPackTier("starter"), false);
  assert.equal(isValidPackTier(""), false);
  assert.equal(isValidPackTier(undefined), false);
});

test("basic tier only has messaging", () => {
  assert.equal(hasEntitlement("basic", "messaging"), true);
  assert.equal(hasEntitlement("basic", "campaigns"), false);
  assert.equal(hasEntitlement("basic", "automationBuilder"), false);
  assert.equal(hasEntitlement("basic", "analytics"), false);
  assert.equal(hasEntitlement("basic", "aiAssistant"), false);
});

test("medium tier adds campaigns and the automation builder, but not analytics/AI", () => {
  assert.equal(hasEntitlement("medium", "messaging"), true);
  assert.equal(hasEntitlement("medium", "campaigns"), true);
  assert.equal(hasEntitlement("medium", "automationBuilder"), true);
  assert.equal(hasEntitlement("medium", "analytics"), false);
  assert.equal(hasEntitlement("medium", "aiAssistant"), false);
});

test("pro tier has every defined capability", () => {
  for (const definition of CAPABILITY_DEFINITIONS) {
    assert.equal(hasEntitlement("pro", definition.key), true);
  }
});

test("custom tier is a strict superset of pro (never fewer capabilities)", () => {
  for (const definition of CAPABILITY_DEFINITIONS) {
    assert.equal(hasEntitlement("custom", definition.key), true);
  }
});

test("hasEntitlement rejects an unknown capability key rather than silently returning false", () => {
  assert.throws(() => hasEntitlement("pro", "notARealCapability"), /Unknown capability/);
});

test("hasEntitlement treats an unrecognized plan value (legacy 'starter', empty, typo) as basic", () => {
  assert.equal(hasEntitlement("starter", "messaging"), true);
  assert.equal(hasEntitlement("starter", "campaigns"), false);
  assert.equal(hasEntitlement("", "campaigns"), false);
  assert.equal(hasEntitlement(undefined, "campaigns"), false);
});

test("getEntitlements reports every capability with its enabled state for a given tier", () => {
  const result = getEntitlements("medium");
  assert.equal(result.plan, "medium");
  assert.equal(result.normalized, false);
  assert.equal(result.capabilities.length, CAPABILITY_DEFINITIONS.length);
  const byKey = Object.fromEntries(result.capabilities.map((item) => [item.key, item.enabled]));
  assert.equal(byKey.messaging, true);
  assert.equal(byKey.campaigns, true);
  assert.equal(byKey.automationBuilder, true);
  assert.equal(byKey.analytics, false);
  assert.equal(byKey.aiAssistant, false);
});

test("getEntitlements flags normalization when the stored plan isn't a known tier", () => {
  const result = getEntitlements("starter");
  assert.equal(result.plan, "basic");
  assert.equal(result.normalized, true);
});

// Phase 6 (master plan) - only messagesSent is populated in PLAN_LIMITS today, per its own TODO
// comment; every other metric must read as unmetered (null), not 0.
test("getUsageLimit returns the plan's messagesSent cap, rising with tier", () => {
  assert.equal(getUsageLimit("basic", "messagesSent"), PLAN_LIMITS.basic.messagesSent);
  assert.equal(getUsageLimit("medium", "messagesSent"), PLAN_LIMITS.medium.messagesSent);
  assert.equal(getUsageLimit("pro", "messagesSent"), PLAN_LIMITS.pro.messagesSent);
  assert.ok(PLAN_LIMITS.basic.messagesSent < PLAN_LIMITS.medium.messagesSent);
  assert.ok(PLAN_LIMITS.medium.messagesSent < PLAN_LIMITS.pro.messagesSent);
});

test("getUsageLimit returns null (unmetered) for a metric with no defined limit, and for the unmetered custom tier", () => {
  assert.equal(getUsageLimit("basic", "campaignsRun"), null);
  assert.equal(getUsageLimit("pro", "automationRuns"), null);
  assert.equal(getUsageLimit("custom", "messagesSent"), null);
});

test("getUsageLimit treats an unrecognized plan value the same way hasEntitlement does (falls back to basic)", () => {
  assert.equal(getUsageLimit("starter", "messagesSent"), PLAN_LIMITS.basic.messagesSent);
});
