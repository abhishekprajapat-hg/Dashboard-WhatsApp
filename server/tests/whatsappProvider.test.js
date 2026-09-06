import test from "node:test";
import assert from "node:assert/strict";
import { attachmentBytes, credentialSummary, decodeCredentials, encodeCredentials } from "../services/whatsappProvider.js";

test("encodes and decodes WhatsApp credentials as a server-side blob", () => {
  const encryptedCredentials = encodeCredentials({
    accessToken: "meta-token",
    verifyToken: "verify-token",
    appSecret: "app-secret",
  });

  assert.match(encryptedCredentials, /^v1:/);
  assert.equal(encryptedCredentials.includes("meta-token"), false);

  const decoded = decodeCredentials({ encryptedCredentials });

  assert.equal(decoded.accessToken, "meta-token");
  assert.equal(decoded.verifyToken, "verify-token");
  assert.equal(decoded.appSecret, "app-secret");
});

test("credential summary does not expose secret values", () => {
  const account = {
    encryptedCredentials: encodeCredentials({
      accessToken: "meta-token",
      verifyToken: "verify-token",
      appSecret: "app-secret",
    }),
    credentialsUpdatedAt: new Date("2026-01-01T00:00:00.000Z"),
    lastTestedAt: new Date("2026-01-02T00:00:00.000Z"),
    lastError: "",
  };

  const summary = credentialSummary(account);

  assert.deepEqual({
    accessTokenConfigured: summary.accessTokenConfigured,
    verifyTokenConfigured: summary.verifyTokenConfigured,
    appSecretConfigured: summary.appSecretConfigured,
  }, {
    accessTokenConfigured: true,
    verifyTokenConfigured: true,
    appSecretConfigured: true,
  });
  assert.equal("accessToken" in summary, false);
  assert.equal("appSecret" in summary, false);
});

// Regression coverage for a real SSRF vulnerability: attachmentBytes() used to do a raw
// fetch(attachment.url) with no host/scheme restriction - any authenticated user (agent-level
// inbox:write, not admin) sending a message with an attachments[].url pointing at an internal-only
// address (e.g. the cloud metadata endpoint) had the server fetch it and deliver the response back
// to them as a real WhatsApp media message. It must now be routed through the same safeFetch/
// assertPublicUrl guard used for outbound webhooks/automation HTTP calls.
test("attachmentBytes refuses to fetch a private/internal attachment URL (SSRF guard)", async () => {
  // safeFetch's assertPublicUrl rejects before any request is made; attachmentBytes catches that
  // rejection and returns null rather than ever holding attacker-fetched bytes.
  const result = await attachmentBytes({ url: "http://169.254.169.254/latest/meta-data/" });
  assert.equal(result, null);
});

test("attachmentBytes refuses a non-http(s) attachment URL scheme", async () => {
  const result = await attachmentBytes({ url: "file:///etc/passwd" });
  assert.equal(result, null);
});
