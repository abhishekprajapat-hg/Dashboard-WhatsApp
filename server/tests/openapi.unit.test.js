import test from "node:test";
import assert from "node:assert/strict";
import { buildOpenApiDocument } from "../openapi/generate.js";

const document = buildOpenApiDocument();

test("generates a well-formed OpenAPI 3.1 document", () => {
  assert.equal(document.openapi, "3.1.0");
  assert.equal(document.info.title, "WhatsCRM API");
  assert.ok(document.paths && typeof document.paths === "object");
  assert.ok(Object.keys(document.paths).length > 50, "expected a substantial number of paths");
});

test("registers the bearerAuth security scheme", () => {
  assert.deepEqual(document.components.securitySchemes.bearerAuth, {
    type: "http",
    scheme: "bearer",
    bearerFormat: "JWT",
  });
});

test("the whole document serializes cleanly (no circular refs / unsupported values)", () => {
  const serialized = JSON.stringify(document);
  assert.ok(serialized.length > 1000);
  assert.doesNotThrow(() => JSON.parse(serialized));
});

test("spot-checks representative paths/methods/tags match the real routes", () => {
  assert.deepEqual(Object.keys(document.paths["/api/tasks/"]), ["get", "post"]);
  assert.deepEqual(Object.keys(document.paths["/api/admin/feature-flags/{key}"]), ["put", "delete"]);
  assert.ok(document.paths["/api/campaigns/{id}/send"]?.post);
  assert.ok(document.paths["/api/automation/{id}/runs"]?.get);
  assert.ok(document.paths["/webhooks/whatsapp/"]?.post, "public webhook route should still be documented");

  assert.deepEqual(document.paths["/api/tasks/"].get.tags, ["Tasks"]);
  assert.deepEqual(document.paths["/api/admin/overview"].get.tags, ["Admin"]);
});

test("protected routes carry bearerAuth security; the public webhook/login routes do not", () => {
  assert.deepEqual(document.paths["/api/tasks/"].get.security, [{ bearerAuth: [] }]);
  assert.equal(document.paths["/api/auth/login"].post.security, undefined);
  assert.equal(document.paths["/webhooks/whatsapp/"].post.security, undefined);
});
