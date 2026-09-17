import Redis from "ioredis";
import { Queue, Worker } from "bullmq";
import { config } from "../config.js";
import { getFlagSync } from "./featureFlags.js";
import { logger } from "./logger.js";
import { processCampaignRecipient } from "./campaignSender.js";
import { sweepMeetingReminders } from "./meetingReminders.js";
import {
  processAutomationGoogleSheetAction,
  processAutomationSendMessage,
  processAutomationWebhookAction,
} from "./automationSender.js";
import { resumeAutomationRun } from "./automationEngine.js";

const queues = new Map();
const workers = new Map();

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

  // No "webhooks" or "events" queue here on purpose - callOutboundWebhook and publishEvent are
  // both only ever invoked synchronously elsewhere in this codebase (settings.js, automationSender.js),
  // never through enqueueJob("webhooks"/"events", ...). A Worker for either would sit idling
  // against Redis forever, unable to ever process a job - pure background cost on a pay-as-you-go
  // instance. Re-add them if something actually starts enqueuing to those names.
  //
  // drainDelay: 15 (seconds, BullMQ's default is 5) - campaigns is a paced batch broadcast, not a
  // live reply someone's waiting on (individual sends are already spaced out via each job's own
  // `delay`), so checking in less often here is free money on a pay-as-you-go Redis instance.
  // automations does NOT get this - a flow's send_message action to a real, live conversation goes
  // through this exact worker (automationSender.js's enqueueAutomationSendMessage), so slowing its
  // check-ins down would directly delay every automated reply a real customer sees.
  workers.set("campaigns", new Worker("campaigns", async (job) => processCampaignRecipient(job.data), { ...options, concurrency: 10, drainDelay: 15 }));
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

let reminderSweepInterval;

// The meeting-reminder sweep used to be a BullMQ repeatable job on a "maintenance" queue, but it
// never needed Redis at all - it's a single 15-minute timer with nothing worth persisting across a
// restart (a reminder running a few minutes late after a deploy is a non-issue, unlike an
// automation's delay node, which genuinely needs to survive one). That queue's own idle Worker was
// still checking in against Redis every 5 seconds, all day, for a job that only actually needs to
// run every 15 minutes - real, ongoing cost on a pay-as-you-go instance for zero benefit. A plain
// interval does the identical job with no Redis dependency at all. Runs once immediately at boot
// (rather than waiting up to 15 minutes for the first tick) so reminders don't lag right after every
// deploy restart.
export function startMeetingReminderSweep() {
  if (reminderSweepInterval) return;
  const run = () => sweepMeetingReminders().catch((error) => logger.warn({ err: error }, "meetingReminders: sweep failed"));
  run();
  reminderSweepInterval = setInterval(run, 15 * 60 * 1000);
}

export async function queueHealth() {
  const names = ["campaigns", "automations"];
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
