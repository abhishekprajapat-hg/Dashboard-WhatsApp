import test from "node:test";
import assert from "node:assert/strict";
import { isEmail, passwordPolicy, requiredString } from "../utils/validation.js";

test("validates email shape", () => {
  assert.equal(isEmail("agent@example.com"), true);
  assert.equal(isEmail("bad-address"), false);
  assert.equal(isEmail("missing@example"), false);
});

test("enforces production password policy", () => {
  assert.equal(passwordPolicy("123456").valid, false);
  assert.equal(passwordPolicy("StrongPass1").valid, true);
});

test("trims and bounds required strings", () => {
  assert.equal(requiredString("  Sales Team  ", 20), "Sales Team");
  assert.equal(requiredString("abcdef", 3), "abc");
});
