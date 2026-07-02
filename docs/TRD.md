# Technical Requirements Document

## Stack

- Frontend: React 19, Vite, TailwindCSS, Framer Motion, Zustand, Socket.io Client.
- Backend: Node.js, Express 5, MongoDB/Mongoose, Socket.io.
- Infrastructure: Redis, BullMQ, RabbitMQ, Prometheus, OpenTelemetry, Docker, Kubernetes.
- Media: Local uploads in development; S3/CDN in production.

## Architecture Principles

- Tenant-first data isolation.
- Route/service/model separation.
- Optional production adapters with safe local fallbacks.
- Realtime events published through a dedicated layer.
- Background work via queues instead of request-bound long jobs.
- Observable by default with health, metrics, audit, and queue status.

## Backend Requirements

- All authenticated routes receive `req.user` from JWT.
- All workspace data must filter by `workspaceId`.
- All production deployments must set `JWT_SECRET` and `MONGODB_URI`.
- All mutating API requests should be audited.
- All provider webhooks should normalize into the conversation pipeline.
- Long-running sends, retries, webhooks, sync jobs, and imports should use BullMQ.

## Frontend Requirements

- Existing routing/view structure must remain stable.
- Views should be reusable components under `client/src/app/components`.
- Heavy feature views should be candidates for lazy loading.
- All primary controls need keyboard labels and accessible names.
- Realtime updates should be reconciled without duplicate state.

## Database Requirements

- Every business document includes `organizationId` and `workspaceId`.
- High-volume collections need compound indexes by tenant and date/status.
- Message collection must support cursor pagination and duplicate prevention.
- Audit and webhook events should have retention policies.

## Security Requirements

- Helmet security headers.
- Configured CORS allowlist in production.
- Rate limits for all routes, stricter limits for auth and webhooks.
- Password policy for team invites.
- No production boot with default JWT secret.
- Dependency audit must remain clean.
- Secrets should move to a vault or cloud secret manager.
