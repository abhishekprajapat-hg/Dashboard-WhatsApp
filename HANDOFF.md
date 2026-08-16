# Handoff — WhatsApp CRM engine work

**Repo:** `D:\Whatsapp Dashboard\Dashboard-WhatsApp` (note: the *parent* folder `D:\Whatsapp Dashboard\` also contains an unrelated `New folder` with other client docs — the actual project is one level down).
**Remote:** https://github.com/abhishekprajapat-hg/Dashboard-WhatsApp.git
**Branch:** `main` — all work pushed directly to `main` (no PR workflow in use).
**HEAD as of this handoff:** `5cb6f5d` — six commits shipped and confirmed deployed on
2026-08-16 (see the dated section directly below for what each one is). `https://dashboard.
nemnidhi.com/health` returned `200 OK` after the final one, checked directly. **Working tree is
STILL not clean** - the validation-backfill work described lower in this file (mid-flight before
this session started) is untouched, deliberately left alone throughout 2026-08-16's session so as
not to interfere with it. Run `git status --short` before touching anything else in this repo -
you should see exactly `HANDOFF.md` plus the five validation-backfill route files modified, nothing
else.
**Also see "Production bug found, deferred" below** - a real outbound-message delivery issue the
user found live on production, still not investigated (deliberately deferred to a later
fine-tuning pass).
**Also see "Strategy discussion: competitive gaps and long-term vision" below** - the planning
conversation that today's session's work (pack-tier entitlements, the Dashboard→Vega feed) was
scoped from.

## Pack-tier entitlements, Dashboard→Vega feed, AI reply-assist — 2026-08-16, DONE, all deployed

Six commits, each independently verified against a real running local server before pushing, each
confirmed deployed via `https://dashboard.nemnidhi.com/health` returning `200 OK` after the ~5min
cron cycle. This closed out `execution-sequence.md` (see `D:\Research\ecosystem-audit\`) step 7,
step 9, and step 20 in full, plus all three pieces of the "Vega copilot" internal-AI scope (the
third piece, sales reply-assist, lives here in Dashboard, not in Vega - see Vega's own `HANDOFF.md`
for the other two pieces and everything Vega-side).

1. **`1cdce1b` Pack-tier entitlements, deliberately separate from `FeatureFlag`.** The original
   plan (`execution-sequence.md` step 7, and this file's own earlier "Admin-level feature flag
   management UI" section) called for adding `workspaceId` to the existing `FeatureFlag` system.
   That turned out to be the wrong fix: `FeatureFlag`'s two real flags (`queueProcessing`,
   `rabbitmqEvents`) gate whether *this process* connects to Redis/RabbitMQ - a deployment-wide
   concern that can't vary per tenant within one running server. What actually needed to vary per
   client already had a home: `Organization.plan` (existed, previously free-text/unenforced).
   New `server/services/entitlements.js` - `PACK_TIERS` (`basic`/`medium`/`pro`/`custom`),
   `CAPABILITY_DEFINITIONS` (`messaging`→basic, `campaigns`/`automationBuilder`→medium,
   `analytics`/`aiAssistant`→pro), `hasEntitlement()`. New `requireEntitlement(capability)` in
   `server/middleware/auth.js`, deliberately separate from `requirePermission` - permission is
   "can this role do this", entitlement is "did this org's plan buy this". Wired onto every
   `automation.js` route and `assistant.js`'s action routes (not `/assistant/overview`, which
   stays open since its metrics have value on any plan).
2. **`51b66a5` Admin Plan management UI.** New "Plan" tab in `AdminView.tsx` next to the existing
   "Feature Flags" tab - shows the org's tier, a one-click Basic/Medium/Pro/Custom switcher, and
   every capability's enabled/locked state with its minimum tier. `GET`/`PUT
   /admin/entitlements[/plan]`.
3. **`65840a6` Locked/upsell states for gated pages.** New shared `PlanLockedState` component,
   driven by the server's real `PLAN_LIMIT` error text, not a separate client-side guess.
   `AutomationView.tsx` gets a full-page block (its data list fails to load entirely when
   ungated, so a full swap is the honest state). `AssistantView.tsx` gets a per-action reactive
   banner (only its action routes are gated, not the read-only overview).
4. **`ea66d54` Proactive upsell gate on the AI Assistant page.** `GET /assistant/overview` now
   returns `entitlements.aiAssistant`, computed the same way `requireEntitlement` does, so the
   client can show the locked state immediately on page load instead of waiting for a user to
   click something and hit a 403. Metrics and conversation history stay visible - they have value
   on any plan; only the action panels (Run Assistant, Knowledge Base, Search, Voice/Tools) swap
   for the locked card.
5. **`a52eb46` Dashboard→Vega event feed - sender side.** New `server/services/
   vegaIntegration.js` - `notifyVega(organizationId, event, data)`, fire-and-forget POST to
   Vega's `/api/integrations/dashboard-events` with a shared secret header
   (`VEGA_INTEGRATION_SECRET`/`VEGA_API_URL`, both optional so an unconfigured environment just
   no-ops rather than erroring). Wired into `PUT /admin/entitlements/plan` as the first real
   event - fires after a plan change, never blocks the response, swallows its own errors (a Vega
   outage must never break a plan change on this side). See Vega's `HANDOFF.md` for the receiver
   side and exactly what it does with the event.
6. **`5cb6f5d` AI reply-assist in the Inbox composer.** No new AI backend needed -
   `/assistant/analyze` (`task: "draft_reply"`) already returns a real `autoReply` for any
   conversation, including a genuinely useful local-rules fallback with zero AI providers
   configured (confirmed live: correctly picked "automation" out of a test customer message and
   recommended the matching product). Almost entirely UI wiring - a "Suggest reply" button
   threaded `InboxView.tsx` (owns the actual state/API call, mirrors the existing
   `applyQuickReply` pattern) → `WhatsAppBusinessInbox.tsx` → `ChatWindow.tsx` → `Composer.tsx`.
   Automatically inherited the `aiAssistant` entitlement gate from item 1, for free - a `PLAN_
   LIMIT` error shows as a small inline warning in the composer bar (no room for the full
   `PlanLockedState` card there).

**Production deploy of the Dashboard→Vega feed needs env vars on BOTH sides before it does
anything** - `VEGA_INTEGRATION_SECRET` (this app) / `DASHBOARD_INTEGRATION_SECRET` (Vega, must be
the identical value) / `VEGA_API_URL=https://vega.nemnidhi.com`. **Already done, 2026-08-16** -
added to `/opt/dashboard-whatsapp/server/.env` (needs `sudo -u dashboard`, this app's PM2 process
runs as a different Linux user than the `hrmsdeploy` user Vega runs as, even though both apps
share one VPS) and to Vega's `/home/hrmsdeploy/apps/hrms/.env.local`, both restarted with
`pm2 restart <name> --update-env`, both confirmed via a clean `tail` read-back. Not yet verified
against a real production plan change (only tested locally) - the first real one will be the
actual live proof.

**Not done, left for later:** more event types on the Dashboard→Vega feed beyond `plan_changed`
(e.g. usage/activity signals - Vega's account-health flags are currently limited to plan-trend
data because of this, see Vega's `HANDOFF.md`); BillStack's Razorpay plan IDs/webhook were
deliberately left unconfigured (no client needs billing yet, and doing it speculatively was
explicitly ruled out this session - revisit only when a real client signs).

## Strategy discussion: competitive gaps and long-term vision — 2026-08-15, planning only

**Nothing in this section was built. This is a decision-context record for whoever scopes the next
phase of roadmap work**, so the reasoning behind future prioritization calls doesn't have to be
re-derived from scratch. Triggered by the user asking for a competitive feature audit, then
describing a much larger long-term vision, which got scoped down to something concrete.

- **Competitive feature gap audit** (real web research, not guessed): against direct competitors
  (WATI, Interakt, AiSensy, Gallabox), this product is **ahead** on automation-engine depth, AI
  assistant depth, and enterprise admin/observability maturity - none of those competitors appear to
  match this at the same price tier. It is **behind** on four things, confirmed via real search, not
  assumption: WhatsApp Catalog/commerce (no `Product`/`Catalog`/`Order` model exists anywhere in this
  codebase today), omnichannel beyond WhatsApp (Instagram/Facebook unified inbox), WhatsApp Business
  Calling (voice calls in the same inbox as chat - explicitly a 2026 buying criterion per research,
  not present at all), and catalog-tied cart-recovery campaigns (downstream of the catalog gap).
  **None of these four appear anywhere in `docs/FUTURE_ROADMAP.md`'s five phases** - the existing
  roadmap is entirely infrastructure/hardening/AI-depth/compliance-shaped, not competitive-parity
  shaped. Worth a deliberate decision on sequencing, not an oversight to just fix quietly.
- **SOC 2 / compliance question, resolved for now**: researched what a real SOC 2 audit actually
  requires (an independent CPA firm, a 3-12 month Type II observation window, $15k-50k+ engagement
  fee - none of it shortened by more engineering effort) and checked whether direct competitors
  publish one - none of WATI/Interakt/AiSensy/Gallabox appear to (only Twilio, a much bigger
  infrastructure-tier company, does). **Conclusion: not needed now, with no live clients.** It's a
  customer-procurement gate, not a Meta/WhatsApp Business Platform requirement - pursue reactively,
  once a real deal is actually stuck behind it, not speculatively.
- **Long-term vision, scoped down to something buildable**: the user's stated ambition was "one-stop
  solution across 20+ industries, each with multiple participant types (manufacturer/wholesaler/
  retailer)." Clarified via direct question: **each business stays isolated** (its own contacts, own
  catalog, own campaigns) - this is *not* a multi-sided marketplace where businesses transact with
  each other through the platform. That distinction matters enormously: the isolated-business version
  is a genuinely incremental extension of the existing `Organization`/`Workspace` multi-tenant model
  (the hard architectural part already exists); the marketplace version would have been a different
  category of product entirely (Udaan/Moglix-scale, a different multi-year build).
- **System-boundaries framework** worked out for the vision as scoped: a four-stage process (Marketing
  &amp; Sales &rarr; Operations &rarr; Delivery &rarr; Maintenance/Taxation/Feedback) that repeats
  under every industry's specific process, with a clear ownership rule - **WhatsApp never owns data,
  it's the channel every stage talks through; the platform owns the identity thread connecting all
  four stages end to end; supporting software owns deep/regulated/industry-specific execution.**
  Concrete conclusions worth remembering: keep Operations deliberately thin in the platform until
  specific anchor industries are chosen (a generic ops module serving 20 industries would serve none
  of them well); **taxation/GST compliance should be an integration with Tally/Zoho Books/Vyapar, not
  a native rebuild** - regulated, penalty-bearing, and the market already trusts an incumbent there;
  Marketing &amp; Sales and Delivery are where the nearest-term work (catalog/commerce, payments,
  omnichannel - the same four competitive gaps above) should land, since that extends an already-
  strong foundation rather than starting one from nothing.
- Two artifacts published capturing this discussion in full, in case either needs to be shared or
  referenced again: **[Build Manifest](https://claude.ai/code/artifact/51fdf45f-46c9-4c32-9950-8aab02a1dfba)**
  (this session's shipped/in-progress/deferred/not-started status across the whole roadmap) and
  **[System Boundaries](https://claude.ai/code/artifact/caaa4ef2-f235-454f-8cc2-b353d0b8320b)** (the
  four-stage ownership framework above, laid out in full with the per-stage WhatsApp/platform/
  supporting-software breakdown).

## Production bug found, deferred - outbound WhatsApp messages may silently fake "sent"

**Not investigated to a root cause yet - deliberately deferred by the user to a later
"fine-tuning" session, not this one.** Recorded here so it isn't lost, with everything gathered so
far so the next session doesn't have to redo the diagnosis from scratch.

**What the user observed**: sent a message reading "Soomil" from the live production dashboard
(`dashboard.nemnidhi.com`) to their own WhatsApp number as a test. It showed as sent (checkmarks) in
the dashboard's Inbox, but never arrived on the actual WhatsApp side (confirmed by checking the real
WhatsApp/WhatsApp Web thread with that number - the message is absent). Later messages in the same
conversation ("Hello", "How can i help you?") did arrive.

**Leading hypothesis, not yet confirmed**: `server/services/whatsappProvider.js`'s
`sendWhatsAppText()` (lines ~323-330) has a silent fallback -
```js
if (!account) {
  return { providerMessageId: `local_${Date.now()}`, status: "sent", mode: "local" };
}
```
- if the caller passes no `account` (e.g. `conversations.js`'s `POST /:id/messages` handler's fresh
  `WhatsAppAccount.findOne({status: {$in: ["connected","needs_attention"]}})` lookup comes back
  empty for any reason at send time), this returns a **fake success** instead of throwing - no real
  API call to Meta/Twilio/Wati ever happens, but the message is stored and rendered as a normal sent
  message with no error indication anywhere.
- **User's own alternative theory**: "Soomil" was the first-ever contact attempt to that test number
  (no prior inbound message from it), so it may have been rejected by Meta for being a free-form
  message outside the 24-hour customer-service window (or a billing/payment-method gap on the
  connected WABA) - then the *next* messages worked because messaging FROM the personal number to
  the business first opened a real 24-hour window.
- **Evidence gathered so far, from the Settings → WhatsApp console page**: exactly 1 connected
  account, status healthy, 0 needs-attention. Aggregate stats: 69 outbound, 61 delivered, **0
  failed**. This evidence is more consistent with the `!account` local-fallback hypothesis than with
  the user's Meta-rejection theory - a real Meta API rejection (billing or 24-hour-window) is a
  thrown HTTP error in this codebase, which the catch block in `conversations.js` turns into
  `status: "failed"` on the message document, and that *is* what "Failed sends" counts
  (`server/routes/whatsapp.js`'s `/console` handler aggregates `Message.status === "failed"`
  directly). Zero failed messages argues Meta was never actually asked, not that it said no. The
  69−61=8 outbound-but-not-delivered gap is consistent with messages sitting at `status: "sent"`
  forever (exactly what the local fallback produces, since there's no real provider message id for
  a delivery-status webhook to ever match against) - though some of that gap could also just be
  normal delivery latency on genuinely-sent messages, not proof by itself.
- **Not yet run - the one thing that would settle this**: query the "Soomil" message's own stored
  record directly (`status`, `metadata.providerMode`, `providerMessageId`, `metadata.error`). A
  read-only diagnostic command for this was written and handed to the user but not yet executed:
  ```bash
  ssh -p 2424 samvid@72.60.97.58 "cd /opt/dashboard-whatsapp/server && node -e 'require(\"dotenv/config\");const mongoose=require(\"mongoose\");(async()=>{await mongoose.connect(process.env.MONGODB_URI);const docs=await mongoose.connection.collection(\"messages\").find({body:\"Soomil\"}).sort({createdAt:-1}).limit(3).toArray();console.log(JSON.stringify(docs.map(d=>({status:d.status,providerMode:(d.metadata||{}).providerMode,providerMessageId:d.providerMessageId,error:(d.metadata||{}).error,createdAt:d.createdAt})),null,2));process.exit(0);})();'"
  ```
  `providerMode: "local"` → confirms the app-side silent-fallback bug (fix: `sendWhatsAppText`/its
  callers should throw or surface a clear error when no connected account is found, not fake
  success). `status: "failed"` with a real `error` → a real Meta/provider rejection that isn't
  reaching the "Failed sends" counter (a different, second bug). A real `providerMessageId` with
  `providerMode: "meta"` → the problem is outside this app entirely.
- **Next session should start here**: run that query (or re-derive an equivalent one), confirm which
  branch above is true, then scope an actual fix - likely making the account-lookup failure path
  throw a clear, user-visible error instead of silently faking delivery, regardless of which
  specific trigger caused it this time.

## Session paused here 2026-08-15 (continued a fifth time) — validation backfill in progress, not finished

A sixth pass this same day picked up the other follow-up task flagged during the OpenAPI pass (the
`socket.io-parser` fix, the first follow-up, shipped and deployed as `048103f` - confirmed via
`.last-deploy-sha` and PM2 restart count directly against the VPS before this pass started).

**Unlike every other entry in this file, this one is not "implemented and verified, just
uncommitted" - it's genuinely partway through.** Real, wired `validateBody`/`validateQuery` schemas
have been added to all 15 gap routes across `team.js`/`templates.js`/`whatsapp.js`/`campaigns.js`/
`conversations.js` (see the dedicated section below for exactly what and why), syntax-checked, and
confirmed not to regress the existing 113-test non-spawning suite. **Not yet done**: reconciling the
OpenAPI pass's now-superseded guessed schemas in `server/openapi/paths/*.js` with these real ones,
new test coverage for the 15 new schemas, e2e coverage for the highest-traffic routes, the full
manual UI verification pass, and regenerating `docs/openapi.json`. Whoever (or whatever fresh
window) picks this back up should treat the plan this was built from as still authoritative for
what's left - re-derive it from this section plus the route-level diffs already in the working tree
rather than re-researching from scratch.

**What's actually left:** everything in the "Not yet done" list above, then the usual commit/push
pause for the user's go-ahead. Roadmap-wise, once this closes: Phase 1 has only the Socket.io Redis
adapter (low current value, single-VPS deployment) and the Playwright E2E suite (biggest remaining
lift, no frontend test infra exists yet) left; Phase 2 has tenant quotas/billing and backup drills
left, both needing decisions outside pure engineering scope before they can be sized further.

## `.last-deploy-sha`/deploy history note

Everything from `## Feature-flag admin UI` through the rest of this file (down to `## History`)
predates the OpenAPI, structured-logging, socket.io-parser fix, and validation-backfill work above
and was true as of `HEAD 30cda73` before the feature-flag commit landed. It's kept as-is below for
the detailed implementation record of each piece; only the top banner and the "Session paused"
headers above have been kept current.

## Validation backfill on 15 gap routes — in progress 2026-08-15, not finished

Closes the follow-up flagged during the OpenAPI pass: `HANDOFF.md` had claimed "Zod validation on
all routes" was closed entirely (see the "Zod validation on the remaining route files" section
further below - accurate for the 7 files it covered, just not a complete picture of the whole
codebase), but ~15 routes across `team.js`, `templates.js`, `whatsapp.js`, `campaigns.js`, and
`conversations.js` still read `req.body`/`req.query` with zero `validateBody`/`validateQuery`
coverage.

Three parallel research passes traced every route's real handler logic against the real client-side
call shape (`client/src/app/lib/api.ts` + every component caller) before writing anything, since
this is genuinely behavior-changing work (unlike the OpenAPI pass, which only wrote
documentation-only, unwired guesses for these same routes). That research paid off immediately:

- **A real bug the OpenAPI pass's guess would have shipped**: `templates.js`'s sync-whatsapp guess
  marked `accountId` required, but the only real caller (`TemplatesView.tsx`'s "Sync WhatsApp"
  button) always calls with zero arguments. The real schema makes `accountId` optional.
- **A real unguarded crash, not just a gap**: `conversations.js`'s `POST /:id/messages` did
  `content.trim()` with no null-check - an omitted `content` was a `TypeError` → unhandled 500, not
  a clean 400. The new schema requires `content` (allowing `""`, since media-only messages
  legitimately send empty content) - the one deliberate behavior change in this whole pass, and it
  fixes a crash rather than introducing a new rejection.
- **A real type mismatch in the earlier guess**: `conversations.js`'s `POST /:id/template` guessed
  `parameters` as a record; the client's own type and the handler's `Array.isArray` check both treat
  it as an array. Corrected.
- **Every other silently-coerced/defaulted field stays exactly that permissive** - `role` (team.js),
  `type`/`status`/`category`/`language` (templates.js), `stage`/`mode` (conversations.js),
  `limit`/`cursor`/`before` (conversations.js) all keep their current "invalid input silently
  falls back, never rejects" behavior. Tightening any of these into a hard-rejecting enum was
  deliberately not done - that's a separate decision, not bundled into a validation-gap backfill.
- `team.js`'s new schema reuses the existing, already-tested `isEmail`/`passwordPolicy` functions
  (`server/utils/validation.js`) via `.refine()` instead of re-deriving the acceptance rules by
  hand - `isEmail` is a custom regex, not `z.string().email()` (those accept different input).
  `templates.js`'s `POST /` schema deliberately stays shape-level only (types, not business rules) -
  `cleanPayload()`'s existing defaulting/coercion logic keeps doing that job untouched, so there's
  one source of truth for those rules instead of two that could drift apart.

**Route changes are done and syntax-checked** (`team.js`, `templates.js`, `whatsapp.js`,
`campaigns.js`, `conversations.js` - all 15 routes now wired). **Not yet done, in order**:
1. Reconcile `server/openapi/paths/{team,templates,whatsapp,campaigns,conversations}.js` - swap
   their now-superseded local guessed schemas for imports of the real ones, delete the dead guesses.
2. Extend `server/tests/routeValidation.unit.test.js` with all 15 new schemas (minimal-valid-succeeds
   + invalid-fails, plus explicit assertions that the permissive fields still accept garbage rather
   than rejecting it).
3. New/extended e2e coverage for the highest-traffic routes (team invite, sync-whatsapp zero-arg
   call, whatsapp template creation defaults, campaign preview, and both message shapes on
   `conversations.js POST /:id/messages` including the fixed crash case).
4. Full test suite run.
5. Manual verification against the real running dashboard UI - team invite, template create, the
   "Sync WhatsApp" button specifically, campaign audience preview, CSV contact import, and (highest
   traffic) sending a chat message in the real Inbox UI both text-only and attachment-only.
6. `npm run generate:openapi` re-run so `docs/openapi.json` reflects the corrected shapes.

Only after all of that should this be committed - do not commit mid-way through this list.

## `socket.io-parser` vulnerability fix — implemented 2026-08-15, uncommitted

Closes one of the two follow-up tasks flagged while scoping OpenAPI generation earlier this session:
`npm audit` reported a high-severity advisory in `socket.io-parser` (`GHSA-2m8v-j782-fhvr`, "Socket.
IO: Zero-attachment Memory Exhaustion"), a transitive dependency of the existing `socket.io@4.8.3`.

- **Confirmed low-risk before touching anything**: `socket.io@4.8.3`'s own `package.json` declares
  `"socket.io-parser": "~4.2.4"` (tilde range - patch-level only, `>=4.2.4 <4.3.0`). The fixed
  version is `4.2.7`, comfortably inside that range - `npm audit fix` (no `--force`, no major-version
  bump anywhere) was the whole fix.
- **`npm audit fix --workspace server`** bumped `socket.io-parser` `4.2.6` → `4.2.7` (deduped across
  both `client` and `server` workspaces, since `socket.io-client` shares the same parser package).
  `npm audit` now reports 0 vulnerabilities. `package-lock.json` diff is 6 lines - exactly the one
  package's version/resolved/integrity fields, nothing else touched.
- **Hit the now-familiar Windows npm gotcha a third time** - `npm audit fix` also stripped the
  `@rollup/rollup-linux-x64-gnu`/`@tailwindcss/oxide-linux-x64-gnu`/`lightningcss-linux-x64-gnu`
  Linux-only `optionalDependencies` lines from the lockfile (see "Environment gotchas" below).
  Caught via `git diff package-lock.json` and manually restored before anything was committed, same
  fix as the previous two times this session.
- **Verified beyond `npm audit`**: `npx tsc --noEmit` clean on the client (the dependency bump
  touches `socket.io-client` too, deduped to the same patched version); full server test suite
  141/142 (same pre-existing unrelated `automationEngine.e2e` flakiness, not this change); booted the
  real server + client, logged in as the seeded local admin, navigated to the Inbox (which is what
  actually calls `realtimeService.connect()`), confirmed zero console errors; **directly verified the
  patched Engine.IO/Socket.io stack itself** with `curl "http://127.0.0.1:4000/socket.io/?EIO=4&
  transport=polling"`, which returned a real handshake (`{"sid":"...","upgrades":["websocket"],...}`)
  - the browser tool's network monitor doesn't capture WebSocket upgrade traffic, so this direct
    handshake check was the more authoritative proof that the patched parser still accepts and
    responds to real connections correctly, not just "the app didn't crash."

## Structured logger with redaction — implemented 2026-08-15, deployed (commit `d033ee1`)

Closes `FUTURE_ROADMAP.md`'s Phase 1 "Add structured logger with redaction" item.

- **Real scoping correction before writing any code**: a precise inventory found 44 `console.*`
  call sites across 17 files, but **22 of those are in one-shot CLI scripts**
  (`server/scripts/*.js`) - human-facing terminal tools a developer/ops person runs and reads
  directly, where structured JSON would be a strictly worse UX. `seed.js`'s
  `console.log(\`Password: ${seedUser.password}\`)` is **intentionally** printing the freshly-seeded
  dev password for the human running it, not a leak - explicitly left alone. **Only the 22 call
  sites in the actual server runtime** (`index.js`, `db.js`, `routes/`, `services/`, `realtime/`)
  were migrated.
- **Tooling**: `pino@^10` + `pino-http@^11` (new runtime deps), `pino-pretty@^13` (devDependency
  only). Chosen over Winston/hand-rolled - pino's `redact` option (backed by `fast-redact`) does
  exactly what's needed declaratively, and `pino-http` is the official Express integration from the
  same maintainers rather than hand-rolling response-finish timing.
- **`server/services/logger.js`** (new) - the single pino instance (`config.logLevel`, new
  `LOG_LEVEL` env var, default `"info"`), a shared `redactPaths` export (one definition, reused by
  both the base logger and `httpLogger` below), and `httpLogger` (`pino-http` with `genReqId` -
  **this codebase had zero request-id/correlation-id anywhere before this**, confirmed via
  repo-wide grep - and `customProps` reading `req.user?.workspaceId`/`req.user?.sub` when present).
  Pretty-printed only when `NODE_ENV=development` specifically (not `"test"`) - pino-pretty runs its
  own worker thread, and this environment's server-spawning tests are already documented as fragile
  (see "Environment gotchas" below), so spawned test servers stay on the same plain-JSON path as
  production. Production writes plain JSON to stdout, same destination every `console.*` call
  already wrote to - **PM2's existing log capture on the VPS needs zero changes**, log lines are
  just structured now instead of freeform text.
- **`server/index.js`** - `app.use(httpLogger)` mounted before `rateLimiter()` (so rate-limited
  requests still get logged); the global error handler's `console.error(error)` replaced with
  `logger.error({err: error, requestId: req.id}, "Unhandled route error")` - pino's standard `err`
  serializer preserves the full stack trace in structured form, a real improvement over the old raw
  dump, not just a like-for-like swap. Confirmed the client-facing error response is byte-identical
  to before (`{"error":"SERVER_ERROR","message":"Something went wrong."}`) - only the log line
  changed, not the response contract.
- **Remaining 16 call sites** (`db.js`, `analytics.js`, `whatsapp.js`, `conversations.js`,
  `messageBus.js`, `jobs.js`, `campaignSender.js`, `cache.js`, `automationEngine.js`,
  `realtime/events.js`) - mechanical swap to `logger.info/warn/error`, passing the real `Error`
  object as `{err: error}` instead of just `.message` (strictly more information, now safely
  redactable) and discrete variables as structured fields instead of string-interpolating them
  (e.g. `jobs.js`'s job-failed warning now carries `queue`/`jobId`/`err` as real fields).
- **Real, unplanned finding caught during manual verification, not by inspection** - triggering a
  genuine malformed-JSON request to test the error handler surfaced that Express's `body-parser`
  attaches the raw invalid input as `.body` directly on the `SyntaxError` it throws, and pino's
  `err` serializer surfaces every enumerable property of a logged error - so **the original redact
  list would have missed this specific real leak path** (a mistyped secret in a malformed JSON body
  would've appeared in `err.body` in production logs). Caught live during step 4 of verification
  (not anticipated during design), fixed by adding `body`/`*.body` to `redactPaths` before calling
  this done, confirmed with a real re-triggered request containing a fake secret in a broken JSON
  body - the raw value no longer appears anywhere in the log output.
- **Tests**: `server/tests/logger.unit.test.js` (new, 6 tests) - builds a fresh pino instance from
  the exact same exported `redactPaths`, writes to an in-memory stream, asserts real secret values
  never appear in the parsed JSON output for: a top-level secret field, `req.headers.authorization`
  in the real pino-http shape, a one-level-nested secret via the wildcard path, the `.body`-on-error
  case above, and that unrelated fields and the error stack trace both pass through untouched. Full
  suite unaffected (141/142 - the one failure is the same pre-existing, already-documented
  `automationEngine.e2e` sub_workflow flakiness, confirmed by two separate full-suite runs producing
  the identical failure, untouched by this change).
- **Verified against a real running server, not just the unit tests**: booted with
  `NODE_ENV=development` and confirmed pino-pretty's colorized human-readable output; booted with
  `NODE_ENV=test` (matches what spawned e2e tests actually use) and confirmed plain JSON lines with
  `req`/`res`/`responseTime`/`requestId`; logged in as the seeded local admin, hit an authenticated
  route with the real bearer token, and grepped the **entire raw log file** for the actual token
  value - zero matches, confirmed `"authorization":"[Redacted]"` in its place and
  `workspaceId`/`userId` correctly populated from `customProps`; triggered a real unhandled error
  (malformed JSON body) and confirmed both the stack trace appears in the structured log **and** the
  client response is unchanged (see `.body` finding above for what this step actually caught).

## OpenAPI schema generation — implemented 2026-08-15, uncommitted

Closes `FUTURE_ROADMAP.md`'s Phase 1 "Add OpenAPI schema generation" item. Scoped as the
lowest-risk, most mechanical of everything left on the roadmap - no architecture change, generates
purely from what already exists.

- **Tooling decision**: `@asteasolutions/zod-to-openapi@^9` (new dependency), not Zod v4's native
  `z.toJSONSchema()` hand-rolled. Confirmed via `npm view` that v9.1.0 targets Zod v4
  (`peerDependencies: {zod: "^4.0.0"}`) before committing to it. Its README confirmed raw Zod
  schemas can be passed straight into `registry.registerPath(...)` without calling
  `.openapi()`/`.meta()` on them first (named-ref extraction is opt-in) - so **no existing schema
  definition anywhere in the codebase needed to change shape**, only gain an `export` keyword.
- **`server/openapi/registry.js`** (new) - the single `OpenAPIRegistry`, a `bearerAuth` security
  scheme (matches the real `Authorization: Bearer <token>` + `requireAuth` pattern used everywhere
  except `legal.js`, `POST /api/auth/login`, and the WhatsApp webhook routes), shared path-param
  schemas built on the existing-but-previously-unused-for-this `objectIdString` helper
  (`zodHelpers.js`), and shared **generic** response schemas (`DataResponse`/`ListResponse`/
  `OkResponse`/precise `ErrorResponse`) - deliberately not fabricated per-endpoint response bodies,
  since none exist anywhere in the codebase to draw from.
- **`server/openapi/paths/*.js`** (new, 19 files mirroring `server/routes/`) - one
  `registry.registerPath(...)` call per endpoint (105 operations across 83 unique path templates),
  tagged by domain. Real finding while inventorying: **~15 routes across `team.js`, `templates.js`,
  `whatsapp.js`, `campaigns.js`, and `conversations.js` read `req.body`/`req.query` with zero
  `validateBody`/`validateQuery` schema today** - directly contradicting this file's earlier claim
  that the "Zod validation on all routes" item was closed entirely (see that dated section further
  below - it was accurate for the 7 files it covered, just not a complete picture of the whole
  codebase). For these gap routes, **documentation-only** Zod schemas were authored directly in the
  relevant `paths/*.js` file (never imported into the route file, never wired into `validateBody`) -
  describes the observed shape for the spec without changing any live route's runtime behavior.
  Flagged as its own separate follow-up task, not bundled into this change (adding real validation
  now would be behavior-changing work needing its own verification pass, not just documentation).
- **Route-file changes**: mechanical only - added `export` to ~38 previously-module-private schema
  `const`s across `admin.js`, `analytics.js`, `auth.js`, `automation.js`, `calendarEvents.js`,
  `campaigns.js`, `contacts.js`, `conversations.js`, `settings.js`, `tasks.js`, `team.js`,
  `templates.js`, `whatsapp.js`. Zero other changes to any of these files - confirmed via the full
  test suite (135/136 green, the one failure is the pre-existing unrelated `automationEngine.e2e`
  sub_workflow delay/queue flakiness documented in "Environment gotchas" below).
- **`server/openapi/generate.js`** (new) - `buildOpenApiDocument()`, the single source of truth
  both the CLI script and the live route call, so they can't drift from each other.
- **`server/scripts/generateOpenApi.js`** (new, `npm run generate:openapi`) - writes
  `docs/openapi.json` (committed, versioned, same precedent as the existing hand-written
  `docs/API_DOCUMENTATION.md`, which now points to it at the top).
- **`server/index.js`** - `GET /api/openapi.json`, computed once at module load and served from
  memory (same "compute once, reuse" pattern `admin.js` already uses for `defaultPermissions`),
  unauthenticated like `/health`/`/metrics` since the spec only describes shapes, not real data.
- **Explicitly not built**: no Swagger UI/Redoc page shipped in the app (the raw JSON works with any
  external tool), no real validation added to the 15 gap routes (separate follow-up, see above), no
  CI drift-check step comparing a fresh generation against the committed `docs/openapi.json` (easy
  later addition, not core scope).
- **Real, unrelated finding surfaced along the way, not fixed here**: adding the new dependency and
  running `npm install` on this Windows machine reproduced the documented "npm install strips the
  Linux-only `optionalDependencies` pointer" gotcha (see "Environment gotchas" below) - caught via
  `git diff package-lock.json`, manually restored the three stripped lines
  (`@rollup/rollup-linux-x64-gnu`, `@tailwindcss/oxide-linux-x64-gnu`, `lightningcss-linux-x64-gnu`)
  before anything was committed. Separately, `npm audit` now reports one new high-severity
  vulnerability (`socket.io-parser`, from the existing `socket.io` dependency, unrelated to
  anything added this session) - flagged as its own follow-up task, not fixed here.
- **Tests**: `server/tests/openapi.unit.test.js` (new, 5 tests) - generates the document in-process,
  asserts `openapi`/`info`/`paths`/`components.securitySchemes.bearerAuth` all present,
  `JSON.stringify` succeeds end to end, and spot-checks specific paths/methods/tags/security match
  the real routes exactly (e.g. `/api/tasks/` has `get`+`post` tagged `Tasks` with `bearerAuth`
  security; `/api/auth/login` and the public webhook routes correctly have no security).
- **Verified beyond the unit tests, against a real running server**: `npm run generate:openapi`
  produced valid JSON (105 operations, 83 paths); booted the real server and confirmed
  `GET /api/openapi.json` is **byte-identical** to the committed `docs/openapi.json`
  (`JSON.stringify` equality, not just "looks similar") - proves the live route and the CLI script
  can't drift, by construction; loaded the live spec into a real Swagger UI (via CDN bundle, served
  from a throwaway page temporarily placed under `client/public/` so it ran through Vite rather than
  hitting this environment's restriction on scripts in files opened outside the project folder,
  removed immediately after) in the actual Browser pane and visually confirmed every domain/tag/
  endpoint/summary renders correctly with no console errors, before deleting the throwaway file.

## Session paused here 2026-08-15 — quick-start for whoever (or whatever fresh window) picks this up

Everything below in this section was **shipped, tested, deployed, and verified live in production
this session** — six real pieces of work, each its own commit, all pushed to `origin/main` and
confirmed on the VPS one at a time as they went out (not batched at the end):

1. **Task/Calendar viewing UI** — full CRUD for both, `tasks:read`/`tasks:write` permissions, a
   month-grid calendar. See the dedicated section below.
2. **Execution-history UI nesting** — `sub_workflow` child runs now render nested in the Run
   History panel via `$graphLookup`, independently expandable. See the dedicated section below.
3. ~~**Zod validation on the remaining 7 route files** — closes that `FUTURE_ROADMAP.md` Phase 1 item
   entirely.~~ **Correction, added later the same day**: this closed the 7 files it actually covered,
   but a later pass found ~15 routes across 5 *other* files this item never touched still had zero
   validation - see "Validation backfill on 15 gap routes" near the top of this file (in progress,
   not finished as of this correction). The item wasn't closed entirely; this entry's original claim
   was wrong. Along the way, this pass fixed a pre-existing `$text` `sanitizeFilter` bug and the
   missing `Message.body` text index that made search actually work for the first time ever.
4. **`infrastructure.js` permission gap** — all three routes were reachable by any authenticated
   user of any role; now gated behind `admin:read`/`admin:write`.
5. **AuditLog export + retention** — closes that `FUTURE_ROADMAP.md` Phase 2 item entirely.
   `GET /admin/audit-log/export`, `POST /admin/audit-log/prune`, a periodic
   `scripts/pruneAuditLogs.js`. **The VPS crontab was also updated this session** (not just the
   code) — `dashboard`'s crontab now runs it nightly at 3 AM, confirmed via a real manual run
   against production data (`sudo -u dashboard npm run prune:audit-logs` — swept "Main Workspace",
   0 deletions, correct for a fresh-enough dataset).
6. Multiple recurring `mongoose.sanitizeFilter` bugs found and fixed along the way (see "Design
   notes" and the dated sections below for each) — this pattern bit a change **four separate times**
   this session. If you touch a Mongoose filter with a `$operator` value anywhere in this codebase,
   wrap it in `mongoose.trusted(...)` on reflex, don't wait to get bitten a fifth time.

~~**What's actually paused, mid-scoping, not started:** the next `FUTURE_ROADMAP.md` Phase 2 item,
"admin-level feature flag management UI."~~ Resolved the same day — see the dedicated section below
for the implementation. The user chose the DB-backed live-toggle option over the read-only viewer.

## Admin-level feature flag management UI — implemented 2026-08-15, uncommitted

Closes `FUTURE_ROADMAP.md`'s Phase 2 "admin-level feature flag management UI" item. Picked up
exactly where this file's research (further up, now struck through) left off: `config.featureFlags`
was a load-time env singleton, only `queueProcessing`/`rabbitmqEvents` gated any real behavior, and
the user was explicitly asked which of two scopes to build. **They chose the real DB-backed
live-toggle system**, not the read-only viewer — a genuine architecture change to
`queueProcessing`'s/`rabbitmqEvents`'s call sites, not just a UI.

- **`server/models/FeatureFlag.js`** (new) — one doc per overridden flag key
  (`{key, enabled, updatedByUserId, updatedByEmail, timestamps}`), absence of a doc means "use the
  env default." Deliberately global, not workspace-scoped, matching `config.featureFlags`'s existing
  process-wide semantics rather than silently turning a deployment-wide switch into a per-tenant one.
- **`server/services/featureFlags.js`** rewritten in place (not a parallel module — this file was
  already the sole consumer-facing API, and the old `isFeatureEnabled` export was dead code, never
  called anywhere). Now: `FEATURE_FLAG_DEFINITIONS` (label/description/envVar/`gatesRealBehavior`
  per flag, `gatesRealBehavior: true` only for `queueProcessing`/`rabbitmqEvents` — this is what lets
  the admin UI honestly badge the other 3 as having no current effect instead of pretending they do
  something), a module-level in-memory `cachedFlags` cache (seeded synchronously from
  `config.featureFlags` at import time so `getFlagSync()` always has a value even before the DB load
  below resolves), `loadFeatureFlagsFromDb()`, `getFlagSync(key)` (sync, no DB round trip — what the
  hot paths call), `setFeatureFlagOverride`/`clearFeatureFlagOverride` (upsert/delete +
  cache update + a runtime side-effect hook), `listFeatureFlagsWithMeta()` (the admin-UI read model).
  **The old per-workspace Redis TTL cache is gone** — it never actually varied by workspace (same
  static values under N different keys), so the new in-memory cache with real invalidation replaces
  it outright rather than living alongside it. `getFeatureFlags(workspaceId)` keeps its old signature
  for `infrastructure.js`'s `GET /status` (unchanged caller), just backed by the new cache.
- **`queueProcessing` is live by construction** — `jobs.js`'s `connectionOptions()` and
  `automationExecutors.js`'s `queueProcessingAvailable()` already re-checked the flag on every call
  (per-job-enqueue, per-delay-node-execution); swapping `config.featureFlags.queueProcessing` for
  `getFlagSync("queueProcessing")` in both was the entire change needed for a toggle to take effect
  immediately, no restart.
- **`rabbitmqEvents` needed real work to become live** — `messageBus.js`'s `connectRabbitMQ()` was
  previously called exactly once, at boot; there was no code path to connect or disconnect later.
  Added `disconnectRabbitMQ()` (closes the channel/connection, safe no-op if already disconnected)
  and a `setFeatureFlagOverride`/`clearFeatureFlagOverride` side-effect hook
  (`applyRuntimeSideEffects`) that calls `connectRabbitMQ()`/`disconnectRabbitMQ()` live whenever
  this specific flag flips. Verified manually: toggling it on with no broker configured in the local
  dev env exercises `connectRabbitMQ()`'s existing graceful-failure path
  (`status: "unavailable"` on connect error) without crashing anything — didn't need a real broker to
  prove the wiring works.
- **New circular import, same accepted shape as the two that already exist** (`jobs.js` ↔
  `automationEngine.js`, `automationExecutors.js` ↔ `automationEngine.js`): `featureFlags.js` ↔
  `messageBus.js`. Safe for the same reason as the other two — every cross-call happens inside a
  function body, never at module-eval time (`messageBus.js`'s functions are hoisted `function`
  declarations, so importing them mid-evaluation from `featureFlags.js` works even before
  `messageBus.js` finishes its own top-level execution).
- **`server/index.js`** — `await loadFeatureFlagsFromDb()` inserted right after `connectDatabase()`
  resolves, before `connectRedis()`/`connectRabbitMQ()`/`startWorkers()`, so any stored override is
  already in the cache before those three boot-time calls read a flag.
- **`server/routes/admin.js`** — `GET /feature-flags` (`admin:read`), `PUT /feature-flags/:key`
  (`admin:write`, `{enabled: boolean}` body, 404 on an unknown key), `DELETE /feature-flags/:key`
  (`admin:write`, same 404 guard, reverts to env default). Reuses the existing `admin:read`/
  `admin:write` permissions rather than inventing a new pair — same choice `infrastructure.js`
  already made for its own process-wide ops routes, no RBAC migration needed.
- **Client** — `getFeatureFlagsAdmin`/`updateFeatureFlag`/`resetFeatureFlag` in `lib/api.ts`; a new
  "Feature Flags" tab in `AdminView.tsx` (own independent fetch/state, not folded into the big
  `/admin/overview` payload — matches the Logs tab's separate-fetch precedent). Each flag renders as
  a row with a "Live"/"No current effect" badge (from `gatesRealBehavior`, so the UI never implies
  the 3 decorative flags do something they don't), an On/Off badge, a Default/Override source badge
  with last-changed-by/when when overridden, a toggle button, and a Reset button shown only when
  overridden.
- **Not built, deliberately** — no new gating behavior for the 3 decorative flags
  (`s3MediaStorage`/`infrastructurePanel`/`zeroDowntimeMode`), no per-workspace flag scoping, no
  multi-instance cache invalidation (Redis pub/sub or similar) — this VPS runs a single PM2 process
  for `dashboard-api`, so an in-memory cache reloaded at boot plus updated on every toggle is
  sufficient; revisit only if this app ever runs more than one API instance.
- **Tests**: `server/tests/featureFlags.unit.test.js` (new, no DB connection — env-default fallback,
  DB-down no-op, unknown-key rejection). `server/tests/adminFeatureFlags.e2e.test.js` (new, real
  Mongo — fresh-DB defaults, PUT→override→GET reflects it→DELETE reverts with correct
  `source`/`effective`/`updatedByEmail`, `rabbitmqEvents` toggle doesn't crash without a broker,
  unknown key 404s on both PUT and DELETE, a seeded viewer-role user gets 403 on both read and
  write). All 5 pass cleanly run in isolation; hit this environment's now-familiar
  server-spawn flakiness (see "Environment gotchas") when run as part of the full `npm test` -
  confirmed environmental, not a code issue, by re-running the file alone twice, clean both times,
  and by every other pre-existing server-spawning e2e file (`criticalPath.e2e.test.js`,
  `automationEngine.e2e.test.js`'s sub_workflow test) failing the same way in that same full-suite
  run despite being untouched by this change. Full non-spawning unit suite (102 tests across every
  `*.unit.test.js`/`.test.js` file that doesn't spawn a server, including the 4 new
  `featureFlags.unit.test.js` tests) green.
- **Verified manually beyond the automated tests, against a real running local server + browser**:
  logged in as `admin@test.com`, opened Admin → Feature Flags, confirmed all 5 flags render with
  correct env defaults and honest live/decorative badges; toggled `queueProcessing` off/on and
  `rabbitmqEvents` on/off via direct authenticated HTTP calls (`PUT`/`DELETE`), confirming
  persistence and the `rabbitmqEvents` connect/disconnect side-effect fires without crashing;
  restarted the real server process against the same test DB with an override already stored and
  confirmed it survived and applied before `connectRabbitMQ()`'s boot-time call - proving DB
  persistence, not just in-memory state; confirmed `GET /api/infrastructure/status` still returns
  the same flag shape unchanged; then, in the actual browser UI, clicked "Turn on" on a flag,
  watched it flip to On/Override/Reset with the correct "last changed by" line with no page reload,
  clicked Reset, watched it cleanly revert to Off/Default - no console errors either time.
  `npx tsc --noEmit` clean on the client.

## AuditLog export + retention — implemented 2026-08-15

Closed `FUTURE_ROADMAP.md`'s Phase 2 "data retention jobs and audit export" item. `AuditLog` already
recorded real data (`server/models/AuditLog.js`), but the only consumer was a `find().limit(80)`
list in `admin.js`'s `GET /overview` that drops most fields, and
`Workspace.settings.security.dataRetentionDays` — already settable via the Admin UI, already
validated by `adminSettingsSchema` — was purely decorative: nothing anywhere read it to actually
delete anything.

- **`server/utils/csv.js`** (new) — `jsonCsv()` extracted out of `analytics.js`, generalized with an
  optional explicit `headers` param (needed for a zero-row export, where columns can't be inferred
  from `rows[0]`). Backward compatible by construction: omit `headers` and behavior is identical to
  before, including the old hardcoded empty-state fallback - both existing `analytics.js` export
  routes were re-verified working unchanged after the extraction.
- **`server/services/auditLogRetention.js`** (new) — `pruneAuditLogs({workspaceId})`, one workspace
  or every workspace, reads `dataRetentionDays` (default 365) per workspace, deletes `AuditLog` docs
  older than that cutoff. Shared by both entry points below so the deletion logic exists exactly once.
- **`server/routes/admin.js`** — `GET /audit-log/export` (`admin:read`, optional `from`/`to` range) —
  a real CSV, deliberately richer than `GET /overview`'s 5-field list (actor name/email via populate,
  IP, user-agent, full `before`/`after` JSON) — and `POST /audit-log/prune` (`admin:write`), the
  on-demand trigger.
- **`server/scripts/pruneAuditLogs.js`** (new) — same shape as `seed.js`/`connect-whatsapp.js`,
  sweeps every workspace. `npm run prune:audit-logs`. **Not done: no crontab entry added anywhere**
  to actually run this periodically - a production cron change, deliberately left for the user to
  add via the hPanel terminal, same as `deploy-vps.sh`'s own schedule.
- **`client/src/app/lib/download.ts`** (new) — `downloadFromUrl(url, filename)` extracted out of
  `AnalyticsView.tsx`'s local copy (a real authenticated `fetch()` + blob download, not a plain
  `<a href>`, since these routes sit behind `requireAuth`), now shared with the new Admin "Logs" tab
  Export/Prune buttons.
- **Two real bugs found and fixed in my own test, not the code, during verification:**
  `seedTestWorkspace()` disconnects Mongoose's global connection internally, so a raw `insertMany`
  right after it failed until reconnected explicitly. Then an assertion itself was wrong, not the
  code under test - asserting exactly one `AuditLog` document would remain after pruning missed that
  the audit *middleware* logs the test's own `PUT /settings` and `POST /prune` calls too; fixed to
  check specific document IDs instead of a total count.
- **Verified live, not just via tests**: real CSV export with correctly-escaped embedded JSON, a
  malformed date query correctly rejected with 400, a real prune run, and both new buttons clicked
  through the actual browser UI with the Audit Trail list refreshing automatically afterward.
  `server/tests/auditLogRetention.e2e.test.js` (new) passes; full suite (100 tests) green.

## `Message.body` text index — implemented 2026-08-15

Closed the deliberately-held-back item from the validation pass below: added
`messageSchema.index({ workspaceId: 1, body: "text" })` to `server/models/Message.js`, so
`assistant.js`'s `GET /search` `$text` query actually returns matches instead of always hitting the
empty-index-path silently (well, post the `sanitizeFilter` fix, an actual "no text index" Mongo
error). Leading `workspaceId` isn't just habit - the route's filter always includes it alongside
`$text`, and MongoDB supports one text field in a compound index alongside regular equality fields,
so this lets the same index serve both the workspace scoping and the text search together.

- **No migration script needed, and none was run.** Mongoose's default `autoIndex: true` (no
  override anywhere in `server/db.js`/`config.js`) builds indexes automatically at connection time -
  confirmed locally by listing `messages` collection indexes right after a fresh `node index.js`
  start and seeing `workspaceId_1_body_text` already present, with zero explicit index-build step.
  **This means the next production deploy's PM2 restart will build this index against the live
  `Message` collection automatically**, the same way every other index in this file already works.
  Modern MongoDB (WiredTiger, this stack's target) builds indexes without holding a
  collection-wide lock, so the app keeps serving traffic during the build, but the build itself
  consumes real I/O proportional to production's actual message volume - worth a glance at
  `dashboard-api` CPU/logs right after the next deploy, not a get-in-and-out five-minute check like
  the others in this file, if the `Message` collection turns out to have serious volume.
- **Verified with real data end to end, not just "index exists":** created a real WhatsApp account,
  sent a real inbound webhook with the body "I need help with pricing for the enterprise plan",
  confirmed `GET /search?q=pricing` returns that exact message and `GET /search?q=nonexistentxyz`
  returns an empty array - proves the text index isn't just present but actually being matched
  against. Cleaned up the test account/contact/conversation/message afterward.
- Full non-spawning suite (98 tests) still green.

## Zod validation on the remaining route files — implemented 2026-08-15

> **Correction added later the same day**: despite this section's original framing, this did not
> close `FUTURE_ROADMAP.md`'s "Add Zod/Joi validation to all routes" item entirely - it closed the
> 7 files listed below, but ~15 routes across `team.js`/`templates.js`/`whatsapp.js`/`campaigns.js`/
> `conversations.js` (never touched by this pass) still had zero validation. See "Validation
> backfill on 15 gap routes" near the top of this file for that follow-up (in progress, not
> finished as of this correction).

Picked up `docs/FUTURE_ROADMAP.md`'s Phase 1 "Add Zod/Joi validation to all routes" item (a separate,
much broader wishlist than the automation-engine plan above — see that file for the other 4 phases,
all still untouched). Coverage was ~63% before this session (12 of 19 route files already used
`validateBody`/`validateQuery` from `server/middleware/validate.js`); the 7 gap files were
`admin.js`, `assistant.js`, `dashboard.js`, `infrastructure.js`, `legal.js`, `media.js`,
`workspace.js`. Investigation found the real scope smaller than "7 files": several of them read no
client input at all.

- **Added schemas to `admin.js`** (`PUT /settings` only — `GET /overview` reads no input),
  `assistant.js` (`/analyze`, `/stream`, `/search` query, `/knowledge`, `/voice/transcribe`,
  `/voice/reply`, `/tool-call` — `GET /overview` reads no input), `media.js` (`POST /upload`), and
  `workspace.js` (`POST /`, `PUT /current` — `GET /current` reads no input). Genuinely dynamic
  shapes (`admin.js`'s `webhooks`/`departments`/`teams`/`billing`, `assistant.js`'s `tool-call`
  `arguments`) use `z.record(z.unknown())` rather than an invented strict shape nothing else
  enforces — same reasoning this codebase already uses for automation node `config`.
- **No changes to `dashboard.js`, `legal.js`, `infrastructure.js`** — confirmed none of them read
  `req.body`/`req.query` anywhere, so a schema would be a no-op.
- ~~**Separate, unrelated `infrastructure.js` permission gap**~~ — fixed later the same day: all
  three routes (`GET /status`, `POST /jobs/test`, `POST /events/test`) had no `requirePermission`
  call at all, so any authenticated user of any role could read internal health/queue/feature-flag
  details and trigger a real test job/event. Gated with the existing `admin:read`/`admin:write`
  rather than inventing a dedicated `infrastructure:*` pair, since no client UI calls this router at
  all - it's a backend-only ops/diagnostics surface. **Verified with a real access-control check, not
  just code review:** created a temporary viewer-role user via the live API, confirmed all three
  routes now return `403` for it while the admin token still gets `200`, then deleted the test user.
- **Real bug found and fixed here, not test-only — but pre-existing, not introduced by this
  session:** `assistant.js`'s `GET /search` had an unwrapped `$text` operator
  (`messageFilter.$text = { $search: query }`) hitting the same `mongoose.sanitizeFilter`
  restriction documented further down this file - the *fourth* time this exact pattern has bitten a
  change in this codebase this week. Confirmed by reading Mongoose's actual
  `sanitizeFilter.js`/`trusted.js` source that `mongoose.trusted(...)` bypasses the check (the
  trusted-symbol check runs before the forbidden-key check per top-level key), fixed the same way as
  every other instance.
- ~~**Found but NOT fixed, flagged for a deliberate follow-up**~~ — fixed later the same day, see
  the dedicated section near the top of this file. `Message.body` had no MongoDB text index, so
  `$text` search had never actually worked in this codebase, in any environment, ever.
- **Tests**: new `server/tests/routeValidation.unit.test.js` (fast, no DB/server, matches
  `rbac.test.js`'s style) - each new schema exported from its route file, one `safeParse` assertion
  per schema that a minimal valid payload succeeds with the right defaults, one that a clearly
  invalid payload fails. Full non-spawning suite (98 tests) green.
- **Verified manually against a real running server, not just unit-tested schemas in isolation**:
  admin settings save via an actual UI click, assistant analyze (UI click) plus search/knowledge/
  tool-call (direct authenticated fetch), media upload, workspace update - each confirmed valid
  requests succeed unchanged and malformed ones get a clear 400, both before and after the `$text`
  fix.

## Execution-history UI nesting — implemented 2026-08-15

Closed the last remaining item from the automation-engine plan: `sub_workflow` child runs were
always correctly linked via `parentRunId` (the model comment on `server/models/AutomationRun.js`
has said "lets the Run History UI eventually show nesting" since Phase 2), but neither the API nor
the UI ever exposed it. Investigation found the gap was two layers, not one: `serializeAutomationRun`
didn't include `parentRunId` at all, and `GET /:id/runs` was scoped to a single `flowId` — a
`sub_workflow` child run's `flowId` is the *called* flow's id, not the caller's, so the parent
flow's own Run History panel structurally couldn't see the child run in the first place, nested or
not.

- **`server/routes/automation.js`** — `GET /:id/runs` now uses a `$graphLookup` aggregation
  (`from: "automationruns", connectFromField: "_id", connectToField: "parentRunId"`) to attach each
  top-level run's full descendant set (any depth, any flow), `maxDepth: 4` matching
  `MAX_SUB_WORKFLOW_DEPTH`'s 5-level call-chain cap. A small `nestDescendants()` helper turns
  `$graphLookup`'s flat per-run array into a real tree server-side, so the client just renders what
  it's given. `serializeAutomationRun` gained `parentRunId`, `flowName` (via one batched
  `AutomationFlow.find` across every flowId seen), and recursive `children`. **No filtering change**
  to the existing top-level list — a run that's itself a child of another flow's run still appears
  exactly as before; nesting only adds `children` under entries that have any.
- **`client/src/app/components/AutomationView.tsx`** — extracted the run card into a recursive
  `RunHistoryEntry` component so `children` renders nested/indented with a
  `sub_workflow → {flowName}` badge. **Upgraded `expandedRunId` (single string) to
  `expandedRunIds` (a `Set`)** — with a flat list only one run ever needed to be open at a time, but
  nesting a child under an already-expanded parent while only one thing in the whole tree can be
  open defeats the point; verified in the real browser UI that parent and child now expand
  independently.
- **Real bug found and fixed here, not test-only:** the new flow-name lookup
  (`AutomationFlow.find({ _id: { $in: [...] } })`) hit the exact same `mongoose.sanitizeFilter`
  gotcha documented lower in this file — an unwrapped `$in` on a brand-new flow with zero runs
  (empty `flowIds` set) produced a `CastError` → 500. **This is the third time this specific pattern
  has bitten a change in this codebase this week** (Task/Calendar's calendar-range filter was the
  second) — worth internalizing: *any* `{ field: { $operator: ... } }` value in a Mongoose filter
  needs `mongoose.trusted(...)`, full stop, no exceptions for "this one's probably fine." Fixed the
  same way as before.
- **Tests**: extended the existing `automationEngine.e2e.test.js` sub_workflow test (which already
  proved `parentRunId`/`chain` correctness at the DB level) with an API-level assertion — calls
  `GET /:parentFlowId/runs` and confirms the child run comes back nested in `children[]` with the
  right `flowName`/`status`. This closes the exact gap flagged during scoping: the test only ever
  proved DB state, never the API contract.
- **Verification note**: this environment's server-spawning e2e tests need real BullMQ/Redis queue
  processing for delay-dependent paths (the false-branch delay test, the loop test, and this
  sub_workflow test's own message-wait all hit that pre-existing limitation, unrelated to this
  change - see "Environment gotchas" below). Confirmed the change itself is correct via the one test
  that directly covers it (`GET /api/automation/:id/runs returns the run history for the flow`,
  passes clean) plus manual verification: created a real parent+child sub_workflow flow through the
  actual dashboard UI, ran it, confirmed the child nests under the parent with the right flow-name
  badge, and confirmed both can be expanded at once.

## Task/Calendar viewing UI — implemented 2026-08-15

Closed out the last concretely-deferred item from `docs/AUTOMATION_ENGINE_PLAN.md`'s Phase 2+
sketch: `Task`/`CalendarEvent` records existed and were written for real by the automation engine's
`task`/`calendar` nodes, but there was no way to browse, create, edit, or complete them. Scoped with
the user first (single "Tasks" nav item with two tabs, not two separate nav entries; full manual
create/edit/delete, not read-only; a real month-grid calendar, not a flat agenda list).

- **New permissions** `tasks:read`/`tasks:write` in `server/utils/rbac.js` — same split as
  `contacts:*` (manager/agent get both, viewer read-only). Added to `permissionCatalog` and the role
  arrays only; **no production migration was run**, so existing non-admin workspace members won't
  see the page until a future reseed/migration. Admin/super_admin see it immediately (wildcard `"*"`).
- **New `server/routes/tasks.js` / `server/routes/calendarEvents.js`** — full CRUD, mirroring
  `contacts.js`/`team.js`'s structure exactly (Zod schemas, `requirePermission`, workspace-scoped
  queries, `.populate("assignedToUserId", "name")`). Mounted at `/api/tasks` and
  `/api/calendar-events` in `server/index.js`. Calendar events support a `from`/`to` range query
  for the month grid.
- **New `client/src/app/components/TasksView.tsx`** — one file, following `ContactsView.tsx`'s
  established visual/structural language (header stat cards, fixed-overlay create/edit forms, mobile
  card list + desktop table, no delete-confirmation dialog — matches `ContactsView`'s own
  `deleteContact`, which has none either). Hand-rolled tab state, not the unused `ui/tabs.tsx`
  primitive — this app has an established habit of hand-rolling tabs/tables/selects instead of the
  shadcn scaffold (`ui/tabs.tsx`, `ui/table.tsx`, `ui/select.tsx`, `ui/alert-dialog.tsx` are all
  present but unused anywhere in the app), so this stays consistent rather than diverging. Calendar
  tab is a real month grid built with `date-fns` (already a project dependency, previously unused —
  no new package needed).
- **Real bug found and fixed here, not test-only:** the calendar route's `from`/`to` range filter
  set `filter.startAt = { $lte: new Date(...) }` — an unwrapped `$lte` operator, exactly the
  `mongoose.sanitizeFilter` gotcha already documented lower in this file (unwrapped `$operator`
  values get silently neutered, producing a `CastError` → 500). Missed on first pass, caught by the
  new e2e test itself, fixed with `mongoose.trusted(...)` like every other query in this codebase
  that needs one.
- **Also found and fixed:** `server/tests/helpers/seedTestWorkspace.js` hardcoded the same email and
  workspace slug on every call, so a test proving workspace-scoping (which needs two seeded
  workspaces in one database) would hit a duplicate-key error on the second call. Fixed by
  suffixing both with a unique per-call token — backward compatible, every existing caller reads
  `seed.email` from the return value rather than hardcoding the old string.
- **Tests**: `server/tests/rbac.test.js` extended for the new permissions; new
  `server/tests/tasksCalendar.e2e.test.js` covers create/list/patch/delete for both routes, the
  calendar range filter, and workspace scoping. Full non-spawning unit suite (90 tests) still green;
  the server-spawning e2e/integration files hit this environment's already-documented flakiness below
  (unrelated to this change — confirmed by running the new e2e file alone, which passes clean).
- **Verified manually in the actual dashboard UI** (logged in as `admin@test.com`): created,
  completed, and deleted a task; created, edited (pre-fill correct), and deleted a calendar event;
  confirmed month navigation refetches the right range. Caught and fixed one more issue this way — a
  React duplicate-key warning in the task table's header row (two columns both used `key={column}`
  with the same empty-string label).
- **Not done**: no production permission migration (see above); no viewer-role write-gating smoke
  test (the `canWrite` gating mirrors `ContactsView`'s already-proven pattern exactly, so this was
  judged low-risk and skipped rather than seeding a separate viewer test user for it).

## Session paused here 2026-08-03 — quick-start for whoever picks this up next

Both items below (`code_block` and `task`/`calendar`) are **committed, pushed to `origin/main`, and
confirmed deployed to production** — verified via the VPS's `.last-deploy-sha` matching `HEAD`, a
clean `deploy complete` line in `deploy.log`, `pm2 status` showing `dashboard-api` online, and
`https://dashboard.nemnidhi.com/health` returning `200 OK`. Nothing is mid-flight; this is a clean
stopping point, not an interrupted one.

**What's actually left (nothing more, nothing less):**
1. ~~**Execution-history UI nesting**~~ — done 2026-08-15, see the section near the top of this file.
2. ~~**Task/Calendar viewing UI**~~ — done 2026-08-15, see the section near the top of this file.
3. ~~`docs/SCREEN_RECORDING_SCRIPT.md` / `.claude/launch.json`~~ — both committed 2026-08-15.

**Everything this project has ever tracked as deferred is now done.** Phase 1 and all 7 Phase 2
features were complete before this session; this session closed out the two remaining deferred
items (`code_block`, `task`/`calendar`) end to end - implemented, tested, manually verified, and
confirmed live in production.

## Meta App Review — approved 2026-08-13

Submission reviewed and **approved** by Meta (submitted/decided same day, per the developer
dashboard's App Review > Previous submissions). Two permissions now live on the app, not just
sandbox-mode:

- `whatsapp_business_messaging` — **Approved**
- `whatsapp_business_management` — **Approved**

This unblocks the Meta-provider path in `whatsappProvider.js`/`whatsapp.js` for real (non-test)
WhatsApp Business accounts beyond the developer's own sandbox numbers - previously any
non-admin/non-tester phone number would have been rejected by Meta regardless of app config. No
code change needed on this repo's side; this is a Meta-side app-config unlock, not a deploy.
Nothing in this codebase currently branches on review status, so no follow-up here beyond knowing
real customer WhatsApp numbers can now be onboarded.

## `task`/`calendar` nodes — implemented 2026-08-03, models + executors only (no viewing UI yet)

Picked up the other deliberately-deferred Phase 2 item. Scope was explicitly narrowed with the
user first: **models + executors only**, no dedicated page to browse created tasks/events this
pass - every other Phase 2 node writes to something with an existing UI surface (tags/CRM stage
show on the CRM board, assignee shows on the conversation); `task`/`calendar` are the first ones
writing to brand-new data with nowhere to view it yet. Confirmed via research (no existing
Task/Calendar/Event/Reminder concept anywhere in the codebase - closest analog was `Lead.followUpAt`,
a bare timestamp, not a task object) before designing anything from scratch.

- **`server/models/Task.js`** / **`server/models/CalendarEvent.js`** - new Mongoose models,
  following house schema conventions from `Lead.js`/`Contact.js`: `organizationId`+`workspaceId`
  (required, indexed, paired), `contactId`/`conversationId` (optional refs, the standard
  dual-link pattern), `assignedToUserId` (mirrors `Conversation.assignedToUserId`'s "assign to a
  team member" convention, not `ownerUserId`'s "record ownership" one), `{ timestamps: true }`.
  Task adds `status` (`open`/`completed`) and `dueAt`; CalendarEvent adds `startAt`/`endAt`. Named
  `CalendarEvent` not `Calendar` - it's an event *within* a calendar, and every other model name in
  this codebase is the record type, not its container.
- **`execTask`/`execCalendar` in `automationExecutors.js`** - config reuses `delay`'s existing
  `{duration, unit}` shape for a **relative** offset ("due in 2 days" / "starts in 3 hours") rather
  than an absolute date, computed at execution time via a new `relativeOffsetMs()` helper built on
  the same `delayUnitMs` map `execDelay` already defines - a flow author designs the node before
  knowing when it'll actually run, so only a relative offset makes sense at design time. Calendar
  adds a plain `lengthMinutes` field (default 30) for `endAt`, not a second duration/unit pair -
  event lengths are almost always sub-day, a unit dropdown would be overkill. Both auto-link
  `contactId`/`conversationId` from `env` (same as `execEmail`/`execSms`, no per-node override) and
  accept an optional `userId` in config for `assignedToUserId` (validated via
  `mongoose.Types.ObjectId.isValid`, silently null if absent/invalid - no team-member picker UI,
  see below). Skip (not fail) on empty title, matching every other Phase 2 node's empty-input
  convention.
- **Client**: dedicated inspector form (title/description/duration+unit/optional userId,
  calendar adds length-in-minutes) - mirrors `delay`'s existing duration+unit UI exactly, reusing
  the same `<select>` options. The `userId` field is a **plain text input, not a team-member
  dropdown** - deliberately minimal since `assign_user` (the existing, older node) has the exact
  same gap already (no picker UI at all, `config.userId` isn't even one of the generic form's 7
  fields, so it's currently unsettable from the UI) - not fixing that pre-existing gap here, out of
  scope for this pass.
- **Tests**: no unit tests - matches this codebase's established precedent that DB-writing
  executors (`execAssignUser`, `makeCrmExecutor`, `execGoogleSheets`, `execCallWebhook`) are never
  unit-tested, only covered at the e2e level. Added a real e2e scenario to
  `automationEngine.e2e.test.js` (trigger -> task -> calendar -> send_message, asserting real
  `Task`/`CalendarEvent` documents exist with correct `dueAt`/`startAt`/`endAt` math and
  `contactId`/`conversationId` linkage). Hit this session's now-familiar sandbox flakiness (server
  spawn from `node:test` times out - see "Environment gotchas"); verified manually instead via a
  directly-booted server + real HTTP requests + direct Mongo queries against the created documents,
  same fallback used for `code_block`. Full non-spawning suite (89 tests across the whole server)
  still green.

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
- **Native dependency risk — resolved, verified on production.** `isolated-vm` is a native addon
  (compiles via node-gyp). Confirmed installing/running cleanly on the dev machine (Windows, Node
  24) first. Pushed as `42bea1e`; the VPS cron deploy at `2026-08-03T02:50:04Z` picked it up,
  detected `package-lock.json`/`server/package.json` changed, ran `npm install` (no manual
  intervention, no extra build tooling installed), then `npm run build` and a PM2 restart, all
  logged as `deploy complete (42bea1e...)` in `deploy.log` — proof `npm install` didn't fail,
  since `deploy-vps.sh` runs with `set -euo pipefail` and would have stopped (and left
  `.last-deploy-sha` on the previous commit) if it had. Confirmed `.last-deploy-sha` reads
  `42bea1e028ae3036cac35cc78465d5beafd7d27a` and the PM2 process `dashboard-api` (run
  `sudo -u dashboard pm2 status` to see it - see the PM2-per-user gotcha in "Environment gotchas"
  below if you check this as root and don't see it) is `online` with 0 restarts, meaning
  `codeSandbox.js`'s `import ivm from "isolated-vm"` loaded cleanly at boot, not just locally.
  `https://dashboard.nemnidhi.com/health` returns `200 OK`. No further action needed on this.

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
- ~~`task`/`calendar`~~ — models + executors done, see the section above this one. Still no
  dedicated viewing UI (deliberately out of scope for that pass) - a Tasks/Calendar list view is
  the natural follow-up if this is worth surfacing beyond the automation flow itself.
- ~~Execution-history UI doesn't yet show `parentRunId` nesting~~ — done 2026-08-15, see the
  section near the top of this file.

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
- **Vite binds only to IPv6 loopback (`[::1]`) on this machine, not `127.0.0.1`** — a plain
  `curl http://127.0.0.1:5173` (or any tool hitting the IPv4 literal) gets connection-refused even
  though the dev server is genuinely up; use `http://localhost:5173` or `http://[::1]:5173`
  instead. The API server (`node index.js`) doesn't have this problem — it binds `0.0.0.0`/`[::]`,
  both families. If `npm run dev` reports "Port 5173 is in use" and falls back to 5174 (e.g. a
  stray process from an earlier session still holding 5173 - `netstat -ano | grep LISTEN` to find
  and kill it), **the browser's `Origin` header won't match `config.corsOrigins`'s hardcoded
  `http://localhost:5173` allowlist entry**, and every API call fails with a CORS preflight error
  ("Failed to fetch" in the UI, `blocked by CORS policy` in the console) - not a code bug, just
  needs the stray process cleared so Vite lands back on 5173.
- **The browser automation tool's simulated `computer` clicks (and screenshots) silently don't land
  in this sandbox** - `read_page`/`get_page_text` (DOM-based) work fine, but a `computer.left_click`
  on a real button can do nothing at all with no error, and `computer.screenshot` reliably times out
  with "the Browser pane is not displayed." Verified this isn't a page/app bug - a login submit
  button that a simulated click didn't trigger fired immediately via
  `document.querySelector('form').requestSubmit()` and via `element.click()` through
  `javascript_tool`. **If a browser-tool click seems to do nothing, don't assume the UI is broken -
  drive it with `javascript_tool` (`requestSubmit()`, `.click()` on a matched element, etc.) instead
  and re-check with `get_page_text`/`read_console_messages`.**

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

Standard check sequence on the VPS (run as the `dashboard` user - see the PM2-per-user gotcha
right below for why this matters):
```bash
cd /opt/dashboard-whatsapp && cat .last-deploy-sha && git log -1 --oneline
sudo -u dashboard pm2 status
sudo -u dashboard pm2 logs dashboard-api --lines 50 --nostream
```

**PM2-per-user gotcha found this session, silent-failure trap:** PM2 runs a separate daemon per
Linux user - `sudo -u dashboard pm2 status` and plain `pm2 status` as `root` show **completely
different process lists**, and neither errors when the process you're looking for isn't in the
list you happened to query. Running `pm2 status`/`pm2 describe dashboard-api` as `root` doesn't
fail or say "not found" - it silently shows *root's own* PM2 processes instead, which on this VPS
includes an **unrelated app also hosted here**, `nemnidhi-backend`
(`/var/www/samvid-os/backend/src/server.js`, nothing to do with this project - do not restart,
rename, or otherwise touch it). Mistaking that for this app's process cost real time and nearly
led to an unnecessary "fix" (renaming an unrelated production process) before the mismatch was
traced to the wrong Linux user rather than an actual naming problem. **Always check as
`sudo -u dashboard pm2 ...`**, never plain `pm2 ...` as root, when looking at this app's process.

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
