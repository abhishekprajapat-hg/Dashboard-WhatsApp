import test from "node:test";
import assert from "node:assert/strict";
import mongoose from "mongoose";
import { interpolateConfig, normalizeFlowGraph } from "../services/automationEngine.js";
import { executorFor } from "../services/automationExecutors.js";

test("normalizeFlowGraph: fully-wired flow traverses exactly as drawn", () => {
  const flow = {
    nodes: [
      { id: "trigger", type: "trigger" },
      { id: "a", type: "send_message" },
      { id: "b", type: "add_tag" },
    ],
    edges: [
      { id: "e1", source: "trigger", target: "a" },
      { id: "e2", source: "a", target: "b" },
    ],
  };

  const { outgoing, triggerNodeId } = normalizeFlowGraph(flow);
  assert.equal(triggerNodeId, "trigger");
  assert.equal(outgoing.get("trigger")[0].target, "a");
  assert.equal(outgoing.get("a")[0].target, "b");
  assert.equal(outgoing.has("b"), false);
});

test("normalizeFlowGraph: orphan nodes with no incoming edge get auto-healed onto the chain tail", () => {
  // Mirrors an old flow saved before edges were read at all: trigger -> a is wired, but b and c
  // are disconnected canvas nodes. Both must still run, deterministically, in nodes-array order.
  const flow = {
    nodes: [
      { id: "trigger", type: "trigger" },
      { id: "a", type: "send_message" },
      { id: "b", type: "add_tag" },
      { id: "c", type: "assign_user" },
    ],
    edges: [{ id: "e1", source: "trigger", target: "a" }],
  };

  const { outgoing } = normalizeFlowGraph(flow);
  assert.equal(outgoing.get("trigger")[0].target, "a");
  assert.equal(outgoing.get("a")[0].target, "b", "orphan b should be healed onto the chain tail (a)");
  assert.equal(outgoing.get("b")[0].target, "c", "orphan c should be healed after orphan b");
});

test("normalizeFlowGraph: a fully disconnected flow (no edges at all) still chains every node", () => {
  const flow = {
    nodes: [
      { id: "trigger", type: "trigger" },
      { id: "a", type: "send_message" },
      { id: "b", type: "add_tag" },
    ],
    edges: [],
  };

  const { outgoing, triggerNodeId } = normalizeFlowGraph(flow);
  assert.equal(outgoing.get(triggerNodeId)[0].target, "a");
  assert.equal(outgoing.get("a")[0].target, "b");
});

test("interpolateConfig: resolves trigger.* and steps.<nodeId>.* tokens", () => {
  const context = {
    trigger: { body: "please help urgent" },
    steps: { cond1: { result: true } },
  };

  const resolved = interpolateConfig(
    { message: "Body was: {{trigger.body}}", flag: "{{steps.cond1.result}}", untouched: 42 },
    context
  );

  assert.equal(resolved.message, "Body was: please help urgent");
  assert.equal(resolved.flag, "true");
  assert.equal(resolved.untouched, 42);
});

test("interpolateConfig: unresolvable paths interpolate to empty string, not a throw", () => {
  const resolved = interpolateConfig({ value: "{{steps.missing.field}}" }, { trigger: {}, steps: {} });
  assert.equal(resolved.value, "");
});

test("interpolateConfig: recurses through nested objects and arrays", () => {
  const resolved = interpolateConfig(
    { headers: { Authorization: "Bearer {{trigger.token}}" }, list: ["{{trigger.body}}", "static"] },
    { trigger: { token: "abc123", body: "hi" }, steps: {} }
  );
  assert.equal(resolved.headers.Authorization, "Bearer abc123");
  assert.deepEqual(resolved.list, ["hi", "static"]);
});

test("condition executor: contains operator picks the true branch on a match", async () => {
  const executor = executorFor("condition");
  const context = { trigger: { body: "This is urgent, please respond" }, steps: {} };
  const result = await executor({
    node: { id: "cond1", config: { field: "trigger.body", operator: "contains", value: "urgent" } },
    resolve: (path) => path.split(".").reduce((acc, part) => acc?.[part], context),
  });
  assert.equal(result.branch, "true");
});

test("condition executor: falls back to the false branch when the field doesn't match", async () => {
  const executor = executorFor("condition");
  const context = { trigger: { body: "just checking in" }, steps: {} };
  const result = await executor({
    node: { id: "cond1", config: { field: "trigger.body", operator: "contains", value: "urgent" } },
    resolve: (path) => path.split(".").reduce((acc, part) => acc?.[part], context),
  });
  assert.equal(result.branch, "false");
});

