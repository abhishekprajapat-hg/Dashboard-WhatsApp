import { z } from "zod";
import {
  bearerSecurity,
  contactIdParamSchema,
  conversationIdParamSchema,
  conversationMessageParamSchema,
  dataResponseSchema,
  idParamSchema,
  jsonResponse,
  registry,
  standardErrorResponses,
} from "../registry.js";
import {
  updateAssignmentSchema,
  updateMessageActionsSchema,
  updateReceiptSchema,
  updateSettingsSchema,
  updateStatusSchema,
} from "../../routes/conversations.js";

const TAGS = ["Conversations"];

// Documentation-only schemas below - these routes read req.query/req.body directly with no
// validateBody/validateQuery today (a real gap, not backfilled by this OpenAPI pass). Shapes
// observed from each handler.
const listConversationsQuerySchema = z.object({
  status: z.string().optional(),
  search: z.string().optional(),
  unread: z.string().optional(),
  limit: z.coerce.number().optional(),
  cursor: z.string().optional(),
});
const listMessagesQuerySchema = z.object({
  limit: z.coerce.number().optional(),
  before: z.string().optional(),
});
const deleteMessageBodySchema = z.object({ mode: z.string().optional() });
const deleteMessageByIdBodySchema = z.object({ messageId: z.string() });
const createConversationBodySchema = z.object({ contactId: z.string(), content: z.string().optional() });
const addToCrmBodySchema = z.object({ stage: z.string().optional() });
const sendTemplateBodySchema = z.object({ templateId: z.string(), parameters: z.record(z.unknown()).optional() });
const sendMessageBodySchema = z.object({
  content: z.string().optional(),
  attachments: z.array(z.unknown()).optional(),
  replyToMessageId: z.string().optional(),
  clientMessageId: z.string().optional(),
});
const addNoteBodySchema = z.object({ content: z.string() });

registry.registerPath({
  method: "get",
  path: "/api/conversations/",
  tags: TAGS,
  summary: "List conversations for the workspace inbox.",
  security: bearerSecurity,
  request: { query: listConversationsQuerySchema },
  responses: {
    200: jsonResponse("Conversation list.", z.object({ data: z.array(z.unknown()), total: z.number(), page: z.unknown() })),
    ...standardErrorResponses,
  },
});

registry.registerPath({
  method: "get",
  path: "/api/conversations/unread-count",
  tags: TAGS,
  summary: "Total unread conversation count for the current user.",
  security: bearerSecurity,
  responses: {
    200: jsonResponse("Unread count.", z.object({ unread: z.number() })),
    ...standardErrorResponses,
  },
});

registry.registerPath({
  method: "get",
  path: "/api/conversations/by-contact/{contactId}",
  tags: TAGS,
  summary: "Get the conversation for a given contact.",
  security: bearerSecurity,
  request: { params: contactIdParamSchema },
  responses: {
    200: jsonResponse("Conversation.", dataResponseSchema),
    ...standardErrorResponses,
  },
});

registry.registerPath({
  method: "get",
  path: "/api/conversations/{conversationId}/messages/{messageId}/info",
  tags: TAGS,
  summary: "Delivery/read receipt info for a single message.",
  security: bearerSecurity,
  request: { params: conversationMessageParamSchema },
  responses: {
    200: jsonResponse("Message info.", dataResponseSchema),
    ...standardErrorResponses,
  },
});

registry.registerPath({
  method: "get",
  path: "/api/conversations/{conversationId}/messages",
  tags: TAGS,
  summary: "List messages in a conversation, paginated.",
  security: bearerSecurity,
  request: { params: conversationIdParamSchema, query: listMessagesQuerySchema },
  responses: {
    200: jsonResponse("Message list.", z.object({ data: z.array(z.unknown()), page: z.unknown() })),
    ...standardErrorResponses,
  },
});

registry.registerPath({
  method: "patch",
  path: "/api/conversations/{conversationId}/messages/{messageId}/receipt",
  tags: TAGS,
  summary: "Mark a message as delivered or read.",
  security: bearerSecurity,
  request: {
    params: conversationMessageParamSchema,
    body: { content: { "application/json": { schema: updateReceiptSchema } } },
  },
  responses: {
    200: jsonResponse("Updated message.", dataResponseSchema),
    ...standardErrorResponses,
  },
});

registry.registerPath({
  method: "patch",
  path: "/api/conversations/{conversationId}/messages/{messageId}/actions",
  tags: TAGS,
  summary: "Pin or star a message.",
  security: bearerSecurity,
  request: {
    params: conversationMessageParamSchema,
    body: { content: { "application/json": { schema: updateMessageActionsSchema } } },
  },
  responses: {
    200: jsonResponse("Updated message.", dataResponseSchema),
    ...standardErrorResponses,
  },
});

registry.registerPath({
  method: "delete",
  path: "/api/conversations/{conversationId}/messages/{messageId}",
  tags: TAGS,
  summary: "Delete a message (for me / for everyone, per mode).",
  security: bearerSecurity,
  request: {
    params: conversationMessageParamSchema,
    body: { content: { "application/json": { schema: deleteMessageBodySchema } } },
  },
  responses: {
    204: { description: "Deleted." },
    ...standardErrorResponses,
  },
});

