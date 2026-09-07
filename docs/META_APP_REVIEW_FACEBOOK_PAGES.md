# Meta App Review — Facebook Page Messenger (pages_show_list / pages_messaging) submission

Goal: get the Meta app (App ID `1622746365465041`) approved for Advanced Access on
`pages_show_list` and `pages_messaging`, so any business's Facebook Page can be connected for
Messenger DMs in the dashboard, not just Pages the developer personally administers (Standard
Access). Separate review from every other doc in this folder — same app, different feature.

## What this feature actually is

Settings → Facebook lets a business connect a Facebook Page (`server/routes/facebookPages.js`,
`server/services/facebookPagesProvider.js`, `client/.../FacebookSettingsPanel.tsx`) to receive and
reply to Messenger DMs in the same unified Inbox already used for WhatsApp and Instagram. Minimal
scope, matching this project's own discipline of only requesting a permission with a real,
demonstrable feature behind it: connect, receive, reply. No Page post publishing/comments/insights
yet - real follow-ups once this is proven live, same incremental pattern Instagram's five
permissions were built up one at a time.

**Note on `pages_show_list`**: unlike its use in the Ads/CTWA feature (where it was found to be
unnecessary and dropped, see `META_APP_REVIEW_ADS.md`), it's genuinely required here - the connect
flow calls `GET /me/accounts` to list every Page the authorizing user manages and let them
implicitly connect all of them.

## 1. Permission justification text (paste into the App Review request form)

**`pages_show_list`**

> Used when a business connects their Facebook Page(s) in Settings → Facebook: after they log in
> via Facebook, `GET /me/accounts` lists every Page they manage so we can register it for Messenger
> conversations in the dashboard. Read-only, only during the connect step.

**`pages_messaging`**

> Used to receive and reply to Messenger conversations for a business's own connected Facebook
> Page, in the same unified Inbox they already use for WhatsApp and Instagram conversations. An
> inbound DM to the Page arrives via webhook and appears in the Inbox in real time; a team member
> replies directly from there via the Messenger Send API. This is used only against Pages the
> business itself has explicitly connected - no cross-tenant access.

## 2. Screencast walkthrough

1. Settings → Facebook, click **Connect Facebook Page**
2. Complete the real Facebook login/consent popup, granting Page access
3. Show the connected Page card (name, status "connected") - demonstrates `pages_show_list`
4. From a second phone/account, send a Messenger DM to that Page
5. Switch to the dashboard **Inbox**, show it arriving in the Facebook section in real time
6. Open the conversation, reply from the dashboard
7. Switch back to the phone, show the reply arriving in Messenger - demonstrates `pages_messaging`

## 3. After submission

- Standard Access (your own Pages) is unaffected while review is pending
- If Meta requests changes, re-submit from the same **Review** tab once addressed
- Once approved, no code changes are required - the feature already works correctly for Pages you
  administer; this only expands it to any business's Page
