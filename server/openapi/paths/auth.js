import { z } from "zod";
import { bearerSecurity, errorResponseSchema, jsonResponse, registry } from "../registry.js";
import { loginSchema } from "../../routes/auth.js";

const TAGS = ["Auth"];

const sessionResponseSchema = z.object({
  token: z.string(),
  user: z.unknown(),
  workspace: z.unknown(),
});

registry.registerPath({
  method: "get",
  path: "/api/auth/me",
  tags: TAGS,
  summary: "Resolve the current session from the bearer token and re-issue a fresh workspace session.",
  security: bearerSecurity,
  responses: {
    200: jsonResponse("Current session.", sessionResponseSchema),
    401: jsonResponse("Missing or invalid token.", errorResponseSchema),
  },
});

registry.registerPath({
  method: "post",
  path: "/api/auth/login",
  tags: TAGS,
  summary: "Authenticate with email/password and receive a session token.",
  request: { body: { content: { "application/json": { schema: loginSchema } } } },
  responses: {
    200: jsonResponse("New session.", sessionResponseSchema),
    400: jsonResponse("Validation error.", errorResponseSchema),
    401: jsonResponse("Invalid credentials.", errorResponseSchema),
  },
});
