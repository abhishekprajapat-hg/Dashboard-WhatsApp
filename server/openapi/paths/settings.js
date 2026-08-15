import { z } from "zod";
import { bearerSecurity, jsonResponse, registry, standardErrorResponses } from "../registry.js";
import { integrationsSchema, testWebhookSchema } from "../../routes/settings.js";

const TAGS = ["Settings"];

registry.registerPath({
  method: "get",
  path: "/api/settings/",
  tags: TAGS,
  summary: "Workspace settings snapshot - WhatsApp accounts, templates, roles, integrations.",
  security: bearerSecurity,
  responses: {
    200: jsonResponse("Settings snapshot.", z.unknown()),
    ...standardErrorResponses,
  },
});

registry.registerPath({
  method: "put",
  path: "/api/settings/integrations",
  tags: TAGS,
  summary: "Update third-party integration config (webhook, Google Sheets, AI providers, email, SMS).",
  security: bearerSecurity,
  request: { body: { content: { "application/json": { schema: integrationsSchema } } } },
  responses: {
    200: jsonResponse("Updated integrations.", z.object({ integrations: z.unknown() })),
    ...standardErrorResponses,
  },
});

registry.registerPath({
  method: "post",
  path: "/api/settings/integrations/test-webhook",
  tags: TAGS,
  summary: "Send a real test payload to a configured outbound webhook URL.",
  security: bearerSecurity,
  request: { body: { content: { "application/json": { schema: testWebhookSchema } } } },
  responses: {
    200: jsonResponse("Test result.", z.object({ result: z.unknown() })),
    ...standardErrorResponses,
  },
});
