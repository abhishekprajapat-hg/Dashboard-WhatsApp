export const roleDefinitions = {
  super_admin: {
    name: "Super Admin",
    description: "Full organization and workspace access.",
    permissions: ["*"],
  },
  admin: {
    name: "Admin",
    description: "Full workspace access except global platform ownership.",
    permissions: ["*"],
  },
  manager: {
    name: "Manager",
    description: "Team, reporting, campaign, automation, and inbox management.",
    permissions: [
      "dashboard:read",
      "inbox:read",
      "inbox:write",
      "contacts:read",
      "contacts:write",
      "campaigns:read",
      "campaigns:write",
      "ads:read",
      "ads:write",
      "automation:read",
      "automation:write",
      "templates:read",
      "templates:write",
      "team:read",
      "reports:read",
      "assistant:read",
      "assistant:write",
      "assignment:write",
      "media:write",
      "tasks:read",
      "tasks:write",
    ],
  },
  agent: {
    name: "Agent",
    description: "Inbox and CRM access for daily support work.",
    permissions: [
      "dashboard:read",
      "inbox:read",
      "inbox:write",
      "contacts:read",
      "contacts:write",
      "templates:read",
      "assistant:read",
      "media:write",
      "tasks:read",
      "tasks:write",
    ],
  },
  viewer: {
    name: "Viewer",
    description: "Read-only dashboard, inbox, CRM, campaign, automation, and report access.",
    permissions: [
      "dashboard:read",
      "inbox:read",
      "contacts:read",
      "campaigns:read",
      "ads:read",
      "automation:read",
      "templates:read",
      "reports:read",
      "assistant:read",
      "tasks:read",
    ],
  },
};

export const roleKeys = Object.keys(roleDefinitions);

export const permissionCatalog = [
  "admin:read",
  "admin:write",
  "dashboard:read",
  "inbox:read",
  "inbox:write",
  "contacts:read",
  "contacts:write",
  "campaigns:read",
  "campaigns:write",
  "ads:read",
  "ads:write",
  "automation:read",
  "automation:write",
  "templates:read",
  "templates:write",
  "team:read",
  "team:write",
  "settings:read",
  "settings:write",
  "billing:read",
  "security:write",
  "reports:read",
  "assistant:read",
  "assistant:write",
  "assignment:write",
  "media:write",
  "tasks:read",
  "tasks:write",
];

export function normalizeRoleKey(role = "agent") {
  const key = String(role || "agent").trim().toLowerCase();
  if (key === "workspace_admin") return "admin";
  return roleDefinitions[key] ? key : "agent";
}

export function roleDefinitionFor(role = "agent") {
  return roleDefinitions[normalizeRoleKey(role)] || roleDefinitions.agent;
}

export function allPermissions() {
  return permissionCatalog;
}
