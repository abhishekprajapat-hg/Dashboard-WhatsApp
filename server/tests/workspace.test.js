import test from "node:test";
import assert from "node:assert/strict";
import { requireWorkspaceContext, workspaceScope } from "../middleware/workspace.js";

function runMiddleware(req) {
  let statusCode = 200;
  let payload;
  let nextCalled = false;
  const res = {
    status(code) {
      statusCode = code;
      return this;
    },
    json(body) {
      payload = body;
      return this;
    },
  };

  requireWorkspaceContext(req, res, () => {
    nextCalled = true;
  });

  return { statusCode, payload, nextCalled };
}

test("requires workspace and organization context", () => {
  const result = runMiddleware({ user: { sub: "user_1" } });
  assert.equal(result.nextCalled, false);
  assert.equal(result.statusCode, 403);
  assert.equal(result.payload.error, "WORKSPACE_REQUIRED");
});

test("allows requests with workspace context when database validation is inactive", () => {
  const result = runMiddleware({ user: { workspaceId: "demo_workspace", organizationId: "demo_org" } });
  assert.equal(result.nextCalled, true);
});

test("builds a reusable workspace scope from request user", () => {
  assert.deepEqual(
    workspaceScope({ user: { workspaceId: "w1", organizationId: "o1" } }),
    { workspaceId: "w1", organizationId: "o1" }
  );
});
