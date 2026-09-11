import test from "node:test";
import assert from "node:assert/strict";
import { config } from "../config.js";
import { requireActionPassword } from "../middleware/requireActionPassword.js";
import { hashPassword } from "../utils/password.js";

const PASSWORD = "a-real-destructive-password";

function fakeReq(headerValue, body = {}) {
  return {
    method: "DELETE",
    originalUrl: "/api/whatsapp/accounts/abc",
    ip: "127.0.0.1",
    body,
    // No user: recordAttempt returns early, so these tests exercise the decision logic without
    // needing a database connection for the audit write.
    user: undefined,
    get(name) {
      if (String(name).toLowerCase() === "x-action-password") return headerValue;
      return "";
    },
  };
}

function fakeRes() {
  return {
    statusCode: 0,
    payload: null,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(body) {
      this.payload = body;
      return this;
    },
  };
}

function run(headerValue, body) {
  const res = fakeRes();
  let nextCalled = false;
  requireActionPassword(fakeReq(headerValue, body), res, () => {
    nextCalled = true;
  });
  return { res, nextCalled };
}

test("fails closed with 503 when no hash is configured", () => {
  const previous = config.destructiveActionPasswordHash;
  config.destructiveActionPasswordHash = "";
  try {
    const { res, nextCalled } = run(PASSWORD);
    assert.equal(nextCalled, false, "must not run the destructive handler when unconfigured");
    assert.equal(res.statusCode, 503);
    assert.equal(res.payload.error, "ACTION_PASSWORD_NOT_CONFIGURED");
  } finally {
    config.destructiveActionPasswordHash = previous;
  }
});

test("asks for the password with 428, not 401", () => {
  const previous = config.destructiveActionPasswordHash;
  config.destructiveActionPasswordHash = hashPassword(PASSWORD);
  try {
    const { res, nextCalled } = run("");
    assert.equal(nextCalled, false);
    // 401 would make the client clear the session and log the operator out instead of prompting.
    assert.equal(res.statusCode, 428);
    assert.equal(res.payload.error, "ACTION_PASSWORD_REQUIRED");
  } finally {
    config.destructiveActionPasswordHash = previous;
  }
});

test("rejects a wrong password with 403 and does not continue", () => {
  const previous = config.destructiveActionPasswordHash;
  config.destructiveActionPasswordHash = hashPassword(PASSWORD);
  try {
    const { res, nextCalled } = run("not-the-password");
    assert.equal(nextCalled, false);
    assert.equal(res.statusCode, 403);
    assert.equal(res.payload.error, "ACTION_PASSWORD_INVALID");
  } finally {
    config.destructiveActionPasswordHash = previous;
  }
});

test("accepts the correct password from the header or the body", () => {
  const previous = config.destructiveActionPasswordHash;
  config.destructiveActionPasswordHash = hashPassword(PASSWORD);
  try {
    assert.equal(run(PASSWORD).nextCalled, true, "header form should pass");
    assert.equal(run("", { actionPassword: PASSWORD }).nextCalled, true, "body form should pass");
  } finally {
    config.destructiveActionPasswordHash = previous;
  }
});

test("does not leak the supplied value in any response body", () => {
  const previous = config.destructiveActionPasswordHash;
  config.destructiveActionPasswordHash = hashPassword(PASSWORD);
  try {
    const { res } = run("some-guess");
    assert.ok(!JSON.stringify(res.payload).includes("some-guess"));
  } finally {
    config.destructiveActionPasswordHash = previous;
  }
});
