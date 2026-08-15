import Redis from "ioredis";
import { Queue, Worker, QueueEvents } from "bullmq";
import { config } from "../config.js";
import { getFlagSync } from "./featureFlags.js";
import { callOutboundWebhook } from "./integrations.js";
import { logger } from "./logger.js";
import { publishEvent } from "./messageBus.js";
import { processCampaignRecipient } from "./campaignSender.js";
import {
  processAutomationGoogleSheetAction,
  processAutomationSendMessage,
  processAutomationWebhookAction,
} from "./automationSender.js";
import { resumeAutomationRun } from "./automationEngine.js";

const queues = new Map();
const workers = new Map();
const events = new Map();

// BullMQ's blocking commands require their own connection with maxRetriesPerRequest: null -
// it must not be shared with services/cache.js's client, which needs bounded retries to fail fast.
let bullConnection;

function connectionOptions() {
  if (!config.redisUrl || !getFlagSync("queueProcessing")) return null;
  if (!bullConnection) {
    bullConnection = new Redis(config.redisUrl, {
      maxRetriesPerRequest: null,
      enableReadyCheck: false,
    });
    bullConnection.on("error", (error) => logger.warn({ err: error }, "BullMQ Redis connection error"));
  }
  return { connection: bullConnection };
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
  workers.set("campaigns", new Worker("campaigns", async (job) => processCampaignRecipient(job.data), { ...options, concurrency: 10 }));
  const automationProcessors = {
    "automation.call-webhook": processAutomationWebhookAction,
    "automation.google-sheets": processAutomationGoogleSheetAction,
    "automation.send-message": processAutomationSendMessage,
    "automation.resume-run": resumeAutomationRun,
  };
  workers.set("automations", new Worker(
    "automations",
    async (job) => (automationProcessors[job.name] || processAutomationSendMessage)(job.data),
    { ...options, concurrency: 10 }
  ));

  for (const [name, worker] of workers) {
    worker.on("failed", (job, error) => logger.warn({ queue: name, jobId: job?.id, err: error }, "Job failed"));
  }

  return { enabled: true, workers: workers.size };
}

export async function queueHealth() {
  const names = ["webhooks", "events", "maintenance", "campaigns", "automations"];
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
