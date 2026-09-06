import test from "node:test";
import assert from "node:assert/strict";
import { extensionFor } from "../services/mediaStorage.js";

// Regression coverage for a real stored-XSS bug: extensionFor() used to prefer a caller-supplied
// filename's extension over the server-validated mimeType, so an allow-listed mimeType (e.g.
// text/plain) paired with a filename like "pwn.html" got stored - and served - as real HTML.
// extensionFor() must now derive the extension solely from mimeType, ignoring any filename.

test("maps every known mimeType to its real extension", () => {
  assert.equal(extensionFor("image/jpeg"), ".jpg");
  assert.equal(extensionFor("image/png"), ".png");
  assert.equal(extensionFor("application/pdf"), ".pdf");
  assert.equal(extensionFor("text/plain"), ".txt");
  assert.equal(extensionFor("application/msword"), ".doc");
  assert.equal(extensionFor("application/vnd.openxmlformats-officedocument.wordprocessingml.document"), ".docx");
  assert.equal(extensionFor("application/vnd.ms-excel"), ".xls");
  assert.equal(extensionFor("application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"), ".xlsx");
});

test("falls back to the inert .bin extension for an unmapped mimeType", () => {
  assert.equal(extensionFor("application/octet-stream"), ".bin");
  assert.equal(extensionFor(""), ".bin");
});

test("never derives an extension from a filename - a text/plain upload named pwn.html stays .txt, not .html", () => {
  // extensionFor() no longer even accepts a name argument. Calling it the OLD way (mimeType as the
  // second positional arg, like `extensionFor("pwn.html", "text/plain")`) must not silently work -
  // confirms no name-based fallback path exists to reopen the stored-XSS bug.
  assert.equal(extensionFor("pwn.html", "text/plain"), ".bin", "a filename passed where mimeType belongs must not be treated as one");
  assert.equal(extensionFor("text/plain"), ".txt");
});

test("unmapped dangerous types (never allow-listed upstream, but defense in depth) never map to an executable extension", () => {
  assert.notEqual(extensionFor("text/html"), ".html");
  assert.notEqual(extensionFor("image/svg+xml"), ".svg");
  assert.equal(extensionFor("text/html"), ".bin");
  assert.equal(extensionFor("image/svg+xml"), ".bin");
});
