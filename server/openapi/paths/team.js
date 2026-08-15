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
import { updateMemberSchema } from "../../routes/team.js";

const TAGS = ["Team"];

// Documentation-only - this route validates name/email/password manually (isEmail/passwordPolicy
// helpers) rather than through a Zod schema today, a real gap this OpenAPI pass doesn't backfill.
const inviteMemberBodySchema = z.object({
  name: z.string(),
  email: z.string(),
  role: z.string(),
  password: z.string(),
});

registry.registerPath({
  method: "get",
  path: "/api/team/",
  tags: TAGS,
  summary: "List team members.",
  security: bearerSecurity,
  responses: {
    200: jsonResponse("Team member list.", listResponseSchema),
    ...standardErrorResponses,
  },
});

registry.registerPath({
  method: "post",
  path: "/api/team/",
  tags: TAGS,
  summary: "Invite a new team member.",
  security: bearerSecurity,
  request: { body: { content: { "application/json": { schema: inviteMemberBodySchema } } } },
  responses: {
    201: jsonResponse("Created member.", dataResponseSchema),
    ...standardErrorResponses,
  },
});

registry.registerPath({
  method: "patch",
  path: "/api/team/{id}",
  tags: TAGS,
  summary: "Update a team member's role.",
  security: bearerSecurity,
  request: { params: idParamSchema, body: { content: { "application/json": { schema: updateMemberSchema } } } },
  responses: {
    200: jsonResponse("Updated member.", dataResponseSchema),
    ...standardErrorResponses,
  },
});

registry.registerPath({
  method: "delete",
  path: "/api/team/{id}",
  tags: TAGS,
  summary: "Remove a team member.",
  security: bearerSecurity,
  request: { params: idParamSchema },
  responses: {
    204: { description: "Deleted." },
    ...standardErrorResponses,
  },
});
