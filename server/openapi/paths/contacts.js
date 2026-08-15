import {
  bearerSecurity,
  dataResponseSchema,
  idParamSchema,
  jsonResponse,
  listResponseSchema,
  registry,
  standardErrorResponses,
} from "../registry.js";
import { createContactSchema, listContactsQuerySchema, updateContactSchema } from "../../routes/contacts.js";

const TAGS = ["Contacts"];

registry.registerPath({
  method: "get",
  path: "/api/contacts/",
  tags: TAGS,
  summary: "List contacts, optionally filtered by search text or lifecycle stage.",
  security: bearerSecurity,
  request: { query: listContactsQuerySchema },
  responses: {
    200: jsonResponse("Contact list.", listResponseSchema),
    ...standardErrorResponses,
  },
});

registry.registerPath({
  method: "post",
  path: "/api/contacts/",
  tags: TAGS,
  summary: "Create a contact.",
  security: bearerSecurity,
  request: { body: { content: { "application/json": { schema: createContactSchema } } } },
  responses: {
    201: jsonResponse("Created contact.", dataResponseSchema),
    ...standardErrorResponses,
  },
});

registry.registerPath({
  method: "put",
  path: "/api/contacts/{id}",
  tags: TAGS,
  summary: "Replace a contact's editable fields.",
  security: bearerSecurity,
  request: { params: idParamSchema, body: { content: { "application/json": { schema: updateContactSchema } } } },
  responses: {
    200: jsonResponse("Updated contact.", dataResponseSchema),
    ...standardErrorResponses,
  },
});

registry.registerPath({
  method: "delete",
  path: "/api/contacts/{id}",
  tags: TAGS,
  summary: "Delete a contact.",
  security: bearerSecurity,
  request: { params: idParamSchema },
  responses: {
    204: { description: "Deleted." },
    ...standardErrorResponses,
  },
});
