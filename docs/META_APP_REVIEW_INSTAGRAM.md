# Meta App Review — Instagram Messaging (instagram_business_basic / instagram_business_manage_messages) submission

Goal: get approved for these two permissions so Instagram DM omnichannel works for real client
businesses' Instagram accounts, not just this app's own tester/added account (`@nemnidhi.official`).
Same overall App ID `1622746365465041` as [`META_APP_REVIEW.md`](./META_APP_REVIEW.md) (WhatsApp) and
[`META_APP_REVIEW_ADS.md`](./META_APP_REVIEW_ADS.md) (Marketing API) — these two permissions just
belong to the Instagram product's own "API setup with Instagram Login" configuration within that same
app, issued with their own separate Instagram App ID/Secret (see `HANDOFF.md`'s "Manual setup
required" section). Basic Settings (icon, domains, privacy policy, Terms of Service, data deletion,
Business Verification) are already done from the WhatsApp review — nothing to redo there.

## Before submitting — confirm the real demo still works

Everything below assumes `HANDOFF.md`'s "RESOLVED 2026-08-22" and "Instagram non-text messages...
closed 2026-08-22" sections are both still true in production:

```bash
ssh -p 2424 samvid@72.60.97.58 "cd /opt/dashboard-whatsapp && cat .last-deploy-sha && git log -1 --oneline"
```

Confirm the deployed SHA is at or after `c8d15e5` (the most recent Instagram-related fix as of this
doc). If it's genuinely stale, re-verify the whole demo below before recording anything — Meta
requires a working demo, not a description, and a stale deploy is exactly what would make a real
screencast unreliable.

## 1. Permission justification text (paste into the App Review request form)

**`instagram_business_basic`**

> Our app is a WhatsApp CRM/marketing dashboard that lets a business's own team manage customer
> conversations from a single shared inbox. This permission lets a business connect their own
> Instagram professional account (via a standard OAuth consent flow in Settings → Instagram) so the
> app can read basic account info needed to route their Instagram DMs into the same inbox they already
> use for WhatsApp — one unified place for customer conversations across channels, instead of a
> separate disconnected tool per channel.

**`instagram_business_manage_messages`**

> Used to receive a business's inbound Instagram DMs via webhook and send replies on their behalf,
> from the same shared team inbox that already handles WhatsApp. Inbound messages (text and media —
> image/video/audio/document) create or update a `Contact`/`Conversation`/`Message` record exactly
> like an inbound WhatsApp message does, so a business's team replies from one screen regardless of
> which channel a customer messaged on. This also lets a connected Instagram DM trigger the same
> automation-flow engine (keyword triggers, auto-tagging, etc.) already available for WhatsApp.

## 2. Screencast walkthrough (~2 minutes)

Reuse the same recording setup as `SCREEN_RECORDING_SCRIPT.md` (dashboard logged in as admin, address
bar visible, no real customer data beyond the demo account itself).

1. **Settings → Instagram → Connect Instagram** — real OAuth popup, real consent screen, popup
   closes, `@nemnidhi.official` appears with a green "connected" badge.
2. Switch to a phone (or a second browser session) logged into a **different, personal** Instagram
   account → send a real DM (a plain text message) to the connected account.
3. Back in the dashboard's **Inbox** — show the DM arrive as a new conversation, tagged `Instagram DM`,
   with the real message body.
4. **Reply** from the Inbox's composer → show it delivered on the real Instagram side (switch back to
   the personal account, show the reply arrived).
5. **Optional but strengthens the submission**: repeat step 2–4 with a real photo/video attachment
   instead of plain text, to demonstrate the non-text handling explicitly covered by
   `instagram_business_manage_messages`'s justification text above.

## 3. After submission

- Same discipline as the other two reviews: Standard Access (this app's own tester/added account,
  `@nemnidhi.official`) keeps working throughout the review — nothing in this app gates on review
  status, so development on `main` continues as normal.
- If Meta requests changes, re-submit from the same **Review** tab once addressed.
- Once approved, no code changes are required — `instagramProvider.js`/`instagram.js` already talk to
  the real Instagram Graph API end to end; this only unlocks *other* businesses' Instagram accounts
  beyond this app's own tester account.
