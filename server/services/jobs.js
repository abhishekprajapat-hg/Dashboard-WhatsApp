import { Queue, Worker, QueueEvents } from "bullmq";
import { config } from "../config.js";
import { getRedisClient } from "./cache.js";
import { callOutboundWebhook } from "./integrations.js";
import { publishEvent } from "./messageBus.js";

const queues = new Map();
const workers = new Map();
const events = new Map();

function connectionOptions() {
  const redis = getRedisClient();
  if (!redis || !config.featureFlags.queueProcessing) return null;
  return { connection: redis };
}

export function getQueue(name) {
  const options = connectionOptions();
  if (!options) return null;
  if (!queues.has(name)) {
    queues.set(name, new Queue(name, {
      ...options,
      defaultJobOptions: {
        attempts: 5,
        backoff: { type: "exponential", delay: 5000 },
        removeOnComplete: 1000,
        removeOnFail: 5000,
      },
    }));
    events.set(name, new QueueEvents(name, options));
  }
  return queues.get(name);
}

export async function enqueueJob(name, jobName, data = {}, options = {}) {
  const queue = getQueue(name);
  if (!queue) return { queued: false, reason: "queue_disabled" };
  const job = await queue.add(jobName, data, options);
  return { queued: true, id: job.id };
}

export function startWorkers() {
  const options = connectionOptions();
  if (!options || workers.size) return { enabled: Boolean(options), workers: workers.size };

  workers.set("webhooks", new Worker("webhooks", async (job) => callOutboundWebhook(job.data), options));
  workers.set("events", new Worker("events", async (job) => publishEvent(job.name, job.data), options));
  workers.set("maintenance", new Worker("maintenance", async () => ({ ok: true, ranAt: new Date().toISOString() }), options));

  for (const [name, worker] of workers) {
    worker.on("failed", (job, error) => console.warn(`Job failed in ${name}:`, job?.id, error.message));
  }

  return { enabled: true, workers: workers.size };
}

export async function queueHealth() {
  const names = ["webhooks", "events", "maintenance"];
  const health = {};
  for (const name of names) {
    const queue = getQueue(name);
    if (!queue) {
      health[name] = { enabled: false };
      continue;
    }
    const counts = await queue.getJobCounts("waiting", "active", "delayed", "failed", "completed");
    health[name] = { enabled: true, ...counts };
  }
  return health;
}
