import {
  bearerSecurity,
  dataResponseSchema,
  idParamSchema,
  jsonResponse,
  listResponseSchema,
  registry,
  standardErrorResponses,
} from "../registry.js";
import { eventBodySchema, listEventsQuerySchema, patchEventSchema } from "../../routes/calendarEvents.js";

const TAGS = ["Calendar"];

registry.registerPath({
  method: "get",
  path: "/api/calendar-events/",
  tags: TAGS,
  summary: "List calendar events, optionally bounded by a from/to range (for the month-grid view).",
  security: bearerSecurity,
  request: { query: listEventsQuerySchema },
  responses: {
    200: jsonResponse("Event list.", listResponseSchema),
    ...standardErrorResponses,
  },
});

registry.registerPath({
  method: "post",
  path: "/api/calendar-events/",
  tags: TAGS,
  summary: "Create a calendar event.",
  security: bearerSecurity,
  request: { body: { content: { "application/json": { schema: eventBodySchema } } } },
  responses: {
    201: jsonResponse("Created event.", dataResponseSchema),
    ...standardErrorResponses,
  },
});

registry.registerPath({
  method: "patch",
  path: "/api/calendar-events/{id}",
  tags: TAGS,
  summary: "Update a calendar event.",
  security: bearerSecurity,
  request: { params: idParamSchema, body: { content: { "application/json": { schema: patchEventSchema } } } },
  responses: {
    200: jsonResponse("Updated event.", dataResponseSchema),
    ...standardErrorResponses,
  },
});

registry.registerPath({
  method: "delete",
  path: "/api/calendar-events/{id}",
  tags: TAGS,
  summary: "Delete a calendar event.",
  security: bearerSecurity,
  request: { params: idParamSchema },
  responses: {
    204: { description: "Deleted." },
    ...standardErrorResponses,
  },
});
