# Operations Manual

## Daily Checks

- `/ready` returns 200.
- `/metrics` is scraped by Prometheus.
- Queue failed counts remain below alert threshold.
- Webhook failure rate under 2%.
- WhatsApp account status is connected.
- MongoDB backups completed.

## Incident Response

1. Check `/ready` dependency status.
2. Check Prometheus API latency and error rate.
3. Inspect BullMQ failed jobs.
4. Inspect webhook events and audit logs.
5. Verify WhatsApp provider status and credentials.
6. Roll back if the issue started after deployment.

## Alerts

- API 5xx rate above 2%.
- P95 latency above 1s for 10 minutes.
- Queue failed jobs above 100.
- MongoDB unavailable.
- Redis unavailable in production.
- RabbitMQ unavailable when event bus is enabled.
- Webhook failure rate above 5%.

## Backup and Retention

- **`npm run backup:mongo`** (`server/scripts/backupMongo.js`) - dumps every collection to
  timestamped EJSON files (preserves ObjectId/Date types exactly, not just plain JSON) under
  `server/backups/<timestamp>/`, plus a `manifest.json` with per-collection document counts. Pure
  Node/mongoose driver, no `mongodump` binary dependency. Also prunes backup runs older than
  `BACKUP_RETENTION_DAYS` (default 14) on every run.
- **`npm run restore:drill`** (`server/scripts/restoreMongoDrill.js`) - restores the most recent
  (or a named) backup into a separate `<dbname>_restore_drill` database by default, verifying
  every collection's restored document count against the backup's manifest. Refuses to restore
  into the real `MONGODB_URI` database without an explicit `--confirm-overwrite-target` flag - a
  real restore always needs to be provably safe to run without asking "will this destroy
  production data" first.
- **Scheduled on the VPS 2026-08-21**: `dashboard`'s crontab runs `npm run backup:mongo` daily at
  2 AM (`0 2 * * * cd /opt/dashboard-whatsapp/server && npm run backup:mongo >>
  /opt/dashboard-whatsapp/backup-cron.log 2>&1`), an hour ahead of the existing 3 AM
  `prune:audit-logs` entry. Verified with a real manual run against production, not just the
  crontab line existing: 24 collections backed up (including 51,303 real `auditlogs` documents),
  written to `/opt/dashboard-whatsapp/server/backups/2026-08-21T16-52-44-176Z` with a matching
  manifest. Restore drill (`npm run restore:drill`) was verified locally only (22 collections,
  including a 3942-row `auditlogs` collection, ObjectId/Date field types confirmed identical
  post-restore) - **not yet run against a real production backup**, worth doing once as a genuine
  drill rather than assuming the local verification generalizes.
- Audit logs retained via the existing `npm run prune:audit-logs` (`server/services/
  auditLogRetention.js`), independent of the Mongo-wide backup above.
- Webhook payload retention should be minimized or redacted for privacy - not yet implemented,
  still true as an open item.

## Security Operations

- Rotate JWT secret and provider credentials through a secret manager.
- Run dependency audit before releases.
- Review audit logs for admin/API token changes.
- Enforce MFA before enterprise launch.
- Keep CORS origins explicit in production.
