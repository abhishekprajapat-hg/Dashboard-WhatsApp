import test from "node:test";
import assert from "node:assert/strict";
import mongoose from "mongoose";
import { startTestServer } from "./helpers/testServer.js";
import { seedTestWorkspace } from "./helpers/seedTestWorkspace.js";
import { AutomationRun } from "../models/index.js";

// Drives the real node-based automation engine (Phase 1) end to end: a trigger -> condition
// branch, where the true branch replies immediately and the false branch waits at a real
// (non-mocked) short delay before replying. Proves graph traversal, branching, and pause/
// persist/resume against the actual queue, not just synchronous single-pass execution.
// Own port/DB, distinct from the other e2e/integration suites - see criticalPath.e2e.test.js.
const TEST_PORT = 4213;
const MONGO_URI = process.env.TEST_MONGODB_URI_E2E_AUTOMATION || "mongodb://127.0.0.1:27017/whatscrm_test_e2e_automation";
const DELAY_SECONDS = 3;

let server;
let token;
let seed;
let phoneNumberId;
let flowId;
let conversationId;

async function api(path, { method = "GET", body, expectStatus } = {}) {
  const response = await fetch(`${server.baseUrl}${path}`, {
    method,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await response.json().catch(() => ({}));
  if (expectStatus && response.status !== expectStatus) {
    throw new Error(`Expected ${expectStatus} from ${method} ${path}, got ${response.status}: ${JSON.stringify(data)}`);
  }
  return { status: response.status, data };
}

async function postWebhook(payload) {
  const response = await fetch(`${server.baseUrl}/webhooks/whatsapp`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  return response.status;
}

function metaInboundPayload({ from, messageId, text, waName = "Automation E2E Contact" }) {
  return {
    entry: [
      {
        changes: [
          {
            value: {
              metadata: { phone_number_id: phoneNumberId },
              contacts: [{ wa_id: from, profile: { name: waName } }],
              messages: [{ id: messageId, from, text: { body: text } }],
            },
          },
        ],
      },
    ],
  };
}

async function waitFor(fn, { timeoutMs = 20000, intervalMs = 300 } = {}) {
  const start = Date.now();
  let lastError;
  while (Date.now() - start < timeoutMs) {
    try {
      const result = await fn();
      if (result) return result;
    } catch (error) {
      lastError = error;
    }
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
  throw lastError || new Error(`Condition not met within ${timeoutMs}ms.`);
}

test.before(async () => {
  const admin = await mongoose.connect(MONGO_URI, { serverSelectionTimeoutMS: 10000 });
  await admin.connection.dropDatabase().catch(() => undefined);
  await mongoose.disconnect();

  seed = await seedTestWorkspace({ mongoUri: MONGO_URI, contactCount: 0 });

  // Force queue processing on so the false-branch delay node genuinely pauses/resumes through
  // BullMQ against the Redis instance configured in server/.env, instead of silently failing
  // with delay_requires_queue_processing - this test's whole point is proving that path works.
  server = startTestServer({ port: TEST_PORT, mongoUri: MONGO_URI, extraEnv: { FEATURE_QUEUE_PROCESSING: "true" } });
  await server.waitUntilReady();

  await mongoose.connect(MONGO_URI, { serverSelectionTimeoutMS: 10000 });

  const login = await api("/api/auth/login", {
    method: "POST",
    body: { email: seed.email, password: seed.password },
    expectStatus: 200,
  });
  token = login.data.token;
  assert.ok(token, "login did not return a token");
});

test.after(async () => {
  await server?.stop();
  await mongoose.connection.dropDatabase().catch(() => undefined);
  await mongoose.disconnect();
});

test("connects a WhatsApp account for the branching flow to run against", async () => {
  phoneNumberId = `automation_e2e_phone_${Date.now()}`;
  const { status, data } = await api("/api/whatsapp/accounts", {
    method: "POST",
    body: {
      provider: "meta",
      displayName: "Automation E2E WhatsApp",
      phoneNumber: "+919990000002",
      phoneNumberId,
      businessAccountId: `automation_e2e_business_${Date.now()}`,
    },
  });
  assert.equal(status, 201);
  assert.equal(data.data.status, "connected");
});

test("creates a trigger -> condition -> [true: reply, false: delay -> reply] flow via the real API", async () => {
  const nodes = [
    { id: "trigger", type: "trigger" },
    { id: "cond1", type: "condition", config: { field: "trigger.body", operator: "contains", value: "urgent" } },
    { id: "send_true", type: "send_message", config: { body: "Escalating now" } },
    { id: "delay1", type: "delay", config: { duration: DELAY_SECONDS, unit: "seconds" } },
    { id: "send_false", type: "send_message", config: { body: "Thanks, we'll get back to you" } },
  ];
  const edges = [
    { id: "trigger-cond1", source: "trigger", target: "cond1" },
    { id: "cond1-true", source: "cond1", target: "send_true", sourceHandle: "true" },
    { id: "cond1-false", source: "cond1", target: "delay1", sourceHandle: "false" },
    { id: "delay1-send_false", source: "delay1", target: "send_false" },
  ];

  const { status, data } = await api("/api/automation", {
    method: "POST",
    body: {
      name: "E2E Condition + Delay Branch",
      triggerType: "new_message",
      sendReply: false,
      status: "active",
      nodes,
      edges,
    },
  });

  assert.equal(status, 201);
  assert.equal(data.data.status, "active");
  assert.equal(data.data.nodes.length, 5);
  assert.equal(data.data.edges.length, 4);
  flowId = data.data.id;
});

test("an inbound message matching the condition takes the true branch and replies immediately", async () => {
  const from = "919990001001";
  const webhookStatus = await postWebhook(
    metaInboundPayload({ from, messageId: `automation_e2e_msg_true_${Date.now()}`, text: "This is urgent, please help" })
  );
  assert.equal(webhookStatus, 200);

  const { data: conversations } = await api("/api/conversations");
  const conversation = conversations.data.find((item) => item.phone === from);
  assert.ok(conversation, "expected a conversation to exist for the inbound contact");
  conversationId = conversation.id;

  const trueReply = await waitFor(async () => {
    const { data } = await api(`/api/conversations/${conversationId}/messages`);
    return data.data.find((message) => message.content === "Escalating now");
  });
  assert.equal(trueReply.from, "agent");

  // The false-branch reply must never appear for this run.
  const { data: messagesAfter } = await api(`/api/conversations/${conversationId}/messages`);
  assert.equal(
    messagesAfter.data.some((message) => message.content === "Thanks, we'll get back to you"),
    false,
    "the false branch must not fire when the condition matched true"
  );

  const run = await waitFor(() =>
    AutomationRun.findOne({ flowId, "trigger.conversationId": new mongoose.Types.ObjectId(conversationId) }).sort({ createdAt: -1 })
  );
  assert.equal(run.status, "completed");
  const stepTypes = run.history.map((entry) => entry.type);
  assert.deepEqual(stepTypes, ["condition", "send_message"]);
  assert.equal(run.history[0].action.result, true);
});

test("a non-matching inbound message takes the false branch: no immediate reply, then a real delayed reply, with the run pausing and resuming", async () => {
  const from = "919990001002";
  const webhookStatus = await postWebhook(
    metaInboundPayload({ from, messageId: `automation_e2e_msg_false_${Date.now()}`, text: "Just checking in, no rush" })
  );
  assert.equal(webhookStatus, 200);

  const { data: conversations } = await api("/api/conversations");
  const conversation = conversations.data.find((item) => item.phone === from);
  assert.ok(conversation, "expected a conversation to exist for the inbound contact");
  const falseConversationId = conversation.id;

  // Give the condition step a moment to run, then confirm the reply has NOT appeared yet and the
  // run is genuinely paused (status "waiting"), not just slow.
  const waitingRun = await waitFor(async () => {
    const run = await AutomationRun.findOne({ flowId, "trigger.conversationId": new mongoose.Types.ObjectId(falseConversationId) }).sort({ createdAt: -1 });
    return run?.status === "waiting" ? run : null;
  });
  assert.equal(waitingRun.status, "waiting");
  assert.ok(waitingRun.resumeAt, "a waiting run must record when it will resume");

  const { data: messagesBeforeDelay } = await api(`/api/conversations/${falseConversationId}/messages`);
  assert.equal(
    messagesBeforeDelay.data.some((message) => message.content === "Thanks, we'll get back to you"),
    false,
    "the delayed reply must not appear before the delay elapses"
  );

  const falseReply = await waitFor(
    async () => {
      const { data } = await api(`/api/conversations/${falseConversationId}/messages`);
      return data.data.find((message) => message.content === "Thanks, we'll get back to you");
    },
    { timeoutMs: (DELAY_SECONDS + 15) * 1000 }
  );
  assert.equal(falseReply.from, "agent");

  const completedRun = await waitFor(async () => {
    const run = await AutomationRun.findOne({ flowId, "trigger.conversationId": new mongoose.Types.ObjectId(falseConversationId) }).sort({ createdAt: -1 });
    return run?.status === "completed" ? run : null;
  });
  const stepTypes = completedRun.history.map((entry) => entry.type);
  assert.deepEqual(stepTypes, ["condition", "delay", "send_message"]);
  assert.equal(completedRun.history[0].action.result, false);
});

test("the flow test endpoint skips the delay and runs synchronously in one pass", async () => {
  const { status, data } = await api(`/api/automation/${flowId}/test`, {
    method: "POST",
    body: { message: "no rush at all" },
  });
  assert.equal(status, 200);
  assert.equal(data.matched, true);

  const delayAction = data.actions.find((action) => action.type === "delay");
  assert.ok(delayAction, "expected a delay action in the synchronous test result");
  assert.equal(delayAction.skipped, true);

  const sendActions = data.actions.filter((action) => action.type === "send_message");
  assert.equal(sendActions.length, 1);
  assert.equal(sendActions[0].status, "sent");
});

test("GET /api/automation/:id/runs returns the run history for the flow", async () => {
  const { status, data } = await api(`/api/automation/${flowId}/runs`);
  assert.equal(status, 200);
  assert.ok(Array.isArray(data.data));
  // The two inbound-triggered runs from earlier tests (true branch + false branch) must both
  // show up, most recent first, each with a real step-by-step history a client can render.
  assert.ok(data.data.length >= 2, `expected at least 2 runs, got ${data.data.length}`);

  const completedRuns = data.data.filter((run) => run.status === "completed" && !run.testMode);
  assert.ok(completedRuns.length >= 2);

  // Non-test-mode send_message actions are queued, not delivered synchronously - messageId is
  // only populated on the /test endpoint's synchronous path (covered by the previous test).
  const trueRun = completedRuns.find((run) => run.history.some((step) => step.type === "send_message" && step.action?.status === "queued"));
  assert.ok(trueRun, "expected a run whose history includes a queued send_message step");
  const conditionStep = trueRun.history.find((step) => step.type === "condition");
  assert.ok(conditionStep, "expected the condition step to appear in run history");
  assert.ok(conditionStep.branch === "true" || conditionStep.branch === "false");

  const timestamps = data.data.map((run) => new Date(run.createdAt).getTime());
  const sorted = [...timestamps].sort((a, b) => b - a);
  assert.deepEqual(timestamps, sorted, "runs must be returned most-recent-first");
});

test("a loop node iterates a real array through a genuine graph cycle, then falls through to done", async () => {
  const nodes = [
    { id: "trigger", type: "trigger" },
    { id: "json_1", type: "json_parser", config: { body: '["Alice","Bob","Carol"]' } },
    { id: "loop_1", type: "loop", config: { field: "steps.json_1.parsed" } },
    { id: "send_item", type: "send_message", config: { body: "Hi {{steps.loop_1.item}}" } },
    { id: "send_done", type: "send_message", config: { body: "All items processed" } },
  ];
  const edges = [
    { id: "trigger-json1", source: "trigger", target: "json_1" },
    { id: "json1-loop1", source: "json_1", target: "loop_1" },
    { id: "loop1-senditem", source: "loop_1", target: "send_item", sourceHandle: "loop" },
    // The literal cycle: the loop body's last node wires back into the loop node itself.
    { id: "senditem-loop1", source: "send_item", target: "loop_1" },
    { id: "loop1-senddone", source: "loop_1", target: "send_done", sourceHandle: "done" },
  ];

  const flow = await api("/api/automation", {
    method: "POST",
    body: { name: "E2E Loop", triggerType: "new_message", sendReply: false, status: "active", nodes, edges },
  });
  assert.equal(flow.status, 201);
  const loopFlowId = flow.data.data.id;

  const from = "919990001003";
  const webhookStatus = await postWebhook(
    metaInboundPayload({ from, messageId: `automation_e2e_loop_${Date.now()}`, text: "trigger the loop" })
  );
  assert.equal(webhookStatus, 200);

  const { data: conversations } = await api("/api/conversations");
  const conversation = conversations.data.find((item) => item.phone === from);
  assert.ok(conversation, "expected a conversation to exist for the loop test contact");
  const loopConversationId = conversation.id;

  // All 4 sends (3 loop iterations + the final "done" message) are queued, not synchronous -
  // wait for the last one, by which point the earlier ones must already be present too.
  await waitFor(async () => {
    const { data } = await api(`/api/conversations/${loopConversationId}/messages`);
    return data.data.find((message) => message.content === "All items processed");
  });

  const { data: messages } = await api(`/api/conversations/${loopConversationId}/messages`);
  const replyBodies = messages.data.filter((message) => message.from === "agent").map((message) => message.content);
  // The 4 sends are enqueued in the correct order within one synchronous advanceRun pass, but the
  // automations worker processes its queue with concurrency:10 - delivery completion order across
  // concurrently-processed jobs isn't guaranteed, so check the set, not the sequence. The loop's
  // own deterministic per-iteration order is verified separately below via run.history, which
  // reflects the engine's synchronous traversal and isn't affected by queue timing.
  assert.deepEqual([...replyBodies].sort(), ["All items processed", "Hi Alice", "Hi Bob", "Hi Carol"]);

  const run = await waitFor(async () => {
    const found = await AutomationRun.findOne({ flowId: loopFlowId, "trigger.conversationId": new mongoose.Types.ObjectId(loopConversationId) }).sort({ createdAt: -1 });
    return found?.status === "completed" ? found : null;
  });

  const loopSteps = run.history.filter((entry) => entry.type === "loop");
  assert.equal(loopSteps.length, 4, "expected 4 visits to the loop node: 3 iterations + 1 done");
  assert.deepEqual(loopSteps.map((step) => step.branch), ["loop", "loop", "loop", "done"]);
  assert.deepEqual(loopSteps.slice(0, 3).map((step) => step.action.item), ["Alice", "Bob", "Carol"]);
  assert.equal(loopSteps[3].action.done, true);
  assert.equal(loopSteps[3].action.total, 3);
});
