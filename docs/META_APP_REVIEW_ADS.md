# Meta App Review — Marketing API (ads_management / ads_read) submission

Goal: get the Meta app (App ID `1622746365465041`) approved for Standard Access on
`ads_management` and `ads_read`, so Click-to-WhatsApp campaigns can be created against the real
production ad account instead of failing on the app's Limited-access Marketing API tier. This is a
separate review from [`META_APP_REVIEW.md`](./META_APP_REVIEW.md) (WhatsApp messaging/management,
already approved 2026-08-13) — that doc and its screencast script don't cover these permissions.

## Before submitting — real root cause, don't re-diagnose

If `(#200) Ad account owner has NOT grant ads_management or ads_read permission` ever comes back,
read [`HANDOFF.md`](../HANDOFF.md)'s "RESOLVED 2026-08-19" section first. The multi-day version of
this error was a wrong ad account ID (`act_638172839578849`, one digit off from the real
`act_338172839578849`), not a permissions or tier problem. Confirm the literal ID before assuming
anything Meta-side is broken again.

## 2026-08-19 rejection — read this before resubmitting

The first submission was rejected. Real feedback from Meta's App Review dashboard, not assumed:

- **`pages_show_list`, `ads_read`, `ads_management`** — all three: **"Screencast Not Aligned with
  Use Case Details."** Meta's own text: *"We have determined that your apps' use case is allowed,
  however, the submitted screencast fails to demonstrate the end-to-end experience."* The use case
  itself was accepted — only the screencast was the problem. Meta's stated checklist for a passing
  screencast: (1) the complete Meta login flow, (2) a user granting the app access to the
  permission, (3) the end-to-end experience of the use case, (4) Screen Recording Guide practices
  (English UI, captions/tooltips explaining buttons and UI elements), and (5) **if the app is
  server-to-server or uses a System User token, say so explicitly in the submission notes** so the
  reviewer doesn't expect a frontend login flow that will never appear.
- **`pages_read_engagement`** — different rejection: **"Disallowed Use Case Details."** Meta says
  the permission is invalid or not needed for the app's core functionality. This matches what this
  project's own code trace already found independently (nothing in this codebase ever reads
  engagement data) — **don't re-request this one, drop it entirely.**

**The real root cause, confirmed by checking `AdsSettingsPanel.tsx`**: this feature connects via a
**manually pasted access token** (`Ad account ID`/`Page ID`/`Access token` fields), not a "Login
with Facebook" OAuth popup — there is no frontend Meta login flow in this app at all, matching
every other account-connection flow in this codebase (WhatsApp, Instagram). The original screencast
almost certainly showed pasting a token with no visible consent screen, and without checklist item
5's disclosure, a reviewer reasonably reads that as a failed/incomplete OAuth demonstration rather
than a legitimate server-to-server integration.

**A second real finding, checking `metaAdsProvider.js` directly**: `pages_show_list` isn't actually
needed by this code at all, the same "wrong permission requested" pattern already caught once in
Samvid Lead Engine's own Facebook-presence work. `pageId` (line 94) is only ever passed as a
literal `page_id` field *value* inside the ad creative payload (lines 126, 146) — the code never
calls `/me/accounts` or anything else `pages_show_list` actually gates. Meta saying "your app's use
case is allowed" for it doesn't mean it's *needed*; per Meta's own general guidance, requesting an
unneeded permission is itself a common rejection cause. Drop it, don't just re-record its screencast.

**Fix for resubmission**:
1. Request only `ads_read` and `ads_management` — omit both `pages_read_engagement` (disallowed use
   case) and `pages_show_list` (not needed by this code at all).
2. Add one explicit sentence to each of the two remaining permissions' justification text (see the
   updated text below): this app is a server-to-server integration, connected via a System User
   access token the business's own admin enters directly, not a frontend OAuth flow.
3. Re-record the screencast following Meta's Screen Recording Guide: English UI (already is),
   on-screen captions/tooltips naming each field and button as it's used, not just silent clicking.

## 1. Permission justification text (paste into the App Review request form)

**`ads_management`**

> Our app is a WhatsApp CRM/marketing dashboard that lets a business's own team create and manage
> Click-to-WhatsApp ad campaigns for their own ad account, directly from the same dashboard they use
> to manage their WhatsApp inbox and automation. The Ads tab (Settings → Ads) connects the
> business's own Meta ad account, then creates a campaign/ad set/ad via the Marketing API - every
> campaign is created `PAUSED` by design, with no activation control in the app; activation happens
> explicitly in Meta Ads Manager. This closes the loop between ad spend and the WhatsApp
> conversations it generates, which the dashboard already manages end to end.
>
> This is a server-to-server integration: the business's own admin connects their ad account by
> entering a System User access token directly in Settings → Ads, not through a frontend Meta
> Login/OAuth popup. There is no visible Meta login step in the screencast for this reason.

**`ads_read`**

> Used alongside `ads_management` to read the connected ad account's details (name, currency,
> status) when testing a connection, and to pull campaign status back into the dashboard so a
> business can see their Click-to-WhatsApp campaigns without leaving the tool they already use for
> WhatsApp messaging and CRM.
>
> Same server-to-server integration as `ads_management` above - System User access token entered
> directly by the business's own admin, no frontend Meta Login/OAuth flow.

## 2. Screencast walkthrough (~1-2 minutes, much shorter than the WhatsApp one)

Reuse the same recording setup as `SCREEN_RECORDING_SCRIPT.md` (dashboard logged in as admin,
address bar visible, no real customer data). **New this time, per Meta's own rejection checklist**:
add on-screen captions/tooltips naming each field and button as it's used (not silent clicking),
and open with a title card or caption stating plainly: *"This app connects via a System User access
token entered by the business admin - there is no Meta Login popup in this flow."* That sentence is
what was missing last time.

1. **Settings → Ads** — show the connected ad account card (`act_338172839578849`, status
   "connected"); caption the Ad account ID / Page ID / Access token fields as you point to them
2. Click **Create campaign** → fill in name / daily budget / ad message / creative image → submit
   → show it appear in the campaign list with status `paused`
3. Switch to a second tab already open on **Meta Ads Manager** (`adsmanager.facebook.com`) → show
   the same campaign there by name, Delivery "Off", confirming it's real and genuinely paused (zero
   spend, matches the app's own "nothing spends until explicitly activated from Meta Ads Manager"
   description)

## 3. After submission

- Same discipline as the WhatsApp review: Standard Access / existing flows are unaffected while
  review is pending, keep developing on `main` as normal
- If Meta requests changes, re-submit from the same **Review** tab once addressed
- Once approved, no code changes are required - `metaAdsProvider.js` already talks to the real
  Marketing API; it's just currently tier/permission-limited until this is granted
