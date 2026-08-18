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

## 1. Permission justification text (paste into the App Review request form)

**`ads_management`**

> Our app is a WhatsApp CRM/marketing dashboard that lets a business's own team create and manage
> Click-to-WhatsApp ad campaigns for their own ad account, directly from the same dashboard they use
> to manage their WhatsApp inbox and automation. The Ads tab (Settings → Ads) connects the
> business's own Meta ad account, then creates a campaign/ad set/ad via the Marketing API - every
> campaign is created `PAUSED` by design, with no activation control in the app; activation happens
> explicitly in Meta Ads Manager. This closes the loop between ad spend and the WhatsApp
> conversations it generates, which the dashboard already manages end to end.

**`ads_read`**

> Used alongside `ads_management` to read the connected ad account's details (name, currency,
> status) when testing a connection, and to pull campaign status back into the dashboard so a
> business can see their Click-to-WhatsApp campaigns without leaving the tool they already use for
> WhatsApp messaging and CRM.

## 2. Screencast walkthrough (~1-2 minutes, much shorter than the WhatsApp one)

Reuse the same recording setup as `SCREEN_RECORDING_SCRIPT.md` (dashboard logged in as admin,
address bar visible, no real customer data).

1. **Settings → Ads** — show the connected ad account card (`act_338172839578849`, status
   "connected")
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
