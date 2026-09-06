import "dotenv/config";
import mongoose from "mongoose";
import { config } from "../config.js";
import { Template, WhatsAppAccount } from "../models/index.js";
import { sendWhatsAppTemplate } from "../services/whatsappProvider.js";

// "dotenv/config" resolves .env relative to process.cwd() at the time this process starts - it
// MUST be invoked with cwd already inside server/ (see deploy-health-check.sh's send_alert(),
// which cd's there before calling node) for this to find the real .env at all. A fix attempted
// inline here (loading dotenv with an explicit path before importing config.js) does NOT work:
// ES module static imports are hoisted and fully evaluated before any of this file's own
// top-level code runs, so config.js (and anything importing it, like whatsappProvider.js below)
// would already have read process.env by the time an inline dotenv.config() call executed - the
// cwd is the only thing that can actually control this correctly.

// Standalone ops alert, invoked by scripts/deploy-health-check.sh - deliberately NOT part of the
// running Express app (so it still works if that process is the thing that's stale/down). Sends a
// real WhatsApp message via a pre-approved UTILITY template (a freeform text send can't reach a
// number outside an open 24h session, same reason otpService.js uses a template for OTP codes),
// reusing the same isSystemAccount WhatsApp number as OTP sending.
//
// Usage: node scripts/sendDeployAlert.mjs "<message text>"

async function main() {
  const message = String(process.argv[2] || "").trim();
  if (!message) {
    console.error("Usage: node sendDeployAlert.mjs \"<message>\"");
    process.exit(1);
  }

  if (!config.deployAlert.phone) {
    console.error("DEPLOY_ALERT_PHONE is not set - nowhere to send this alert. Message was:", message);
    process.exit(1);
  }

  await mongoose.connect(process.env.MONGODB_URI, { serverSelectionTimeoutMS: 10000 });

  try {
    const systemAccount = await WhatsAppAccount.findOne({ isSystemAccount: true, status: "connected" });
    if (!systemAccount) {
      console.error("No connected isSystemAccount WhatsApp account configured - cannot send alert. Message was:", message);
      process.exit(1);
    }

    const template = await Template.findOne({
      workspaceId: systemAccount.workspaceId,
      name: config.deployAlert.templateName,
      status: "approved",
    });
    if (!template) {
      console.error(
        `WhatsApp template "${config.deployAlert.templateName}" is not created/approved yet - cannot send alert.`,
        "Create it (UTILITY category, one text parameter) in WhatsApp Manager or this app's Templates tab, then set DEPLOY_ALERT_TEMPLATE_NAME if the name differs.",
        "Message was:", message
      );
      process.exit(1);
    }

    await sendWhatsAppTemplate({ account: systemAccount, to: config.deployAlert.phone, template, parameters: [message] });
    console.log("Deploy alert sent to", config.deployAlert.phone);
  } finally {
    await mongoose.disconnect();
  }
}

main().catch((error) => {
  console.error("sendDeployAlert failed:", error.message);
  process.exit(1);
});
