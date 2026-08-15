import { z } from "zod";
import {
  bearerSecurity,
  dataResponseSchema,
  jsonResponse,
  keyParamSchema,
  okResponseSchema,
  rawResponse,
  registry,
  standardErrorResponses,
} from "../registry.js";
import { adminSettingsSchema, auditLogExportQuerySchema, featureFlagUpdateSchema } from "../../routes/admin.js";

const TAGS = ["Admin"];

registry.registerPath({
  method: "get",
  path: "/api/admin/overview",
  tags: TAGS,
  summary: "Multi-tenant admin dashboard data (companies, tenants, users, roles, billing, usage, logs, settings).",
  security: bearerSecurity,
  responses: {
    200: jsonResponse("Admin overview payload.", z.unknown()),
    ...standardErrorResponses,
  },
});

registry.registerPath({
  method: "put",
  path: "/api/admin/settings",
  tags: TAGS,
  summary: "Update workspace/organization settings (security, branding, API keys, billing).",
  security: bearerSecurity,
  request: { body: { content: { "application/json": { schema: adminSettingsSchema } } } },
  responses: {
    200: jsonResponse("Updated settings.", z.object({ ok: z.literal(true), settings: z.unknown(), billing: z.unknown() })),
    ...standardErrorResponses,
  },
});

registry.registerPath({
  method: "get",
  path: "/api/admin/audit-log/export",
  tags: TAGS,
  summary: "Export the full audit trail as CSV, optionally bounded by a date range.",
  security: bearerSecurity,
  request: { query: auditLogExportQuerySchema },
  responses: {
    200: rawResponse("CSV export of audit log entries.", "text/csv"),
    ...standardErrorResponses,
  },
});

registry.registerPath({
  method: "post",
  path: "/api/admin/audit-log/prune",
  tags: TAGS,
  summary: "Delete audit log entries older than the workspace's configured retention window.",
  security: bearerSecurity,
  responses: {
    200: jsonResponse("Prune result.", dataResponseSchema),
    ...standardErrorResponses,
  },
});

registry.registerPath({
  method: "get",
  path: "/api/admin/feature-flags",
  tags: TAGS,
  summary: "List all feature flags with their effective value, source (override/env-default), and whether they gate real behavior.",
  security: bearerSecurity,
  responses: {
    200: jsonResponse("Feature flag list.", dataResponseSchema),
    ...standardErrorResponses,
  },
});

registry.registerPath({
  method: "put",
  path: "/api/admin/feature-flags/{key}",
  tags: TAGS,
  summary: "Set a live override for a feature flag.",
  security: bearerSecurity,
  request: {
    params: keyParamSchema,
    body: { content: { "application/json": { schema: featureFlagUpdateSchema } } },
  },
  responses: {
    200: jsonResponse("Updated flag list.", z.object({ ok: z.literal(true), data: z.unknown() })),
    404: jsonResponse("Unknown flag key.", z.unknown()),
    ...standardErrorResponses,
  },
});

registry.registerPath({
  method: "delete",
  path: "/api/admin/feature-flags/{key}",
  tags: TAGS,
  summary: "Clear a feature flag override, reverting it to its env default.",
  security: bearerSecurity,
  request: { params: keyParamSchema },
  responses: {
    200: jsonResponse("Updated flag list.", z.object({ ok: z.literal(true), data: z.unknown() })),
    404: jsonResponse("Unknown flag key.", z.unknown()),
    ...standardErrorResponses,
  },
});
