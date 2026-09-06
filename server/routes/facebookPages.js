import { Router } from "express";
import crypto from "crypto";
import { z } from "zod";
import { Contact, Conversation, FacebookAccount, Membership, Message } from "../models/index.js";
import { requireAuth, requirePermission } from "../middleware/auth.js";
import { requireWorkspaceContext } from "../middleware/workspace.js";
import { validateBody } from "../middleware/validate.js";
import { trimmedString } from "../utils/zodHelpers.js";
import { config } from "../config.js";
import { publishConversationChanged } from "../realtime/events.js";
import { runInboundAutomations } from "../services/automationRunner.js";
import {
  buildFacebookPagesAuthorizeUrl,
  decodeFacebookCredentials,
  encodeFacebookCredentials,
  exchangeFacebookCode,
  exchangeForLongLivedUserToken,
  fetchManagedPages,
  hasValidFacebookSignature,
  normalizeFacebookWebhookPayload,
  sendFacebookMessage,
} from "../services/facebookPagesProvider.js";

// Minimal scope, matching this project's own "genuine minimal feature before requesting a
// permission" discipline (see instagram.js/whatsappCommerce.js): connect a Page, receive a DM into
// the same unified Inbox, reply. No Page post publishing/comments/insights here - those are real
// follow-ups for a later, separate permission request, exactly like Instagram's own permissions
// were added one at a time as real features justified each one.
export const facebookPagesRouter = Router();
// Public: Meta's webhook POSTs here and the OAuth popup redirects here - neither carries our JWT.
export const facebookPagesPublicRouter = Router();

function serializeAccount(account) {
  const credentials = decodeFacebookCredentials(account);
  return {
    id: account._id.toString(),
    pageId: account.pageId,
    pageName: account.pageName,
    profilePictureUrl: account.profilePictureUrl,
    status: account.status,
    webhookStatus: account.webhookStatus,
    lastError: account.lastError || "",
    hasAccessToken: Boolean(credentials.accessToken),
  };
}

facebookPagesRouter.use(requireAuth, requireWorkspaceContext);

facebookPagesRouter.get("/oauth/authorize-url", requirePermission("settings:read"), async (_req, res) => {
  if (!config.meta.appId || !config.facebookPages.redirectUri) {
    return res.status(400).json({
      error: "FACEBOOK_PAGES_NOT_CONFIGURED",
      message: "Set META_APP_ID/WHATSAPP_APP_SECRET/META_FACEBOOK_PAGES_REDIRECT_URI first.",
    });
  }
  const state = crypto.randomBytes(16).toString("hex");
  res.json({ url: buildFacebookPagesAuthorizeUrl(state), state });
});

facebookPagesRouter.get("/accounts", requirePermission("settings:read"), async (req, res) => {
  const accounts = await FacebookAccount.find({ workspaceId: req.user.workspaceId }).sort({ createdAt: -1 });
  res.json({ data: accounts.map(serializeAccount), total: accounts.length });
});

export const connectFacebookPagesSchema = z.object({
  code: trimmedString("An authorization code is required."),
});

// Connects every Page the authorizing user manages in one call - unlike Instagram (always exactly
// one account per OAuth grant), a Facebook user can manage several Pages at once via a single
// pages_show_list/pages_messaging grant, so this upserts all of them rather than asking the client
// to pick just one.
facebookPagesRouter.post("/accounts", requirePermission("settings:write"), validateBody(connectFacebookPagesSchema), async (req, res) => {
  try {
    const { accessToken: shortLivedToken } = await exchangeFacebookCode(req.body.code);
    const { accessToken: longLivedUserToken } = await exchangeForLongLivedUserToken(shortLivedToken);
    const pages = await fetchManagedPages(longLivedUserToken);

    const accounts = await Promise.all(
      pages.map((page) =>
        FacebookAccount.findOneAndUpdate(
          { workspaceId: req.user.workspaceId, pageId: page.id },
          {
            organizationId: req.user.organizationId,
            workspaceId: req.user.workspaceId,
            pageId: page.id,
            pageName: page.name,
            profilePictureUrl: page.profilePictureUrl,
            encryptedCredentials: encodeFacebookCredentials({ accessToken: page.accessToken }),
            status: "connected",
            lastError: "",
            credentialsUpdatedAt: new Date(),
          },
          { upsert: true, new: true, setDefaultsOnInsert: true }
        )
      )
    );

    res.status(201).json({ data: accounts.map(serializeAccount) });
  } catch (error) {
    res.status(error.status || 502).json({ error: error.code || "FACEBOOK_CONNECT_FAILED", message: error.message });
  }
});

