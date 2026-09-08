# Manual WhatsApp onboarding runbook

Use this whenever a client can't complete self-serve Embedded Signup ("Connect with Facebook"
currently fails with "Facebook Login is currently unavailable" for real external users - see
HANDOFF.md and `docs/META_APP_REVIEW_FACEBOOK_LOGIN.md` for the root cause and fix status) and the
client has a normal, never-migrated WhatsApp number.

Proven end-to-end against a real client (Sundrishti Solar Solutions, 2026-09-07).

## 1. Business info must be complete first

In the client's own Business Settings → Business info, fill in Legal business name, Address,
Business phone number, and Website. WhatsApp's own setup flow refuses to create a WABA under an
incomplete business profile with a real, actionable error naming this - don't skip straight to the
number.

## 2. Migrate the number

In WhatsApp Manager (business.facebook.com/wa/manage), try adding the number. If it's active on
regular WhatsApp/WhatsApp Business App, you'll get "Phone Number In Use" - have the client check
their phone for a migration confirmation prompt first (less destructive); if none appears, have
them go to WhatsApp → Settings → Account → **Delete my account** (warn them first: this loses
local chat history on that number). Wait ~3 minutes, then retry adding the number in WhatsApp
Manager.

## 3. Share the WABA with Nemnidhi's business

Don't try to claim Nemnidhi's app into the client's portfolio (that direction fails - the app is
owned by Nemnidhi, not them). On the client's WABA page in their Business Settings, click **Assign
partner** and enter Nemnidhi's own Business Portfolio ID (find it: Nemnidhi's own Business
Settings → Business info → "Business portfolio ID" at the top).

## 4. Generate the token from Nemnidhi's own Business Settings

Not the client's. Check the existing "Dashboardlink" System User first (Users → System Users) -
it likely already has Full Control on the Dashboard app; once the WABA is shared, add it as an
asset there too if it doesn't auto-appear. Generate New Token with
`whatsapp_business_management` + `whatsapp_business_messaging`, expiration **Never**.

## 5. Get the real Phone Number ID

Not the WABA ID - click into the phone number's own row in WhatsApp Manager for its distinct
numeric ID; don't reuse the Business Account ID by mistake.

## 6. Add the account manually

In this app's Settings → WhatsApp → Meta Cloud API, using Phone Number ID / Business Account ID /
the token from step 4.

## 7. Confirm the webhook subscribed automatically

**As of the `Auto-subscribe Meta webhooks on manual WhatsApp account connect` fix (2026-09-07),
this step is automatic** - the manual connect form itself now calls Meta's
`POST /{waba-id}/subscribed_apps` for you. Just verify: the account should show **"webhook
healthy"** in Settings → WhatsApp right after saving. If it instead shows **"webhook error"**,
the real Meta error message is shown alongside it (commonly a token missing
`whatsapp_business_management`, or the WABA-sharing step not fully propagated yet) - fix whatever
it names and re-save the account to retry the subscribe call.

(No manual Graph API Explorer step needed anymore - that used to be required here and is the
reason this bug existed in the first place for every client connected before the fix.)

## 8. Verify for real

Send an actual WhatsApp message to the number from a different phone, confirm it lands in the
dashboard Inbox, reply from there, confirm it arrives back on the phone. Don't trust the
"connected"/"webhook healthy" badges alone as proof until you've seen a real message round-trip -
badges reflect internal state, this is the only way to confirm Meta is actually delivering events.
