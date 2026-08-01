import mongoose from "mongoose";
import {
  Contact,
  Membership,
  Organization,
  Role,
  Template,
  User,
  WhatsAppAccount,
  Workspace,
} from "../../models/index.js";
import { encodeCredentials } from "../../services/whatsappProvider.js";
import { hashPassword } from "../../utils/password.js";
import { roleDefinitionFor } from "../../utils/rbac.js";

// Seeds a minimal but complete workspace - user, org, role, membership, a "local" (never calls a
// real WhatsApp API) account, an approved template, and a handful of contacts - against whatever
// database the caller's mongoose connection points at. Mirrors scripts/seed.js plus the ad-hoc
// account/template/contact seeding used throughout manual verification of this app, formalized
// for repeatable test runs.
export async function seedTestWorkspace({ mongoUri, contactCount = 5 }) {
  await mongoose.connect(mongoUri, { serverSelectionTimeoutMS: 10000 });

  const email = "integration-admin@test.local";
  const password = "IntegrationTest123!";

  const user = await User.create({
    name: "Integration Admin",
    email,
    passwordHash: hashPassword(password),
    status: "active",
  });

  const organization = await Organization.create({
    name: "Integration Test Org",
    slug: `integration-test-org-${Date.now()}`,
    ownerUserId: user._id,
    plan: "starter",
    billingStatus: "trial",
  });

  const workspace = await Workspace.create({
    organizationId: organization._id,
    name: "Integration Test Workspace",
    slug: "integration-test-workspace",
    timezone: "Asia/Kolkata",
    businessCategory: "Customer Support",
  });

  const adminRole = await Role.create({
    organizationId: organization._id,
    workspaceId: workspace._id,
    key: "admin",
    ...roleDefinitionFor("admin"),
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

  const account = await WhatsAppAccount.create({
    organizationId: organization._id,
    workspaceId: workspace._id,
    displayName: "Integration Test WhatsApp",
    phoneNumber: "+910000099999",
    phoneNumberId: `integration_test_${Date.now()}`,
    businessAccountId: "integration_test_business_id",
    provider: "local",
    encryptedCredentials: encodeCredentials({ provider: "local", accessToken: "local-placeholder-token" }),
    webhookStatus: "healthy",
    templateSyncStatus: "synced",
    status: "connected",
    credentialsUpdatedAt: new Date(),
  });

  const template = await Template.create({
    organizationId: organization._id,
    workspaceId: workspace._id,
    whatsappAccountId: account._id,
    providerTemplateId: "integration_test_template",
    name: "integration_test_template",
    language: "en",
    category: "MARKETING",
    body: "Hi {{1}}, this is an integration test message.",
    status: "approved",
    lastSyncedAt: new Date(),
  });

  const contacts = await Contact.insertMany(
    Array.from({ length: contactCount }, (_, index) => ({
      organizationId: organization._id,
      workspaceId: workspace._id,
      name: `Integration Contact ${index + 1}`,
      phone: `91900000${String(index + 1).padStart(4, "0")}`,
      source: "Integration test seed",
      lifecycleStatus: "lead",
      optInStatus: "opted_in",
    }))
  );

  await mongoose.disconnect();

  return { email, password, organizationId: organization._id.toString(), workspaceId: workspace._id.toString(), accountId: account._id.toString(), templateId: template._id.toString(), contacts };
}
