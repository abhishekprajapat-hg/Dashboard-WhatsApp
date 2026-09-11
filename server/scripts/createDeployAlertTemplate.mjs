import "dotenv/config";
import mongoose from "mongoose";
import { config } from "../config.js";
import { Template, WhatsAppAccount } from "../models/index.js";
import { createWhatsAppTemplate } from "../services/whatsappProvider.js";

// Creates the UTILITY template that scripts/deploy-health-check.sh sends its alerts through. Split
// out as a one-shot script rather than done through the Templates UI so the exact shape Meta needs
// is version-controlled and repeatable - it has to be a template at all because a freeform text
// send can't reach a number outside an open 24h session, which an ops alert never has.
//
// Same cwd constraint as sendDeployAlert.mjs: "dotenv/config" resolves .env relative to
// process.cwd() at process start, and ES module imports are hoisted, so this MUST be run from
// inside server/:
//
//   sudo -u dashboard bash -c 'cd /home/dashboard/dashboard-whatsapp/server && node scripts/createDeployAlertTemplate.mjs'
//
// Meta approval is asynchronous. The record is stored with whatever status Meta returns (always
// "pending" straight after submission) - routes/whatsapp.js's message_template_status_update
// webhook flips it to approved on its own once Meta decides, so nothing here needs re-running.

const LANGUAGE = "en";

async function main() {
  await mongoose.connect(process.env.MONGODB_URI, { serverSelectionTimeoutMS: 10000 });

  try {
    const account = await WhatsAppAccount.findOne({ isSystemAccount: true, status: "connected" });
    if (!account) {
      console.error("No connected isSystemAccount WhatsApp account - nothing to create the template on.");
      process.exit(1);
    }

    const name = config.deployAlert.templateName;
    const existing = await Template.findOne({ workspaceId: account.workspaceId, name, language: LANGUAGE });
    if (existing) {
      console.log(`Template "${name}" already exists locally with status "${existing.status}".`);
      console.log(existing.status === "approved" ? "Nothing to do - alerts can send." : "Waiting on Meta approval; the status webhook will flip it to approved.");
      return;
    }

    // One positional parameter, carrying the whole problem summary.
    //
    // Two Meta constraints are baked into this shape, both learned by having it rejected:
    //   1. The example is not optional - Meta rejects any template containing {{n}} placeholders
    //      without sample values to review.
    //   2. A variable may not be the first or last thing in the body ("Leading or trailing params
    //      not allowed", code 100 / subcode 2388299). The original text ended with "{{1}}" and was
    //      refused, hence the trailing sentence - it is load-bearing, not decoration. Keep static
    //      text on BOTH sides of {{1}} if this is ever reworded.
    const components = [
      {
        type: "BODY",
        text: "Dashboard-WhatsApp deploy alert: {{1}} - check deploy.log and deploy-cron.log on the VPS.",
        example: { body_text: [["Deploy stuck: origin/main has been ahead of the last deployed commit for 25min"]] },
      },
    ];

    const result = await createWhatsAppTemplate({
      account,
      name,
      category: "UTILITY",
      language: LANGUAGE,
      components,
    });

    await Template.create({
      organizationId: account.organizationId,
      workspaceId: account.workspaceId,
      whatsappAccountId: account._id,
      providerTemplateId: result.providerTemplateId,
      name,
      type: "whatsapp",
      language: LANGUAGE,
      category: "utility",
      body: components[0].text,
      variables: ["1"],
      components,
      status: result.status,
      lastSyncedAt: new Date(),
    });

    console.log(`Submitted "${name}" to Meta (id ${result.providerTemplateId}, status ${result.status}).`);
    console.log("Approval is asynchronous - usually minutes to a few hours. Once approved, test with:");
    console.log('  node scripts/sendDeployAlert.mjs "test alert - ignore"');
  } finally {
    await mongoose.disconnect();
  }
}

main().catch((error) => {
  console.error("createDeployAlertTemplate failed:", error.message);
  if (error.meta) console.error("Meta said:", JSON.stringify(error.meta));
  process.exit(1);
});