test("condition executor: is_empty / is_not_empty / greater_than operators", async () => {
  const executor = executorFor("condition");
  const context = { trigger: { count: 5, name: "" }, steps: {} };
  const resolve = (path) => path.split(".").reduce((acc, part) => acc?.[part], context);

  const empty = await executor({ node: { config: { field: "trigger.name", operator: "is_empty" } }, resolve });
  assert.equal(empty.branch, "true");

  const notEmpty = await executor({ node: { config: { field: "trigger.name", operator: "is_not_empty" } }, resolve });
  assert.equal(notEmpty.branch, "false");

  const greater = await executor({ node: { config: { field: "trigger.count", operator: "greater_than", value: 3 } }, resolve });
  assert.equal(greater.branch, "true");
});

test("if_else executor mirrors condition's branch semantics", async () => {
  const executor = executorFor("if_else");
  const context = { trigger: { status: "vip" }, steps: {} };
  const result = await executor({
    node: { config: { field: "trigger.status", operator: "equals", value: "vip" } },
    resolve: (path) => path.split(".").reduce((acc, part) => acc?.[part], context),
  });
  assert.equal(result.branch, "true");
});

test("unsupported node kinds no-op and continue, they don't error the flow", async () => {
  // task/calendar remain genuinely unsupported (no backend model exists yet, per HANDOFF.md) -
  // code_block used to be the example here too, until it got a real executor below.
  const executor = executorFor("task");
  const result = await executor({ node: { type: "task", config: {} } });
  assert.equal(result.status, "skipped");
  assert.equal(result.action, undefined);
});

test("code_block executor skips (not fails) on empty code", async () => {
  const executor = executorFor("code_block");
  const result = await executor({ node: { type: "code_block", config: {} }, run: { context: {} } });
  assert.equal(result.status, "skipped");
  assert.equal(result.action, undefined);
});

test("code_block executor runs sandboxed JS and exposes run context as data, not string tokens", async () => {
  const executor = executorFor("code_block");
  const run = { context: { trigger: { name: "Somil" }, steps: {}, variables: { greeting: "Hi" } } };
  const result = await executor({
    node: { type: "code_block", config: { code: "return context.variables.greeting + ', ' + context.trigger.name + '!';" } },
    run,
  });
  assert.equal(result.status, "ok");
  assert.equal(result.action.result, "Hi, Somil!");
});

test("code_block executor reports a failed step (not a thrown exception) on a runtime error", async () => {
  const executor = executorFor("code_block");
  const result = await executor({
    node: { type: "code_block", config: { code: "throw new Error('boom');" } },
    run: { context: {} },
  });
  assert.equal(result.status, "failed");
  assert.match(result.error, /boom/);
});

test("code_block executor has no access to require/process/fs - sandbox actually isolates", async () => {
  const executor = executorFor("code_block");
  const result = await executor({
    node: { type: "code_block", config: { code: "return typeof require + ',' + typeof process + ',' + typeof fetch;" } },
    run: { context: {} },
  });
  assert.equal(result.status, "ok");
  assert.equal(result.action.result, "undefined,undefined,undefined");
});

test("code_block executor enforces a CPU-time limit on runaway code", async () => {
  const executor = executorFor("code_block");
  const result = await executor({
    node: { type: "code_block", config: { code: "while (true) {}" } },
    run: { context: {} },
  });
  assert.equal(result.status, "failed");
  assert.match(result.error, /timed out/i);
});

test("delay executor skips synchronously in test mode instead of returning waitMs", async () => {
  const executor = executorFor("delay");
  const result = await executor({ node: { config: { duration: 5, unit: "seconds" } }, testMode: true });
  assert.equal(result.waitMs, undefined);
  assert.equal(result.action.skipped, true);
});

test("delay executor returns waitMs outside test mode when queue processing is unavailable it fails clearly", async () => {
  const executor = executorFor("delay");
  const result = await executor({ node: { config: { duration: 2, unit: "seconds" } }, testMode: false });
  // This process's config.featureFlags.queueProcessing/redisUrl reflect whatever env the test
  // runner started with - assert the two valid outcomes rather than assuming Redis availability.
  if (result.status === "failed") {
    assert.equal(result.error, "delay_requires_queue_processing");
  } else {
    assert.equal(result.waitMs, 2000);
  }
});

test("json_parser executor parses config.body into action.parsed", async () => {
  const executor = executorFor("json_parser");
  const result = await executor({ config: { body: '{"orderId": 42, "items": ["a", "b"]}' } });
  assert.equal(result.status, "ok");
  assert.deepEqual(result.action.parsed, { orderId: 42, items: ["a", "b"] });
});

