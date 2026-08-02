# Automation: real node-based workflow engine (Phase 1)

_This is the plan approved via Claude Code's plan mode on 2026-08-02, copied into the repo so it
survives independent of the machine/session that generated it. See `HANDOFF.md`'s "IN PROGRESS
right now" section for exact resume-here instructions and task order._

## Context

The Automation page's visual canvas (`AutomationView.tsx`) offers 25 draggable node kinds — trigger, delay, condition, if_else, api, call_webhook, add_to_crm, google_sheets, openai, claude, gemini, email, sms, send_message, assign_user, add_tag, lead_stage, task, calendar, http_request, loop, variables, json_parser, code_block, sub_workflow — but the backend (`automationRunner.js`) only actually executes 7 of them, and even those aren't executed in the order/branches the user draws: it scans the flow's `nodes` array for known action types and runs every match, in a fixed hardcoded order, completely ignoring `edges`. Dragging a Delay, Condition, If Else, or API node onto the canvas, wiring it up, and saving works fine visually — it just silently does nothing when the flow runs. There's no branching, no wait/delay capability, and no way for one node's output to feed another.

The user wants this to become a real, "state of the art" workflow engine comparable to n8n/Make.com. That full scope is too large for one pass — it spans a genuine execution-engine rewrite plus ~18 additional integration types (AI providers, email/SMS, code execution, sub-workflows, etc.), each with its own real design questions (sandboxing for code execution, API-key storage for AI providers, and so on). This plan covers **Phase 1**: a production-quality core engine that makes graph traversal, branching, delay/wait, a generic HTTP/API node, and basic variable passing between nodes genuinely work — built on top of, not replacing, the 7 already-working action types and the existing BullMQ queue infrastructure. Phase 2+ (AI nodes, email/SMS, loop, code_block, sub_workflow, execution-history UI) is sketched at the end as a roadmap, not designed in detail here.

Both of this plan's load-bearing technical claims were verified directly against the code before writing this: `AutomationFlow`'s schema (`server/models/AutomationFlow.js`) has `nodes`/`edges` as fully schemaless `[Mixed]` arrays with no sub-schema, and `enqueueJob(name, jobName, data, options)` in `server/services/jobs.js` passes `options` straight through to BullMQ's `queue.add()` untouched — so native `delay`/`jobId` options work today, just unused by any current caller.

## Approach

### 1. Schema changes

**`AutomationFlow`** (`server/models/AutomationFlow.js`): give `nodes`/`edges` real subdocument schemas instead of `Mixed`. No migration needed — every node ever written by any existing creation path (canvas save, simple-builder synthesis) already matches `{id, type, position?, config?}`, and edges already match `{id, source, target}`. Add two new optional edge fields, `sourceHandle`/`targetHandle` (default `null`), which is how a condition/if-else node's "true"/"false" branch gets recorded — old edges just get `null`, which the engine treats as "the single default edge" (today's only kind). `config` stays `Mixed` per node — 25+ kinds makes a fully-typed discriminated union not worth it in Phase 1; each node kind validates its own config at execution time instead. `trigger`/`conditions`/`actions`/`runLogs` are untouched.

**New model `AutomationRun`** (`server/models/AutomationRun.js`): persists in-progress execution state so a flow can pause at a delay node and resume later from a queued job, instead of needing to complete synchronously within one request. Fields: `flowId`, `status` (`running|waiting|completed|failed|cancelled`), `testMode`, `trigger` (seed context: inbound message/contact/conversation ids and flags), `context` (`{trigger, steps: {[nodeId]: output}}` — this is what powers variable interpolation between nodes), `cursor.nodeId` (where to resume), `visitCounts` (cycle guard), `stepCount`, `resumeAt`/`resumeJobId`, `history` (per-step log), `error`. Indexes on `{workspaceId,status}` and `{status,resumeAt}` (the latter is a backstop for a future sweep of any resume job lost to a Redis restart — BullMQ delayed jobs are Redis-persisted by default, so this is defensive, not required for correctness).

**Zod** (`server/routes/automation.js`): tighten `createFlowSchema`/`updateFlowSchema`'s `nodes: z.array(z.unknown())` to a real structural schema (`id`, `type`, `position?`, `config` defaulting to `{}`) and same for edges with the new `sourceHandle`/`targetHandle`. Purely additive — every payload the client already sends already matches.

### 2. Execution engine

New file `server/services/automationEngine.js` is the new core. `server/services/automationRunner.js` stays as the **stable public entry point** — `runInboundAutomations`'s signature and return shape don't change, so its two callers (`server/routes/whatsapp.js:681`, `server/routes/automation.js:480`) need zero changes. Internally it delegates to the engine.

