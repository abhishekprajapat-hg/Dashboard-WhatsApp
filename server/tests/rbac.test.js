import test from "node:test";
import assert from "node:assert/strict";
import { hasPermission } from "../middleware/auth.js";
import { normalizeRoleKey, roleDefinitionFor, roleKeys } from "../utils/rbac.js";

test("defines the required production roles", () => {
  assert.deepEqual(roleKeys, ["super_admin", "admin", "manager", "agent", "viewer"]);
});

test("normalizes legacy workspace admin role", () => {
  assert.equal(normalizeRoleKey("workspace_admin"), "admin");
  assert.equal(normalizeRoleKey("bad-role"), "agent");
});

test("checks wildcard and explicit permissions", () => {
  assert.equal(hasPermission({ roleKey: "admin", permissions: ["*"] }, "settings:write"), true);
  assert.equal(hasPermission({ roleKey: "viewer", permissions: ["contacts:read"] }, "contacts:read"), true);
  assert.equal(hasPermission({ roleKey: "viewer", permissions: ["contacts:read"] }, "contacts:write"), false);
});

test("viewer role stays read-only", () => {
  const viewer = roleDefinitionFor("viewer");
  assert.equal(viewer.permissions.includes("contacts:read"), true);
  assert.equal(viewer.permissions.includes("contacts:write"), false);
});
