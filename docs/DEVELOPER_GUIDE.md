# Developer Guide

## Setup

```bash
npm install
npm run seed
npm run server
npm run dev
```

## Verification

```bash
npm run build
npm run check:server
npm test
npm audit --omit=dev
```

## Folder Structure

- `client/src/app/components`: feature views and reusable UI.
- `client/src/app/components/whatsapp-inbox`: inbox engine, store, realtime, media cache.
- `client/src/app/lib/api.ts`: typed API helpers.
- `server/routes`: HTTP route modules.
- `server/services`: domain services and integrations.
- `server/models`: Mongoose models.
- `server/middleware`: auth, audit, rate limit.
- `server/realtime`: Socket.io and event publishing.
- `docs`: product, technical, architecture, and operations docs.
- `infra`, `k8s`, `.github`: deployment and CI/CD.

## Coding Standards

- Keep tenant filters on every database query.
- Put provider/integration logic in services, not components/routes.
- Add request validation before persistence.
- Keep long-running work in queues.
- Avoid duplicate state in frontend; derive from stores/API payloads.
- Add tests for every new validation and service behavior.

## Testing Strategy

- Unit tests: validation, serializers, service pure functions.
- Integration tests: auth, contacts, conversations, campaigns, automation, assistant.
- E2E tests: login, inbox send, CRM conversion, campaign approval/send, automation test, analytics export.