test("json_parser executor fails clearly on invalid JSON, doesn't throw", async () => {
  const executor = executorFor("json_parser");
  const result = await executor({ config: { body: "{not valid json" } });
  assert.equal(result.status, "failed");
  assert.ok(result.error);
  assert.equal(result.action.status, "failed");
});

test("json_parser executor skips on empty input", async () => {
  const executor = executorFor("json_parser");
  const result = await executor({ config: { body: "" } });
  assert.equal(result.status, "skipped");
});

test("variables executor sets run.context.variables[name], readable via {{variables.x}} downstream", async () => {
  const executor = executorFor("variables");
  const run = { context: { trigger: {}, steps: {}, variables: {} } };
  const result = await executor({ config: { variable: "customerName", body: "Priya" }, run });

  assert.equal(result.status, "ok");
  assert.equal(run.context.variables.customerName, "Priya");

  // Proves the actual integration: a later node's config referencing {{variables.customerName}}
  // resolves against the same context object the variables node just mutated.
  const resolved = interpolateConfig({ body: "Hi {{variables.customerName}}, thanks!" }, run.context);
  assert.equal(resolved.body, "Hi Priya, thanks!");
});

test("variables executor skips when no variable name is configured", async () => {
  const executor = executorFor("variables");
  const run = { context: { trigger: {}, steps: {}, variables: {} } };
  const result = await executor({ config: { body: "orphan value" }, run });
  assert.equal(result.status, "skipped");
  assert.deepEqual(run.context.variables, {});
});

for (const provider of ["openai", "claude", "gemini"]) {
  test(`${provider} executor fails clearly when the workspace hasn't configured it`, async () => {
    const executor = executorFor(provider);
    const result = await executor({ config: { body: "Summarize this conversation" }, env: { integrations: {} }, testMode: false });
    assert.equal(result.status, "failed");
    assert.equal(result.error, "ai_provider_not_configured");
  });

  test(`${provider} executor skips the real API call in test mode`, async () => {
    const executor = executorFor(provider);
    const env = { integrations: { aiProviders: { [provider]: { enabled: true, apiKey: "sk-configured" } } } };
    const result = await executor({ config: { body: "Summarize this conversation" }, env, testMode: true });
    assert.equal(result.status, "ok");
    assert.equal(result.action.skipped, true);
  });

  test(`${provider} executor skips on an empty prompt without checking configuration`, async () => {
    const executor = executorFor(provider);
    const result = await executor({ config: { body: "" }, env: { integrations: {} }, testMode: false });
    assert.equal(result.status, "skipped");
  });
}

test("email executor skips when the contact has no email address, before checking configuration", async () => {
  const executor = executorFor("email");
  const result = await executor({ config: { subject: "Hi", body: "Hello" }, env: { contact: {}, integrations: {} }, testMode: false });
  assert.equal(result.status, "skipped");
});

test("email executor fails clearly when the workspace hasn't configured it", async () => {
  const executor = executorFor("email");
  const env = { contact: { email: "lead@example.com" }, integrations: {} };
  const result = await executor({ config: { subject: "Hi", body: "Hello" }, env, testMode: false });
  assert.equal(result.status, "failed");
  assert.equal(result.error, "email_not_configured");
});

test("email executor skips the real send in test mode", async () => {
  const executor = executorFor("email");
  const env = { contact: { email: "lead@example.com" }, integrations: { email: { enabled: true, apiKey: "SG.x", fromAddress: "hi@example.com" } } };
  const result = await executor({ config: { subject: "Hi", body: "Hello" }, env, testMode: true });
  assert.equal(result.status, "ok");
  assert.equal(result.action.skipped, true);
  assert.equal(result.action.to, "lead@example.com");
});

test("sms executor skips when the contact has no phone number, before checking configuration", async () => {
  const executor = executorFor("sms");
  const result = await executor({ config: { body: "Hello" }, env: { contact: {}, integrations: {} }, testMode: false });
  assert.equal(result.status, "skipped");
});

test("sms executor fails clearly when the workspace hasn't configured it", async () => {
  const executor = executorFor("sms");
  const env = { contact: { phone: "+15550002222" }, integrations: {} };
  const result = await executor({ config: { body: "Hello" }, env, testMode: false });
  assert.equal(result.status, "failed");
  assert.equal(result.error, "sms_not_configured");
});

test("sms executor skips the real send in test mode", async () => {
  const executor = executorFor("sms");
  const env = { contact: { phone: "+15550002222" }, integrations: { sms: { enabled: true, accountSid: "AC", authToken: "tok", fromNumber: "+15550001111" } } };
  const result = await executor({ config: { body: "Hello" }, env, testMode: true });
  assert.equal(result.status, "ok");
  assert.equal(result.action.skipped, true);
  assert.equal(result.action.to, "+15550002222");
});

