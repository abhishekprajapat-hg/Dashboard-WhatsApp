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

- MongoDB daily snapshots with point-in-time recovery for production.
- S3 lifecycle retention by tenant policy.
- Audit logs retained at least 180 days.
- Webhook payload retention should be minimized or redacted for privacy.

## Security Operations

- Rotate JWT secret and provider credentials through a secret manager.
- Run dependency audit before releases.
- Review audit logs for admin/API token changes.
- Enforce MFA before enterprise launch.
- Keep CORS origins explicit in production.
