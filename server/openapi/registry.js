import { OpenAPIRegistry } from "@asteasolutions/zod-to-openapi";
import { z } from "zod";
import { objectIdString } from "../utils/zodHelpers.js";

// Single shared registry every server/openapi/paths/*.js file registers its endpoints into.
// Raw Zod schemas are passed straight into registerPath() without calling .openapi()/.meta() on
// them - named-ref extraction is opt-in in this library, not required, so this generates a valid
// (if fully-inlined, no $ref reuse) document without touching how any existing route schema is
// defined.
export const registry = new OpenAPIRegistry();

registry.registerComponent("securitySchemes", "bearerAuth", {
  type: "http",
  scheme: "bearer",
  bearerFormat: "JWT",
});

export const bearerSecurity = [{ bearerAuth: [] }];

// Path params - none of these exist as real validateParams schemas anywhere in the codebase today
// (every route does a manual mongoose.Types.ObjectId.isValid() check instead), so these are
// documentation-only, mirroring the actual de facto shape.
export const idParamSchema = z.object({ id: objectIdString });
export const keyParamSchema = z.object({ key: z.string() });
export const contactIdParamSchema = z.object({ contactId: objectIdString });
export const conversationIdParamSchema = z.object({ conversationId: objectIdString });
export const conversationMessageParamSchema = z.object({
  conversationId: objectIdString,
  messageId: objectIdString,
});

// Generic response shapes - deliberately not fabricated per-endpoint response bodies, since none
// exist anywhere in the codebase to draw from. These mirror the response envelopes actually
// observed across every route file.
export const errorResponseSchema = z.object({
  error: z.string(),
  message: z.string(),
  details: z.array(z.object({ path: z.string(), message: z.string() })).optional(),
});
export const dataResponseSchema = z.object({ data: z.unknown() });
export const listResponseSchema = z.object({ data: z.array(z.unknown()), total: z.number() });
export const listWithSummaryResponseSchema = z.object({
  data: z.array(z.unknown()),
  total: z.number(),
  summary: z.unknown().optional(),
});
export const okResponseSchema = z.object({ ok: z.literal(true) });

export function jsonResponse(description, schema) {
  return { description, content: { "application/json": { schema } } };
}

export function rawResponse(description, mediaType) {
  return { description, content: { [mediaType]: { schema: { type: "string" } } } };
}

// Attach to any route gated by requirePermission()/requireAuth - covers the standard error shapes
// validate.js and auth.js middleware actually produce.
export const standardErrorResponses = {
  400: jsonResponse("Validation error", errorResponseSchema),
  401: jsonResponse("Authentication required", errorResponseSchema),
  403: jsonResponse("Forbidden", errorResponseSchema),
};