function makeResolve(context) {
  return (path) => path.split(".").reduce((acc, part) => acc?.[part], context);
}

test("loop executor: first visit resolves the field and returns the first item on the 'loop' branch", async () => {
  const executor = executorFor("loop");
  const nodeId = "loop_1";
  const context = { trigger: {}, steps: {}, variables: { items: ["a", "b", "c"] } };
  const run = { context };

  const result = await executor({ node: { id: nodeId, config: { field: "variables.items" } }, run, resolve: makeResolve(context) });
  assert.equal(result.branch, "loop");
  assert.equal(result.action.done, false);
  assert.equal(result.action.index, 0);
  assert.equal(result.action.total, 3);
  assert.equal(result.action.item, "a");
});

test("loop executor: subsequent visits advance the index using the node's own prior step state", async () => {
  const executor = executorFor("loop");
  const nodeId = "loop_1";
  const context = { trigger: {}, steps: {}, variables: { items: ["a", "b", "c"] } };
  const run = { context };
  const node = { id: nodeId, config: { field: "variables.items" } };
  const resolve = makeResolve(context);

  const first = await executor({ node, run, resolve });
  context.steps[nodeId] = first.action;

  const second = await executor({ node, run, resolve });
  assert.equal(second.branch, "loop");
  assert.equal(second.action.index, 1);
  assert.equal(second.action.item, "b");
  context.steps[nodeId] = second.action;

  const third = await executor({ node, run, resolve });
  assert.equal(third.branch, "loop");
  assert.equal(third.action.index, 2);
  assert.equal(third.action.item, "c");
  context.steps[nodeId] = third.action;

  const fourth = await executor({ node, run, resolve });
  assert.equal(fourth.branch, "done");
  assert.equal(fourth.action.done, true);
  assert.equal(fourth.action.index, 3);
  assert.equal(fourth.action.total, 3);
});

test("loop executor: an unresolvable or non-array field is treated as zero items and finishes immediately", async () => {
  const executor = executorFor("loop");
  const context = { trigger: {}, steps: {}, variables: {} };
  const result = await executor({ node: { id: "loop_1", config: { field: "variables.missing" } }, run: { context }, resolve: makeResolve(context) });
  assert.equal(result.branch, "done");
  assert.equal(result.action.total, 0);
});

test("loop executor: a nested inner loop starts fresh on a new outer iteration instead of resuming its finished state", async () => {
  // Simulates: outer loop's body contains an inner loop that runs to completion once, then the
  // outer loop advances to its next iteration and re-enters the inner loop node. Without the
  // !priorState.done check, the inner loop would see its old finished state (items + a stale
  // index already >= total) and incorrectly return "done" again without ever restarting.
  const executor = executorFor("loop");
  const nodeId = "inner_loop";
  const context = { trigger: {}, steps: {}, variables: { items: ["x", "y"] } };
  const run = { context };
  const node = { id: nodeId, config: { field: "variables.items" } };
  const resolve = makeResolve(context);

  const first = await executor({ node, run, resolve });
  context.steps[nodeId] = first.action;
  const second = await executor({ node, run, resolve });
  context.steps[nodeId] = second.action;
  const finished = await executor({ node, run, resolve });
  assert.equal(finished.branch, "done");
  context.steps[nodeId] = finished.action;

  // New outer iteration re-enters the same inner loop node - must restart, not stay "done".
  const restarted = await executor({ node, run, resolve });
  assert.equal(restarted.branch, "loop");
  assert.equal(restarted.action.index, 0);
  assert.equal(restarted.action.item, "x");
});

// sub_workflow's real DB-touching paths (target not found, successful nested call, input
// passthrough, parentRunId linkage) are covered by automationEngine.e2e.test.js instead - only
// the branches that return before touching the database belong here.

test("sub_workflow executor skips when no target flow is selected, without checking depth", async () => {
  const executor = executorFor("sub_workflow");
  const result = await executor({ node: { config: {} }, run: { chain: [] } });
  assert.equal(result.status, "skipped");
});

test("sub_workflow executor fails clearly when the call chain is already at max depth", async () => {
  const executor = executorFor("sub_workflow");
  const deepChain = Array.from({ length: 5 }, (_, index) => new mongoose.Types.ObjectId());
  const result = await executor({
    node: { config: { flowId: new mongoose.Types.ObjectId().toString() } },
    run: { chain: deepChain },
  });
  assert.equal(result.status, "failed");
  assert.equal(result.error, "sub_workflow_depth_exceeded");
});
