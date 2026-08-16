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
import {
  createTemplateBodySchema,
  listTemplatesQuerySchema,
  previewTemplateBodySchema,
  syncWhatsappTemplatesSchema,
  updateTemplateSchema,
} from "../../routes/templates.js";

const TAGS = ["Templates"];

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
  request: { body: { content: { "application/json": { schema: syncWhatsappTemplatesSchema } } } },
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
