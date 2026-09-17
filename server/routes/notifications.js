import { Router } from "express";
import mongoose from "mongoose";
import { z } from "zod";
import { requirePermission } from "../middleware/auth.js";
import { validateQuery } from "../middleware/validate.js";
import { Notification } from "../models/index.js";

export const notificationsRouter = Router();

// Gated on dashboard:read, not a dedicated notifications:* permission - every role that can see the
// app at all has dashboard:read (rbac.js), which matches the bell being a global nav element every
// signed-in user sees, not a feature some roles are locked out of.
const listQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(50).optional().default(20),
});

function serializeNotification(notification) {
  return {
    id: notification._id.toString(),
    type: notification.type,
    title: notification.title,
    body: notification.body || "",
    link: notification.link || null,
    read: notification.read,
    createdAt: notification.createdAt,
  };
}

notificationsRouter.get("/", requirePermission("dashboard:read"), validateQuery(listQuerySchema), async (req, res) => {
  if (mongoose.connection.readyState !== 1) {
    return res.json({ data: [], unreadCount: 0 });
  }

  const filter = { workspaceId: req.user.workspaceId };
  const [notifications, unreadCount] = await Promise.all([
    Notification.find(filter).sort({ createdAt: -1 }).limit(req.query.limit),
    Notification.countDocuments({ ...filter, read: false }),
  ]);

  res.json({ data: notifications.map(serializeNotification), unreadCount });
});

notificationsRouter.patch("/:id/read", requirePermission("dashboard:read"), async (req, res) => {
  if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
    return res.status(404).json({ error: "NOT_FOUND", message: "Notification not found." });
  }

  const notification = await Notification.findOneAndUpdate(
    { _id: req.params.id, workspaceId: req.user.workspaceId },
    { $set: { read: true, readAt: new Date() } },
    { new: true }
  );
  if (!notification) return res.status(404).json({ error: "NOT_FOUND", message: "Notification not found." });

  res.json({ data: serializeNotification(notification) });
});

notificationsRouter.post("/read-all", requirePermission("dashboard:read"), async (req, res) => {
  await Notification.updateMany(
    { workspaceId: req.user.workspaceId, read: false },
    { $set: { read: true, readAt: new Date() } }
  );
  res.json({ data: { ok: true } });
});
