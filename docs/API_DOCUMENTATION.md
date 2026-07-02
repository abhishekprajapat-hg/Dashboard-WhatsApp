# API Documentation

## Authentication

All protected endpoints require:

```http
Authorization: Bearer <jwt>
```

Errors use:

```json
{ "error": "VALIDATION_ERROR", "message": "Human readable message." }
```

## Core Endpoints

| Method | Path | Purpose |
| --- | --- | --- |
| `POST` | `/api/auth/login` | Login and receive session JWT. |
| `GET` | `/api/auth/me` | Restore session. |
| `GET` | `/api/dashboard/summary` | Workspace dashboard metrics. |
| `GET` | `/api/conversations` | Paginated conversations. |
| `GET` | `/api/conversations/:id/messages` | Paginated messages. |
| `POST` | `/api/conversations/:id/messages` | Send WhatsApp message. |
| `PATCH` | `/api/conversations/:id/read` | Clear unread count. |
| `PATCH` | `/api/conversations/:id/assignment` | Assign conversation. |
| `GET` | `/api/contacts` | Search/list contacts. |
| `POST` | `/api/contacts` | Create contact. |
| `GET` | `/api/campaigns` | Campaign list and summary. |
| `POST` | `/api/campaigns` | Create campaign. |
| `POST` | `/api/campaigns/:id/action` | Pause, resume, cancel, approve, retry. |
| `GET` | `/api/automation` | Automation flows. |
| `POST` | `/api/automation` | Create automation flow. |
| `PATCH` | `/api/automation/:id` | Update flow/canvas. |
| `POST` | `/api/automation/:id/test` | Test flow. |
| `GET` | `/api/assistant/overview` | AI assistant status. |
| `POST` | `/api/assistant/analyze` | Summary, draft, RAG, lead qualification. |
| `POST` | `/api/assistant/knowledge` | Upload knowledge document text. |
| `GET` | `/api/analytics/summary` | Enterprise analytics payload. |
| `GET` | `/api/analytics/export/pdf` | Download report PDF. |
| `GET` | `/api/analytics/export/excel` | Download CSV/Excel-compatible report. |
| `GET` | `/api/admin/overview` | Enterprise admin overview. |
| `GET` | `/api/infrastructure/status` | Health, queues, flags, capabilities. |

## Webhooks

| Method | Path | Purpose |
| --- | --- | --- |
| `GET` | `/webhooks/whatsapp` | Meta verification. |
| `POST` | `/webhooks/whatsapp` | Meta inbound webhook. |
| `POST` | `/webhooks/whatsapp/twilio` | Twilio inbound webhook. |
| `POST` | `/webhooks/whatsapp/wati` | WATI inbound webhook. |

## Health and Ops

| Method | Path | Purpose |
| --- | --- | --- |
| `GET` | `/health` | Liveness. |
| `GET` | `/ready` | Readiness with dependency status. |
| `GET` | `/metrics` | Prometheus metrics. |
