import { Router } from "express";
import jwt from "jsonwebtoken";
import mongoose from "mongoose";
import { config } from "../config.js";
import { Conversation, Message } from "../models/index.js";
import { hasPermission } from "../middleware/auth.js";
import { serializeConversation } from "../utils/serializers.js";
import { publishSocketWorkspaceUserEvent } from "./socket.js";

export const eventsRouter = Router();

const clientsByWorkspace = new Map();

function sendSse(res, event, data) {
  try {
    res.write(`event: ${event}\n`);
    res.write(`data: ${JSON.stringify(data)}\n\n`);
  } catch (error) {
    console.warn("SSE publish failed.", error.message);
  }
}

function addClient(workspaceId, user, res) {
  const key = workspaceId.toString();
  const clients = clientsByWorkspace.get(key) || new Set();
  const client = { userId: user?.sub?.toString(), user, res };
  clients.add(client);
  clientsByWorkspace.set(key, clients);

  return () => {
    clients.delete(client);
    if (clients.size === 0) {
      clientsByWorkspace.delete(key);
    }
  };
}

export function publishWorkspaceEvent(workspaceId, event, payload) {
  const clients = clientsByWorkspace.get(workspaceId?.toString());
  if (!clients) return;

  for (const client of clients) {
    sendSse(client.res, event, payload);
  }
}

async function unreadTotalForUser(workspaceId, user) {
  const userId = user?.sub?.toString?.() || user?.userId?.toString?.() || user?.toString?.();
  if (!workspaceId || !userId) return 0;
  const filter = { workspaceId };
  if (typeof user === "object" && !hasPermission(user, "team:read")) {
    filter.$or = [{ assignedToUserId: userId }, { assignedToUserId: { $exists: false } }, { assignedToUserId: null }];
  }
  const conversations = await Conversation.find(filter).select("unreadCountByUser");
  return conversations.reduce(
    (total, conversation) => total + Number(conversation.unreadCountByUser?.get?.(userId) || 0),
    0
  );
}

export async function publishConversationChanged(conversationId) {
  const conversation = await Conversation.findById(conversationId)
    .populate({ path: "contactId", populate: { path: "tagIds" } })
    .populate("assignedToUserId", "name")
    .populate("tagIds")
    .populate("lastMessageId");

  if (!conversation) return;

  const messages = await Message.find({ workspaceId: conversation.workspaceId, conversationId: conversation._id, deletedAt: mongoose.trusted({ $exists: false }) })
    .sort({ createdAt: 1 })
    .limit(100);

  const clients = clientsByWorkspace.get(conversation.workspaceId?.toString());
  if (!clients) return;

  for (const client of clients) {
    const visibleMessages = messages.filter((message) => {
      const deletedFor = message.deletedForUserIds || [];
      return !deletedFor.some((userId) => userId?.toString?.() === client.userId);
    });
    const unreadCount = await unreadTotalForUser(conversation.workspaceId, client.user);
    try {
      sendSse(client.res, "conversation", {
        conversation: serializeConversation(conversation, visibleMessages, { userId: client.userId }),
        unreadCount,
      });
    } catch (error) {
      console.warn("Conversation SSE serialization failed.", error.message);
    }
  }

  try {
    await publishSocketWorkspaceUserEvent(conversation.workspaceId, "conversation", async (user) => {
      const visibleMessages = messages.filter((message) => {
        const deletedFor = message.deletedForUserIds || [];
        return !deletedFor.some((userId) => userId?.toString?.() === user?.sub?.toString?.());
      });
      return {
        conversation: serializeConversation(conversation, visibleMessages, { userId: user?.sub }),
        unreadCount: await unreadTotalForUser(conversation.workspaceId, user),
      };
    });
  } catch (error) {
    console.warn("Socket conversation publish failed.", error.message);
  }
}

eventsRouter.get("/", (req, res) => {
  const token = req.query.token;

  if (!token) {
    return res.status(401).json({ error: "AUTH_REQUIRED", message: "Authentication is required." });
  }

  let user;
  try {
    user = jwt.verify(token, config.jwtSecret);
  } catch {
    return res.status(401).json({ error: "INVALID_TOKEN", message: "Session is invalid or expired." });
  }
  if (!user.workspaceId || !user.organizationId) {
    return res.status(403).json({ error: "WORKSPACE_REQUIRED", message: "An active workspace is required." });
  }

  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache, no-transform");
  res.setHeader("Connection", "keep-alive");
  res.flushHeaders?.();

  sendSse(res, "connected", { ok: true, workspaceId: user.workspaceId });
  const removeClient = addClient(user.workspaceId, user, res);
  const heartbeat = setInterval(() => {
    sendSse(res, "heartbeat", { time: new Date().toISOString() });
  }, 25000);

  req.on("close", () => {
    clearInterval(heartbeat);
    removeClient();
  });
});

