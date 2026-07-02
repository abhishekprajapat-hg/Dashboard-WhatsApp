import mongoose from "mongoose";

export function requireWorkspaceContext(req, res, next) {
  const workspaceId = req.user?.workspaceId;
  const organizationId = req.user?.organizationId;

  if (!workspaceId || !organizationId) {
    return res.status(403).json({ error: "WORKSPACE_REQUIRED", message: "An active workspace is required." });
  }

  if (mongoose.connection.readyState === 1 && !mongoose.Types.ObjectId.isValid(workspaceId)) {
    return res.status(403).json({ error: "WORKSPACE_REQUIRED", message: "Workspace context is invalid." });
  }

  next();
}

export function workspaceScope(req) {
  return {
    organizationId: req.user.organizationId,
    workspaceId: req.user.workspaceId,
  };
}

export function workspaceObjectId(req) {
  return new mongoose.Types.ObjectId(req.user.workspaceId);
}
