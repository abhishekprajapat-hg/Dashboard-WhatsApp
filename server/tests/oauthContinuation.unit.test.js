import test from "node:test";
import assert from "node:assert/strict";
import jwt from "jsonwebtoken";
import { config } from "../config.js";
import { signOAuthContinuationToken, verifyOAuthContinuationToken } from "../utils/session.js";

// Regression coverage for a real account-takeover bug: /oauth/complete used to accept
// provider/providerId/name/avatarUrl straight from the request body with no proof they came from
// a real, verified OAuth exchange - anyone could plant a User row under an arbitrary providerId,
// which a real login for that identity would later silently match into. The fix binds the
// provider's real callback step's verified identity into a short-lived signed token that
// /oauth/complete must present and verify instead of re-accepting those fields as free-form JSON.

test("round-trips a real identity through sign/verify", () => {
  const token = signOAuthContinuationToken({ provider: "instagram", providerId: "17841400000000000", name: "Real User", avatarUrl: "https://example.com/a.jpg" });
  const identity = verifyOAuthContinuationToken(token);
  assert.ok(identity);
  assert.equal(identity.provider, "instagram");
  assert.equal(identity.providerId, "17841400000000000");
  assert.equal(identity.name, "Real User");
  assert.equal(identity.avatarUrl, "https://example.com/a.jpg");
});

test("rejects a token signed with a different secret (forged token)", () => {
  const forged = jwt.sign(
    { purpose: "oauth_complete", provider: "instagram", providerId: "attacker-controlled-id" },
    "wrong-secret",
    { expiresIn: "10m" }
  );
  assert.equal(verifyOAuthContinuationToken(forged), null);
});

test("rejects a token that isn't actually an oauth-continuation token - e.g. a real session JWT reused here", () => {
  // Same signing secret (config.jwtSecret), but the wrong "purpose" and shape - simulates an
  // attacker trying to replay some other real, validly-signed token against this endpoint.
  const sessionLikeToken = jwt.sign({ sub: "user123", workspaceId: "ws123" }, config.jwtSecret, { expiresIn: "15m" });
  assert.equal(verifyOAuthContinuationToken(sessionLikeToken), null);
});

test("rejects a token missing providerId even if otherwise validly signed", () => {
  const incomplete = jwt.sign({ purpose: "oauth_complete", provider: "instagram" }, config.jwtSecret, { expiresIn: "10m" });
  assert.equal(verifyOAuthContinuationToken(incomplete), null);
});

test("rejects an expired token", () => {
  const expired = jwt.sign(
    { purpose: "oauth_complete", provider: "instagram", providerId: "123" },
    config.jwtSecret,
    { expiresIn: -10 }
  );
  assert.equal(verifyOAuthContinuationToken(expired), null);
});

test("rejects garbage input without throwing", () => {
  assert.equal(verifyOAuthContinuationToken(""), null);
  assert.equal(verifyOAuthContinuationToken(undefined), null);
  assert.equal(verifyOAuthContinuationToken("not-a-real-jwt"), null);
});
