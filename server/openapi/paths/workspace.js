import { z } from "zod";
import { bearerSecurity, jsonResponse, registry, standardErrorResponses } from "../registry.js";
import { createWorkspaceSchema, updateWorkspaceSchema } from "../../routes/workspace.js";

const TAGS = ["Workspace"];
const workspaceResponseSchema = z.object({ workspace: z.unknown() });

registry.registerPath({
  method: "get",
  path: "/api/workspaces/current",
  tags: TAGS,
  summary: "Get the current workspace.",
  security: bearerSecurity,
  responses: {
    200: jsonResponse("Current workspace.", workspaceResponseSchema),
    ...standardErrorResponses,
  },
});

registry.registerPath({
  method: "post",
  path: "/api/workspaces/",
  tags: TAGS,
  summary: "Create a new workspace under the current organization.",
  security: bearerSecurity,
  request: { body: { content: { "application/json": { schema: createWorkspaceSchema } } } },
  responses: {
    201: jsonResponse("Created workspace.", workspaceResponseSchema),
    ...standardErrorResponses,
  },
});

registry.registerPath({
  method: "put",
  path: "/api/workspaces/current",
  tags: TAGS,
  summary: "Update the current workspace.",
  security: bearerSecurity,
  request: { body: { content: { "application/json": { schema: updateWorkspaceSchema } } } },
  responses: {
    200: jsonResponse("Updated workspace.", workspaceResponseSchema),
    ...standardErrorResponses,
  },
});
