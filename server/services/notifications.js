import { Workspace } from "../models/index.js";
import { sendEmail } from "./notificationChannels.js";
import { logger } from "./logger.js";

// Mirrors vegaIntegration.js's own reasoning: this is a best-effort side channel bolted onto real
// operations (an account failing its connection test) - a notification-delivery failure must never
// surface as, or block, the actual operation's own response.
export async function notifyWorkspace(workspaceId, eventKey, { subject, body }) {
  try {
    const workspace = await Workspace.findById(workspaceId).select("settings");
    const prefs = workspace?.settings?.notifications;
    if (!prefs?.enabled || !prefs.recipientEmail || !prefs.events?.[eventKey]) return;

    const emailConfig = workspace?.settings?.integrations?.email;
    if (!emailConfig?.enabled || !emailConfig.apiKey || !emailConfig.fromAddress) return;

    await sendEmail({
      apiKey: emailConfig.apiKey,
      fromAddress: emailConfig.fromAddress,
      fromName: emailConfig.fromName,
      to: prefs.recipientEmail,
      subject,
      body,
    });
  } catch (error) {
    logger.warn({ err: error, workspaceId, eventKey }, "Workspace notification delivery failed");
  }
}
