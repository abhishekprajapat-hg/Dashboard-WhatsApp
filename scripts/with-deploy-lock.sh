#!/bin/bash
# Runs an arbitrary command (e.g. a diagnostic `git pull`, a manual `pm2 restart`) while holding
# the exact same lock deploy-vps.sh's cron uses for its own git fetch/pull. A manual git command
# run directly in a shell doesn't touch that lock at all, so it can race the cron's protected
# section and hit "cannot lock ref 'refs/remotes/origin/main'" - this happened repeatedly
# (see HANDOFF.md and the dashboard-whatsapp-deploy-cron-broken memory). Waits up to 30s for the
# lock rather than failing outright, since a normal build finishes well within that.
#
# Usage: scripts/with-deploy-lock.sh git pull
#        scripts/with-deploy-lock.sh git log -1 --format='%H %ci'

set -euo pipefail
cd "$(dirname "$0")/.."

LOCKFILE="$(pwd)/.deploy.lock"
exec 200>"$LOCKFILE"
flock -w 30 200

exec "$@"
