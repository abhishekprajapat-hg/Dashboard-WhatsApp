import {
  bearerSecurity,
  dataResponseSchema,
  idParamSchema,
  jsonResponse,
  listResponseSchema,
  registry,
  standardErrorResponses,
} from "../registry.js";
import { bulkImportContactsSchema, createContactSchema, listContactsQuerySchema, updateContactSchema } from "../../routes/contacts.js";

const TAGS = ["Contacts"];

registry.registerPath({
  method: "get",
  path: "/api/contacts/",
  tags: TAGS,
  summary: "List contacts, paginated and filtered by search text, lifecycle, stage, source, owner, or tag.",
  security: bearerSecurity,
  request: { query: listContactsQuerySchema },
  responses: {
    200: jsonResponse("Contact list.", listResponseSchema),
    ...standardErrorResponses,
  },
});

registry.registerPath({
  method: "get",
  path: "/api/contacts/filter-options",
  tags: TAGS,
  summary: "Get the distinct stage/source/tag values available to filter contacts by.",
  security: bearerSecurity,
  responses: {
    200: jsonResponse("Filter options.", dataResponseSchema),
    ...standardErrorResponses,
  },
});

registry.registerPath({
  method: "post",
  path: "/api/contacts/bulk-import",
  tags: TAGS,
  summary: "Bulk-create contacts from parsed CSV rows. Skips duplicates by phone, reports per-row errors.",
  security: bearerSecurity,
  request: { body: { content: { "application/json": { schema: bulkImportContactsSchema } } } },
  responses: {
    201: jsonResponse("Import result summary.", dataResponseSchema),
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
