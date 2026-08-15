import mongoose from "mongoose";
import { config } from "../config.js";
import { FeatureFlag } from "../models/FeatureFlag.js";
import { connectRabbitMQ, disconnectRabbitMQ } from "./messageBus.js";

// Definitions for every known flag. `gatesRealBehavior` is what lets the admin UI honestly badge
// which flags actually change anything today vs. which are stored for a future feature but read
// nowhere in the codebase - see HANDOFF.md for the research behind this split.
export const FEATURE_FLAG_DEFINITIONS = [
  {
    key: "queueProcessing",
    label: "Queue Processing (BullMQ)",
    description: "Routes campaign sends, webhook retries, and automation delay/loop waits through BullMQ instead of the synchronous inline fallback.",
    envVar: "FEATURE_QUEUE_PROCESSING",
    gatesRealBehavior: true,
  },
  {
    key: "rabbitmqEvents",
    label: "RabbitMQ Event Bus",
    description: "Connects to RabbitMQ and publishes internal events to the whatscrm.events exchange. Toggling this connects/disconnects the broker live.",
    envVar: "FEATURE_RABBITMQ_EVENTS",
    gatesRealBehavior: true,
  },
  {
    key: "s3MediaStorage",
    label: "S3 Media Storage",
    description: "Not read anywhere in the codebase today - the real S3 switch is MEDIA_STORAGE_DRIVER (config.s3.enabled). Stored here for visibility only.",
    envVar: "FEATURE_S3_MEDIA_STORAGE",
    gatesRealBehavior: false,
  },
  {
    key: "infrastructurePanel",
    label: "Infrastructure Panel",
    description: "Not read anywhere in the codebase today. Stored here for visibility only.",
    envVar: "FEATURE_INFRASTRUCTURE_PANEL",
    gatesRealBehavior: false,
  },
  {
    key: "zeroDowntimeMode",
    label: "Zero Downtime Mode",
    description: "Not read anywhere in the codebase today. Stored here for visibility only.",
    envVar: "FEATURE_ZERO_DOWNTIME_MODE",
    gatesRealBehavior: false,
  },
];

const KNOWN_FLAG_KEYS = new Set(FEATURE_FLAG_DEFINITIONS.map((definition) => definition.key));

// Seeded synchronously at import time so getFlagSync() always has a valid value, even before
// loadFeatureFlagsFromDb() resolves (e.g. a call that races the boot sequence).
let cachedFlags = { ...config.featureFlags };

export function isKnownFlagKey(key) {
  return KNOWN_FLAG_KEYS.has(key);
}

async function applyRuntimeSideEffects(key, enabled) {
  if (key !== "rabbitmqEvents") return;
  if (enabled) {
    await connectRabbitMQ();
  } else {
    await disconnectRabbitMQ();
  }
}

export async function loadFeatureFlagsFromDb() {
  if (mongoose.connection.readyState !== 1) return { ...cachedFlags };
  const overrides = await FeatureFlag.find({});
  const merged = { ...config.featureFlags };
  for (const override of overrides) {
    if (KNOWN_FLAG_KEYS.has(override.key)) merged[override.key] = override.enabled;
  }
  cachedFlags = merged;
  return { ...cachedFlags };
}

export function getFlagSync(key) {
  return Boolean(cachedFlags[key]);
}

export async function setFeatureFlagOverride(key, enabled, actor = {}) {
  if (!KNOWN_FLAG_KEYS.has(key)) throw new Error(`Unknown feature flag: ${key}`);
  await FeatureFlag.findOneAndUpdate(
    { key },
    { $set: { key, enabled, updatedByUserId: actor.id, updatedByEmail: actor.email } },
    { upsert: true, new: true, setDefaultsOnInsert: true }
  );
  cachedFlags = { ...cachedFlags, [key]: enabled };
  await applyRuntimeSideEffects(key, enabled);
  return listFeatureFlagsWithMeta();
}

export async function clearFeatureFlagOverride(key) {
  if (!KNOWN_FLAG_KEYS.has(key)) throw new Error(`Unknown feature flag: ${key}`);
  await FeatureFlag.deleteOne({ key });
  const defaultValue = Boolean(config.featureFlags[key]);
  cachedFlags = { ...cachedFlags, [key]: defaultValue };
  await applyRuntimeSideEffects(key, defaultValue);
  return listFeatureFlagsWithMeta();
}

export async function listFeatureFlagsWithMeta() {
  const overrides = mongoose.connection.readyState === 1 ? await FeatureFlag.find({}) : [];
  const overrideByKey = new Map(overrides.map((override) => [override.key, override]));
  return FEATURE_FLAG_DEFINITIONS.map((definition) => {
    const override = overrideByKey.get(definition.key);
    return {
      key: definition.key,
      label: definition.label,
      description: definition.description,
      envVar: definition.envVar,
      gatesRealBehavior: definition.gatesRealBehavior,
      envDefault: Boolean(config.featureFlags[definition.key]),
      effective: Boolean(cachedFlags[definition.key]),
      source: override ? "override" : "env-default",
      updatedByEmail: override?.updatedByEmail || null,
      updatedAt: override?.updatedAt || null,
    };
  });
}

// Kept for `infrastructure.js`'s `GET /status` - same signature as before, now backed by the
// in-memory cache (loaded from Mongo, kept live on every toggle) instead of the old per-workspace
// Redis TTL cache, which never actually varied by workspace.
export async function getFeatureFlags(workspaceId = "global") {
  return {
    ...cachedFlags,
    workspaceId,
    evaluatedAt: new Date().toISOString(),
  };
}
