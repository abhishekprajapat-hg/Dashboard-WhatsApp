import { Router } from "express";
import crypto from "crypto";
import { z } from "zod";
import { Contact, Conversation, InstagramAccount, Message } from "../models/index.js";
import { requireAuth, requirePermission } from "../middleware/auth.js";
import { requireWorkspaceContext } from "../middleware/workspace.js";
import { validateBody } from "../middleware/validate.js";
import { trimmedString } from "../utils/zodHelpers.js";
import { config } from "../config.js";
import {
  buildInstagramAuthorizeUrl,
  decodeInstagramCredentials,
  encodeInstagramCredentials,
  exchangeForLongLivedToken,
  exchangeInstagramCode,
  fetchInstagramAccountInfo,
  hasValidInstagramSignature,
  normalizeInstagramWebhookPayload,
  sendInstagramMessage,
} from "../services/instagramProvider.js";

export const instagramRouter = Router();
// Public: Meta's webhook POSTs here and the OAuth popup redirects here - neither carries our JWT.
export const instagramPublicRouter = Router();

function serializeAccount(account) {
  const credentials = decodeInstagramCredentials(account);
  return {
    id: account._id.toString(),
    instagramUserId: account.instagramUserId,
    username: account.username,
    profilePictureUrl: account.profilePictureUrl,
    status: account.status,
    webhookStatus: account.webhookStatus,
    lastError: account.lastError || "",
    hasAccessToken: Boolean(credentials.accessToken),
  };
}

instagramRouter.use(requireAuth, requireWorkspaceContext);

instagramRouter.get("/oauth/authorize-url", requirePermission("settings:read"), async (_req, res) => {
  if (!config.instagram.appId || !config.instagram.redirectUri) {
    return res.status(400).json({
      error: "INSTAGRAM_NOT_CONFIGURED",
      message: "Set META_INSTAGRAM_APP_ID/META_INSTAGRAM_APP_SECRET/META_INSTAGRAM_REDIRECT_URI first.",
    });
  }
  const state = crypto.randomBytes(16).toString("hex");
  res.json({ url: buildInstagramAuthorizeUrl(state), state });
});

instagramRouter.get("/accounts", requirePermission("settings:read"), async (req, res) => {
  const accounts = await InstagramAccount.find({ workspaceId: req.user.workspaceId }).sort({ createdAt: -1 });
  res.json({ data: accounts.map(serializeAccount), total: accounts.length });
});

export const connectInstagramSchema = z.object({
  code: trimmedString("An authorization code is required."),
});

instagramRouter.post("/accounts", requirePermission("settings:write"), validateBody(connectInstagramSchema), async (req, res) => {
  try {
    const { accessToken: shortLivedToken, instagramUserId } = await exchangeInstagramCode(req.body.code);
    const { accessToken } = await exchangeForLongLivedToken(shortLivedToken);
    const info = await fetchInstagramAccountInfo(accessToken);

    const account = await InstagramAccount.findOneAndUpdate(
      { workspaceId: req.user.workspaceId, instagramUserId },
      {
        organizationId: req.user.organizationId,
        workspaceId: req.user.workspaceId,
        instagramUserId,
        username: info.username || "",
        profilePictureUrl: info.profile_picture_url || "",
        encryptedCredentials: encodeInstagramCredentials({ accessToken }),
        status: "connected",
        lastError: "",
        credentialsUpdatedAt: new Date(),
      },
      { upsert: true, new: true, setDefaultsOnInsert: true }
    );

    res.status(201).json({ data: serializeAccount(account) });
  } catch (error) {
    res.status(error.status || 502).json({ error: error.code || "INSTAGRAM_CONNECT_FAILED", message: error.message });
  }
});

instagramRouter.delete("/accounts/:id", requirePermission("settings:write"), async (req, res) => {
  await InstagramAccount.deleteOne({ _id: req.params.id, workspaceId: req.user.workspaceId });
  res.status(204).send();
});

