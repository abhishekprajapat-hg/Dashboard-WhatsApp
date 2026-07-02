import { Server } from "socket.io";
import jwt from "jsonwebtoken";
import { config } from "../config.js";

let io;
const onlineUsersByWorkspace = new Map();

function workspaceRoom(workspaceId) {
  return `workspace:${workspaceId}`;
}

function conversationRoom(conversationId) {
  return `conversation:${conversationId}`;
}

function onlinePayload(workspaceId) {
  return {
    workspaceId: workspaceId?.toString?.() || String(workspaceId || ""),
    userIds: Array.from(onlineUsersByWorkspace.get(workspaceId?.toString?.() || String(workspaceId || "")) || []),
  };
}

function addOnlineUser(workspaceId, userId) {
  const key = workspaceId?.toString?.() || "";
  if (!key || !userId) return;
  const users = onlineUsersByWorkspace.get(key) || new Set();
  users.add(userId.toString());
  onlineUsersByWorkspace.set(key, users);
}

function removeOnlineUser(workspaceId, userId) {
  const key = workspaceId?.toString?.() || "";
  if (!key || !userId) return;
  const users = onlineUsersByWorkspace.get(key);
  if (!users) return;
  users.delete(userId.toString());
  if (users.size === 0) onlineUsersByWorkspace.delete(key);
}

export function createRealtimeServer(httpServer) {
  io = new Server(httpServer, {
    cors: {
      origin: true,
      credentials: true,
    },
    transports: ["websocket", "polling"],
    pingTimeout: 30000,
    pingInterval: 20000,
  });

  io.use((socket, next) => {
    const token = socket.handshake.auth?.token || socket.handshake.query?.token;
    if (!token) return next(new Error("AUTH_REQUIRED"));

    try {
      socket.user = jwt.verify(token, config.jwtSecret);
      if (!socket.user.workspaceId || !socket.user.organizationId) return next(new Error("WORKSPACE_REQUIRED"));
      return next();
    } catch {
      return next(new Error("INVALID_TOKEN"));
    }
  });

  io.on("connection", (socket) => {
    const workspaceId = socket.user.workspaceId?.toString();
    const userId = socket.user.sub?.toString();
    socket.join(workspaceRoom(workspaceId));
    addOnlineUser(workspaceId, userId);
    io.to(workspaceRoom(workspaceId)).emit("presence:online", onlinePayload(workspaceId));

    socket.on("conversation:join", ({ conversationId } = {}) => {
      if (conversationId) socket.join(conversationRoom(conversationId));
    });

    socket.on("conversation:leave", ({ conversationId } = {}) => {
      if (conversationId) socket.leave(conversationRoom(conversationId));
    });

    socket.on("typing", ({ conversationId, typing } = {}) => {
      if (!conversationId) return;
      socket.to(workspaceRoom(workspaceId)).emit("typing", {
        conversationId,
        typing: Boolean(typing),
        userId,
      });
    });

    socket.on("disconnect", () => {
      removeOnlineUser(workspaceId, userId);
      io?.to(workspaceRoom(workspaceId)).emit("presence:online", onlinePayload(workspaceId));
    });
  });

  return io;
}

export function publishSocketWorkspaceEvent(workspaceId, event, payload) {
  if (!io || !workspaceId) return;
  io.to(workspaceRoom(workspaceId)).emit(event, payload);
}

export async function publishSocketWorkspaceUserEvent(workspaceId, event, buildPayload) {
  if (!io || !workspaceId) return;
  const sockets = await io.in(workspaceRoom(workspaceId)).fetchSockets();
  for (const socket of sockets) {
    socket.emit(event, await buildPayload(socket.user));
  }
}

export function publishSocketConversationEvent(conversationId, event, payload) {
  if (!io || !conversationId) return;
  io.to(conversationRoom(conversationId)).emit(event, payload);
}
