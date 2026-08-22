import { Router } from "express";
import crypto from "crypto";
import { z } from "zod";
import { Contact, Conversation, InstagramAccount, Membership, Message } from "../models/index.js";
import { requireAuth, requirePermission } from "../middleware/auth.js";
import { requireWorkspaceContext } from "../middleware/workspace.js";
import { validateBody } from "../middleware/validate.js";
import { trimmedString } from "../utils/zodHelpers.js";
import { config } from "../config.js";
import { publishConversationChanged } from "../realtime/events.js";
import { runInboundAutomations } from "../services/automationRunner.js";
import { logger } from "../services/logger.js";
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
// like WhatsApp Embedded Signup.
//
// Two real bugs found via live testing, in sequence, both around getting the code back to the
// opener window:
// 1. helmet's default Cross-Origin-Opener-Policy: same-origin applies to every response including
//    this one - overriding it to same-origin-allow-popups (still set below, cheap and correct
//    regardless) fixes the case where *our own* header was the problem.
// 2. That alone wasn't enough: Instagram's own login/consent pages very likely set their own
//    strict COOP, which severs window.opener the moment the popup first navigates *to*
//    instagram.com - before it ever comes back here. No header on our side can undo a group
//    switch that already happened on Instagram's domain. This is a known failure mode for
//    window.opener-based OAuth popups on any provider with its own strict COOP (Google, Facebook,
//    Instagram, etc. all commonly do this now).
//
// Real fix: don't depend on window.opener at all. Write the result to localStorage instead - the
// main window listens for the "storage" event, which fires cross-window for any same-origin
// window/tab regardless of whether an opener relationship survived. InstagramSettingsPanel.tsx is
// the other half of this.
instagramPublicRouter.get("/oauth-callback", (req, res) => {
  const code = String(req.query.code || "");
  const error = String(req.query.error_description || req.query.error || "");
  res.setHeader("Cross-Origin-Opener-Policy", "same-origin-allow-popups");
  const payload = JSON.stringify({ type: "IG_OAUTH_CALLBACK", code, error, at: Date.now() });
  res.set("Content-Type", "text/html").send(`<!doctype html><html><body>
<script>
  try { localStorage.setItem("ig_oauth_result", ${JSON.stringify(payload)}); } catch (e) {}
  window.opener?.postMessage(JSON.parse(${JSON.stringify(payload)}), window.location.origin);
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

  let account = await InstagramAccount.findOne({ instagramUserId: normalized.instagramUserId });
  if (!account) {
    // Two different ID namespaces exist across Meta's Instagram APIs (confirmed live in production -
    // graph.instagram.com/me?fields=user_id, called during OAuth connect, returns a different numeric
    // ID than what a real webhook's entry[].id sends for the same account). Rather than chase which
    // OAuth-time call would've returned the matching ID, self-heal here: when the mismatch happens and
    // exactly one InstagramAccount is on file, it can only be that one account under its real webhook
    // ID, so correct it and keep processing this message instead of dropping it.
    const candidates = await InstagramAccount.find({});
    if (candidates.length === 1) {
      const previousInstagramUserId = candidates[0].instagramUserId;
      account = await InstagramAccount.findByIdAndUpdate(
        candidates[0]._id,
        { $set: { instagramUserId: normalized.instagramUserId } },
        { new: true }
      );
      logger.warn({ previousInstagramUserId, correctedInstagramUserId: normalized.instagramUserId, username: account.username }, "Instagram webhook: self-healed instagramUserId on the single connected account");
    } else {
      logger.warn({ webhookInstagramUserId: normalized.instagramUserId, rawEntryId: req.body?.entry?.[0]?.id, storedAccounts: candidates.map((a) => ({ id: a.instagramUserId, username: a.username })) }, "Instagram webhook: no matching account found, and self-heal skipped (more than one account on file)");
      return res.sendStatus(200);
    }
  }

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

  const existingConversation = await Conversation.findOne({ workspaceId: account.workspaceId, contactId: contact._id, channel: "instagram" });
  const isNewConversation = !existingConversation;
  const conversation = existingConversation
    ? await Conversation.findByIdAndUpdate(existingConversation._id, { instagramAccountId: account._id, status: "open", lastMessageAt: new Date() }, { new: true })
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
    type: normalized.attachments?.[0]?.type || "text",
    body: normalized.body,
    attachments: normalized.attachments,
    providerMessageId: normalized.providerMessageId,
    status: "delivered",
    receivedAt: new Date(),
  });

  const memberships = await Membership.find({ workspaceId: account.workspaceId, status: "active" }).select("userId");
  for (const membership of memberships) {
    const key = membership.userId.toString();
    const current = Number(conversation.unreadCountByUser?.get?.(key) || 0);
    conversation.unreadCountByUser.set(key, current + 1);
  }
  conversation.markModified("unreadCountByUser");
  conversation.lastMessageId = message._id;
  await conversation.save();
  await publishConversationChanged(conversation._id);

  // Same trigger.accountId/env.account mechanism whatsapp.js already uses - runInboundAutomations
  // only needs workspaceId/organizationId/_id off "account", it doesn't care which collection it
  // came from. env.account (automationEngine.js's loadRunEnv) will resolve to null for these runs
  // since it looks up WhatsAppAccount specifically - harmless, since send_instagram (unlike
  // send_message) deliberately doesn't depend on env.account, it looks up the Instagram account
  // itself. WhatsApp-only nodes (send_message, etc.) correctly no-op via their own
  // missing-account-skip path, same as any other flow with no connected account.
  await runInboundAutomations({
    account,
    contact,
    conversation,
    inboundMessage: message,
    isNewConversation,
  });

  res.sendStatus(200);
});
