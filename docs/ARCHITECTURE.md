# Architecture

## System Diagram

```mermaid
flowchart LR
  User[Agent/Admin Browser] --> Client[React/Vite SPA]
  Client --> API[Express API]
  Client <-->|Socket.io/SSE| Realtime[Realtime Layer]
  API --> Mongo[(MongoDB)]
  API --> Redis[(Redis Cache/Rate Limit)]
  API --> Bull[BullMQ Queues]
  Bull --> Workers[Background Workers]
  API --> Rabbit[RabbitMQ Event Bus]
  API --> S3[(S3 Media Storage)]
  API --> Prom[Prometheus Metrics]
  API --> OTEL[OpenTelemetry]
  API --> WA[WhatsApp Providers]
  API --> AI[OpenAI/Gemini/Claude/Local LLM]
  Workers --> Webhooks[Outbound Webhooks]
  Workers --> WA
```

## Backend Layers

```mermaid
flowchart TB
  Routes[Routes] --> Services[Services]
  Services --> Models[Mongoose Models]
  Routes --> Middleware[Auth, Rate Limit, Audit, Metrics]
  Services --> Realtime[Events and Socket Rooms]
  Services --> Queues[BullMQ]
  Services --> Providers[WhatsApp, AI, Sheets, Webhooks]
```

## Domain Modules

- Inbox: conversations, messages, contacts, assignments, receipts.
- CRM: contacts, leads, notes, timeline, tags, custom fields.
- Campaigns: templates, campaigns, imports, approvals, queues, metrics.
- Automation: flows, nodes, triggers, tests, runtime actions.
- AI: summaries, drafts, RAG documents, memory, tool calls.
- Admin: companies, tenants, users, roles, permissions, billing, audit.
- Analytics: messages, agents, leads, revenue, templates, automation.
- Infrastructure: health, metrics, queues, cache, flags, deployment.

## Scaling Model

- Stateless API pods behind load balancer.
- Sticky or shared Socket.io adapter should be added when scaling realtime beyond one pod.
- MongoDB replica set with backups.
- Redis for shared rate limits, BullMQ, and cache.
- RabbitMQ for durable cross-service events.
- S3/CDN for media delivery.
