import mongoose from "mongoose";
import { cacheStatus } from "./cache.js";
import { rabbitStatus } from "./messageBus.js";
import { queueHealth } from "./jobs.js";
import { config } from "../config.js";

export async function healthSnapshot() {
  const queues = await queueHealth().catch((error) => ({ error: error.message }));
  const mongoReady = mongoose.connection.readyState === 1;
  const redis = cacheStatus();
  const rabbitmq = rabbitStatus();
  const ready = mongoReady && (!redis.enabled || redis.status === "ready") && (!rabbitmq.enabled || rabbitmq.status === "ready");

  return {
    ok: ready,
    service: "whatscrm-api",
    environment: config.nodeEnv,
    version: process.env.npm_package_version || "0.1.0",
    uptimeSeconds: Math.round(process.uptime()),
    checks: {
      mongo: { enabled: true, status: mongoReady ? "ready" : "unavailable" },
      redis,
      rabbitmq,
      queues,
      mediaStorage: { driver: config.s3.enabled ? "s3" : "local", cdn: Boolean(config.cdnBaseUrl) },
      telemetry: { enabled: config.telemetry.enabled },
    },
  };
}
