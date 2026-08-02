import test from "node:test";
import assert from "node:assert/strict";
import { assertPublicUrl } from "../services/integrations.js";

// assertPublicUrl throws for private/loopback/link-local/reserved destinations, resolves for
// public ones. Literal IP inputs skip DNS entirely (no network access needed for these), so this
// suite stays fast and offline - only the "localhost" case below relies on local resolution.

async function expectBlocked(url) {
  await assert.rejects(() => assertPublicUrl(url));
}

async function expectAllowed(url) {
  await assert.doesNotReject(() => assertPublicUrl(url));
}

test("blocks loopback (IPv4 and IPv6)", async () => {
  await expectBlocked("http://127.0.0.1/");
  await expectBlocked("http://127.0.0.99/");
  await expectBlocked("http://[::1]/");
});

test("blocks the cloud metadata link-local range", async () => {
  await expectBlocked("http://169.254.169.254/latest/meta-data/");
});

test("blocks RFC1918 private ranges", async () => {
  await expectBlocked("http://10.0.0.5/");
  await expectBlocked("http://172.16.5.5/");
  await expectBlocked("http://172.31.255.254/");
  await expectBlocked("http://192.168.1.1/");
});

test("blocks an IPv4-mapped IPv6 loopback address", async () => {
  await expectBlocked("http://[::ffff:127.0.0.1]/");
});

test("blocks unique-local and link-local IPv6", async () => {
  await expectBlocked("http://[fc00::1]/");
  await expectBlocked("http://[fe80::1]/");
});

test("blocks non-http(s) protocols", async () => {
  await expectBlocked("file:///etc/passwd");
  await expectBlocked("ftp://8.8.8.8/");
});

test("blocks the localhost hostname (resolves to loopback)", async () => {
  await expectBlocked("http://localhost/");
});

test("allows a public IPv4 literal", async () => {
  await expectAllowed("https://8.8.8.8/");
});
