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
import { connectAccountSchema } from "../../routes/whatsapp.js";

const TAGS = ["WhatsApp"];
const WEBHOOK_TAGS = ["WhatsApp Webhooks"];

// Documentation-only - these two routes read req.query/req.body directly with no
// validateBody/validateQuery today, a real gap this OpenAPI pass doesn't backfill.
const listWhatsappTemplatesQuerySchema = z.object({ accountId: z.string().optional() });
const createWhatsappTemplateBodySchema = z.object({
  accountId: z.string(),
  name: z.string(),
  language: z.string(),
  category: z.string(),
  body: z.string(),
});

registry.registerPath({
  method: "get",
  path: "/api/whatsapp/accounts",
  tags: TAGS,
  summary: "List connected WhatsApp Business accounts.",
  security: bearerSecurity,
  responses: {
    200: jsonResponse("Account list.", listResponseSchema),
    ...standardErrorResponses,
  },
});

registry.registerPath({
  method: "get",
  path: "/api/whatsapp/console",
  tags: TAGS,
  summary: "WhatsApp provider health, message/template stats, and recent activity.",
  security: bearerSecurity,
  responses: {
    200: jsonResponse("Console snapshot.", z.unknown()),
    ...standardErrorResponses,
  },
});

registry.registerPath({
  method: "post",
  path: "/api/whatsapp/accounts",
  tags: TAGS,
  summary: "Connect a WhatsApp Business account (Meta, Twilio, or Wati).",
  security: bearerSecurity,
  request: { body: { content: { "application/json": { schema: connectAccountSchema } } } },
  responses: {
    201: jsonResponse("Connected account.", dataResponseSchema),
    ...standardErrorResponses,
  },
});

registry.registerPath({
  method: "delete",
  path: "/api/whatsapp/accounts/{id}",
  tags: TAGS,
  summary: "Disconnect a WhatsApp Business account.",
  security: bearerSecurity,
  request: { params: idParamSchema },
  responses: {
    204: { description: "Deleted." },
    ...standardErrorResponses,
  },
});

registry.registerPath({
  method: "get",
  path: "/api/whatsapp/templates",
  tags: TAGS,
  summary: "List provider-side templates for an account.",
  security: bearerSecurity,
  request: { query: listWhatsappTemplatesQuerySchema },
  responses: {
    200: jsonResponse("Template list.", listResponseSchema),
    ...standardErrorResponses,
  },
});

registry.registerPath({
  method: "post",
  path: "/api/whatsapp/templates",
  tags: TAGS,
  summary: "Submit a new template to the WhatsApp provider for approval.",
  security: bearerSecurity,
  request: { body: { content: { "application/json": { schema: createWhatsappTemplateBodySchema } } } },
  responses: {
    201: jsonResponse("Created template.", dataResponseSchema),
    ...standardErrorResponses,
  },
});

registry.registerPath({
  method: "post",
  path: "/api/whatsapp/accounts/{id}/sync-templates",
  tags: TAGS,
  summary: "Pull the latest template list/status from the provider for an account.",
  security: bearerSecurity,
  request: { params: idParamSchema },
  responses: {
    200: jsonResponse("Sync result.", z.object({ account: z.unknown(), templates: z.unknown() })),
    ...standardErrorResponses,
  },
});

registry.registerPath({
  method: "post",
  path: "/api/whatsapp/accounts/{id}/test",
  tags: TAGS,
  summary: "Send a real test message through the account's provider to verify credentials.",
  security: bearerSecurity,
  request: { params: idParamSchema },
  responses: {
    200: jsonResponse("Test result.", z.object({ result: z.unknown(), account: z.unknown() })),
    ...standardErrorResponses,
  },
});

registry.registerPath({
  method: "get",
  path: "/webhooks/whatsapp/",
  tags: WEBHOOK_TAGS,
  summary: "Meta webhook verification handshake (hub.challenge), gated by the configured verify token, not Bearer auth.",
  responses: {
    200: { description: "Returns the raw hub.challenge string." },
    403: { description: "Verify token mismatch." },
  },
});

registry.registerPath({
  method: "post",
  path: "/webhooks/whatsapp/",
  tags: WEBHOOK_TAGS,
  summary: "Meta inbound webhook (messages, statuses). Verified via X-Hub-Signature-256 HMAC, not Bearer auth.",
  request: { body: { content: { "application/json": { schema: z.unknown() } } } },
  responses: {
    200: { description: "Acknowledged." },
  },
});

registry.registerPath({
  method: "post",
  path: "/webhooks/whatsapp/twilio",
  tags: WEBHOOK_TAGS,
  summary: "Twilio inbound webhook (messages, statuses). Provider-verified, not Bearer auth.",
  request: { body: { content: { "application/json": { schema: z.unknown() } } } },
  responses: {
    200: { description: "Acknowledged." },
  },
});

registry.registerPath({
  method: "post",
  path: "/webhooks/whatsapp/wati",
  tags: WEBHOOK_TAGS,
  summary: "Wati inbound webhook (messages, statuses). Provider-verified, not Bearer auth.",
  request: { body: { content: { "application/json": { schema: z.unknown() } } } },
  responses: {
    200: { description: "Acknowledged." },
  },
});
