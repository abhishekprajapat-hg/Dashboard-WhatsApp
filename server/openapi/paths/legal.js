import { rawResponse, registry } from "../registry.js";

const TAGS = ["Legal"];

registry.registerPath({
  method: "get",
  path: "/legal/terms-of-service",
  tags: TAGS,
  summary: "Public terms of service page.",
  responses: {
    200: rawResponse("HTML page.", "text/html"),
  },
});

registry.registerPath({
  method: "get",
  path: "/legal/data-deletion",
  tags: TAGS,
  summary: "Public data deletion instructions page (required by Meta app review).",
  responses: {
    200: rawResponse("HTML page.", "text/html"),
  },
});
