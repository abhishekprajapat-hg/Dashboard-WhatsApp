#!/bin/bash
# Polls origin/main for new commits and deploys them if found. Meant to run on a schedule
# (cron) as the same user that owns /opt/dashboard-whatsapp and its PM2 process, e.g.:
#
#   */5 * * * * /opt/dashboard-whatsapp/scripts/deploy-vps.sh >> /opt/dashboard-whatsapp/deploy-cron.log 2>&1
#
# Log files live inside this checkout, not in /opt/ directly - the deploy user typically only
# owns the repo directory, not /opt/ itself, so writes straight to /opt/*.log fail silently.
#
# Tracks the last successfully deployed commit in .last-deploy-sha (gitignored) rather than
# just comparing against git's HEAD, so a failed deploy (bad build, etc.) is retried on the
# next run instead of silently being treated as "done" just because `git pull` already moved
# HEAD forward.

set -euo pipefail
cd "$(dirname "$0")/.."

MARKER=".last-deploy-sha"
LOG="$(pwd)/deploy.log"
PM2_APP=dashboard-api

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

CHANGED_FILES=$(git diff --name-only HEAD "$REMOTE_SHA" || true)

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
