# Product Requirements Document

## Product Vision

WhatsCRM is an enterprise WhatsApp Business operating system for sales, support, marketing, automation, AI assistance, and analytics. It should feel comparable to Interakt, Respond.io, WATI, AiSensy, and Gupshup while remaining modular, scalable, and maintainable.

## Target Users

- Business owners managing WhatsApp revenue operations.
- Sales teams converting inbound leads.
- Support agents resolving customer conversations.
- Marketing teams running template and bulk campaigns.
- Admins managing tenants, roles, numbers, billing, and governance.
- Operations teams monitoring delivery, queues, webhooks, and infrastructure.

## Core Jobs

- Manage all WhatsApp conversations from a professional team inbox.
- Automatically create CRM contacts and leads from inbound WhatsApp messages.
- Run bulk, scheduled, recurring, and template campaigns.
- Build visual automations for lead routing, tagging, replies, and integrations.
- Use AI for summaries, draft replies, qualification, sentiment, RAG, and follow-up.
- Measure messages, agents, campaigns, leads, revenue, templates, and automation performance.
- Govern multi-tenant companies, users, roles, permissions, API keys, and audit trails.

## Functional Requirements

- Multi-tenant organization and workspace isolation.
- WhatsApp provider account management.
- Realtime inbox with unread counts, receipts, typing, media, and assignments.
- CRM entities: contacts, leads, notes, custom fields, tags, stages, scores, timelines.
- Campaign management with approvals, queues, retries, segmentation, and analytics.
- Visual automation builder with nodes, edges, tests, logs, and versions.
- AI assistant with provider abstraction for OpenAI, Gemini, Claude, and local fallback.
- Enterprise analytics with export PDF/Excel and role-based scope.
- Infrastructure observability, health, metrics, queue status, and feature flags.

## Non-Functional Requirements

- Horizontal API scaling.
- Zero-downtime deployment.
- Redis/BullMQ/RabbitMQ optional adapters.
- S3/CDN media storage.
- Rate limiting and audit logging.
- Tenant-scoped authorization.
- High-volume message pagination and indexing.

## Success Metrics

- First response time under 2 minutes.
- Message delivery failure rate under 2%.
- 99.9% API uptime for paid tenants.
- Campaign delivery analytics available within 60 seconds.
- Agents can process conversations without manual refresh.
