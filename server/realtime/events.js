import { Router } from "express";
import jwt from "jsonwebtoken";
import { config } from "../config.js";
import { Conversation, Message } from "../models/index.js";
import { serializeConversation } from "../utils/serializers.js";
import { publishSocketWorkspaceUserEvent } from "./socket.js";

export const eventsRouter = Router();

const clientsByWorkspace = new Map();

function sendSse(res, event, data) {
  res.write(`event: ${event}\n`);
  res.write(`data: ${JSON.stringify(data)}\n\n`);
}

function addClient(workspaceId, userId, res) {
  const key = workspaceId.toString();
  const clients = clientsByWorkspace.get(key) || new Set();
  const client = { userId: userId?.toString(), res };
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

export async function publishConversationChanged(conversationId) {
  const conversation = await Conversation.findById(conversationId)
    .populate({ path: "contactId", populate: { path: "tagIds" } })
    .populate("assignedToUserId", "name")
    .populate("tagIds")
    .populate("lastMessageId");

  if (!conversation) return;

  const messages = await Message.find({ conversationId: conversation._id, deletedAt: { $exists: false } })
    .sort({ createdAt: 1 })
    .limit(100);

  const clients = clientsByWorkspace.get(conversation.workspaceId?.toString());
  if (!clients) return;

  for (const client of clients) {
    const visibleMessages = messages.filter((message) => {
      const deletedFor = message.deletedForUserIds || [];
      return !deletedFor.some((userId) => userId?.toString?.() === client.userId);
    });
    const unreadCount = Array.from(conversation.unreadCountByUser?.values?.() || [])
      .reduce((total, value) => total + Number(value || 0), 0);
    sendSse(client.res, "conversation", {
      conversation: serializeConversation(conversation, visibleMessages, { userId: client.userId }),
      unreadCount,
    });
  }

  await publishSocketWorkspaceUserEvent(conversation.workspaceId, "conversation", (user) => ({
    conversation: serializeConversation(conversation, messages, { userId: user?.sub }),
  }));
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

  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache, no-transform");
  res.setHeader("Connection", "keep-alive");
  res.flushHeaders?.();

  sendSse(res, "connected", { ok: true, workspaceId: user.workspaceId });
  const removeClient = addClient(user.workspaceId, user.sub, res);
  const heartbeat = setInterval(() => {
    sendSse(res, "heartbeat", { time: new Date().toISOString() });
  }, 25000);

  req.on("close", () => {
    clearInterval(heartbeat);
    removeClient();
  });
});

