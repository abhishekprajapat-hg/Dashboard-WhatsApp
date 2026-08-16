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
import {
  campaignActionSchema,
  createCampaignSchema,
  importCampaignContactsSchema,
  previewCampaignSchema,
  sendCampaignSchema,
  updateCampaignSchema,
} from "../../routes/campaigns.js";

const TAGS = ["Campaigns"];

registry.registerPath({
  method: "get",
  path: "/api/campaigns/",
  tags: TAGS,
  summary: "List campaigns for the workspace.",
  security: bearerSecurity,
  responses: {
    200: jsonResponse("Campaign list.", listWithSummaryResponseSchema),
    ...standardErrorResponses,
  },
});

registry.registerPath({
  method: "post",
  path: "/api/campaigns/preview",
  tags: TAGS,
  summary: "Preview the audience an audience-filter set would resolve to, without creating a campaign.",
  security: bearerSecurity,
  request: { body: { content: { "application/json": { schema: previewCampaignSchema } } } },
  responses: {
    200: jsonResponse("Audience preview.", dataResponseSchema),
    ...standardErrorResponses,
  },
});

registry.registerPath({
  method: "get",
  path: "/api/campaigns/{id}",
  tags: TAGS,
  summary: "Get a single campaign.",
  security: bearerSecurity,
  request: { params: idParamSchema },
  responses: {
    200: jsonResponse("Campaign.", dataResponseSchema),
    ...standardErrorResponses,
  },
});

registry.registerPath({
  method: "post",
  path: "/api/campaigns/",
  tags: TAGS,
  summary: "Create a campaign.",
  security: bearerSecurity,
  request: { body: { content: { "application/json": { schema: createCampaignSchema } } } },
  responses: {
    201: jsonResponse("Created campaign.", dataResponseSchema),
    ...standardErrorResponses,
  },
});

registry.registerPath({
  method: "post",
  path: "/api/campaigns/{id}/send",
  tags: TAGS,
  summary: "Send (or queue) a campaign to its resolved audience.",
  security: bearerSecurity,
  request: { params: idParamSchema, body: { content: { "application/json": { schema: sendCampaignSchema } } } },
  responses: {
    200: jsonResponse("Send result.", z.object({ data: z.unknown(), recipients: z.number(), queueMode: z.string() })),
    ...standardErrorResponses,
  },
});

registry.registerPath({
  method: "patch",
  path: "/api/campaigns/{id}",
  tags: TAGS,
  summary: "Update a campaign (sparse update).",
  security: bearerSecurity,
  request: { params: idParamSchema, body: { content: { "application/json": { schema: updateCampaignSchema } } } },
  responses: {
    200: jsonResponse("Updated campaign.", dataResponseSchema),
    ...standardErrorResponses,
  },
});

registry.registerPath({
  method: "post",
  path: "/api/campaigns/{id}/action",
  tags: TAGS,
  summary: "Apply a lifecycle action to a campaign (submit for approval, approve, reject, pause, resume, cancel, retry).",
  security: bearerSecurity,
  request: { params: idParamSchema, body: { content: { "application/json": { schema: campaignActionSchema } } } },
  responses: {
    200: jsonResponse("Updated campaign.", dataResponseSchema),
    ...standardErrorResponses,
  },
});

registry.registerPath({
  method: "post",
  path: "/api/campaigns/import",
  tags: TAGS,
  summary: "Bulk-import contacts from a contacts array or CSV text.",
  security: bearerSecurity,
  request: { body: { content: { "application/json": { schema: importCampaignContactsSchema } } } },
  responses: {
    201: jsonResponse("Import result.", z.object({ created: z.number(), updated: z.number(), failed: z.number(), failures: z.array(z.unknown()) })),
    ...standardErrorResponses,
  },
});

registry.registerPath({
  method: "delete",
  path: "/api/campaigns/{id}",
  tags: TAGS,
  summary: "Delete a campaign.",
  security: bearerSecurity,
  request: { params: idParamSchema },
  responses: {
    204: { description: "Deleted." },
    ...standardErrorResponses,
  },
});
