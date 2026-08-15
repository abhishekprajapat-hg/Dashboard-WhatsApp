import { z } from "zod";
import { bearerSecurity, jsonResponse, registry, standardErrorResponses } from "../registry.js";

const TAGS = ["Dashboard"];

registry.registerPath({
  method: "get",
  path: "/api/dashboard/summary",
  tags: TAGS,
  summary: "Home dashboard summary - KPIs, message volume, agent performance, team workload, recent conversations, health.",
  security: bearerSecurity,
  responses: {
    200: jsonResponse("Dashboard summary.", z.unknown()),
    ...standardErrorResponses,
  },
});
