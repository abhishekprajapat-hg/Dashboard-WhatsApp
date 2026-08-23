# Meta App Review — Instagram permissions submission

Goal: get approved for five Instagram permissions so the full Instagram integration works for real
client businesses' Instagram accounts, not just this app's own tester/added account
(`@nemnidhi.official`). Same overall App ID `1622746365465041` as
[`META_APP_REVIEW.md`](./META_APP_REVIEW.md) (WhatsApp) and
[`META_APP_REVIEW_ADS.md`](./META_APP_REVIEW_ADS.md) (Marketing API) — these permissions all belong to
the Instagram product's own "API setup with Instagram Login" configuration within that same app,
issued with their own separate Instagram App ID/Secret (see `HANDOFF.md`'s "Manual setup required"
section). Basic Settings (icon, domains, privacy policy, Terms of Service, data deletion, Business
Verification) are already done from the WhatsApp review — nothing to redo there.

**The five permissions**, in the order they were built (see `HANDOFF.md` for each one's full build
record):
1. `instagram_business_basic` — connect the account
2. `instagram_business_manage_messages` — receive/send DMs (built and verified live first)
3. `instagram_business_manage_insights` — account-level stats
4. `instagram_business_manage_comments` — view/reply to comments on posts
5. `instagram_business_content_publish` — publish a photo post

A sixth checkbox Meta's "Request advanced access" dialog offers, **"Human Agent"**, isn't a separate
OAuth scope needing its own justification text the same way — it's the `HUMAN_AGENT` message tag,
which extends the 24-hour messaging window to 7 days for genuinely human-initiated replies. It's
already wired into `sendInstagramMessage`'s real Inbox-reply call site (never the automation node —
see `HANDOFF.md`). If Meta's form does present a text box for it, use the messaging justification
text below — the tag rides on the same underlying send capability.

## Before submitting — confirm the real demo still works

Everything below assumes every Instagram section in `HANDOFF.md` dated 2026-08-22/23 is still true in
production — the DM fixes, and the four new features (Insights/Comments/Publish/Human Agent tag):

```bash
ssh -p 2424 samvid@72.60.97.58 "cd /opt/dashboard-whatsapp && cat .last-deploy-sha && git log -1 --oneline"
```

Confirm the deployed SHA is at or after `7900bcb` (the Human Agent tag commit, most recent as of this
doc). If it's genuinely stale, re-verify the whole demo below before recording anything — Meta
requires a working demo, not a description, and a stale deploy is exactly what would make a real
screencast unreliable.

**One manual step still outstanding before Comments can be demoed for real**: the webhook is only
subscribed to the `messages` field in App Dashboard. Subscribe to `comments` too (App Dashboard →
Instagram product → webhook config) — without this, the Comments code is live but will never receive
a real comment no matter how correct it is.

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

**`instagram_business_manage_insights`**

> Used to show a business their own Instagram account's real-time performance (reach, follower count,
> accounts engaged, and total interactions) directly in the same dashboard they use to manage their
> WhatsApp and Instagram conversations — so a business doesn't need a separate tool just to see how
> their Instagram presence is performing alongside the customer-conversation data this app already
> centralizes.

**`instagram_business_manage_comments`**

> Used to show a business the comments on their own Instagram posts and let their team reply directly
> from the same shared inbox that already handles their DMs and WhatsApp conversations — so a
> customer's public comment and their private DM get the same fast, centralized response instead of
> comments living in a separate, easy-to-miss tab of the native Instagram app.

**`instagram_business_content_publish`**

> Used to let a business publish a photo post directly to their own connected Instagram account from
> the same dashboard they already use for WhatsApp campaigns and Instagram DMs — closing the loop
> between planning outreach content and actually publishing it, without needing to switch to a
> separate tool or the native Instagram app just to post.

## 2. Screencast walkthrough (~3-4 minutes, all five permissions in one recording)

Reuse the same recording setup as `SCREEN_RECORDING_SCRIPT.md` (dashboard logged in as admin, address
bar visible, no real customer data beyond the demo account itself).

1. **Settings → Instagram → Connect Instagram** — if already connected, showing the existing green
   "connected" badge for `@nemnidhi.official` is fine (see `HANDOFF.md` — the last live-recorded
   attempt showed this completing in ~2 seconds with no visible consent screen, since the app was
   already authorized from earlier testing; don't force a disconnect/reconnect just for the recording
   unless you specifically want that risk).
2. Switch to a phone (or a second browser session) logged into a **different, personal** Instagram
   account → send a real DM (a plain text message) to the connected account.
3. Back in the dashboard's **Inbox** — show the DM arrive as a new conversation, tagged `Instagram DM`,
   with the real message body.
4. **Reply** from the Inbox's composer → show it delivered on the real Instagram side (switch back to
   the personal account, show the reply arrived). This step was missing from the last recording
   attempt — don't skip it, it's the part that most directly backs up
   `instagram_business_manage_messages`'s "and send replies on their behalf" justification text.
5. Repeat step 2–4 with a real photo attachment instead of plain text, to demonstrate the non-text
   handling explicitly covered by the same justification text.
6. **Settings → Instagram → View Insights** on the connected account — show the real
   reach/follower count/accounts engaged/total interactions numbers Meta returns.
7. **Post a real comment** on one of the connected account's real posts (from the personal account) →
   show it appear in the dashboard's **Recent Comments** panel → **reply** to it from the panel → show
   the reply appear as a real reply on the actual Instagram post.
8. **Publish a real photo post** from the Settings → Instagram panel's "Publish Post" form → show the
   new post actually appear on the connected account's real Instagram profile afterward.

## 3. After submission

- Same discipline as the other two reviews: Standard Access (this app's own tester/added account,
  `@nemnidhi.official`) keeps working throughout the review — nothing in this app gates on review
  status, so development on `main` continues as normal.
- If Meta requests changes, re-submit from the same **Review** tab once addressed.
- Once approved, no code changes are required — `instagramProvider.js`/`instagram.js` already talk to
  the real Instagram Graph API end to end; this only unlocks *other* businesses' Instagram accounts
  beyond this app's own tester account.
