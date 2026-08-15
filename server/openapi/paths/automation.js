import { z } from "zod";
import {
  bearerSecurity,
  dataResponseSchema,
  idParamSchema,
  jsonResponse,
  listWithSummaryResponseSchema,
  registry,
  standardErrorResponses,
} from "../registry.js";
import { createFlowSchema, testFlowSchema, updateFlowSchema } from "../../routes/automation.js";

const TAGS = ["Automation"];

registry.registerPath({
  method: "get",
  path: "/api/automation/{id}/runs",
  tags: TAGS,
  summary: "Run history for a flow, including nested sub_workflow child runs.",
  security: bearerSecurity,
  request: { params: idParamSchema },
  responses: {
    200: jsonResponse("Run history.", dataResponseSchema),
    ...standardErrorResponses,
  },
});

registry.registerPath({
  method: "get",
  path: "/api/automation/",
  tags: TAGS,
  summary: "List automation flows for the workspace.",
  security: bearerSecurity,
  responses: {
    200: jsonResponse("Flow list.", listWithSummaryResponseSchema),
    ...standardErrorResponses,
  },
});

registry.registerPath({
  method: "post",
  path: "/api/automation/",
  tags: TAGS,
  summary: "Create a new automation flow.",
  security: bearerSecurity,
  request: { body: { content: { "application/json": { schema: createFlowSchema } } } },
  responses: {
    201: jsonResponse("Created flow.", dataResponseSchema),
    ...standardErrorResponses,
  },
});

registry.registerPath({
  method: "patch",
  path: "/api/automation/{id}",
  tags: TAGS,
  summary: "Update an automation flow (sparse update).",
  security: bearerSecurity,
  request: { params: idParamSchema, body: { content: { "application/json": { schema: updateFlowSchema } } } },
  responses: {
    200: jsonResponse("Updated flow.", dataResponseSchema),
    ...standardErrorResponses,
  },
});

registry.registerPath({
  method: "post",
  path: "/api/automation/{id}/test",
  tags: TAGS,
  summary: "Run a flow synchronously in test mode against a sample message.",
  security: bearerSecurity,
  request: { params: idParamSchema, body: { content: { "application/json": { schema: testFlowSchema } } } },
  responses: {
    200: jsonResponse("Test run result.", z.unknown()),
    ...standardErrorResponses,
  },
});

registry.registerPath({
  method: "delete",
  path: "/api/automation/{id}",
  tags: TAGS,
  summary: "Delete an automation flow.",
  security: bearerSecurity,
  request: { params: idParamSchema },
  responses: {
    204: { description: "Deleted." },
    ...standardErrorResponses,
  },
});