facebookPagesRouter.delete("/accounts/:id", requirePermission("settings:write"), async (req, res) => {
  await FacebookAccount.deleteOne({ _id: req.params.id, workspaceId: req.user.workspaceId });
  res.status(204).send();
});

facebookPagesRouter.post("/accounts/:id/send", requirePermission("templates:write"), validateBody(z.object({ to: trimmedString("A recipient is required."), body: trimmedString("Message body is required.") })), async (req, res) => {
  const account = await FacebookAccount.findOne({ _id: req.params.id, workspaceId: req.user.workspaceId });
  if (!account) return res.status(404).json({ error: "NOT_FOUND", message: "Facebook Page not found." });
  try {
    const result = await sendFacebookMessage({ account, to: req.body.to, body: req.body.body });
    res.json({ data: result });
  } catch (error) {
    res.status(error.status || 502).json({ error: error.code || "FACEBOOK_SEND_FAILED", message: error.message });
  }
});

// Same window.opener-hostility workaround as instagram.js's oauth-callback (see its own comment
// for the two real bugs already found there) - write the result to localStorage instead of relying
// on window.opener, since Facebook's own login/consent pages set a strict
// Cross-Origin-Opener-Policy too.
facebookPagesPublicRouter.get("/oauth-callback", (req, res) => {
  const code = String(req.query.code || "");
  const error = String(req.query.error_description || req.query.error || "");
  res.setHeader("Cross-Origin-Opener-Policy", "same-origin-allow-popups");
  const payload = JSON.stringify({ type: "FB_PAGES_OAUTH_CALLBACK", code, error, at: Date.now() });
  res.set("Content-Type", "text/html").send(`<!doctype html><html><body>
<script>
  try { localStorage.setItem("fb_pages_oauth_result", ${JSON.stringify(payload)}); } catch (e) {}
  window.opener?.postMessage(JSON.parse(${JSON.stringify(payload)}), window.location.origin);
  window.close();
</script>
${error ? "Connection failed - you can close this window." : "Connected - you can close this window."}
</body></html>`);
});

facebookPagesPublicRouter.get("/webhook", async (req, res) => {
  const mode = req.query["hub.mode"];
  const token = req.query["hub.verify_token"];
  const challenge = req.query["hub.challenge"];
  if (mode === "subscribe" && token === config.facebookPages.verifyToken) {
    return res.status(200).send(challenge);
  }
  res.sendStatus(403);
});

facebookPagesPublicRouter.post("/webhook", async (req, res) => {
  if (!hasValidFacebookSignature(req)) {
    return res.status(403).json({ error: "INVALID_SIGNATURE", message: "Facebook webhook signature verification failed." });
  }

  const normalized = normalizeFacebookWebhookPayload(req.body);
  if (normalized.type !== "message") return res.sendStatus(200);

  const account = await FacebookAccount.findOne({ pageId: normalized.pageId });
  if (!account) return res.sendStatus(200);

  const existingMessage = await Message.findOne({ workspaceId: account.workspaceId, providerMessageId: normalized.providerMessageId }).select("_id");
  if (existingMessage) return res.sendStatus(200);

  let contact = await Contact.findOne({ workspaceId: account.workspaceId, facebookScopedId: normalized.from });
  if (!contact) {
    contact = await Contact.create({
      organizationId: account.organizationId,
      workspaceId: account.workspaceId,
      name: normalized.from,
      channel: "facebook",
      facebookScopedId: normalized.from,
      source: "Facebook",
      lifecycleStatus: "lead",
      lastMessageAt: new Date(),
    });
  } else {
    await Contact.updateOne({ _id: contact._id }, { $set: { lastMessageAt: new Date() } });
  }

  const existingConversation = await Conversation.findOne({ workspaceId: account.workspaceId, contactId: contact._id, channel: "facebook" });
  const isNewConversation = !existingConversation;
  const conversation = existingConversation
    ? await Conversation.findByIdAndUpdate(existingConversation._id, { facebookAccountId: account._id, status: "open", lastMessageAt: new Date() }, { new: true })
    : await Conversation.create({
      organizationId: account.organizationId,
      workspaceId: account.workspaceId,
      contactId: contact._id,
      facebookAccountId: account._id,
      channel: "facebook",
      status: "open",
      lastMessageAt: new Date(),
    });

  const message = await Message.create({
    organizationId: account.organizationId,
    workspaceId: account.workspaceId,
    conversationId: conversation._id,
    contactId: contact._id,
    facebookAccountId: account._id,
    channel: "facebook",
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

  await runInboundAutomations({
    account,
    contact,
    conversation,
    inboundMessage: message,
    isNewConversation,
  });

  res.sendStatus(200);
});
