import crypto from "crypto";
import dns from "node:dns/promises";
import { BlockList, isIP } from "node:net";
import { Workspace } from "../models/index.js";

export function signPayload(secret = "", body = "") {
  if (!secret) return "";
  return crypto.createHmac("sha256", secret).update(body).digest("hex");
}

export async function getWorkspaceIntegrations(workspaceId) {
  const workspace = await Workspace.findById(workspaceId).select("settings");
  return workspace?.settings?.integrations || {};
}

// SSRF guard shared by both outbound-request primitives below. Neither the workspace webhook nor
// the automation "api" node had any protection before this - callOutboundWebhook's URL is
// workspace-admin-controlled and callGenericApi's is fully flow-author-controlled, so both can
// point at internal services (including cloud metadata endpoints like 169.254.169.254) unless
// checked. See docs/AUTOMATION_ENGINE_PLAN.md's Phase 2 note - this was flagged there, not new.
const ssrfBlockList = new BlockList();
[
  ["0.0.0.0", 8], // "this network"
  ["10.0.0.0", 8], // RFC1918 private
  ["100.64.0.0", 10], // carrier-grade NAT
  ["127.0.0.0", 8], // loopback
  ["169.254.0.0", 16], // link-local - includes AWS/GCP/Azure metadata at 169.254.169.254
  ["172.16.0.0", 12], // RFC1918 private
  ["192.0.0.0", 24], // IETF protocol assignments
  ["192.0.2.0", 24], // TEST-NET-1
  ["192.88.99.0", 24], // 6to4 relay anycast
  ["192.168.0.0", 16], // RFC1918 private
  ["198.18.0.0", 15], // benchmarking
  ["198.51.100.0", 24], // TEST-NET-2
  ["203.0.113.0", 24], // TEST-NET-3
  ["224.0.0.0", 4], // multicast
  ["240.0.0.0", 4], // reserved
].forEach(([network, prefix]) => ssrfBlockList.addSubnet(network, prefix, "ipv4"));
[
  ["::", 128], // unspecified
  ["::1", 128], // loopback
  ["fc00::", 7], // unique local (ULA)
  ["fe80::", 10], // link-local
].forEach(([network, prefix]) => ssrfBlockList.addSubnet(network, prefix, "ipv6"));

function embeddedIpv4(address) {
  const match = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/i.exec(address);
  return match ? match[1] : null;
}

function isBlockedAddress(address) {
  const family = isIP(address);
  if (family === 4) return ssrfBlockList.check(address, "ipv4");
  if (family === 6) {
    if (ssrfBlockList.check(address, "ipv6")) return true;
    const mapped = embeddedIpv4(address);
    return mapped ? ssrfBlockList.check(mapped, "ipv4") : false;
  }
  // Not a recognizable IP literal (shouldn't happen post-DNS-resolution) - block defensively.
  return true;
}

// Resolves the URL's host and rejects if any answer lands in a private/loopback/link-local/
// reserved range. This checks DNS immediately before each request/redirect hop rather than
// pinning the TCP connection to the resolved IP, so a DNS answer that flips between this check
// and the actual connect (active DNS rebinding) is a known, narrow residual gap - accepted here
// rather than adding a custom HTTP dispatcher for a threat that requires the attacker to already
// control DNS infrastructure and win a sub-second race.
export async function assertPublicUrl(rawUrl) {
  const parsed = new URL(rawUrl);
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new Error(`Blocked outbound request: unsupported protocol "${parsed.protocol}"`);
  }

  const hostname = parsed.hostname.replace(/^\[|\]$/g, "");
  const literalFamily = isIP(hostname);
  let addresses;
  if (literalFamily) {
    addresses = [{ address: hostname }];
  } else {
    try {
      addresses = await dns.lookup(hostname, { all: true });
    } catch {
      throw new Error(`Blocked outbound request: could not resolve host "${hostname}"`);
    }
  }

  if (!addresses.length || addresses.some((entry) => isBlockedAddress(entry.address))) {
    throw new Error(`Blocked outbound request: "${hostname}" resolves to a private or reserved address`);
  }
}

