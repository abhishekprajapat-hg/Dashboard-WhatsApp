import { z } from "zod";
import {
  bearerSecurity,
  dataResponseSchema,
  idParamSchema,
  jsonResponse,
  listResponseSchema,
  registry,
  standardErrorResponses,
} from "../registry.js";
import { updateTemplateSchema } from "../../routes/templates.js";

const TAGS = ["Templates"];

// Documentation-only schemas below - these routes read req.query/req.body directly (POST / goes
// through a cleanPayload() coercion helper instead of zod) with no validateBody/validateQuery
// today, a real gap this OpenAPI pass doesn't backfill. Shapes observed from each handler.
const listTemplatesQuerySchema = z.object({
  type: z.string().optional(),
  status: z.string().optional(),
  category: z.string().optional(),
  language: z.string().optional(),
  search: z.string().optional(),
});
const createTemplateBodySchema = z.object({
  name: z.string(),
  type: z.string().optional(),
  category: z.string().optional(),
  language: z.string().optional(),
  body: z.string(),
  variables: z.array(z.string()).optional(),
});
const previewTemplateBodySchema = z.object({
  body: z.string(),
  variables: z.record(z.unknown()).optional(),
});
const syncWhatsappTemplatesBodySchema = z.object({ accountId: z.string() });

registry.registerPath({
  method: "get",
  path: "/api/templates/",
  tags: TAGS,
  summary: "List message templates, optionally filtered by type/status/category/language/search.",
  security: bearerSecurity,
  request: { query: listTemplatesQuerySchema },
  responses: {
    200: jsonResponse("Template list.", listResponseSchema),
    ...standardErrorResponses,
  },
});

registry.registerPath({
  method: "post",
  path: "/api/templates/",
  tags: TAGS,
  summary: "Create a message template.",
  security: bearerSecurity,
  request: { body: { content: { "application/json": { schema: createTemplateBodySchema } } } },
  responses: {
    201: jsonResponse("Created template.", dataResponseSchema),
    ...standardErrorResponses,
  },
});

registry.registerPath({
  method: "post",
  path: "/api/templates/preview",
  tags: TAGS,
  summary: "Render a template body with sample variables, without saving anything.",
  security: bearerSecurity,
  request: { body: { content: { "application/json": { schema: previewTemplateBodySchema } } } },
  responses: {
    200: jsonResponse("Rendered preview.", dataResponseSchema),
    ...standardErrorResponses,
  },
});

registry.registerPath({
  method: "post",
  path: "/api/templates/sync-whatsapp",
  tags: TAGS,
  summary: "Pull the latest template list/status from the WhatsApp provider for an account.",
  security: bearerSecurity,
  request: { body: { content: { "application/json": { schema: syncWhatsappTemplatesBodySchema } } } },
  responses: {
    200: jsonResponse("Sync result.", z.object({ synced: z.number(), accounts: z.unknown() })),
    ...standardErrorResponses,
  },
});

registry.registerPath({
  method: "get",
  path: "/api/templates/{id}",
  tags: TAGS,
  summary: "Get a single template.",
  security: bearerSecurity,
  request: { params: idParamSchema },
  responses: {
    200: jsonResponse("Template.", dataResponseSchema),
    ...standardErrorResponses,
  },
});

registry.registerPath({
  method: "patch",
  path: "/api/templates/{id}",
  tags: TAGS,
  summary: "Update a template (sparse update).",
  security: bearerSecurity,
  request: { params: idParamSchema, body: { content: { "application/json": { schema: updateTemplateSchema } } } },
  responses: {
    200: jsonResponse("Updated template.", dataResponseSchema),
    ...standardErrorResponses,
  },
});

registry.registerPath({
  method: "delete",
  path: "/api/templates/{id}",
  tags: TAGS,
  summary: "Archive (soft-delete) a template.",
  security: bearerSecurity,
  request: { params: idParamSchema },
  responses: {
    200: jsonResponse("Archived template.", dataResponseSchema),
    ...standardErrorResponses,
  },
});

registry.registerPath({
  method: "post",
  path: "/api/templates/{id}/duplicate",
  tags: TAGS,
  summary: "Duplicate a template as a new draft.",
  security: bearerSecurity,
  request: { params: idParamSchema },
  responses: {
    201: jsonResponse("Duplicated template.", dataResponseSchema),
    ...standardErrorResponses,
  },
});

registry.registerPath({
  method: "post",
  path: "/api/templates/{id}/use",
  tags: TAGS,
  summary: "Record that a template was used (increments usage stats).",
  security: bearerSecurity,
  request: { params: idParamSchema },
  responses: {
    200: jsonResponse("Updated template.", dataResponseSchema),
    ...standardErrorResponses,
  },
});
