import { Router } from "express";
import jwt from "jsonwebtoken";
import mongoose from "mongoose";
import { config } from "../config.js";
import { demoUser, demoWorkspace } from "../data/demoData.js";
import { Membership, Role, User, Workspace } from "../models/index.js";
import { verifyPassword } from "../utils/password.js";
import { serializeUser, serializeWorkspace, signSession } from "../utils/session.js";

export const authRouter = Router();

async function buildSessionForUser(user) {
  const membership = await Membership.findOne({ userId: user._id, status: "active" }).sort({ joinedAt: -1 });

  if (!membership) {
    return null;
  }

  const [workspace, role] = await Promise.all([
    Workspace.findById(membership.workspaceId),
    Role.findById(membership.roleId),
  ]);

  if (!workspace || !role) {
    return null;
  }

  return {
    token: signSession({ user, workspace, role }),
    user: serializeUser(user, role),
    workspace: serializeWorkspace(workspace),
  };
}

authRouter.get("/me", async (req, res) => {
  const authHeader = req.headers.authorization || "";
  const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : "";

  if (!token) {
    return res.status(401).json({ error: "AUTH_REQUIRED", message: "Authentication is required." });
  }

  let payload;
  try {
    payload = jwt.verify(token, config.jwtSecret);
  } catch {
    return res.status(401).json({ error: "INVALID_TOKEN", message: "Session is invalid or expired." });
  }

  if (mongoose.connection.readyState !== 1) {
    return res.status(503).json({ error: "DATABASE_UNAVAILABLE", message: "MongoDB is required." });
  }

  const user = await User.findOne({ _id: payload.sub, status: "active" });
  if (!user) {
    return res.status(401).json({ error: "INVALID_TOKEN", message: "Session user is no longer active." });
  }

  const session = await buildSessionForUser(user);
  if (!session) {
    return res.status(403).json({ error: "NO_WORKSPACE", message: "No active workspace membership found." });
  }

  res.json(session);
});

authRouter.post("/login", async (req, res) => {
  const { email, password } = req.body || {};

  if (!email || !password) {
    return res.status(400).json({ error: "VALIDATION_ERROR", message: "Email and password are required." });
  }

  if (mongoose.connection.readyState === 1) {
    const user = await User.findOne({ email: email.toLowerCase(), status: "active" });

    if (!user || !verifyPassword(password, user.passwordHash)) {
      return res.status(401).json({ error: "INVALID_CREDENTIALS", message: "Invalid email or password." });
    }

    user.lastLoginAt = new Date();
    await User.updateOne({ _id: user._id }, { $set: { lastLoginAt: user.lastLoginAt } });

    const session = await buildSessionForUser(user);
    if (!session) {
      return res.status(403).json({ error: "NO_WORKSPACE", message: "No active workspace membership found." });
    }

    return res.json(session);
  }

  if (config.demoMode && email.toLowerCase() === demoUser.email && password.length > 0) {
    const token = jwt.sign(
      { sub: demoUser.id, email: demoUser.email, workspaceId: demoWorkspace.id, role: demoUser.role },
      config.jwtSecret,
      { expiresIn: config.jwtExpiresIn }
    );

    return res.json({
      token,
      user: demoUser,
      workspace: demoWorkspace,
    });
  }

  res.status(401).json({ error: "INVALID_CREDENTIALS", message: "Invalid email or password." });
});

