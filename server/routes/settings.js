import { Router } from "express";
import mongoose from "mongoose";
import { Role, Template, WhatsAppAccount } from "../models/index.js";

export const settingsRouter = Router();

settingsRouter.get("/", async (req, res) => {
  if (mongoose.connection.readyState === 1) {
    const [accounts, roles, templates] = await Promise.all([
      WhatsAppAccount.find({ workspaceId: req.user.workspaceId }).sort({ createdAt: -1 }),
      Role.find({ workspaceId: req.user.workspaceId }).sort({ name: 1 }),
      Template.find({ workspaceId: req.user.workspaceId }).sort({ name: 1 }),
    ]);

    return res.json({
      whatsappAccounts: accounts.map((account) => ({
        id: account._id.toString(),
        displayName: account.displayName,
        phoneNumber: account.phoneNumber,
        phoneNumberId: account.phoneNumberId,
        businessAccountId: account.businessAccountId,
        status: account.status,
        webhookStatus: account.webhookStatus,
        templateSyncStatus: account.templateSyncStatus,
        lastSyncedAt: account.lastSyncedAt,
      })),
      templates: templates.map((template) => ({
        id: template._id.toString(),
        name: template.name,
        language: template.language,
        category: template.category,
        status: template.status,
      })),
      roles: roles.map((role) => ({
        id: role._id.toString(),
        name: role.name,
        permissions: role.permissions,
      })),
    });
  }

  res.json({
    whatsappAccounts: [],
    templates: [],
    roles: [
      { id: "role_admin", name: "Workspace Admin", permissions: ["*"] },
      { id: "role_agent", name: "Agent", permissions: ["inbox:read", "inbox:write", "contacts:read"] },
    ],
  });
});
