import jwt from "jsonwebtoken";
import { config } from "../config.js";

export function signSession({ user, workspace, role }) {
  return jwt.sign(
    {
      sub: user._id.toString(),
      email: user.email,
      workspaceId: workspace._id.toString(),
      organizationId: workspace.organizationId.toString(),
      role: role.name,
      permissions: role.permissions,
    },
    config.jwtSecret,
    { expiresIn: config.jwtExpiresIn }
  );
}

export function serializeUser(user, role) {
  return {
    id: user._id.toString(),
    name: user.name,
    email: user.email,
    role: role.name,
  };
}

export function serializeWorkspace(workspace) {
  return {
    id: workspace._id.toString(),
    name: workspace.name,
    slug: workspace.slug,
    timezone: workspace.timezone,
    whatsappHealth: workspace.settings?.whatsappHealth || "disconnected",
  };
}
