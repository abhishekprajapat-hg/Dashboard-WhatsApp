#!/bin/bash
# Detects a stuck/stale deploy and sends a WhatsApp alert (via scripts/sendDeployAlert.mjs) - built
# after this exact pipeline broke 3 separate ways with zero alerting (deleted cron path, working-
# tree ownership drifting to root, a cron `git pull` stuck mid-merge for hours). Meant to run on a
# schedule (cron), independently of deploy-vps.sh:
#
#   */5 * * * * /home/dashboard/dashboard-whatsapp/scripts/deploy-health-check.sh >> /home/dashboard/dashboard-whatsapp/deploy-health.log 2>&1
#
# Three things are checked, against deploy-vps.sh's own markers rather than git HEAD (which can
# drift out of sync with what's actually running - see deploy-vps.sh's own comment on this):
#   1. Is .last-deploy-sha - "the last commit deploy-vps.sh fully finished processing" - stuck
#      behind origin/main for longer than a grace period (deploy-vps.sh isn't succeeding: a stuck
#      git pull, a failing build, anything that stops it short of updating the marker)?
#   2. Is the dashboard-api PM2 process there at all?
#   3. Did that process actually restart at-or-after .last-restart-sha's last-write time (catches
#      deploy-vps.sh believing it restarted but the restart itself failing, or - the original bug
#      this check was built for - being silently skipped by a bad diff)?
#
# Check 3 deliberately uses .last-restart-sha, NOT .last-deploy-sha. deploy-vps.sh only builds and
# restarts when the diff since the last deploy actually touched client/ or server/, so a docs-only
# commit is a legitimate no-op: it advances .last-deploy-sha without restarting anything. Comparing
# PM2's uptime against .last-deploy-sha's mtime would read that correct behaviour as "the process is
# still serving old code" and fire a false alert on every documentation commit. .last-restart-sha is
# written only immediately after a successful `pm2 restart`, so its mtime is the only file mtime here
# that genuinely claims "the process was restarted at this moment".
#
# Alerts at most once per incident (tracked in .deploy-health-alerted, gitignored) - not once per
# 5-minute tick - and sends a follow-up when it recovers.

set -uo pipefail
cd "$(dirname "$0")/.."

GRACE_PERIOD_SECONDS=1200 # 20 minutes - longer than deploy-vps.sh's own 5-minute cron interval,
                          # so one slow build or one missed tick never fires a false alarm.
MARKER=".last-deploy-sha"
RESTART_MARKER=".last-restart-sha"
ALERT_STATE=".deploy-health-alerted"
BEHIND_SINCE=".deploy-behind-since"
PM2_APP=dashboard-api
LOCKFILE="$(pwd)/.deploy.lock"

send_alert() {
  # Run from inside server/, not the repo root this script itself cd's to - sendDeployAlert.mjs
  # loads .env via plain "dotenv/config", which resolves relative to process.cwd() at the time
  # node starts. Invoking it from the repo root silently loaded no .env at all (a real incident:
  # DEPLOY_ALERT_PHONE was genuinely set in server/.env, but every cron-triggered alert still
  # failed with "not set" because this cwd was wrong) - a subshell so it doesn't change this
  # script's own cwd for anything running after it.
  (cd "$(pwd)/server" && node scripts/sendDeployAlert.mjs "$1")
}

# deploy-vps.sh runs on its own independent cron tick and holds .deploy.lock for the entire
# duration of its own git fetch/pull (and the build/restart after it). Without sharing that same
# lock here, this script's git fetch could start at the exact moment deploy-vps.sh's is mid-flight,
# and both processes racing to update the same refs/remotes/origin/main ref fails with "cannot lock
# ref" - confirmed hitting exactly this in deploy-cron.log. Wait up to 30s for the lock (long enough
# to cover a normal build, short enough that a genuinely hung deploy - which would hold the lock
# indefinitely - can't make this health check hang forever too); if it times out, fall back to
# whatever origin/main was last fetched as, rather than skip the check entirely.
if ! ( exec 200>"$LOCKFILE"; flock -w 30 200 && git fetch origin main --quiet ); then
  echo "$(date -Iseconds) could not acquire deploy lock for git fetch within 30s - checking against last-known origin/main instead"
fi
REMOTE_SHA=$(git rev-parse origin/main)
LAST_DEPLOYED=$(cat "$MARKER" 2>/dev/null || echo "")
NOW=$(date +%s)

PROBLEMS=()

if [ "$LAST_DEPLOYED" != "$REMOTE_SHA" ]; then
  # Staleness is measured from when this check FIRST saw the deploy fall behind, recorded in
  # $BEHIND_SINCE - not from the newest commit's own timestamp, which is what this used to do:
  #
  #   REMOTE_COMMIT_TIME=$(git log -1 --format=%ct "$REMOTE_SHA")
  #   BEHIND_SECONDS=$((NOW - REMOTE_COMMIT_TIME))
  #
  # That asked "how old is the latest commit?", not "how long have we been failing to deploy it".
  # Every new push reset it to ~0, so during an active session - pushing every 10-20 minutes, which
  # is exactly when a broken pipeline matters most - it could never reach the 20-minute grace and
  # never alerted. Confirmed against the 2026-09-11 incident: the deploy was broken for ~25 minutes
  # across three pushes and this check stayed silent the whole time.
  #
  # Anchoring to first-seen-behind keeps the same protection against false alarms (a fresh push
  # still gets a full grace period before it can alert, because the first tick after it just records
  # the timestamp), while measuring the thing we actually care about.
  if [ ! -f "$BEHIND_SINCE" ]; then
    echo "$NOW" > "$BEHIND_SINCE"
  fi
  BEHIND_START=$(cat "$BEHIND_SINCE" 2>/dev/null || echo "$NOW")
  case "$BEHIND_START" in
    ''|*[!0-9]*) BEHIND_START=$NOW; echo "$NOW" > "$BEHIND_SINCE" ;;
  esac
  BEHIND_SECONDS=$((NOW - BEHIND_START))
  if [ "$BEHIND_SECONDS" -gt "$GRACE_PERIOD_SECONDS" ]; then
    PROBLEMS+=("Deploy stuck: origin/main has been ahead of the last fully-deployed commit for $((BEHIND_SECONDS / 60))min (origin/main $REMOTE_SHA, last deployed ${LAST_DEPLOYED:-none}). Check deploy-cron.log - not just deploy.log - for a failing build or a stuck git pull.")
  fi
else
  rm -f "$BEHIND_SINCE"
fi

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
elif [ -f "$RESTART_MARKER" ]; then
  # Absent on a checkout that hasn't yet deployed a commit touching server/ since this marker was
  # introduced - there is simply no recorded restart to compare against yet, so skip this check
  # rather than guess. The first server-side deploy after that creates it.
  RESTART_MTIME=$(stat -c %Y "$RESTART_MARKER" 2>/dev/null || stat -f %m "$RESTART_MARKER" 2>/dev/null)
  PM2_START_SECONDS=$((PM2_START_MS / 1000))
  # A little slack (60s) for the normal gap between the restart call and the marker write right
  # after it in deploy-vps.sh - only flag a real, meaningfully-stale gap, not that few-second offset.
  if [ "$PM2_START_SECONDS" -lt "$((RESTART_MTIME - 60))" ]; then
    STALE_MINUTES=$(( (RESTART_MTIME - PM2_START_SECONDS) / 60 ))
    PROBLEMS+=("$PM2_APP hasn't restarted in the time since the last deploy recorded restarting it (~${STALE_MINUTES}min stale) - the running process may still be serving old code despite a clean git pull/build.")
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
