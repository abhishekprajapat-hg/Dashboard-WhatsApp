import test from "node:test";
import assert from "node:assert/strict";
import { credentialSummary, decodeCredentials, encodeCredentials } from "../services/whatsappProvider.js";

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
