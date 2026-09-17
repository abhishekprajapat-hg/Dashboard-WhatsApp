import { Notification, Workspace } from "../models/index.js";
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

// The in-app counterpart to notifyWorkspace() above - separate function rather than folding into
// it, since callers here already have organizationId/workspaceId in hand from the record they were
// working with (no need for notifyWorkspace's own Workspace lookup), and this has no email-specific
// opt-in/integration gating to check. Same "never let a notification failure surface as the real
// operation's own failure" rule as notifyWorkspace.
export async function notifyWorkspaceInApp({ organizationId, workspaceId, type, title, body, link }) {
  try {
    await Notification.create({ organizationId, workspaceId, type, title, body, link: link || null });
  } catch (error) {
    logger.warn({ err: error, workspaceId, type }, "In-app notification creation failed");
  }
}
