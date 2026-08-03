# Handoff — WhatsApp CRM engine work

**Repo:** `D:\Whatsapp Dashboard\Dashboard-WhatsApp` (note: the *parent* folder `D:\Whatsapp Dashboard\` also contains an unrelated `New folder` with other client docs — the actual project is one level down).
**Remote:** https://github.com/abhishekprajapat-hg/Dashboard-WhatsApp.git
**Branch:** `main` — all work pushed directly to `main` (no PR workflow in use).
**HEAD as of this handoff:** `d964e08` (full SHA: check `git log -1`) — the `code_block` work below is
committed locally on top of this but not yet pushed; confirm with the user before pushing.

## `code_block` node — implemented 2026-08-03, sandboxing via isolated-vm

Picked up the one deliberately-deferred Phase 2 item flagged in the "Not done, by design" section
below. Sandboxing approach was discussed with the user first (per that section's explicit
instruction) before writing any code: **isolated-vm** was chosen over a child-process-per-execution
model and a hosted sandbox service — it's a real V8 isolate (separate heap/global from the host,
not `node:vm`'s shared-realm non-boundary and not deprecated/vulnerable `vm2`), runs in-process so
it fits the existing synchronous-per-node execution model every other Phase 2 node uses, and needs
no container/orchestration infra on the single Hostinger VPS this app deploys to.

- **`server/services/codeSandbox.js`** — `runSandboxedCode({ code, context, timeoutMs,
  memoryLimitMb })`. Creates a fresh `ivm.Isolate` per call (disposed in `finally`), injects
  `context` as plain copied data via `ExternalCopy` (never live objects/functions — the sandboxed
  code has no reference back into the host process), compiles the source wrapped in an IIFE, and
  runs it with a real V8-level timeout + memory cap. No `require`/`process`/`fs`, and no `fetch` is
  exposed — code_block is compute-only; use the `api` node for outbound HTTP.
- **`execCodeBlock` in `automationExecutors.js`** — reads `node.config.code` **raw** (the
  un-interpolated config), not the `config` param `interpolateConfig` already produced. This is
  deliberate: `{{trigger.x}}`-style textual substitution into a source string is the wrong model
  for actual code (quoting/escaping hazards, breaks any code that legitimately contains `{{`).
  Instead the whole run context is exposed as a real `context` object inside the sandbox —
  `context.trigger`/`context.steps`/`context.variables`, live data instead of string tokens. Output
  goes to `action.result`, readable downstream via `{{steps.<nodeId>.result}}`, same convention as
  `json_parser`'s `.parsed`. No `testMode` short-circuit (unlike AI providers/email/SMS) — it
  doesn't call a paid external API, so there's no cost/non-determinism reason to skip it in tests.
- **Config**: `config.codeBlock.timeoutMs` (`CODE_BLOCK_TIMEOUT_MS`, default 5000) and
  `.memoryLimitMb` (`CODE_BLOCK_MEMORY_LIMIT_MB`, default 32), env-overridable like the AI provider
  models.
- **Client**: dedicated inspector form in `AutomationView.tsx` (monospace textarea + a note on
  sandbox limits) — the generic 7-field form's single-line `code` input doesn't fit multi-line
  source, same reasoning as email's dedicated form.
- **Tests**: `automationEngine.unit.test.js` gained real coverage — success with a returned value,
  a thrown error surfaced as a failed step (not an uncaught exception), no access to
  `require`/`process`/`fetch` (isolation actually holds), and a CPU-time timeout on `while(true){}`.
  The old "unsupported node kinds no-op" test used `code_block` as its example; switched to `task`
  (still genuinely unsupported — no backend model exists).
- **Verified end-to-end**, not just unit tests: created a real flow via `POST /api/automation` with
  a `trigger -> code_block` graph, ran it via `POST /api/automation/:id/test`, confirmed via
  `GET /api/automation/:id/runs` that `context.trigger.body` arrived as live data (not a string
  token) and that `typeof fetch`/`typeof process` were both `"undefined"` inside the sandbox. Also
  confirmed in the actual dashboard UI (logged in as the seeded `admin@test.com` user) that the Run
  History and Execution Logs panels — unmodified Phase 2 components — render the new node kind
  correctly with no special-casing needed, and that the new dedicated inspector textarea shows the
  right node's code.
- **Known limitation, same shape as other Phase 2 nodes**: runs synchronously inline in
  `advanceRun`'s traversal loop, so a slow/runaway script blocks the whole run until the timeout
  fires (not queued) — matches every other Phase 2 node kind's design.
- **Native dependency risk worth flagging for the next session**: `isolated-vm` is a native addon
  (compiles via node-gyp). Verified it installs and runs cleanly on this dev machine (Windows,
  Node 24) with a prebuilt/compiled binary via plain `npm install`. **Not yet verified on the
  production VPS** (Hostinger KVM1, git-clone + PM2 deploy, no Docker) — the deploy cron's
  `npm install` step needs build tooling (python3, a C++ toolchain) available on that box, or the
  next deploy will fail at `npm install` for this package specifically. Check `deploy-cron.log`
  after the first deploy that includes this change.

## Automation Phase 2 — DONE, deployed (2026-08-02, same day as Phase 1)

Seven features shipped in sequence, each its own commit, each following the same discipline: real
tests (unit + where DB/queue behavior matters, e2e), manual verification via the actual dashboard
UI, then commit+push only after the user explicitly said so. In commit order:

1. **`d70d7e7` SSRF hardening.** Neither `callOutboundWebhook` nor the new `callGenericApi` (api
   node) had any protection against reaching internal services. Added `assertPublicUrl`/`safeFetch`
   in `server/services/integrations.js` using Node's built-in `net.BlockList` (no new dependency) —
   blocks private/loopback/link-local/reserved ranges including the `169.254.169.254` cloud
   metadata address, re-validates on every redirect hop (fetch's automatic redirects would
   otherwise bypass the check entirely). **Known accepted gap, documented in code:** doesn't pin
   the TCP connection to the validated IP, so a DNS answer that changes between check and connect
   (active rebinding, needs attacker control of DNS + a timing race) isn't blocked — judged not
   worth a custom HTTP dispatcher for that threat model.
2. **`08f478f` Execution-history / run-timeline UI.** New `GET /api/automation/:id/runs`
   (workspace-scoped, latest 50, full step history per run) + a "Run History" panel in
   `AutomationView.tsx`'s inspector sidebar — collapsed list of runs that expand into the
   step-by-step timeline. Purely additive on top of Phase 1's `AutomationRun` model.
3. **`ff9cdd7` `json_parser` + `variables` nodes.** `execJsonParser` parses the generic form's
   `body` field as JSON into `action.parsed`. `execVariables` sets a **run-wide**
   `context.variables[name]` bag (not nested under the setting node's own step) so any later node
   can read `{{variables.name}}` — this is the mechanism `sub_workflow`'s input-passing and
   `loop`'s item-source later reused. Both reuse the existing generic 7-field inspector form, no
   client changes needed.
4. **`17eff16` AI provider nodes (OpenAI/Claude/Gemini).** Design mirrors the *existing*
   `outboundWebhook`/`googleSheets` integration pattern exactly (per explicit user steer to match
   the codebase's theme, not invent a new one): `Workspace.settings.integrations.aiProviders.
   {openai,claude,gemini}` (`{enabled, apiKey}`), same Zod schema shape, same Settings UI card
   pattern. New `server/services/aiProviders.js` — request-building/response-parsing factored into
   pure functions per provider (unit-testable without live API keys), `callAiProvider()` does the
   actual fetch with a 30s timeout. Executors (`makeAiExecutor` factory) reuse the generic form's
   `body` field as the prompt, fail clearly when not configured, **skip the real call in test mode**
   (matches `delay`'s test-mode pattern — avoids real API costs/non-determinism when testing a
   flow). Model names are env-overridable (`AI_OPENAI_MODEL` etc. in `config.js`), not hardcoded —
   provider model IDs get deprecated on their own schedule.
5. **`3190505` Email/SMS channel nodes.** SMS uses **Twilio** (same Account SID + Auth Token
   credentials `whatsappProvider.js` already uses for the Twilio WhatsApp channel, just the plain
   `Messages.json` send without the `whatsapp:` prefix). Email uses **SendGrid** (confirmed with
   user; Bearer-auth REST API, same shape as the OpenAI integration). New
   `server/services/notificationChannels.js` (`sendEmail`/`sendSms`, same pure-builder-functions
   pattern as `aiProviders.js`). `execEmail` needed a genuinely new client inspector form (Subject +
   Body — nothing in the generic 7 fields fits "subject"); `execSms` reuses the generic form's
   `body` field. **Real bug found and fixed here, not test-only:** `GET /settings` only backfilled
   the full default `integrations` shape when the *entire* stored object was missing, not when
   individual newer keys were absent from an *existing* workspace's document — any workspace that
   had already saved some integration (which this dev workspace had, from testing AI providers)
   crashed the Settings page on `integrationForm.email.enabled` reading `undefined`. Fixed with a
   proper per-field merge, `mergeIntegrations()` in `server/routes/settings.js` — this also
   retroactively protects the *next* integration type added the same way.
6. **`c97e3f1` `loop` node.** Simpler than `docs/AUTOMATION_ENGINE_PLAN.md`'s Phase 2 sketch
   anticipated — no "stack of iteration frames" needed on `AutomationRun`. The loop body is wired
   back to the loop node itself (a real cycle, drawn by the user), and each revisit reads its own
   prior step state (already preserved by the engine for every node — the same mechanism
   downstream interpolation relies on) to track `index`/`items` across re-entries. Branches
   `"loop"`/`"done"`, same `sourceHandle` mechanism condition/if_else already used. **Nested-loop
   correctness needed one careful fix:** continuation only counts if the prior state wasn't already
   `done` — otherwise an inner loop revisited by a new outer iteration wrongly thinks it's resuming
   its already-finished run instead of starting over. Raised `automationEngine.js`'s `STEP_LIMIT`
   (200→1000) and `VISIT_LIMIT` (5→300) so real loops don't hit the old cycle guard; `STEP_LIMIT`
   remains the actual backstop against a runaway/infinite loop. **Real engine bug found and fixed
   here:** `run.history` never actually persisted which branch an executor took — used transiently
   for `pickNext()` routing then discarded, papered over for condition/if_else via an ad-hoc
   `action.result` heuristic in the serializer. Fixed at the source (`advanceRun` now records
   `result.branch` directly onto the history entry), which also fixes the Run History UI panel for
   loop and any future branching node, not just this one. `AutomationView.tsx`'s hardcoded
   true/false handle rendering was generalized into a data-driven `branchHandlesByKind` lookup so
   loop's handles (and any future branching node) fit without more one-off code.
7. **`4be9fde` `sub_workflow` node.** Calls another published flow as a synchronous sub-routine —
   same pattern as every other Phase 2 node (parent waits, no queue). Node config `{flowId, body}`
   — `body` is interpolated and seeded into the child run's `context.variables.input`, reusing
   `variables`' bag mechanism rather than inventing new plumbing. `AutomationRun` gained
   `parentRunId` (links a sub-run back to its caller) and `chain` (the active call stack's
   flowIds, depth-capped at 5 — chosen over exact-cycle rejection so *bounded* self-recursion still
   works; only runaway depth is blocked, direct or mutual). **If the child hits its own delay node,
   the parent does NOT wait for it** — the child pauses independently via its normal BullMQ resume,
   and the parent sees `subRunStatus: "waiting"` and continues immediately. Propagating a pause up
   through nested runs would need a much bigger change; documented as a known limitation, not
   attempted. Needed importing `advanceRun` from `automationEngine.js` into
   `automationExecutors.js` — the *reverse* of the existing one-directional dependency, creating a
   circular import. Same accepted pattern already proven safe in this codebase (`jobs.js` ↔
   `automationEngine.js`); verified it still loads cleanly with both cycles present. **Testing found
   a real design gotcha, not a code bug:** a flow meant to be "callable only" needs a trigger that
   won't also match real inbound events on its own, or it fires twice — once via `sub_workflow`,
   once via its own normal trigger matching the same webhook. No engine fix needed/possible here;
   it's inherent to a flow being both independently-triggered and callable. Documented in the e2e
   test (gives the child a non-matching `keyword_match` trigger).

**Not done, by design — see plan's "Phase 2+" section for what's deferred and why:**
- ~~`code_block`~~ — done, see the section above this one.
- `task`/`calendar` — no backend model exists for either yet; would need new Mongoose models before
  any executor work makes sense.
- Execution-history UI doesn't yet show `parentRunId` nesting (sub_workflow's child runs are
  linked in the data but not visually nested in the panel) — quick follow-up if wanted.

## Automation Phase 1 — DONE, deployed (2026-08-02)

Turned the visual flow builder into a real node-based workflow engine: graph traversal,
condition/if-else branching, delay/wait nodes (pause+resume via BullMQ), a generic API/HTTP node,
and variable passing between nodes via `{{trigger.x}}`/`{{steps.x}}` interpolation. Full design is
in `docs/AUTOMATION_ENGINE_PLAN.md` — still accurate as the as-built architecture for Phase 1;
Phase 2 additions above are documented here, not in that file. Shipped as commit `90d22cf`.

**What's live (Phase 1):**
- `server/models/AutomationFlow.js` — `nodes`/`edges` are real subdocument schemas (was `Mixed`),
  edges have `sourceHandle`/`targetHandle`.
- `server/models/AutomationRun.js` — persisted execution state, exported from
  `server/models/index.js`. (Phase 2 added `parentRunId`/`chain` to this — see above.)
- `server/services/automationEngine.js` — `normalizeFlowGraph` (orphan-node auto-healing),
  `advanceRun` traversal loop, `interpolateConfig`, `resumeAutomationRun`.
- `server/services/automationExecutors.js` — dispatch table: the 7 pre-existing action types
  adapted to the engine, plus `execCondition`/`execIfElse`/`execApi`/`execDelay`, and
  `execUnsupported` as the fallback for not-yet-built catalog kinds (no-ops and continues, doesn't
  error/block). Phase 2 added `execJsonParser`/`execVariables`/`makeAiExecutor`/`execEmail`/
  `execSms`/`execLoop`/`execSubWorkflow` to this same file.
- `server/services/integrations.js` — `callGenericApi()` for the api/http_request node
  (`callOutboundWebhook` untouched by Phase 1; Phase 2 added SSRF guards to both).
- `server/services/automationRunner.js` — thin, signature-unchanged entry point delegating to the
  engine. `runInboundAutomations`'s callers (`server/routes/whatsapp.js:681`,
  `server/routes/automation.js:480`) needed zero edits.
- `server/services/jobs.js` — `"automation.resume-run"` in the existing `automations` worker's
  dispatch map.
- `server/routes/automation.js` — `createFlowSchema`/`updateFlowSchema`'s node/edge Zod validation
  tightened from `z.array(z.unknown())` to real structural schemas. Phase 2 added `GET /:id/runs`.
- `client/src/app/components/AutomationView.tsx` — real `<Handle>` ports on `AutomationNode`,
  per-kind inspector forms for delay/condition/if_else/api (Phase 2 added email/loop/sub_workflow
  forms; the remaining catalog kinds still use the generic 7-field form).

## Design notes worth knowing before touching this code again

- **Every Phase 2 node kind runs synchronously within `advanceRun`'s traversal loop, not queued** —
  api, AI providers, email, SMS, json_parser, variables, loop, sub_workflow all block the step
  until they resolve (bounded by their own timeouts where relevant). Only `delay` pauses the whole
  run via BullMQ. Only the original 3 legacy action types (`send_message`, `call_webhook`,
  `google_sheets`) go through `automationSender.js`'s separate enqueue-a-BullMQ-job wrappers,
  because their queuing predates the engine and was deliberately preserved unchanged. **If you add
  a new node kind, match the synchronous pattern** unless you have a specific reason to queue it —
  don't mix the two styles without a reason.
- **`testMode` skips the real external call for every "slow/costly" Phase 2 node** (AI providers,
  email, SMS) and returns a canned/skipped response — same reasoning as `delay`'s test-mode skip
  (avoid real costs/non-determinism when testing a flow via `/api/automation/:id/test`). If you add
  a new node kind that calls a paid/external API, give it the same `testMode` short-circuit.
- **Reuse the generic 7-field inspector form (`body`/`url`/`keyword`/`status`/`stage`/`variable`/
  `code`) before adding a new per-kind client form.** json_parser, variables, and sms all fit
  cleanly by reusing `body` (or `variable`+`body`). Only add a new form when there's a genuine
  field-shape mismatch (email needed Subject; api needed method/headers; loop needed a field path;
  sub_workflow needed a flow picker + input).
- **Two accepted circular imports exist and are both safe:** `jobs.js` ↔ `automationEngine.js`
  (jobs.js needs `resumeAutomationRun`, engine needs `enqueueJob`) and, since Phase 2's
  `sub_workflow`, `automationExecutors.js` ↔ `automationEngine.js` (executors needs `advanceRun`
  to run a child flow, engine needs `executorFor`). Safe because in both cases the imported
  function is only ever called from inside a function body, well after both modules finish
  loading — never at module-eval time. If you add a third node kind that needs something from
  `automationEngine.js`, this pattern is already proven; don't avoid it out of caution, just don't
  call the imported thing at the top level of either file.
- **`run.history` entries now persist the executor's real `branch`** (`advanceRun` records
  `result.branch` directly) — read `step.branch` directly if you're consuming run history; don't
  reinvent the old `action.result`-boolean heuristic still kept as a fallback in
  `routes/automation.js`'s serializer for pre-Phase-2 run documents.
- **A node meant to be "callable only" (a `sub_workflow` target) needs a trigger that won't also
  match real inbound events** — e.g. `keyword_match` with a keyword nobody will type, not
  `new_message` (which matches everything). This isn't an engine bug, just how trigger-matching and
  direct-invocation currently coexist; worth surfacing in the UI/product at some point (e.g. a
  "callable only, no auto-trigger" flow mode) but not built.
- **`testMode` on automation flows is deliberately synchronous**, bypassing the queue entirely, and
  forces local-placeholder WhatsApp credentials inside the job processor itself — because the job
  re-fetches the account fresh by ID and has no visibility into "this is a test." If you add a new
  *queued* automation action (the legacy 3-action style), it needs the same `testMode` handling.
- **Inline fallback (no Redis) is a real, permanent code path**, not a test shortcut — `enqueueJob`
  returns `{queued: false}` when Redis/BullMQ isn't configured, callers fall back to synchronous
  processing. Local dev without Redis is expected to work (except real, non-test `delay`/`loop`
  waits, which genuinely need the queue — no sane synchronous fallback for "wait 3 hours").

## Environment gotchas (will bite you again if you don't know them)

- **This sandbox's ability to spawn child test servers from within `node:test` degrades over a
  long session and can become totally unreliable** (not just intermittent) — by the end of this
  session, all 3 server-spawning test files (`automationEngine.e2e.test.js`,
  `campaign.integration.test.js`, `criticalPath.e2e.test.js`) failed with "Server did not become
  ready within 20000ms" **even run individually in isolation**, while all 84 non-spawning unit
  tests passed clean every time. Confirmed environmental, not a code regression, by: (a) manually
  booting the server directly via Bash (not through `node:test`'s spawn) and driving the exact same
  HTTP scenarios successfully, and (b) the failures hit files untouched by the current change too.
  **If you hit this: don't assume the code is broken.** Try a fresh session/terminal first — this
  session's failures started as occasional-but-resolves-on-retry and got progressively worse, which
  points at accumulated resource/session state, not a fixed condition. If a fresh session still
  can't spawn test servers, that's worth investigating for real; if it works fine there, it was
  this session's accumulated state.
- **`dangerouslyDisableSandbox: true` is required for any Bash command that spawns a real listening
  server** (dev server, test server) — without it, health checks against `127.0.0.1` fail even
  though the process itself boots fine.
- **This machine runs Windows, and `npm install` regenerates `package-lock.json` in a way that
  strips the Linux-only `optionalDependencies` pointer** (`@rollup/rollup-linux-x64-gnu` etc.,
  needed for the Linux CI/Docker build). Check `git diff package-lock.json` before committing after
  any local `npm install`.
- **MongoDB 8.3.4 (latest via winget) crashes on boot on this machine**
  (`STATUS_ENTRYPOINT_NOT_FOUND`, root cause never identified). **MongoDB 6.0.27 works fine** and is
  what's installed (`C:\Program Files\MongoDB\Server\6.0\bin\mongod.exe`).
- **Corrupted npm installs have been a recurring theme** (`bullmq`, `framer-motion`, `motion-dom`,
  `@xyflow/react` all hit this) — packages with a `package.json` claiming files that don't exist on
  disk. Fix: delete that package's `node_modules` folder, `npm cache clean --force`, reinstall.
- **`@xyflow/react`'s `package.json` `exports` map only nests `"types"` inside `"node"`**, tripping
  up `"moduleResolution": "bundler"`. Worked around via a `paths` override in `client/tsconfig.json`
  — don't "fix" this by reinstalling, the files are fine.
- **The `Glob` tool has given false negatives for deeply-nested `node_modules` subtrees.** Verify
  directly (e.g. a Node `fs.readdirSync` walk) before concluding a package is broken.
- **A live Upstash Redis instance is configured in `server/.env`** (`REDIS_URL`, gitignored). Reset
  from the Upstash console's Settings tab for the `regular-longhorn-109637` database if it needs
  rotating — no data loss.
- **Local dev loop**: start `mongod` as a background process (`mongod.exe --dbpath <repo>/.mongo-data
  --bind_ip 127.0.0.1 --port 27017`), run `node scripts/seed.js` in `server/` for a base workspace
  (`admin@test.com` / `123456`), then `node index.js` in `server/` and `npm run dev` (or root
  `npm run dev:full`) for the client. `Stop-Process` on `mongod` can be unreliable in this sandbox;
  a Mongo-native shutdown (`admin().command({shutdown: 1, force: true})`) works when it is.

## Deployment

Production (`dashboard.nemnidhi.com`) runs on a Hostinger KVM1 VPS at `/opt/dashboard-whatsapp`, a
git clone (not Docker). API runs under PM2 as the `dashboard` Linux user, process name
`dashboard-api`, port 4000; nginx serves `client/dist` and proxies `/api/`, `/webhooks/`, `/legal/`,
`/socket.io/`, `/health`.

Deploys are automatic: `scripts/deploy-vps.sh` runs via cron every 5 minutes as the `dashboard`
user (`crontab -l -u dashboard` to confirm; output redirected to
`/opt/dashboard-whatsapp/deploy-cron.log`), polling `origin/main` — pulls, conditionally
`npm install`, always `npm run build`, restarts PM2 only if `server/` changed. Tracks the last
*successfully deployed* commit in `.last-deploy-sha` (gitignored), separate from git's HEAD, so a
failed build gets retried next tick instead of silently counting as deployed.

**Verification gotcha found this session:** `.last-deploy-sha` can legitimately lag a few minutes
behind `git log -1` on the VPS right after a push, purely because the next cron tick hasn't fired
yet — this is NOT necessarily a failed deploy. Don't panic-diagnose a build failure from a single
mismatched check; re-check `.last-deploy-sha` and `git log -1` a few minutes later before assuming
something's actually broken. `deploy-cron.log` (path above) is the authoritative source if a real
mismatch persists — it has full `npm install`/`npm run build`/PM2-restart output per cycle.

Standard check sequence on the VPS:
```bash
cat /opt/dashboard-whatsapp/.last-deploy-sha
pm2 status dashboard-api
pm2 logs dashboard-api --lines 50 --nostream
cd /opt/dashboard-whatsapp && git log -1 --oneline
```

**One thing checked and ruled out, in case it comes up again:** production's
`dashboard-api-error.log` has old `CastError`s from `server/routes/analytics.js`'s
`buildAnalytics()` (`sanitizeFilter` rejecting unwrapped `$in`/`$lt` operators). These are **stale
log lines predating commit `e617cc5`** (an earlier session's sanitizeFilter sweep, already fixed) —
confirmed by `git log --follow -p` and by hitting `GET /api/analytics/summary` locally (`HTTP 200`,
real data, no error). Nothing to fix here; don't rediscover this.

## History (prior sessions, before the automation engine work)

Starting point was a production audit (in conversation, not a file) that flagged 5 priorities, all
done, each its own commit(s) on `main`: `180483a` (campaign sends queued via BullMQ),
`fb8b1b2` (automation send_message/call_webhook queued), `b44f597` (2 security fixes — credential
secret fallback, `isLocalCredential` prefix-match bug), `a8b478c` (centralized Zod validation on
highest-risk routes), `c0efe2b` (TypeScript added to client — there was none before despite 84
`.tsx`/`.ts` files), `e740dd8` (`npm test` wired into CI + webhook HMAC tests + campaign
integration test), `36dff66` (last unqueued action, `google_sheets`, queued), `1cb1f5e` (`npm
audit` 13→0). Full detail, including *why*, is in the commit messages.

**Bugs found and fixed along the way (not originally on any list), most still relevant if you touch
nearby code:**
- `mongoose.set("sanitizeFilter", true)` silently breaks any raw `$operator` query not wrapped in
  `mongoose.trusted(...)`. ~20 unwrapped instances were found and fixed across `conversations.js`,
  `dashboard.js`, `assistant.js`, `templates.js`, `automation.js`, `crm.js`, `automationRunner.js`.
  `trustedFilter()` in `analytics.js` was a **no-op** until fixed (`return filter;`, never called
  `mongoose.trusted`). **If you see a `CastError` on a `$`-prefixed key being cast as a literal,
  check for an unwrapped operator first.**
- `chooseOwner()` in `crm.js` queried `Membership.findOne({ role: {...} })` but `Membership` has no
  `role` field, only `roleId`. Fixed to look up `Role` by `key` first.
- BullMQ's `Worker` needs `maxRetriesPerRequest: null` on its own Redis connection, separate from
  the shared cache client's bounded-retry connection — `jobs.js` uses a dedicated one.
  `ensureConversationInCrm` crashed on a genuinely new lead (`ConflictingUpdateOperators` — a field
  set in both `$setOnInsert` and `$set`).
- `framer-motion`/`motion-dom`/`@xyflow/react` had corrupted local installs (`motion-dom`'s `dist/`
  was completely empty — `npm run build` couldn't produce a bundle at all before this was found).

## Verification approach used throughout

Every change across every session has been verified by actually running it — booting a local Mongo
+ the real server, seeding test data, hitting real HTTP endpoints, and driving the actual browser
UI — not just read for plausibility. The e2e/integration test suites formalize the highest-value
parts of that into something that runs on every push instead of needing a human to redo it by hand.
