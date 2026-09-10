#!/bin/bash
# Polls origin/main for new commits and deploys them if found. Meant to run on a schedule
# (cron) as the same user that owns the checkout and its PM2 process, e.g.:
#
#   */5 * * * * /home/dashboard/dashboard-whatsapp/scripts/deploy-vps.sh >> /home/dashboard/dashboard-whatsapp/deploy-cron.log 2>&1
#
# This path was previously /opt/dashboard-whatsapp - that directory was deleted at some point
# without the crontab being updated, so the cron silently failed every 5 minutes for over a week
# (found and fixed 2026-09-04, see HANDOFF.md's "auto-deploy cron is BROKEN" entry). The real live
# app has always run from /home/dashboard/dashboard-whatsapp - point the cron there.
#
# Log files live inside this checkout, not in a separate root-owned directory - the deploy user
# typically only owns its own home directory, so writes straight to another path can fail silently.
#
# Tracks the last successfully deployed commit in .last-deploy-sha (gitignored) rather than
# just comparing against git's HEAD, so a failed deploy (bad build, etc.) is retried on the
# next run instead of silently being treated as "done" just because `git pull` already moved
# HEAD forward.

set -euo pipefail
cd "$(dirname "$0")/.."

# Refuse to run as root, BEFORE touching any file. Running a deploy as root is what has repeatedly
# broken this pipeline: root's `npm run build` rewrites client/dist/assets as root:root, and the
# next cron tick - which runs as `dashboard` - then dies with
# "EACCES, Permission denied: client/dist/assets" inside vite's emptyDir, aborting under `set -e`
# before it ever reaches `pm2 restart`. That fails silently, someone deploys by hand as root to
# recover, and the cycle repeats. Confirmed as the real cause of the 2026-09-11 stale-server
# incident, and almost certainly the unexplained "something keeps writing to this repo as root"
# behind the 2026-09-04 and 2026-09-06 incidents too.
#
# This check sits above the lock file and the log write on purpose - as root, both of those would
# themselves be created root-owned and poison the next run.
if [ "$(id -u)" -eq 0 ]; then
  cat >&2 <<'ROOTMSG'
deploy-vps.sh: refusing to run as root.

Running as root leaves client/dist and .git owned by root:root, which breaks every
subsequent cron deploy (they run as `dashboard`) with EACCES during the client build.

Run it as the deploy user instead:

  sudo -u dashboard /home/dashboard/dashboard-whatsapp/scripts/deploy-vps.sh

If a previous root run already broke ownership, repair it first:

  chown -R dashboard:dashboard /home/dashboard/dashboard-whatsapp
ROOTMSG
  exit 1
fi

MARKER=".last-deploy-sha"
RESTART_MARKER=".last-restart-sha"
LOG="$(pwd)/deploy.log"
LOCKFILE="$(pwd)/.deploy.lock"
PM2_APP=dashboard-api

# A build can take longer than the 5-minute cron interval, and this script also gets run
# manually sometimes - without a lock, an overlapping run would race the first one on the same
# git checkout/build/pm2 restart. If another instance already holds the lock, just skip this
# tick; the next one will pick up wherever things stand.
# Wait briefly rather than giving up instantly. deploy-health-check.sh shares this same lock for its
# own `git fetch`, and both scripts are on a */5 cron - so they start in the same second and the
# health check, which waits (flock -w 30), routinely wins the race. With a non-blocking flock here
# the deploy then bailed immediately, every single tick: observed 2026-09-11 as three consecutive
# "skipped: another run holds" lines while origin/main sat two commits ahead. The health check only
# holds it for a fetch (a second or two), so a short wait clears that contention entirely.
#
# 60s still preserves what the non-blocking version was for - preventing genuinely overlapping
# deploys. A real deploy holds the lock for a build far longer than 60s, so a tick that collides
# with one still gives up and lets the next tick pick things up.
exec 200>"$LOCKFILE"
flock -w 60 200 || { echo "$(date -Iseconds) skipped: another run held $LOCKFILE for >60s" >> "$LOG"; exit 0; }

