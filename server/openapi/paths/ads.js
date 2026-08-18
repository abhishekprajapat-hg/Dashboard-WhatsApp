import {
  bearerSecurity,
  dataResponseSchema,
  idParamSchema,
  jsonResponse,
  listResponseSchema,
  registry,
  standardErrorResponses,
} from "../registry.js";
import { connectAdsAccountSchema, createAdCampaignSchema } from "../../routes/ads.js";

const TAGS = ["Ads"];

registry.registerPath({
  method: "get",
  path: "/api/ads/accounts",
  tags: TAGS,
  summary: "List connected Meta Ads accounts for the workspace.",
  security: bearerSecurity,
  responses: {
    200: jsonResponse("Ads account list.", listResponseSchema),
    ...standardErrorResponses,
  },
});

registry.registerPath({
  method: "post",
  path: "/api/ads/accounts",
  tags: TAGS,
  summary: "Connect (or update) a Meta Ads account for Click-to-WhatsApp campaigns.",
  security: bearerSecurity,
  request: { body: { content: { "application/json": { schema: connectAdsAccountSchema } } } },
  responses: {
    201: jsonResponse("Connected ads account.", dataResponseSchema),
    ...standardErrorResponses,
  },
});

registry.registerPath({
  method: "post",
  path: "/api/ads/accounts/{id}/test",
  tags: TAGS,
  summary: "Test a connected Meta Ads account's credentials.",
  security: bearerSecurity,
  request: { params: idParamSchema },
  responses: {
    200: jsonResponse("Connection test result.", dataResponseSchema),
    ...standardErrorResponses,
  },
});

registry.registerPath({
  method: "delete",
  path: "/api/ads/accounts/{id}",
  tags: TAGS,
  summary: "Disconnect a Meta Ads account.",
  security: bearerSecurity,
  request: { params: idParamSchema },
  responses: {
    204: { description: "Deleted." },
    ...standardErrorResponses,
  },
});

registry.registerPath({
  method: "get",
  path: "/api/ads/campaigns",
  tags: TAGS,
  summary: "List Click-to-WhatsApp ad campaigns created from this workspace.",
  security: bearerSecurity,
  responses: {
    200: jsonResponse("Ad campaign list.", listResponseSchema),
    ...standardErrorResponses,
  },
});

registry.registerPath({
  method: "get",
  path: "/api/ads/campaigns/{id}",
  tags: TAGS,
  summary: "Get a single ad campaign.",
  security: bearerSecurity,
  request: { params: idParamSchema },
  responses: {
    200: jsonResponse("Ad campaign.", dataResponseSchema),
    ...standardErrorResponses,
  },
});

registry.registerPath({
  method: "post",
  path: "/api/ads/campaigns",
  tags: TAGS,
  summary: "Create a Click-to-WhatsApp ad campaign on Meta, left PAUSED (no spend) until manually activated in Ads Manager.",
  security: bearerSecurity,
  request: { body: { content: { "application/json": { schema: createAdCampaignSchema } } } },
  responses: {
    201: jsonResponse("Created (paused) ad campaign.", dataResponseSchema),
    ...standardErrorResponses,
  },
});
