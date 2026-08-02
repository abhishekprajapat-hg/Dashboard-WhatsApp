import test from "node:test";
import assert from "node:assert/strict";
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
  const executor = executorFor("code_block");
  const result = await executor({ node: { type: "code_block", config: {} } });
  assert.equal(result.status, "skipped");
  assert.equal(result.action, undefined);
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
