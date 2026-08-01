# Handoff — WhatsApp CRM engine work

**Repo:** `D:\Whatsapp Dashboard\Dashboard-WhatsApp` (note: the *parent* folder `D:\Whatsapp Dashboard\` also contains an unrelated `New folder` with other client docs — the actual project is one level down).
**Remote:** https://github.com/abhishekprajapat-hg/Dashboard-WhatsApp.git
**Branch:** `main` — all work this session pushed directly to `main` (no PR workflow in use).
**HEAD as of this handoff:** `1cb1f5e`

## What this session did

Starting point was a production audit (in conversation, not a file) that flagged 5 priorities. All 5 are done, each as its own commit(s) on `main`:

1. **`180483a`** — Campaign sends queued through BullMQ instead of blocking the HTTP request. New `server/services/campaignSender.js`. Rate limiting is now actually enforced (per-recipient delay spacing), not just stored and ignored.
2. **`fb8b1b2`** — Automation-triggered sends (`send_message`) and webhook calls (`call_webhook`) queued the same way. New `server/services/automationSender.js`. Flow tests (`POST /:id/test`) stay synchronous on purpose — see "Design notes" below.
3. **`b44f597`** — Two security bugs fixed: `WHATSAPP_CREDENTIAL_SECRET` no longer falls back to `JWT_SECRET` (rotating JWT would have permanently bricked stored WhatsApp credentials); `isLocalCredential` narrowed from a `startsWith("local-")` prefix check to an exact match (a real token starting with those characters would have silently never been sent).
4. **`a8b478c`** — Centralized Zod validation (`server/middleware/validate.js`, `server/utils/zodHelpers.js`) on the highest-risk write routes: auth login, WhatsApp account connection, webhook/integration settings, campaign and automation flow creation/actions. PATCH routes and read-heavy routes are still on manual checks — not covered.
5. **`c0efe2b`** — TypeScript checking added to the client (`client/tsconfig.json`, `tsc --noEmit` baked into `client/package.json`'s `build` script itself, not just a side CI step). There was **no tsconfig and no `typescript` package at all** before this despite 84 `.tsx`/`.ts` files.
6. **`e740dd8`** — `npm test` wired into CI (it existed but was never actually run there). Added webhook HMAC signature verification tests (zero prior coverage) and a real integration suite for campaign create → send → pause (spawns the actual server as a child process against a test DB, not mocked).
7. **`36dff66`** — The last unqueued automation action, `google_sheets`, wired through BullMQ the same way as `call_webhook`. Only the outbound Apps Script HTTP call is deferred; the CRM lead lookup/creation stays synchronous (fast local write, same as `add_to_crm`/`lead_stage`). All three automation actions (`send_message`, `call_webhook`, `google_sheets`) are now consistently queued — nothing left unqueued in the inbound-automation critical path.
8. **`1cb1f5e`** — All `npm audit` vulnerabilities fixed, 13 → 0. Most were safe patches or version pins blocking an otherwise in-range fix. Two needed real judgment calls rather than a blind `--force`: `react-router` turned out to be declared but never actually imported anywhere in the client (this SPA does its own view switching), so it was removed outright rather than upgraded; `@opentelemetry/sdk-node`/`auto-instrumentations-node` (a real, used, opt-in feature) were upgraded and verified by actually booting the server with `OTEL_ENABLED=true`, not just confirming the default-disabled path still works.

Full detail, including *why* each change was made, is in the commit messages — they're written to be read, not just skimmed.

## Bugs found and fixed along the way (not originally on the list)

These surfaced from actually running the code end-to-end, not from reading it:

- **`mongoose.set("sanitizeFilter", true)`** (in `server/db.js`) silently breaks any raw `$operator` query object that isn't wrapped in `mongoose.trusted(...)`. Found and fixed ~6 instances across the campaign/audience-filter path. If you see a `CastError` mentioning a `$`-prefixed key being cast as a literal value, this is almost certainly why — check for an unwrapped operator.
- **BullMQ had never actually been exercised against real Redis.** The shared Redis client (`services/cache.js`) sets `maxRetriesPerRequest: 3`, but BullMQ's `Worker` requires `maxRetriesPerRequest: null` on its own connection. `jobs.js` now uses a dedicated connection for BullMQ, separate from the cache client.
- **Pause didn't cancel already-enqueued jobs**, only marked the DB status — a resume before those stale jobs fired would have double-sent. Fixed with a status check inside each job (`processCampaignRecipient`/`processAutomationSendMessage`) that no-ops if the recipient isn't still `"queued"` when the job actually runs.
- **`metadata.campaignId`/`metadata.automationFlowId` stored as strings** instead of ObjectIds inside `Mixed` fields (Mongoose doesn't auto-cast `Mixed` subfields) — broke the campaign timeline / would have broken any future automation-run history feature querying by that field as an ObjectId.
- **The visual automation canvas's "Save" sent the wrong payload shape** to the create-flow API (a nested `trigger` object instead of the flat fields the Zod schema — and the actual server route — expect). Was silently producing the wrong trigger type before; would have been hard-rejected after the Zod work landed. Fixed in `AutomationView.tsx`.
- **`ChatWindow.tsx`'s "Add to CRM" button** passed its handler directly to `onClick` instead of wrapping it, so a click would have called it with the raw `MouseEvent` instead of no arguments. TypeScript caught this the moment strict checking was turned on.
- **`framer-motion`, its own `motion-dom` dependency, and `@xyflow/react`** had corrupted/incomplete local installs (same class of issue as the `bullmq` corruption from earlier in the project's history — see "Environment gotchas" below). `motion-dom`'s `dist/` was completely empty, meaning **`npm run build` could not produce a production bundle at all** before this was found and fixed. Unrelated to TypeScript, just found while verifying it.
- **`ensureConversationInCrm` (`server/services/crm.js`) would crash outright on a genuinely new lead.** `Lead.findOneAndUpdate` set `status` and `providerMessageId` in both `$setOnInsert` and `$set` — Mongo rejects that combination on an actual insert (`ConflictingUpdateOperators`). Never surfaced before because nothing earlier in the session had exercised the lead-*creation* path with a truly new lead (everything either reused an existing lead or skipped CRM). This is shared code — `add_to_crm`, `lead_stage`, and the main inbound-webhook lead-detection flow were all exposed to the same crash on real production traffic, not just `google_sheets`. Fixed by dropping the redundant `$setOnInsert` fields (`$set` already computes both correctly either way).

## Design notes worth knowing before touching this code again

- **`testMode` on automation flows is deliberately synchronous**, bypassing the queue entirely, and forces local-placeholder WhatsApp credentials inside the job processor itself (not just in the caller) — because the job re-fetches the account fresh by ID and has no visibility into "this is a test." If you add a new queued automation action, it needs the same `testMode` handling or testing a flow with that action could place a real API call.
- **Inline fallback (no Redis) is a real, permanent code path**, not a test shortcut — `enqueueJob` returns `{queued: false}` when Redis/BullMQ isn't configured, and callers fall back to processing synchronously. Local dev without Redis is expected to work.
- **All three queued automation actions follow the same shape**: only the slow/external part is deferred (WhatsApp send, webhook POST, Apps Script POST), any local DB prep stays synchronous, `testMode` bypasses the queue entirely and runs inline with the real outcome, and each processor's `trigger.failures` increment is gated on `!testMode` to avoid double-counting against `runInboundAutomations`' own run-level aggregate. If you add a fourth queued action, copy this shape rather than inventing a new one.
- Two intentional behavior changes from the Zod work: a malformed `templateId`/`assignmentUserId` is now **rejected** instead of silently falling back to a default, and an automation flow with the webhook action enabled now **requires** a valid webhook URL up front (cross-field validation) instead of failing later when the action actually runs.

## Environment gotchas (will bite you again if you don't know them)

- **This machine runs Windows, and `npm install` regenerates `package-lock.json` in a way that strips the Linux-only `optionalDependencies` pointer** (`@rollup/rollup-linux-x64-gnu` etc., added for a Linux CI/Docker build). Every `npm install` you run locally will do this again. Before committing after any local `npm install`, check `git diff package-lock.json` for a removed `"dependencies": {...}` block right after the `"workspaces"` array in the root package entry, and manually restore it if stripped (see any of this session's commits touching `package-lock.json` for the exact shape).
- **MongoDB 8.3.4 (the latest via winget) crashes on boot on this machine** (`STATUS_ENTRYPOINT_NOT_FOUND`, unrelated to the VC++ redistributable or CPU AVX support — root cause never fully identified). **MongoDB 6.0.27 works fine** and is what's actually installed and used (`C:\Program Files\MongoDB\Server\6.0\bin\mongod.exe`). Both versions may still be present; use 6.0.
- **Corrupted npm installs have been a recurring theme** (`bullmq`, `framer-motion`, `motion-dom`, `@xyflow/react` all hit this at different points) — packages with a `package.json` claiming files that don't actually exist on disk. If something can't resolve a module or type that should obviously be there, check whether the actual files exist before assuming it's a config/code problem. Fix is usually: delete the package's `node_modules` folder, `npm cache clean --force`, reinstall.
- **`@xyflow/react`'s `package.json` `exports` map only nests a `"types"` condition inside `"node"`**, not at the top level — trips up TypeScript's `"moduleResolution": "bundler"` even when the `.d.ts` files are genuinely present. Worked around with a `paths` override in `client/tsconfig.json` pointing directly at the real file. Don't "fix" this by reinstalling — the files are fine, it's a resolution quirk.
- **The `Glob` tool gave false negatives multiple times this session** for deeply-nested `node_modules` subtrees (returned "No files found" for files that genuinely existed, confirmed via a direct Node.js `fs.readdirSync` walk). If `Glob` says a file doesn't exist somewhere under `node_modules`, don't trust it — verify directly before concluding a package is broken.
- **A live Upstash Redis instance is configured in `server/.env`** (`REDIS_URL`, gitignored, not in this repo). The token was rotated once already this session after being pasted in chat — if it needs rotating again, that's a one-click "Reset Credentials" in the Upstash console's Settings tab for the `regular-longhorn-109637` database, no data loss.
- **Local dev loop**: start `mongod` as a background process (`mongod.exe --dbpath <repo>/.mongo-data --bind_ip 127.0.0.1 --port 27017`), run `node scripts/seed.js` in `server/` for a base workspace (`admin@test.com` / `123456`), then `node index.js` in `server/` and `npm run dev` (or the root `npm run dev:full`) for the client. To stop `mongod` cleanly, OS-level `Stop-Process` was unreliable in this sandbox (access denied on the process); use a Mongo-native shutdown instead: connect with the driver and run `admin().command({shutdown: 1, force: true})`.

## Deployment (as of 2026-08-01)

Production (`dashboard.nemnidhi.com`) runs on a Hostinger KVM1 VPS at `/opt/dashboard-whatsapp`,
as a git clone (not Docker — the VPS has no Docker installed, despite `docker-compose.yml`/
`Dockerfile` existing in this repo for local dev). The API runs under PM2 as the `dashboard` Linux
user, process name `dashboard-api`, port 4000; nginx (`/etc/nginx/sites-available/dashboard-nemnidhi`,
**not** `infra/nginx/default.conf` — that file is only for the Docker Compose setup) serves
`client/dist` as static files and proxies `/api/`, `/webhooks/`, `/legal/`, `/socket.io/`, `/health`
to the API.

Deploys are automatic: `scripts/deploy-vps.sh` runs via cron every 5 minutes as the `dashboard`
user, polling `origin/main` and deploying if there's a new commit — pulls, conditionally runs
`npm install` (only if `package.json`/`package-lock.json` changed) and always `npm run build`,
restarts PM2 only if anything under `server/` changed. It tracks the last successfully deployed
commit in `.last-deploy-sha` (gitignored) rather than trusting git's HEAD, so a failed build gets
retried on the next tick instead of being silently treated as deployed.

This exists because production was found to be running a commit from **July 6** — 13 commits
behind `main`, missing this entire session's work — because deploys had been entirely manual and
nobody was checking. That caused a real production bug (campaigns crashing on send via a
`ConflictingUpdateOperators` error in `crm.js` that was already fixed on `main`) to go unnoticed on
live customer traffic. If this cron job stops running, that kind of silent drift is the risk.

## What's not done

From the original 5-item list, everything is done at the agreed scope, and all three automation actions (`send_message`, `call_webhook`, `google_sheets`) are now queued. Known remaining gaps, roughly in the order they'd matter:

- Zod validation doesn't cover PATCH routes or read-heavy routes (analytics, dashboard, contacts, team, templates, conversations) — still manual `if (!field)` checks.
- No E2E suite covering the full critical path (login → connect WhatsApp → webhook → reply → campaign → automation) — only campaign create/send/pause and webhook signature verification have real integration coverage. That's a genuinely larger, separately-scoped undertaking (discussed and deliberately deferred, not forgotten).
- The client production bundle is a single ~1.4MB chunk (Vite's own build warning) — not urgent, but `manualChunks`/dynamic imports would help if load time ever becomes a concern.

## Verification approach used throughout

Every change this session was verified by actually running it — booting a local Mongo + the real server, seeding test data, hitting real HTTP endpoints, and (for the TypeScript work) driving the actual browser UI — not just read for plausibility. The campaign and webhook integration tests added in the last commit formalize that same pattern into something that runs on every push instead of needing a human to redo it by hand.
