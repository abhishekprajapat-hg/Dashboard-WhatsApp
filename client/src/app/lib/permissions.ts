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

// Distinct from hasPermission: an org's own "admin" role already carries wildcard permissions on
// its own workspace, correctly. This gates the small set of platform-wide controls (global feature
// flags, direct plan overrides that bypass billing) that must stay restricted to Nemnidhi's own
// organization no matter the caller's role - the server enforces this independently, this is just
// so the client UI doesn't dangle controls a client admin would only see rejected.
export function isPlatformOwner(session: AuthSession | null) {
  return Boolean(session?.user.isPlatformOwner);
}

export function canAccessView(session: AuthSession | null, view: ViewId) {
  return hasPermission(session, viewPermissions[view]);
}

export function allowedViews(session: AuthSession | null, views: ViewId[]) {
  return views.filter((view) => canAccessView(session, view));
}