# Every failure path below this point used to be completely silent. `set -e` aborts without writing
# anything, and the first log line isn't reached until after `git fetch`, so a failing fetch, a
# rejected pull, or a build that dies partway left NO trace at all - the log simply had no entry for
# that tick, indistinguishable from "nothing to deploy". That is how 2026-09-11's stale-server
# incident stayed invisible for 20+ minutes: the script was bailing early, the client bundle was
# never rebuilt, and nothing anywhere said so. Log the failure and the line it happened on.
#
# Two traps, not one: $LINENO inside an EXIT trap evaluates in the trap's own context and reports
# the trap's line, not the failure's (verified - it printed the trap's line for a failure seven
# lines below it). The ERR trap fires at the actual failing command, so capture the line there and
# only report it on the way out.
FAILED_LINE=""
trap 'FAILED_LINE=$LINENO' ERR
trap 'status=$?; if [ "$status" -ne 0 ]; then echo "$(date -Iseconds) FAILED (exit $status)${FAILED_LINE:+ at line $FAILED_LINE}" >> "$LOG"; fi' EXIT

git fetch origin main --quiet
REMOTE_SHA=$(git rev-parse origin/main)
LAST_DEPLOYED=$(cat "$MARKER" 2>/dev/null || echo "")

if [ "$LAST_DEPLOYED" = "$REMOTE_SHA" ]; then
  exit 0
fi

echo "$(date -Iseconds) deploying $REMOTE_SHA (last deployed: ${LAST_DEPLOYED:-none})" >> "$LOG"

# npm install regenerates package-lock.json slightly differently on this box than what's
# committed - always discard that before pulling so it never blocks a fast-forward.
git checkout -- package-lock.json 2>/dev/null || true

# --- work out what actually changed, and therefore what actually needs doing -------------------
#
# Only two things on this box consume this repo: nginx serves the built client bundle out of
# client/dist, and PM2 runs the server from server/. Nothing else here is executed on the VPS.
# So a commit that touches neither needs no build and no restart - and doing them anyway is NOT
# free: this is a shared single-vCPU host where a full client build genuinely starves everything
# else on it, and the pm2 restart drops in-flight requests. On 2026-09-11 a commit that touched
# ONLY HANDOFF.md caused a real outage window - nginx returned 502 on
# /api/instagram/accounts/:id/send and the /api/events SSE stream died with
# ERR_HTTP2_PROTOCOL_ERROR - purely for a documentation change.
#
# Diffed against $LAST_DEPLOYED (the last commit this script itself fully finished deploying -
# pull+build+restart+marker all succeeded), NOT against HEAD. HEAD can already equal $REMOTE_SHA
# without this script ever having restarted the process for it - e.g. someone manually ran `git
# pull` outside this script (a real incident, 2026-09-06: a stuck cron pull was fixed by hand,
# HEAD collapsed to match origin, and the next run of this exact script diffed HEAD..REMOTE_SHA as
# empty and silently skipped `pm2 restart` even though the running process was still hours stale).
# Diffing against the marker instead means "what changed since we last KNOW we restarted for it",
# which stays correct regardless of how HEAD got to its current position.
#
# Every way of NOT getting a trustworthy diff falls back to a full build+restart. Skipping work we
# actually needed means serving stale code indefinitely; doing work we didn't need costs one
# wasted build. Those failure modes are not symmetric, so no error path may reach the "nothing
# changed, do nothing" branch. That is also why the old `${LAST_DEPLOYED:-HEAD}` default is gone:
# with no marker it quietly diffed the local HEAD against origin, which on an already-pulled
# checkout is empty - i.e. the missing-marker case resolved to "skip everything", the exact
# opposite of what a first run needs.

FULL_DEPLOY=0
FULL_DEPLOY_REASON=""
CHANGED_FILES=""

if [ -z "$LAST_DEPLOYED" ]; then
  FULL_DEPLOY=1
  FULL_DEPLOY_REASON="no $MARKER (first run on this checkout)"
elif ! git cat-file -e "${LAST_DEPLOYED}^{commit}" 2>/dev/null; then
  # Marker points at a commit this checkout can no longer resolve - a force-push that dropped it,
  # a `git gc` after a rewritten history, a fresh re-clone. There is no honest diff to compute.
  FULL_DEPLOY=1
  FULL_DEPLOY_REASON="$MARKER points at $LAST_DEPLOYED, which is no longer reachable"
