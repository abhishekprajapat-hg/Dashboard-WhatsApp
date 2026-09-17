import { Notification, Workspace } from "../models/index.js";
import { sendEmail } from "./notificationChannels.js";
import { logger } from "./logger.js";

// Mirrors vegaIntegration.js's own reasoning: this is a best-effort side channel bolted onto real
// operations (an account failing its connection test) - a notification-delivery failure must never
// surface as, or block, the actual operation's own response.
export async function notifyWorkspace(workspaceId, eventKey, { subject, body }) {
  try {
    const workspace = await Workspace.findById(workspaceId).select("settings organizationId");
    const prefs = workspace?.settings?.notifications;
    // Gates BOTH channels on the same opt-in, not just email's - a workspace that hasn't turned
    // this event type on shouldn't get pinged in-app either just because that channel needs no
    // SendGrid key to work. recipientEmail is checked here too even though only the email send
    // below actually uses it, so a workspace with notifications enabled but no recipient set yet
    // doesn't get a half-configured in-app notification while email silently does nothing.
    if (!prefs?.enabled || !prefs.recipientEmail || !prefs.events?.[eventKey]) return;

    await notifyWorkspaceInApp({
      organizationId: workspace.organizationId,
      workspaceId,
      type: `workspace.${eventKey}`,
      title: subject,
      body,
    });

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

// The in-app counterpart to notifyWorkspace() above - kept as its own exported function (not
// inlined into notifyWorkspace) since other callers, like meetingReminders.js's sendReminder(),
// already have organizationId/workspaceId in hand from the record they're working with and have no
// email-specific opt-in/integration gating to check. Same "never let a notification failure
// surface as the real operation's own failure" rule as notifyWorkspace.
export async function notifyWorkspaceInApp({ organizationId, workspaceId, type, title, body, link }) {
  try {
    await Notification.create({ organizationId, workspaceId, type, title, body, link: link || null });
  } catch (error) {
    logger.warn({ err: error, workspaceId, type }, "In-app notification creation failed");
  }
}
