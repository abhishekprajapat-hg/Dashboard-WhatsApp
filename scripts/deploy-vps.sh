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

MARKER=".last-deploy-sha"
LOG="$(pwd)/deploy.log"
LOCKFILE="$(pwd)/.deploy.lock"
PM2_APP=dashboard-api

# A build can take longer than the 5-minute cron interval, and this script also gets run
# manually sometimes - without a lock, an overlapping run would race the first one on the same
# git checkout/build/pm2 restart. If another instance already holds the lock, just skip this
# tick; the next one will pick up wherever things stand.
exec 200>"$LOCKFILE"
flock -n 200 || exit 0

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

# Diffed against $LAST_DEPLOYED (the last commit this script itself fully finished deploying -
# pull+build+restart+marker all succeeded), NOT against HEAD. HEAD can already equal $REMOTE_SHA
# without this script ever having restarted the process for it - e.g. someone manually ran `git
# pull` outside this script (a real incident, 2026-09-06: a stuck cron pull was fixed by hand,
# HEAD collapsed to match origin, and the next run of this exact script diffed HEAD..REMOTE_SHA as
# empty and silently skipped `pm2 restart` even though the running process was still hours stale).
# Diffing against the marker instead means "what changed since we last KNOW we restarted for it",
# which stays correct regardless of how HEAD got to its current position.
CHANGED_FILES=$(git diff --name-only "${LAST_DEPLOYED:-HEAD}" "$REMOTE_SHA" || true)

git pull origin main --quiet

if echo "$CHANGED_FILES" | grep -qE '^(package-lock\.json|package\.json|client/package\.json|server/package\.json)$'; then
  echo "$(date -Iseconds) dependency files changed, running npm install" >> "$LOG"
  npm install --no-audit --no-fund
fi

npm run build

if echo "$CHANGED_FILES" | grep -q '^server/'; then
  pm2 restart "$PM2_APP"
  echo "$(date -Iseconds) server code changed, restarted $PM2_APP" >> "$LOG"
fi

echo "$REMOTE_SHA" > "$MARKER"
echo "$(date -Iseconds) deploy complete ($REMOTE_SHA)" >> "$LOG"
