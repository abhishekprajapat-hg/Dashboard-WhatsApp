import mongoose from "mongoose";
import { AuditLog, Workspace } from "../models/index.js";

const DEFAULT_RETENTION_DAYS = 365;
const MS_PER_DAY = 24 * 60 * 60 * 1000;

// Shared by the on-demand admin.js route and the periodic scripts/pruneAuditLogs.js sweep, so the
// actual deletion logic exists exactly once. One workspace if given, every workspace otherwise.
export async function pruneAuditLogs({ workspaceId } = {}) {
  const workspaces = workspaceId
    ? [await Workspace.findById(workspaceId)].filter(Boolean)
    : await Workspace.find();

  const results = [];
  for (const workspace of workspaces) {
    const retentionDays = Number(workspace.settings?.security?.dataRetentionDays) || DEFAULT_RETENTION_DAYS;
    const cutoff = new Date(Date.now() - retentionDays * MS_PER_DAY);

    const { deletedCount } = await AuditLog.deleteMany({
      workspaceId: workspace._id,
      createdAt: mongoose.trusted({ $lt: cutoff }),
    });

    results.push({
      workspaceId: workspace._id.toString(),
      workspaceName: workspace.name,
      retentionDays,
      cutoff,
      deletedCount,
    });
  }

  return results;
}
