import type { AuthSession } from "./api";
import type { ViewId } from "../components/ActivityBar";

export type RoleKey = "super_admin" | "admin" | "manager" | "agent" | "viewer";

const viewPermissions: Record<ViewId, string> = {
  dashboard: "dashboard:read",
  inbox: "inbox:read",
  contacts: "contacts:read",
  automation: "automation:read",
  templates: "templates:read",
  campaigns: "campaigns:read",
  analytics: "reports:read",
  team: "team:read",
  tasks: "tasks:read",
  admin: "admin:read",
  assistant: "assistant:read",
  settings: "settings:read",
};

export function hasPermission(session: AuthSession | null, permission: string) {
  const permissions = session?.user.permissions || [];
  const roleKey = String(session?.user.roleKey || session?.user.role || "").toLowerCase().replace(/\s+/g, "_");
  if (roleKey === "super_admin" || roleKey === "admin" || roleKey === "workspace_admin") return true;
  return permissions.includes("*") || permissions.includes(permission);
}

export function canAccessView(session: AuthSession | null, view: ViewId) {
  return hasPermission(session, viewPermissions[view]);
}

export function allowedViews(session: AuthSession | null, views: ViewId[]) {
  return views.filter((view) => canAccessView(session, view));
}
