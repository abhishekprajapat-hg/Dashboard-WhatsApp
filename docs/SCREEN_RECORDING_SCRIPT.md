# Screen recording script — Meta App Review

One recording, ~4-6 minutes, covers both `whatsapp_business_messaging` and
`whatsapp_business_management`. Reuse the same file for both permission uploads.

## Before you hit record

- Open **WhatsApp Web** (web.whatsapp.com) in one browser window, linked to a personal number able
  to message your connected business test number — no phone needed on camera. Arrange it side by
  side with the dashboard window so both are visible in the same recording.
- Log into `https://dashboard.nemnidhi.com` as an admin in the other window/tab you'll record
- Keep the browser address bar visible in every shot — reviewers check the URL matches your
  registered app domain
- Close any other tabs/notifications that might leak unrelated info
- If your WhatsApp account is already connected from earlier testing, that's fine — the connect
  step below can be shown as "review the existing connection" instead of adding a new one

## Scene 1 — Account connection (`whatsapp_business_management`)

1. Sidebar → **Settings** → **WhatsApp** tab
2. If not already connected: fill in Display name, Phone number, Phone Number ID, Business
   Account ID, Access token → **Connect**. If already connected, open the existing account row
   instead so the fields are visible on screen.
3. Point out (cursor hover, or just pause) the connected account card showing phone number,
   status "Connected", webhook status "Healthy"

This shows the app managing a WhatsApp Business Account it owns — the core
`whatsapp_business_management` use case.

## Scene 2 — Template sync (`whatsapp_business_management`)

1. Still in Settings → WhatsApp, click **Sync templates**
2. Show the template list populate/refresh with names, language, category, status (approved/
   pending) pulled live from the WABA

This is the `GET /message_templates` call — demonstrates managing WABA data, not just messaging.

## Scene 3 — Inbound message (`whatsapp_business_messaging`)

1. In WhatsApp Web, send a message to the connected business number — something simple and
   clearly test-like, e.g. "Hi, this is a test message for App Review"
2. Switch to the dashboard, sidebar → **Inbox**
3. Show the message arriving in the conversation list in real time (don't refresh manually —
   let the reviewer see it update live if possible)
4. Open the conversation, show the message content, sender name/number

## Scene 4 — Reply (`whatsapp_business_messaging`)

1. In the same conversation, type a reply in the composer and send it
2. Switch back to the WhatsApp Web window, show the reply arriving there

## Scene 5 — Campaign send (`whatsapp_business_messaging`)

1. Sidebar → **Campaigns** → create a new campaign
2. Pick an approved template, select a small test audience (just your own test number is fine)
3. Send the campaign
4. Show the delivery status updating (queued → sent → delivered) in the campaign detail view

## Scene 6 — Automation (`whatsapp_business_messaging`)

1. Sidebar → **Automation**, open an existing flow (or build a simple one: trigger = inbound
   message, action = send_message auto-reply)
2. Send another test WhatsApp message from WhatsApp Web
3. Show the automation firing — either the auto-reply arriving in WhatsApp Web, or the flow's run
   history/log showing it triggered

## Wrap-up

End on the Settings → WhatsApp screen again, or the Inbox — no need for a slide or voiceover,
Meta reviewers just need to see the functionality working end-to-end.

## Notes

- No need to narrate/voiceover — a silent screen recording with clear, deliberate clicks is fine
  and is what most approved submissions use
- Don't show real customer data — use your own test number and placeholder names throughout
- Keep each scene long enough to read (2-3 seconds pause after each action) rather than rushing
  through clicks
- Export as MP4, keep it under whatever size limit the upload dialog states (usually 500MB or so)