const MAX_REDIRECTS = 5;

// fetch() follows redirects by default, which would silently bypass assertPublicUrl on the very
// first hop - a validated public URL can 302 to an internal address. Disables automatic
// redirects and re-validates (DNS + range check) before following each one instead.
async function safeFetch(url, options = {}) {
  let currentUrl = url;
  for (let hop = 0; hop <= MAX_REDIRECTS; hop += 1) {
    await assertPublicUrl(currentUrl);
    const response = await fetch(currentUrl, { ...options, redirect: "manual" });
    const location = response.headers.get("location");
    if ([301, 302, 303, 307, 308].includes(response.status) && location) {
      currentUrl = new URL(location, currentUrl).toString();
      continue;
    }
    return response;
  }
  throw new Error("Blocked outbound request: too many redirects");
}

export async function callOutboundWebhook({ workspaceId, url, secret, event = "event", payload = {} }) {
  const integrations = await getWorkspaceIntegrations(workspaceId);
  const webhook = integrations.outboundWebhook || {};
  const targetUrl = url || webhook.url;
  const targetSecret = secret ?? webhook.secret ?? "";

  if (!targetUrl || (!url && webhook.enabled === false)) {
    return { skipped: true, reason: "webhook_not_configured" };
  }

  const body = JSON.stringify({
    event,
    sentAt: new Date().toISOString(),
    data: payload,
  });
  const signature = signPayload(targetSecret, body);

  const response = await safeFetch(targetUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-WhatsCRM-Event": event,
      ...(signature ? { "X-WhatsCRM-Signature": signature } : {}),
    },
    body,
  });

  const responseText = await response.text().catch(() => "");
  if (!response.ok) {
    const error = new Error(responseText || "Outbound webhook failed.");
    error.status = response.status;
    throw error;
  }

  return {
    skipped: false,
    status: response.status,
    response: responseText.slice(0, 500),
  };
}

const genericApiMethods = new Set(["GET", "POST", "PUT", "PATCH", "DELETE"]);

// Generic outbound HTTP primitive for the automation "api"/"http_request" node. Unlike
// callOutboundWebhook (hardcoded POST + fixed envelope for the workspace's configured webhook),
// this calls an arbitrary user-configured URL/method/body and hands the response back to the
// engine for downstream nodes - it does not throw on a non-2xx response, since "the API returned
// a 4xx" is a normal, inspectable outcome for a workflow node, not a delivery failure.
export async function callGenericApi({ method = "GET", url, headers = {}, body } = {}) {
  const verb = genericApiMethods.has(String(method || "GET").toUpperCase()) ? String(method).toUpperCase() : "GET";
  const requestHeaders = Object.fromEntries(
    Object.entries(headers || {}).filter(([key, value]) => key && value !== undefined && value !== null)
  );
  const canHaveBody = verb !== "GET" && verb !== "DELETE";
  const hasBody = canHaveBody && body !== undefined && body !== null && body !== "";
  const requestBody = hasBody ? (typeof body === "string" ? body : JSON.stringify(body)) : undefined;
  if (hasBody && !Object.keys(requestHeaders).some((key) => key.toLowerCase() === "content-type")) {
    requestHeaders["Content-Type"] = "application/json";
  }

  const response = await safeFetch(url, { method: verb, headers: requestHeaders, body: requestBody });
  const responseText = await response.text().catch(() => "");
  const bounded = responseText.slice(0, 2000);
  let parsedBody = bounded;
  try {
    parsedBody = JSON.parse(bounded);
  } catch {
    // Not JSON - keep the raw (bounded) text.
  }

  return { ok: response.ok, status: response.status, body: parsedBody };
}
