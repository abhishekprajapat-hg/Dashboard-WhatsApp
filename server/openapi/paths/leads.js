import {
  bearerSecurity,
  dataResponseSchema,
  idParamSchema,
  jsonResponse,
  listResponseSchema,
  registry,
  standardErrorResponses,
} from "../registry.js";
import { addLeadInternalCommentSchema, addLeadNoteSchema, listLeadsQuerySchema, patchLeadSchema } from "../../routes/leads.js";

const TAGS = ["Leads"];

registry.registerPath({
  method: "get",
  path: "/api/leads/",
  tags: TAGS,
  summary: "List leads, paginated and filterable by stage/owner/source.",
  security: bearerSecurity,
  request: { query: listLeadsQuerySchema },
  responses: {
    200: jsonResponse("Lead list.", listResponseSchema),
    ...standardErrorResponses,
  },
});

registry.registerPath({
  method: "get",
  path: "/api/leads/{id}",
  tags: TAGS,
  summary: "Get a lead's full detail, including its timeline.",
  security: bearerSecurity,
  request: { params: idParamSchema },
  responses: {
    200: jsonResponse("Lead detail.", dataResponseSchema),
    ...standardErrorResponses,
  },
});

registry.registerPath({
  method: "patch",
  path: "/api/leads/{id}",
  tags: TAGS,
  summary: "Update a lead's stage, owner, follow-up date, or deal value. Appends a timeline entry per change.",
  security: bearerSecurity,
  request: { params: idParamSchema, body: { content: { "application/json": { schema: patchLeadSchema } } } },
  responses: {
    200: jsonResponse("Updated lead.", dataResponseSchema),
    ...standardErrorResponses,
  },
});

registry.registerPath({
  method: "post",
  path: "/api/leads/{id}/notes",
  tags: TAGS,
  summary: "Add a note to a lead's timeline.",
  security: bearerSecurity,
  request: { params: idParamSchema, body: { content: { "application/json": { schema: addLeadNoteSchema } } } },
  responses: {
    200: jsonResponse("Updated lead.", dataResponseSchema),
    ...standardErrorResponses,
  },
});

registry.registerPath({
  method: "post",
  path: "/api/leads/{id}/internal-comments",
  tags: TAGS,
  summary: "Add a private, team-only internal comment to a lead (separate from its activity timeline).",
  security: bearerSecurity,
  request: { params: idParamSchema, body: { content: { "application/json": { schema: addLeadInternalCommentSchema } } } },
  responses: {
    200: jsonResponse("Updated lead.", dataResponseSchema),
    ...standardErrorResponses,
  },
});
