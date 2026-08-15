import { z } from "zod";
import { bearerSecurity, jsonResponse, rawResponse, registry, standardErrorResponses } from "../registry.js";
import { analyticsQuerySchema } from "../../routes/analytics.js";

const TAGS = ["Analytics"];

registry.registerPath({
  method: "get",
  path: "/api/analytics/summary",
  tags: TAGS,
  summary: "Aggregate analytics for the workspace over a date range (messages, campaigns, agent performance).",
  security: bearerSecurity,
  request: { query: analyticsQuerySchema },
  responses: {
    200: jsonResponse("Analytics summary.", z.unknown()),
    ...standardErrorResponses,
  },
});

registry.registerPath({
  method: "get",
  path: "/api/analytics/export/excel",
  tags: TAGS,
  summary: "Export the analytics summary as CSV.",
  security: bearerSecurity,
  request: { query: analyticsQuerySchema },
  responses: {
    200: rawResponse("CSV export.", "text/csv"),
    ...standardErrorResponses,
  },
});

registry.registerPath({
  method: "get",
  path: "/api/analytics/export/pdf",
  tags: TAGS,
  summary: "Export the analytics summary as a PDF report.",
  security: bearerSecurity,
  request: { query: analyticsQuerySchema },
  responses: {
    200: rawResponse("PDF export.", "application/pdf"),
    ...standardErrorResponses,
  },
});
