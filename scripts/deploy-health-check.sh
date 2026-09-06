#!/bin/bash
# Detects a stuck/stale deploy and sends a WhatsApp alert (via scripts/sendDeployAlert.mjs) - built
# after this exact pipeline broke 3 separate ways with zero alerting (deleted cron path, working-
# tree ownership drifting to root, a cron `git pull` stuck mid-merge for hours). Meant to run on a
# schedule (cron), independently of deploy-vps.sh:
#
#   */5 * * * * /home/dashboard/dashboard-whatsapp/scripts/deploy-health-check.sh >> /home/dashboard/dashboard-whatsapp/deploy-health.log 2>&1
#
# Two things are checked, both against .last-deploy-sha - deploy-vps.sh's own marker for "the last
# commit I fully pulled, built, AND restarted the process for" (not just git HEAD, which can drift
# out of sync with what's actually running - see deploy-vps.sh's own comment on this):
#   1. Is .last-deploy-sha stuck behind origin/main for longer than a grace period (deploy-vps.sh
#      isn't succeeding - a stuck git pull, a failing build, anything that stops it short of
#      updating the marker)?
#   2. Did the dashboard-api PM2 process actually restart at-or-after the marker's own last-write
#      time (catches deploy-vps.sh believing it deployed but the restart step itself failing or,
#      previously, being silently skipped by the HEAD-vs-marker diff bug this same change fixed)?
#
# Alerts at most once per incident (tracked in .deploy-health-alerted, gitignored) - not once per
# 5-minute tick - and sends a follow-up when it recovers.

set -uo pipefail
cd "$(dirname "$0")/.."

GRACE_PERIOD_SECONDS=1200 # 20 minutes - longer than deploy-vps.sh's own 5-minute cron interval,
                          # so one slow build or one missed tick never fires a false alarm.
MARKER=".last-deploy-sha"
ALERT_STATE=".deploy-health-alerted"
PM2_APP=dashboard-api

send_alert() {
  # Run from inside server/, not the repo root this script itself cd's to - sendDeployAlert.mjs
  # loads .env via plain "dotenv/config", which resolves relative to process.cwd() at the time
  # node starts. Invoking it from the repo root silently loaded no .env at all (a real incident:
  # DEPLOY_ALERT_PHONE was genuinely set in server/.env, but every cron-triggered alert still
  # failed with "not set" because this cwd was wrong) - a subshell so it doesn't change this
  # script's own cwd for anything running after it.
  (cd "$(pwd)/server" && node scripts/sendDeployAlert.mjs "$1")
}

git fetch origin main --quiet
REMOTE_SHA=$(git rev-parse origin/main)
LAST_DEPLOYED=$(cat "$MARKER" 2>/dev/null || echo "")
NOW=$(date +%s)

PROBLEMS=()

if [ "$LAST_DEPLOYED" != "$REMOTE_SHA" ]; then
  REMOTE_COMMIT_TIME=$(git log -1 --format=%ct "$REMOTE_SHA")
  BEHIND_SECONDS=$((NOW - REMOTE_COMMIT_TIME))
  if [ "$BEHIND_SECONDS" -gt "$GRACE_PERIOD_SECONDS" ]; then
    PROBLEMS+=("Deploy stuck: origin/main has been at $REMOTE_SHA for $((BEHIND_SECONDS / 60))min, but the last fully-deployed commit is ${LAST_DEPLOYED:-none}. Check deploy.log/deploy-cron.log for a stuck git pull or a failing build.")
  fi
fi

if [ -f "$MARKER" ]; then
  MARKER_MTIME=$(stat -c %Y "$MARKER" 2>/dev/null || stat -f %m "$MARKER" 2>/dev/null)
  PM2_START_MS=$(pm2 jlist 2>/dev/null | node -e '
    let data = "";
    process.stdin.on("data", (d) => (data += d));
    process.stdin.on("end", () => {
      try {
        const apps = JSON.parse(data);
        const app = apps.find((a) => a.name === process.argv[1]);
        process.stdout.write(app ? String(app.pm2_env.pm_uptime) : "");
      } catch {
        process.stdout.write("");
      }
    });
  ' "$PM2_APP")

  if [ -z "$PM2_START_MS" ]; then
    PROBLEMS+=("PM2 process \"$PM2_APP\" was not found at all - it may have crashed out entirely.")
  else
    PM2_START_SECONDS=$((PM2_START_MS / 1000))
    # A little slack (60s) for the normal gap between the marker write and the restart call inside
    # deploy-vps.sh - only flag a real, meaningfully-stale gap, not this expected few-second offset.
    if [ "$PM2_START_SECONDS" -lt "$((MARKER_MTIME - 60))" ]; then
      STALE_MINUTES=$(( (MARKER_MTIME - PM2_START_SECONDS) / 60 ))
      PROBLEMS+=("$PM2_APP hasn't restarted in the time since the last deploy was marked complete (~${STALE_MINUTES}min stale) - the running process may still be serving old code despite a clean git pull/build.")
    fi
  fi
fi

TIMESTAMP=$(date -Iseconds)

if [ "${#PROBLEMS[@]}" -gt 0 ]; then
  echo "$TIMESTAMP UNHEALTHY:"
  printf '  - %s\n' "${PROBLEMS[@]}"
  if [ ! -f "$ALERT_STATE" ]; then
    ALERT_MESSAGE="Dashboard-WhatsApp deploy health check failed:
$(printf -- '- %s\n' "${PROBLEMS[@]}")"
    if send_alert "$ALERT_MESSAGE"; then
      touch "$ALERT_STATE"
      echo "$TIMESTAMP alert sent"
    else
      echo "$TIMESTAMP alert FAILED to send - see sendDeployAlert.mjs output above"
    fi
  else
    echo "$TIMESTAMP already alerted for this incident, not re-sending"
  fi
else
  echo "$TIMESTAMP healthy (last deployed: ${LAST_DEPLOYED:-none})"
  if [ -f "$ALERT_STATE" ]; then
    send_alert "Dashboard-WhatsApp deploy health check recovered - back to healthy as of $TIMESTAMP." || true
    rm -f "$ALERT_STATE"
    echo "$TIMESTAMP recovery alert sent, cleared alert state"
  fi
fi