instagramRouter.post("/accounts/:id/send", requirePermission("templates:write"), validateBody(z.object({ to: trimmedString("A recipient is required."), body: trimmedString("Message body is required.") })), async (req, res) => {
  const account = await InstagramAccount.findOne({ _id: req.params.id, workspaceId: req.user.workspaceId });
  if (!account) return res.status(404).json({ error: "NOT_FOUND", message: "Instagram account not found." });
  try {
    const result = await sendInstagramMessage({ account, to: req.body.to, body: req.body.body });
    res.json({ data: result });
  } catch (error) {
    res.status(error.status || 502).json({ error: error.code || "INSTAGRAM_SEND_FAILED", message: error.message });
  }
});

// Minimal static popup page - Instagram's classic OAuth is a plain redirect, not a JS-SDK popup
// like WhatsApp Embedded Signup, so this hands the code back to the opener window the same way
// EmbeddedSignupButton.tsx's postMessage listener already expects, keeping both connect flows on
// the same client-side pattern.
instagramPublicRouter.get("/oauth-callback", (req, res) => {
  const code = String(req.query.code || "");
  const error = String(req.query.error_description || req.query.error || "");
  res.set("Content-Type", "text/html").send(`<!doctype html><html><body>
<script>
  window.opener?.postMessage(${JSON.stringify({ type: "IG_OAUTH_CALLBACK" })}, window.location.origin);
  window.opener?.postMessage(Object.assign(${JSON.stringify({ type: "IG_OAUTH_CALLBACK" })}, { code: ${JSON.stringify(code)}, error: ${JSON.stringify(error)} }), window.location.origin);
  window.close();
</script>
${error ? "Connection failed - you can close this window." : "Connected - you can close this window."}
</body></html>`);
});

instagramPublicRouter.get("/webhook", async (req, res) => {
  const mode = req.query["hub.mode"];
  const token = req.query["hub.verify_token"];
  const challenge = req.query["hub.challenge"];
  if (mode === "subscribe" && token === config.instagram.verifyToken) {
    return res.status(200).send(challenge);
  }
  res.sendStatus(403);
});

instagramPublicRouter.post("/webhook", async (req, res) => {
  if (!hasValidInstagramSignature(req)) {
    return res.status(403).json({ error: "INVALID_SIGNATURE", message: "Instagram webhook signature verification failed." });
  }

  const normalized = normalizeInstagramWebhookPayload(req.body);
  if (normalized.type !== "message") return res.sendStatus(200);

  const account = await InstagramAccount.findOne({ instagramUserId: normalized.instagramUserId });
  if (!account) return res.sendStatus(200);

  const existingMessage = await Message.findOne({ workspaceId: account.workspaceId, providerMessageId: normalized.providerMessageId }).select("_id");
  if (existingMessage) return res.sendStatus(200);

  let contact = await Contact.findOne({ workspaceId: account.workspaceId, instagramScopedId: normalized.from });
  if (!contact) {
    contact = await Contact.create({
      organizationId: account.organizationId,
      workspaceId: account.workspaceId,
      name: normalized.from,
      channel: "instagram",
      instagramScopedId: normalized.from,
      source: "Instagram",
      lifecycleStatus: "lead",
      lastMessageAt: new Date(),
    });
  } else {
    await Contact.updateOne({ _id: contact._id }, { $set: { lastMessageAt: new Date() } });
  }

  let conversation = await Conversation.findOne({ workspaceId: account.workspaceId, contactId: contact._id, channel: "instagram" });
  conversation = conversation
    ? await Conversation.findByIdAndUpdate(conversation._id, { instagramAccountId: account._id, status: "open", lastMessageAt: new Date() }, { new: true })
    : await Conversation.create({
      organizationId: account.organizationId,
      workspaceId: account.workspaceId,
      contactId: contact._id,
      instagramAccountId: account._id,
      channel: "instagram",
      status: "open",
      lastMessageAt: new Date(),
    });

  const message = await Message.create({
    organizationId: account.organizationId,
    workspaceId: account.workspaceId,
    conversationId: conversation._id,
    contactId: contact._id,
    instagramAccountId: account._id,
    channel: "instagram",
    direction: "inbound",
    type: "text",
    body: normalized.body,
    providerMessageId: normalized.providerMessageId,
    status: "delivered",
    receivedAt: new Date(),
  });

  await Conversation.updateOne({ _id: conversation._id }, { $set: { lastMessageId: message._id } });

  res.sendStatus(200);
});
