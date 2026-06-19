import "dotenv/config";
import mongoose from "mongoose";
import {
  AutomationFlow,
  Campaign,
  Contact,
  Conversation,
  Membership,
  Message,
  Organization,
  Role,
  Tag,
  Template,
  User,
  WebhookEvent,
  WhatsAppAccount,
  Workspace,
} from "../models/index.js";
import { hashPassword } from "../utils/password.js";

const mongoUri = process.env.MONGODB_URI || "mongodb://127.0.0.1:27017/whatscrm";

const seedUser = {
  name: process.env.SEED_USER_NAME || "Admin",
  email: (process.env.SEED_USER_EMAIL || "admin@test.com").toLowerCase(),
  password: process.env.SEED_USER_PASSWORD || "123456",
};

async function seed() {
  await mongoose.connect(mongoUri, { serverSelectionTimeoutMS: 5000 });
  await Message.collection.dropIndex("workspaceId_1_providerMessageId_1").catch(() => {});
  await Message.syncIndexes();

  const savedMetaAccounts = await WhatsAppAccount.find({
    phoneNumberId: { $ne: "local_phone_number_id" },
  }).lean();

  await Promise.all([
    AutomationFlow.deleteMany({}),
    Campaign.deleteMany({}),
    Contact.deleteMany({}),
    Conversation.deleteMany({}),
    Membership.deleteMany({}),
    Message.deleteMany({}),
    Organization.deleteMany({}),
    Role.deleteMany({}),
    Tag.deleteMany({}),
    Template.deleteMany({}),
    User.deleteMany({}),
    WebhookEvent.deleteMany({}),
    WhatsAppAccount.deleteMany({}),
    Workspace.deleteMany({}),
  ]);

  const user = await User.create({
    name: seedUser.name,
    email: seedUser.email,
    passwordHash: hashPassword(seedUser.password),
    status: "active",
  });

  const organization = await Organization.create({
    name: "Main Organization",
    slug: "main-organization",
    ownerUserId: user._id,
    plan: "starter",
    billingStatus: "trial",
  });

  const workspace = await Workspace.create({
    organizationId: organization._id,
    name: "Main Workspace",
    slug: "main-workspace",
    timezone: "Asia/Kolkata",
    businessCategory: "Customer Support",
    settings: { whatsappHealth: savedMetaAccounts.length > 0 ? "connected" : "disconnected" },
  });

  const adminRole = await Role.create({
    organizationId: organization._id,
    workspaceId: workspace._id,
    name: "Workspace Admin",
    key: "workspace_admin",
    description: "Full access to workspace settings, team, inbox, campaigns, and automations.",
    permissions: ["*"],
    isSystemRole: true,
  });

  await Role.create({
    organizationId: organization._id,
    workspaceId: workspace._id,
    name: "Agent",
    key: "agent",
    description: "Inbox and contact access for daily support work.",
    permissions: ["inbox:read", "inbox:write", "contacts:read", "contacts:write"],
    isSystemRole: true,
  });

  await Membership.create({
    organizationId: organization._id,
    workspaceId: workspace._id,
    userId: user._id,
    roleId: adminRole._id,
    status: "active",
    joinedAt: new Date(),
  });

  for (const savedAccount of savedMetaAccounts) {
    const account = await WhatsAppAccount.create({
      organizationId: organization._id,
      workspaceId: workspace._id,
      displayName: savedAccount.displayName,
      phoneNumber: savedAccount.phoneNumber,
      phoneNumberId: savedAccount.phoneNumberId,
      businessAccountId: savedAccount.businessAccountId,
      provider: savedAccount.provider || "meta",
      encryptedCredentials: savedAccount.encryptedCredentials,
      webhookStatus: savedAccount.webhookStatus || "healthy",
      templateSyncStatus: "pending",
      status: savedAccount.status || "connected",
      lastSyncedAt: savedAccount.lastSyncedAt,
    });

    for (const template of [
      { name: "order_update", category: "UTILITY" },
      { name: "support_follow_up", category: "UTILITY" },
      { name: "campaign_announcement", category: "MARKETING" },
    ]) {
      await Template.create({
        organizationId: organization._id,
        workspaceId: workspace._id,
        whatsappAccountId: account._id,
        providerTemplateId: template.name,
        name: template.name,
        language: "en",
        category: template.category,
        status: "approved",
        lastSyncedAt: new Date(),
      });
    }

    account.templateSyncStatus = "synced";
    account.lastSyncedAt = new Date();
    await account.save();
  }

  console.log("Clean seed complete.");
  console.log(`Login: ${seedUser.email}`);
  console.log(`Password: ${seedUser.password}`);
  console.log(`Preserved Meta accounts: ${savedMetaAccounts.length}`);

  await mongoose.disconnect();
}

seed().catch(async (error) => {
  console.error("Seed failed.", error);
  await mongoose.disconnect().catch(() => {});
  process.exit(1);
});
