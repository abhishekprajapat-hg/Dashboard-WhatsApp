import { config } from "../config.js";
import { cacheGet, cacheSet } from "./cache.js";

export async function getFeatureFlags(workspaceId = "global") {
  const cacheKey = `flags:${workspaceId}`;
  const cached = await cacheGet(cacheKey);
  if (cached) return cached;
  const flags = {
    ...config.featureFlags,
    workspaceId,
    evaluatedAt: new Date().toISOString(),
  };
  await cacheSet(cacheKey, flags, 60);
  return flags;
}

export async function isFeatureEnabled(name, workspaceId) {
  const flags = await getFeatureFlags(workspaceId);
  return Boolean(flags[name]);
}