registry.registerPath({
  method: "post",
  path: "/api/conversations/{conversationId}/messages/{messageId}/delete",
  tags: TAGS,
  summary: "Delete a message (POST alias of the DELETE route above, for clients that can't send a DELETE body).",
  security: bearerSecurity,
  request: {
    params: conversationMessageParamSchema,
    body: { content: { "application/json": { schema: deleteMessageBodySchema } } },
  },
  responses: {
    204: { description: "Deleted." },
    ...standardErrorResponses,
  },
});

registry.registerPath({
  method: "post",
  path: "/api/conversations/{conversationId}/messages/delete",
  tags: TAGS,
  summary: "Delete a message by id in the request body.",
  security: bearerSecurity,
  request: {
    params: conversationIdParamSchema,
    body: { content: { "application/json": { schema: deleteMessageByIdBodySchema } } },
  },
  responses: {
    204: { description: "Deleted." },
    ...standardErrorResponses,
  },
});

registry.registerPath({
  method: "get",
  path: "/api/conversations/{id}",
  tags: TAGS,
  summary: "Get a single conversation.",
  security: bearerSecurity,
  request: { params: idParamSchema },
  responses: {
    200: jsonResponse("Conversation.", dataResponseSchema),
    ...standardErrorResponses,
  },
});

registry.registerPath({
  method: "patch",
  path: "/api/conversations/{id}/read",
  tags: TAGS,
  summary: "Mark a conversation as read.",
  security: bearerSecurity,
  request: { params: idParamSchema },
  responses: {
    200: jsonResponse("Updated unread count.", z.object({ unread: z.number() })),
    ...standardErrorResponses,
  },
});

registry.registerPath({
  method: "patch",
  path: "/api/conversations/{id}/status",
  tags: TAGS,
  summary: "Update a conversation's status (open/waiting/pending/resolved/archived).",
  security: bearerSecurity,
  request: { params: idParamSchema, body: { content: { "application/json": { schema: updateStatusSchema } } } },
  responses: {
    200: jsonResponse("Updated conversation.", dataResponseSchema),
    ...standardErrorResponses,
  },
});

registry.registerPath({
  method: "patch",
  path: "/api/conversations/{id}/settings",
  tags: TAGS,
  summary: "Update a conversation's pinned/muted settings.",
  security: bearerSecurity,
  request: { params: idParamSchema, body: { content: { "application/json": { schema: updateSettingsSchema } } } },
  responses: {
    200: jsonResponse("Updated conversation.", dataResponseSchema),
    ...standardErrorResponses,
  },
});

registry.registerPath({
  method: "post",
  path: "/api/conversations/",
  tags: TAGS,
  summary: "Create a conversation with a contact.",
  security: bearerSecurity,
  request: { body: { content: { "application/json": { schema: createConversationBodySchema } } } },
  responses: {
    201: jsonResponse("Created conversation.", dataResponseSchema),
    ...standardErrorResponses,
  },
});

registry.registerPath({
  method: "post",
  path: "/api/conversations/{id}/add-to-crm",
  tags: TAGS,
  summary: "Add the conversation's contact to the CRM board at a given stage.",
  security: bearerSecurity,
  request: { params: idParamSchema, body: { content: { "application/json": { schema: addToCrmBodySchema } } } },
  responses: {
    200: jsonResponse("Updated contact.", dataResponseSchema),
    ...standardErrorResponses,
  },
});

registry.registerPath({
  method: "patch",
  path: "/api/conversations/{id}/assignment",
  tags: TAGS,
  summary: "Assign or unassign a conversation to a team member.",
  security: bearerSecurity,
  request: { params: idParamSchema, body: { content: { "application/json": { schema: updateAssignmentSchema } } } },
  responses: {
    200: jsonResponse("Updated conversation.", dataResponseSchema),
    ...standardErrorResponses,
  },
});

registry.registerPath({
  method: "post",
  path: "/api/conversations/{id}/template",
  tags: TAGS,
  summary: "Send a WhatsApp template message into a conversation.",
  security: bearerSecurity,
  request: { params: idParamSchema, body: { content: { "application/json": { schema: sendTemplateBodySchema } } } },
  responses: {
    201: jsonResponse("Sent message.", dataResponseSchema),
    ...standardErrorResponses,
  },
});

registry.registerPath({
  method: "post",
  path: "/api/conversations/{id}/messages",
  tags: TAGS,
  summary: "Send a free-form text/attachment message into a conversation.",
  security: bearerSecurity,
  request: { params: idParamSchema, body: { content: { "application/json": { schema: sendMessageBodySchema } } } },
  responses: {
    201: jsonResponse("Sent message.", dataResponseSchema),
    ...standardErrorResponses,
  },
});

registry.registerPath({
  method: "post",
  path: "/api/conversations/{id}/notes",
  tags: TAGS,
  summary: "Add an internal note to a conversation.",
  security: bearerSecurity,
  request: { params: idParamSchema, body: { content: { "application/json": { schema: addNoteBodySchema } } } },
  responses: {
    201: jsonResponse("Created note.", dataResponseSchema),
    ...standardErrorResponses,
  },
});
