import test from "node:test";
import assert from "node:assert/strict";
import { instagramErrorDetail } from "../services/instagramProvider.js";

// The flat envelope is the one that regressed real debugging: a HUMAN_AGENT send failed with
// "The requested user cannot be found." and the code/type never reached the browser, because the
// route only read payload.error.
test("extracts code and type from Instagram's flat error envelope", () => {
  const detail = instagramErrorDetail({
    meta: { error_type: "OAuthException", code: 400, error_message: "The requested user cannot be found." },
  });
  assert.deepEqual(detail, {
    message: "The requested user cannot be found.",
    code: 400,
    error_subcode: undefined,
    type: "OAuthException",
  });
});

test("passes through the Graph-standard error envelope unchanged", () => {
  const error = { message: "outside window", code: 10, error_subcode: 2534022, type: "OAuthException" };
  assert.deepEqual(instagramErrorDetail({ meta: { error } }), error);
});

test("returns null when there is nothing machine-readable to surface", () => {
  assert.equal(instagramErrorDetail({ meta: {} }), null);
  assert.equal(instagramErrorDetail({}), null);
  assert.equal(instagramErrorDetail(new Error("network down")), null);
});
