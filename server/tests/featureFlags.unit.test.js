import test from "node:test";
import assert from "node:assert/strict";
import mongoose from "mongoose";
import { config } from "../config.js";
import {
  FEATURE_FLAG_DEFINITIONS,
  getFlagSync,
  isKnownFlagKey,
  listFeatureFlagsWithMeta,
  loadFeatureFlagsFromDb,
} from "../services/featureFlags.js";

// No Mongo connection in this file (mongoose.connection.readyState is 0 by default), so this
// covers the env-default/no-DB behavior. The DB-backed override/toggle behavior is covered by
// adminFeatureFlags.e2e.test.js, which needs a real Mongo connection.

test("isKnownFlagKey recognizes all 5 defined flags and rejects unknown keys", () => {
  for (const definition of FEATURE_FLAG_DEFINITIONS) {
    assert.equal(isKnownFlagKey(definition.key), true);
  }
  assert.equal(isKnownFlagKey("notARealFlag"), false);
});

test("getFlagSync reflects config.featureFlags before any DB load", () => {
  for (const definition of FEATURE_FLAG_DEFINITIONS) {
    assert.equal(getFlagSync(definition.key), Boolean(config.featureFlags[definition.key]));
  }
});

test("loadFeatureFlagsFromDb no-ops and keeps env defaults when Mongo isn't connected", async () => {
  assert.notEqual(mongoose.connection.readyState, 1, "expected no live Mongo connection in this test file");
  const flags = await loadFeatureFlagsFromDb();
  assert.deepEqual(flags, { ...config.featureFlags });
});

test("listFeatureFlagsWithMeta reports all 5 flags at env-default source when DB is unavailable", async () => {
  const flags = await listFeatureFlagsWithMeta();
  assert.equal(flags.length, FEATURE_FLAG_DEFINITIONS.length);
  for (const flag of flags) {
    assert.equal(flag.source, "env-default");
    assert.equal(flag.effective, flag.envDefault);
    assert.equal(flag.updatedByEmail, null);
  }
  const queueFlag = flags.find((flag) => flag.key === "queueProcessing");
  const rabbitFlag = flags.find((flag) => flag.key === "rabbitmqEvents");
  assert.equal(queueFlag.gatesRealBehavior, true);
  assert.equal(rabbitFlag.gatesRealBehavior, true);
  const decorative = flags.filter((flag) => !flag.gatesRealBehavior);
  assert.deepEqual(
    decorative.map((flag) => flag.key).sort(),
    ["infrastructurePanel", "s3MediaStorage", "zeroDowntimeMode"]
  );
});
