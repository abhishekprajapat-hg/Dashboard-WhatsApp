import { config } from "../config.js";
import { sendEmail } from "./notificationChannels.js";

// Reuses notificationChannels.js's real SendGrid sendEmail() - the same call shape a workspace's
// own "alert me when my WhatsApp account needs attention" feature already uses - rather than
// standing up a second, parallel email-sending implementation. Only the credential source differs:
// this is a platform-wide key (config.platformEmail), since password reset has no workspace
// context to pull a tenant-specific one from.

export async function sendPasswordResetEmail({ to, name, resetUrl }) {
  const { sendgridApiKey, fromAddress, fromName } = config.platformEmail;
  if (!sendgridApiKey || !fromAddress) {
    const error = new Error("Platform email is not configured yet (SENDGRID_API_KEY/MAIL_FROM).");
    error.code = "MAIL_NOT_CONFIGURED";
    throw error;
  }

  const body = [
    `Hi ${name},`,
    "",
    "We received a request to reset your Dashboard-WhatsApp password. This link expires in 30 minutes.",
    resetUrl,
    "",
    "If you didn't request this, you can safely ignore this email - your password won't change.",
  ].join("\n");

  // sendEmail (SendGrid) only sends plain text today (buildEmailRequest hardcodes
  // content[0].type: "text/plain") - the link is included as a plain URL, still clickable in
  // every real email client, so this doesn't need an HTML variant to be genuinely usable.
  return sendEmail({
    apiKey: sendgridApiKey,
    fromAddress,
    fromName,
    to,
    subject: "Reset your Dashboard-WhatsApp password",
    body,
  });
}
