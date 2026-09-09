# Meta App Review — Facebook Login (email / public_profile / business_management) submission

Goal: get the Meta app (App ID `1622746365465041`) approved for Advanced Access on `email`,
`public_profile`, **and `business_management`**, so "Sign in with Facebook" on the public signup
page works for any real user, not just people with a role on this app. This is a separate review
from [`META_APP_REVIEW.md`](./META_APP_REVIEW.md) (WhatsApp) and
[`META_APP_REVIEW_ADS.md`](./META_APP_REVIEW_ADS.md) (Marketing API) — same app, different
permissions, different justification.

## Why this is needed now

Real clients hit `"Facebook Login is currently unavailable for this app as we are updating
additional details for this app"` when trying to sign in - this happens to real outside users
(not developers/testers/admins on the app) when `email`/`public_profile` haven't been reviewed for
Advanced Access, even though the app itself is in Live mode. Confirmed the feature itself is real
and complete before filing this - `services/socialAuth.js`'s Facebook branch does a genuine token
exchange + `GET /me?fields=id,name,email,picture` call, and `SignupPage.tsx` has a real "Sign in
with Facebook" button wired to it (not a stub).

**Why `business_management` is also required, not optional**: live-tested a real OAuth request
with just `email,public_profile` and got a *different*, more specific error: `"This app needs at
least one supported permission"` — confirmed against Meta's own Facebook Login for Business docs
that `email`/`public_profile` must always be paired with at least one other supported business
permission for this product; there is no way to request them alone, for any user, regardless of
Advanced Access status on those two alone. `business_management` is the pairing used here (over
`whatsapp_business_management`, which would look unrelated to a plain sign-in button to a
reviewer). `services/socialAuth.js`'s Facebook OAuth URL now requests all three together.

## 1. Permission justification text (paste into the App Review request form)

**`public_profile`**

> Our app is a WhatsApp CRM/marketing dashboard. On the public signup page, "Sign in with
> Facebook" is one of several account-creation options (alongside Google, Instagram, and
> email/password). `public_profile` is used only to read the person's name and profile picture to
> pre-fill their new account - no other use.

**`email`**

> Used alongside `public_profile` at the same signup step, to get the person's email address so we
> can create their account and send account-related communications (billing, security). If
> Facebook doesn't return an email (some accounts don't have one verified), the person is asked to
> enter one directly to complete signup - Facebook sign-in is never a hard requirement.

**`business_management`**

> Required by Facebook Login for Business as a technical pairing alongside `email`/`public_profile`
> - our product is a business tool (a WhatsApp CRM/marketing dashboard used by companies), and this
> permission lets an admin who signs up via Facebook be recognized as managing their own business
> on our platform. We do not read or modify the person's Business Manager assets during signup
> itself; this scope only satisfies the platform's own requirement that email/public_profile never
> be requested in isolation.

## 2. Screencast walkthrough

1. Go to the public signup page (not already logged in)
2. Click **"Sign in with Facebook"**
3. Complete the real Facebook login/consent popup with a real account - now shows an extra
   business-permission consent step (for `business_management`) before the popup closes; let it
   render on camera rather than cutting past it
4. Show the popup closing and the new account being created - land on the dashboard, logged in
5. Point out the account's name (from `public_profile`) is correctly populated (e.g. in the top-right
   user menu)

## 3. After submission

- Standard Access (works for you/other developers/testers on the app) is unaffected while review
  is pending
- If Meta requests changes, re-submit from the same **Review** tab once addressed
- Once approved, no code changes are required - the flow already works correctly for anyone with a
  role on the app; this only expands it to real outside users
