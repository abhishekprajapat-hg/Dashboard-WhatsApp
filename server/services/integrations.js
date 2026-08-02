import crypto from "crypto";
import { Workspace } from "../models/index.js";

export function signPayload(secret = "", body = "") {
  if (!secret) return "";
  return crypto.createHmac("sha256", secret).update(body).digest("hex");
}

export async function getWorkspaceIntegrations(workspaceId) {
  const workspace = await Workspace.findById(workspaceId).select("settings");
  return workspace?.settings?.integrations || {};
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

  const response = await fetch(targetUrl, {
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

  const response = await fetch(url, { method: verb, headers: requestHeaders, body: requestBody });
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