- **`normalizeFlowGraph(flow)`**: builds a node map + outgoing-edges-by-source index. Backward-compat is the important part here — today's flat scan runs every node in `flow.nodes` regardless of wiring (edges are never read), so a pure "only traverse what's connected to the trigger" engine would be a real regression for old flows with disconnected/orphaned nodes. Fix: any node with no incoming edge (other than the trigger) gets auto-appended to the end of the main chain at normalization time. Net effect — fully-wired new flows traverse exactly as drawn; old/loosely-wired flows keep running everything, same as today, just in deterministic wired order instead of the old hardcoded type-priority order (worth a one-line changelog note, not a behavior break).
- **`advanceRun(run, flow, {testMode})`**: the traversal loop. Walks from `run.cursor` (or the trigger's first successor on a fresh run), dispatches each node to its executor, records output into `run.context.steps[nodeId]`, and picks the next node — either the single default edge, or (for condition/if-else) whichever edge's `sourceHandle` matches the executor's returned `branch`. Capped at a step limit and a per-node revisit limit as cycle guards. **Delay/pause**: if a non-test-mode delay executor returns `waitMs`, the run is persisted with `status: "waiting"` and a resume job is enqueued with that delay; the function returns immediately rather than blocking. **Test mode**: the delay executor itself checks `testMode` and returns `{skipped: true}` instead of a `waitMs` — so in test mode the whole graph (including delay nodes) still runs synchronously in one pass, matching how `/api/automation/:id/test` behaves today for the other 7 action types.
- `runInboundAutomations` maps the run's `history` into the exact same `{flowId, actions, logs}` shape it returns today, and performs the same `AutomationFlow.updateOne` (`$inc trigger.runs/failures`, `$push trigger.executionLogs`) that `serializeFlow` already reads — **the HTTP response shape from every existing automation endpoint is unchanged.**

New file `server/services/automationExecutors.js` — the per-node-kind dispatch table:
- The 7 existing types (`send_message`, `assign_user`, `set_status`, `add_tag`, `add_to_crm`/`lead_stage`, `google_sheets`, `call_webhook`) become thin adapters that build the same payload `automationRunner.js` builds today and call the **unchanged** `automationSender.js` functions — no changes to that file or to `jobs.js`'s 3 existing job names.
- **`execCondition`/`execIfElse`** (shared logic): config `{field, operator, value}`; `field` resolves against `run.context` (`trigger.*` or `steps.<nodeId>.*`); operators: equals/not_equals/contains/not_contains/greater_than/less_than/is_empty/is_not_empty. Returns which branch (`"true"`/`"false"`) to follow.
- **`execApi`** (also handles the `http_request` catalog kind as an alias — Phase 1 treats them as one node): config `{method, url, headers, body}`, interpolated, validated with the existing `httpUrlString` zodHelper. Calls a **new** `callGenericApi()` export added to `server/services/integrations.js` — the existing `callOutboundWebhook` there is hardcoded to POST with a fixed envelope and isn't reusable as a generic primitive, so this is new, separate code, not a rewrite of that function. Captures a bounded, JSON-parsed-if-possible response into the run context for downstream nodes.
- **`execUnsupported`**: fallback for the 18 not-yet-built kinds — logs "not yet supported" and continues along the default edge, rather than dead-ending a flow that happens to contain a Phase-2 node type.
- **`interpolateConfig`**: resolves `{{trigger.body}}` / `{{steps.nodeId.field}}` tokens in a node's config strings against `run.context` before the executor runs. Unresolvable paths interpolate to `""` with a warning logged, not a thrown error — consistent with this codebase's existing defensive style around malformed config.

### 3. New BullMQ job

`server/services/jobs.js`: add one entry to the existing `automations` worker's dispatch-by-name map — `"automation.resume-run": resumeAutomationRun` (exported from `automationEngine.js`). This is additive; the queue, worker, and 3 existing job names are untouched. `resumeAutomationRun({runId})` re-fetches the run and flow fresh from Mongo (same "never trust in-memory state across a delay" discipline `automationSender.js`'s processors already follow), no-ops idempotently if the run isn't still `"waiting"`, and calls `advanceRun` to continue from `run.cursor`.

**Redis requirement**: a real (non-test) delay longer than trivial genuinely needs the queue — there's no sane synchronous fallback for "wait 3 hours" inline. If `FEATURE_QUEUE_PROCESSING`/Redis isn't configured, a non-test delay node fails that step with a clear `delay_requires_queue_processing` error rather than corrupting delay semantics with something like a bare `setTimeout`. Production already has a live Redis instance configured (per `HANDOFF.md`), so this only affects local dev without Redis running — delay nodes there work in test mode only, same constraint campaigns/automations already have for real async behavior.

