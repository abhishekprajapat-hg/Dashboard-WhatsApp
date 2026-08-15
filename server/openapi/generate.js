import { OpenApiGeneratorV31 } from "@asteasolutions/zod-to-openapi";
import { registry } from "./registry.js";

// Import every domain's path registrations for their side effect (each file calls
// registry.registerPath(...) at module load). Order doesn't matter - the registry just
// accumulates definitions.
import "./paths/admin.js";
import "./paths/analytics.js";
import "./paths/assistant.js";
import "./paths/auth.js";
import "./paths/automation.js";
import "./paths/calendarEvents.js";
import "./paths/campaigns.js";
import "./paths/contacts.js";
import "./paths/conversations.js";
import "./paths/dashboard.js";
import "./paths/infrastructure.js";
import "./paths/legal.js";
import "./paths/media.js";
import "./paths/settings.js";
import "./paths/tasks.js";
import "./paths/team.js";
import "./paths/templates.js";
import "./paths/whatsapp.js";
import "./paths/workspace.js";

// Single source of truth for the generated document - both the CLI script (docs/openapi.json)
// and the live GET /api/openapi.json route call this same function, so they can never drift.
export function buildOpenApiDocument() {
  const generator = new OpenApiGeneratorV31(registry.definitions);
  return generator.generateDocument({
    openapi: "3.1.0",
    info: {
      title: "WhatsCRM API",
      version: "1.0.0",
      description: "WhatsApp CRM and automation platform API. Generated from the server's Zod validation schemas.",
    },
    servers: [{ url: "/", description: "Same-origin (path-relative)." }],
  });
}
