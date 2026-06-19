import "dotenv/config";
import mongoose from "mongoose";
import { Membership, Template, WhatsAppAccount, Workspace } from "../models/index.js";
import { fetchWhatsAppTemplates } from "../services/whatsappProvider.js";

const mongoUri = process.env.MONGODB_URI || "mongodb://127.0.0.1:27017/whatscrm";

const required = {
  WHATSAPP_DISPLAY_NAME: process.env.WHATSAPP_DISPLAY_NAME || "Meta WhatsApp",
  WHATSAPP_PHONE_NUMBER: process.env.WHATSAPP_PHONE_NUMBER,
  WHATSAPP_PHONE_NUMBER_ID: process.env.WHATSAPP_PHONE_NUMBER_ID,
  WHATSAPP_BUSINESS_ACCOUNT_ID: process.env.WHATSAPP_BUSINESS_ACCOUNT_ID,
  WHATSAPP_ACCESS_TOKEN: process.env.WHATSAPP_ACCESS_TOKEN,
};

function missingKeys() {
  return Object.entries(required)
    .filter(([key, value]) => key !== "WHATSAPP_DISPLAY_NAME" && !value)
    .map(([key]) => key);
}

async function main() {
  const missing = missingKeys();
  if (missing.length) {
    console.error(`Missing required env values: ${missing.join(", ")}`);
    process.exit(1);
  }

  await mongoose.connect(mongoUri, { serverSelectionTimeoutMS: 5000 });

  const workspace = await Workspace.findOne().sort({ createdAt: -1 });
  if (!workspace) {
    throw new Error("No workspace found. Run npm run seed first.");
  }

  const membership = await Membership.findOne({ workspaceId: workspace._id }).sort({ createdAt: 1 });
  const organizationId = workspace.organizationId || membership?.organizationId;
  if (!organizationId) {
    throw new Error("Workspace organization not found.");
  }

  const account = await WhatsAppAccount.findOneAndUpdate(
    { workspaceId: workspace._id, phoneNumberId: required.WHATSAPP_PHONE_NUMBER_ID },
    {
      organizationId,
      workspaceId: workspace._id,
      displayName: required.WHATSAPP_DISPLAY_NAME,
      phoneNumber: required.WHATSAPP_PHONE_NUMBER,
      phoneNumberId: required.WHATSAPP_PHONE_NUMBER_ID,
      businessAccountId: required.WHATSAPP_BUSINESS_ACCOUNT_ID,
      encryptedCredentials: Buffer.from(required.WHATSAPP_ACCESS_TOKEN).toString("base64"),
      provider: "meta",
      webhookStatus: "healthy",
      templateSyncStatus: "pending",
      status: "connected",
    },
    { upsert: true, new: true, setDefaultsOnInsert: true }
  );

  let syncedCount = 0;
  try {
    const templates = await fetchWhatsAppTemplates(account);
    for (const item of templates) {
      await Template.findOneAndUpdate(
        { workspaceId: workspace._id, whatsappAccountId: account._id, name: item.name, language: item.language || "en" },
        {
          organizationId,
          workspaceId: workspace._id,
          whatsappAccountId: account._id,
          providerTemplateId: item.providerTemplateId || item.name,
          name: item.name,
          language: item.language || "en",
          category: item.category,
          components: item.components || [],
          status: item.status || "approved",
          lastSyncedAt: new Date(),
        },
        { upsert: true, new: true, setDefaultsOnInsert: true }
      );
    }
    syncedCount = templates.length;
    account.templateSyncStatus = "synced";
    account.lastSyncedAt = new Date();
    await account.save();
  } catch (error) {
    account.templateSyncStatus = "failed";
    account.status = /auth/i.test(error.message) ? "needs_attention" : account.status;
    await account.save();
    console.warn(`Template sync skipped: ${error.message}`);
  }

  console.log("WhatsApp account connected permanently.");
  console.log(`Workspace: ${workspace.name}`);
  console.log(`Phone: ${account.phoneNumber}`);
  console.log(`Phone Number ID: ${account.phoneNumberId}`);
  console.log(`Templates synced: ${syncedCount}`);

  await mongoose.disconnect();
}

main().catch(async (error) => {
  console.error("Permanent WhatsApp connect failed.", error.message);
  await mongoose.disconnect().catch(() => {});
  process.exit(1);
});

