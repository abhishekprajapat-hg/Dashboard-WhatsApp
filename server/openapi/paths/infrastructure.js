import { z } from "zod";
import { bearerSecurity, dataResponseSchema, jsonResponse, registry, standardErrorResponses } from "../registry.js";

const TAGS = ["Infrastructure"];

registry.registerPath({
  method: "get",
  path: "/api/infrastructure/status",
  tags: TAGS,
  summary: "Backend ops/diagnostics snapshot - health, feature flags, queue status, capabilities. Not used by any client UI.",
  security: bearerSecurity,
  responses: {
    200: jsonResponse("Infrastructure status.", z.unknown()),
    ...standardErrorResponses,
  },
});

registry.registerPath({
  method: "post",
  path: "/api/infrastructure/jobs/test",
  tags: TAGS,
  summary: "Enqueue a test job on the maintenance queue.",
  security: bearerSecurity,
  responses: {
    200: jsonResponse("Enqueue result.", dataResponseSchema),
    ...standardErrorResponses,
  },
});

registry.registerPath({
  method: "post",
  path: "/api/infrastructure/events/test",
  tags: TAGS,
  summary: "Publish a test event to the RabbitMQ event bus.",
  security: bearerSecurity,
  responses: {
    200: jsonResponse("Publish result.", dataResponseSchema),
    ...standardErrorResponses,
  },
});
