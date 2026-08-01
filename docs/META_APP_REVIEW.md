# Meta App Review — submission checklist

Goal: get the Meta app (App ID `1622746365465041`) approved for Advanced Access on
`whatsapp_business_messaging` and `whatsapp_business_management`, so the dashboard can message any
customer number instead of just the sandbox test numbers. Submitting for review does **not** block
further development — Standard Access (test numbers, current WABA you already manage) keeps working
throughout the review, and everything in [`HANDOFF.md`](../HANDOFF.md) can continue in parallel on
`main` as usual.

## 0. Security — do this first

The App Secret shown in `App settings → Basic` was pasted into a chat screenshot. Click **Reset**
next to App secret in that dashboard now, then update the new value everywhere it's configured
(`server/.env` → `WHATSAPP_APP_SECRET`, and wherever the WhatsApp account's app secret is stored via
**Settings → WhatsApp** in the dashboard itself). Do this before submitting anything else.

## 1. Basic Settings — fields to fill in

| Field | Value | Status |
|---|---|---|
| App icon (1024×1024) | `client/public/app-icon-1024.png` (generated from the existing favicon mark) | Upload manually — Meta blocks submission without this |
| App domains | `nemnidhi.com` | Add manually |
| Privacy Policy URL | `https://www.nemnidhi.com/about` | Already set |
| Terms of Service URL | `https://dashboard.nemnidhi.com/legal/terms-of-service` | New page added this session — paste into the field (replaces the current `facebook.com` placeholder) |
| Data Deletion | Instructions URL: `https://dashboard.nemnidhi.com/legal/data-deletion` | New page added this session — paste into the field (replaces the current `facebook.com` placeholder) |
| Contact email | `somiljain00@gmail.com` | Already set |

Both `/legal/*` pages are live once the current `main` is deployed — verify with:

```bash
curl -I https://dashboard.nemnidhi.com/legal/terms-of-service
curl -I https://dashboard.nemnidhi.com/legal/data-deletion
```

## 2. WhatsApp product configuration

- **Webhook callback URL:** `https://dashboard.nemnidhi.com/webhooks/whatsapp`
- **Verify token:** whatever is set as `WHATSAPP_VERIFY_TOKEN` in production, or the per-account
  verify token entered in **Settings → WhatsApp** when the account was connected
  (`server/routes/whatsapp.js` checks both — see `hasMatchingVerifyToken`)
- **Webhook fields to subscribe:** `messages` (required for `whatsapp_business_messaging`); add
  `message_template_status_update` if template-approval push updates are wanted later, though the
  app already polls via `/api/whatsapp/accounts/:id/sync-templates` so this is optional
- Subscription must be done from the same Meta app the reviewed permissions belong to

## 3. Business verification

Advanced Access for both permissions requires the Business Manager behind this app to have
completed **Business Verification** (Meta Business Settings → Security Center). If it isn't done
yet, start it now — it's typically the slowest step (can take days) and gates submission
independently of everything else on this list.

## 4. Permission justification text (paste into the App Review request form)

**`whatsapp_business_messaging`**

> Our app is a customer-support and marketing dashboard (WhatsCRM) that a business's own team uses
> to manage WhatsApp conversations with their customers. It receives inbound customer messages via
> webhook, displays them in a shared team inbox, lets team members reply, sends approved template
> messages for marketing campaigns (rate-limited, queued via BullMQ), and runs opt-in automation
> flows (e.g. auto-reply, lead capture into CRM) triggered by inbound messages. All messaging is to
> the business's own existing customers who have messaged the connected WhatsApp Business number
> first, or who have opted in through a Meta ad "Click to WhatsApp" referral.

**`whatsapp_business_management`**

> The dashboard's Settings → WhatsApp screen lets an admin connect a WhatsApp Business Account,
> syncs approved message templates from the WABA (`GET /message_templates`) so agents can only send
> pre-approved templates, and surfaces phone number / account health status. This permission is used
> read/write against the business's own WABA that they connect — no cross-tenant access.

## 5. Screencast walkthrough (record this against a real connected test number)

1. Sign in to the dashboard → **Settings → WhatsApp** → connect a WhatsApp Business Account
   (`phoneNumberId`, `businessAccountId`, access token) — demonstrates `whatsapp_business_management`
2. **Settings → WhatsApp → Sync templates** — shows templates pulled live from the WABA
3. Send an inbound WhatsApp message to the connected test number from a phone
4. Show it arriving in **Inbox** in real time — demonstrates the webhook + `whatsapp_business_messaging` read path
5. Reply from the Inbox — demonstrates the send path
6. **Campaigns** → send a template-based broadcast to a small test audience — shows queued,
   rate-limited outbound sends and delivery status updates flowing back through the webhook
7. **Automation** → show an active flow (e.g. auto-reply or lead-to-CRM) firing off the same inbound
   test message

## 6. After submission

- Standard Access / existing test-number flows are unaffected — keep developing and merging to
  `main` as normal per `HANDOFF.md`
- If Meta requests changes, the usual turnaround is a few business days; re-submit from the same
  **Review** tab once addressed
- Once Advanced Access is granted, no code changes are required — the existing credentials flow in
  `server/services/whatsappProvider.js` already talks to the real Graph API, it's just currently
  rate/number-limited by Standard Access