### 4. Client changes (`AutomationView.tsx`)

Scoped, not a rewrite of the 1207-line file:
1. Add real `<Handle>` elements (`@xyflow/react`) to the `AutomationNode` component — every node gets one target handle on the left; `condition`/`if_else` nodes get **two** labeled source handles on the right (`id="true"`/`id="false"`); every other kind keeps its current single unlabeled source handle. This is what makes `sourceHandle` populate correctly on `onConnect` with no other wiring changes — the existing `canvasNodeToServer`/`normalizeCanvasEdges` save path already round-trips whatever React Flow gives it.
2. Replace the current one-size-fits-all 7-field generic inspector with per-kind forms for just the four new/changed kinds — delay (duration + unit), condition/if-else (field/operator/value), api/http_request (method/url/headers/body) — falling back to the existing generic form for the other 21 kinds, so nothing else regresses.
3. Test-result rendering needs no structural change — the existing flat `actions` list already renders `type`/`status`/`error` generically; delay/condition outputs slot into that same shape.

### 5. Backward compatibility

Verified explicitly, not assumed: `runInboundAutomations`'s signature/return shape, all `/api/automation*` request/response shapes, simple-builder-created flows, `automationSender.js`, and `jobs.js`'s existing 3 job names are all unchanged. Old canvas-saved flows with disconnected nodes keep running every action (auto-healed at normalization time), just in a slightly different — but still complete — order than before.

## Critical files

- `server/models/AutomationFlow.js` — `nodes`/`edges` subdocument schemas (additive)
- `server/models/AutomationRun.js` — **new**, persisted execution state
- `server/services/automationEngine.js` — **new**, graph normalization + `advanceRun` traversal + interpolation + resume handling
- `server/services/automationExecutors.js` — **new**, per-node-kind dispatch (7 existing adapters + condition/if_else/api + unsupported fallback)
- `server/services/automationRunner.js` — becomes a thin, signature-unchanged entry point delegating to the engine
- `server/services/integrations.js` — add `callGenericApi()` (new export, `callOutboundWebhook` untouched)
- `server/services/jobs.js` — one new job name in the existing `automations` worker map
- `server/routes/automation.js` — tightened node/edge Zod schemas
- `client/src/app/components/AutomationView.tsx` — `<Handle>` ports, per-kind inspector forms for delay/condition/if_else/api

## Verification

Follows this codebase's existing split between fast unit tests and real spawned-server integration tests (`server/tests/validation.test.js` vs. `server/tests/criticalPath.e2e.test.js`) rather than inventing a new pattern.

1. **`server/tests/automationEngine.e2e.test.js`** (new, own port/DB): connect a WhatsApp account, build a flow via the real API with `trigger → condition(body contains "urgent") → [true: send "Escalating now", false: delay 5s → send "Thanks, we'll get back to you"]`. Send an inbound message containing "urgent" and confirm only the true-branch reply appears. Send a second, non-matching message and confirm the reply does **not** appear immediately but **does** appear after the delay elapses (real short delay, not a mocked clock) — this is the concrete proof that pause/persist/resume actually works, not just synchronous execution. Also assert directly against the `AutomationRun` document that it transitioned `running → waiting → completed` with the right step history. Separately, call the flow's test endpoint and confirm the delay is skipped and the response returns synchronously.
2. **`server/tests/automationEngine.unit.test.js`** (new, no server/DB): fast tests for `normalizeFlowGraph` (orphan-node healing), `interpolateConfig`/context resolution, and condition operator evaluation.
3. Run the full suite (`npm test`, already configured `--test-concurrency=1`) to confirm zero regressions in the existing 31 tests, and manually re-verify one existing simple-builder-created automation still fires correctly end to end via the actual dashboard UI (matching the manual-verification standard used throughout this project's session history).

## Phase 2+ (sketch only, not designed here)

AI provider nodes (OpenAI/Claude/Gemini — needs API-key storage + prompt templating), email/SMS channels (needs new outbound integrations), `loop` (needs the single-cursor `AutomationRun` model extended to a stack of iteration frames), `code_block` (needs a real sandboxing decision before it's safe to ship — deliberately not rushed), `json_parser`/`variables` (low-risk once Phase 1's interpolation model is proven), `sub_workflow` (natural extension via a `parentRunId` on `AutomationRun`), `task`/`calendar` (no existing backend model for either yet), true parallel fan-out/merge, an execution-history/run-timeline UI (data model is already there from Phase 1, only the UI is deferred), and SSRF/outbound-request hardening for the new `api` node (flagged now since it's the first fully user-controlled outbound URL in the system, but no SSRF protection exists anywhere in this codebase today — including the existing webhook feature — so this isn't a new gap, just one worth prioritizing early in Phase 2).