elif ! CHANGED_FILES=$(git diff --name-only "$LAST_DEPLOYED" "$REMOTE_SHA" 2>&1); then
  FULL_DEPLOY=1
  FULL_DEPLOY_REASON="git diff $LAST_DEPLOYED..$REMOTE_SHA failed: $CHANGED_FILES"
  CHANGED_FILES=""
fi

git pull origin main --quiet

# Paths that feed the client bundle. The root package.json/package-lock.json count: the root
# manifest carries the react overrides and the linux-only rollup/tailwind/lightningcss optional
# deps that the client build resolves through.
BUILD_PATHS='^(client/|package\.json$|package-lock\.json$)'
# Paths PM2 actually runs, plus those same root dependency files.
RESTART_PATHS='^(server/|package\.json$|package-lock\.json$)'
# Paths known to be inert on this box - documentation, the container/CI definitions that aren't
# applied here, the e2e suite, and these deploy scripts themselves. Anything matching none of the
# three lists is unclassified, and unclassified means a full deploy (see the asymmetry note above).
# If you add a new top-level thing the VPS actually runs, classify it here rather than leaving it
# to that fallback.
INERT_PATHS='^(HANDOFF\.md$|README\.md$|\.gitignore$|Dockerfile$|docker-compose\.yml$|docs/|e2e/|infra/|k8s/|scripts/|\.github/)'

NEEDS_BUILD=0
NEEDS_RESTART=0

if [ "$FULL_DEPLOY" -eq 1 ]; then
  NEEDS_BUILD=1
  NEEDS_RESTART=1
  echo "$(date -Iseconds) full build+restart: $FULL_DEPLOY_REASON" >> "$LOG"
else
  if echo "$CHANGED_FILES" | grep -qE "$BUILD_PATHS"; then
    NEEDS_BUILD=1
  fi
  if echo "$CHANGED_FILES" | grep -qE "$RESTART_PATHS"; then
    NEEDS_RESTART=1
  fi

  UNCLASSIFIED=$(echo "$CHANGED_FILES" \
    | grep -v '^$' \
    | grep -vE "$BUILD_PATHS" \
    | grep -vE "$RESTART_PATHS" \
    | grep -vE "$INERT_PATHS" || true)
  if [ -n "$UNCLASSIFIED" ]; then
    NEEDS_BUILD=1
    NEEDS_RESTART=1
    echo "$(date -Iseconds) full build+restart: unclassified paths changed, assuming they matter: $(echo "$UNCLASSIFIED" | tr '\n' ' ')" >> "$LOG"
  fi
fi

if [ "$FULL_DEPLOY" -eq 1 ] || echo "$CHANGED_FILES" | grep -qE '^(package-lock\.json|package\.json|client/package\.json|server/package\.json)$'; then
  echo "$(date -Iseconds) dependency files changed, running npm install" >> "$LOG"
  npm install --no-audit --no-fund
fi

if [ "$NEEDS_BUILD" -eq 1 ]; then
  npm run build
  echo "$(date -Iseconds) client build complete" >> "$LOG"
else
  echo "$(date -Iseconds) no client/ or dependency changes, skipped client build" >> "$LOG"
fi

if [ "$NEEDS_RESTART" -eq 1 ]; then
  pm2 restart "$PM2_APP"
  # Written only on a real restart, and only after it succeeded. deploy-health-check.sh compares
  # PM2's uptime against THIS file's mtime, not $MARKER's - now that a docs-only commit legitimately
  # deploys without restarting, $MARKER's mtime is no longer a claim that the process was restarted,
  # and using it would fire a false "still serving old code" alert on every such no-op deploy.
  echo "$REMOTE_SHA" > "$RESTART_MARKER"
  echo "$(date -Iseconds) server code changed, restarted $PM2_APP" >> "$LOG"
else
  echo "$(date -Iseconds) no server/ or dependency changes, skipped $PM2_APP restart" >> "$LOG"
fi

echo "$REMOTE_SHA" > "$MARKER"
echo "$(date -Iseconds) deploy complete ($REMOTE_SHA)" >> "$LOG"
