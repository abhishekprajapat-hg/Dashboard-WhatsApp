import { bearerSecurity, dataResponseSchema, jsonResponse, registry, standardErrorResponses } from "../registry.js";
import { uploadMediaSchema } from "../../routes/media.js";

const TAGS = ["Media"];

registry.registerPath({
  method: "post",
  path: "/api/media/upload",
  tags: TAGS,
  summary: "Upload a base64-encoded media attachment.",
  security: bearerSecurity,
  request: { body: { content: { "application/json": { schema: uploadMediaSchema } } } },
  responses: {
    201: jsonResponse("Uploaded media.", dataResponseSchema),
    ...standardErrorResponses,
  },
});
