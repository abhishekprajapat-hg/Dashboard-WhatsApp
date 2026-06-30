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
