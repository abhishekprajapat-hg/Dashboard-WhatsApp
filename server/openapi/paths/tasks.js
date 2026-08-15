import {
  bearerSecurity,
  dataResponseSchema,
  idParamSchema,
  jsonResponse,
  listResponseSchema,
  registry,
  standardErrorResponses,
} from "../registry.js";
import { listTasksQuerySchema, patchTaskSchema, taskBodySchema } from "../../routes/tasks.js";

const TAGS = ["Tasks"];

registry.registerPath({
  method: "get",
  path: "/api/tasks/",
  tags: TAGS,
  summary: "List tasks, optionally filtered by status or assignee.",
  security: bearerSecurity,
  request: { query: listTasksQuerySchema },
  responses: {
    200: jsonResponse("Task list.", listResponseSchema),
    ...standardErrorResponses,
  },
});

registry.registerPath({
  method: "post",
  path: "/api/tasks/",
  tags: TAGS,
  summary: "Create a task.",
  security: bearerSecurity,
  request: { body: { content: { "application/json": { schema: taskBodySchema } } } },
  responses: {
    201: jsonResponse("Created task.", dataResponseSchema),
    ...standardErrorResponses,
  },
});

registry.registerPath({
  method: "patch",
  path: "/api/tasks/{id}",
  tags: TAGS,
  summary: "Update a task (sparse update, including status).",
  security: bearerSecurity,
  request: { params: idParamSchema, body: { content: { "application/json": { schema: patchTaskSchema } } } },
  responses: {
    200: jsonResponse("Updated task.", dataResponseSchema),
    ...standardErrorResponses,
  },
});

registry.registerPath({
  method: "delete",
  path: "/api/tasks/{id}",
  tags: TAGS,
  summary: "Delete a task.",
  security: bearerSecurity,
  request: { params: idParamSchema },
  responses: {
    204: { description: "Deleted." },
    ...standardErrorResponses,
  },
});
