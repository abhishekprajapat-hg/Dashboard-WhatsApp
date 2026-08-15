import Redis from "ioredis";
import { config } from "../config.js";
import { logger } from "./logger.js";

let redisClient;

export function getRedisClient() {
  if (!config.redisUrl) return null;
  if (!redisClient) {
    redisClient = new Redis(config.redisUrl, {
      maxRetriesPerRequest: 3,
      enableReadyCheck: true,
      lazyConnect: true,
    });
    redisClient.on("error", (error) => {
      logger.warn({ err: error }, "Redis connection error");
    });
  }
  return redisClient;
}

export async function connectRedis() {
  const client = getRedisClient();
  if (!client) return { enabled: false, status: "disabled" };
  if (client.status === "ready") return { enabled: true, status: "ready" };
  await client.connect().catch(() => undefined);
  return { enabled: true, status: client.status };
}

export async function cacheGet(key) {
  const client = getRedisClient();
  if (!client || client.status !== "ready") return null;
  const value = await client.get(key);
  if (!value) return null;
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
}

export async function cacheSet(key, value, ttlSeconds = 300) {
  const client = getRedisClient();
  if (!client || client.status !== "ready") return false;
  await client.set(key, JSON.stringify(value), "EX", ttlSeconds);
  return true;
}

export async function cacheDelete(pattern) {
  const client = getRedisClient();
  if (!client || client.status !== "ready") return 0;
  const keys = await client.keys(pattern);
  if (!keys.length) return 0;
  return client.del(keys);
}

export function cacheStatus() {
  const client = getRedisClient();
  return {
    enabled: Boolean(client),
    status: client?.status || "disabled",
  };
}
