# Meta App Review — Facebook Login (email / public_profile) submission

Goal: get the Meta app (App ID `1622746365465041`) approved for Advanced Access on `email` and
`public_profile`, so "Sign in with Facebook" on the public signup page works for any real user,
not just people with a role on this app. This is a separate review from
[`META_APP_REVIEW.md`](./META_APP_REVIEW.md) (WhatsApp) and [`META_APP_REVIEW_ADS.md`](./META_APP_REVIEW_ADS.md)
(Marketing API) — same app, different permissions, different justification.

## Why this is needed now

Real clients hit `"Facebook Login is currently unavailable for this app as we are updating
additional details for this app"` when trying to sign in - this happens to real outside users
(not developers/testers/admins on the app) when `email`/`public_profile` haven't been reviewed for
Advanced Access, even though the app itself is in Live mode. Confirmed the feature itself is real
and complete before filing this - `services/socialAuth.js`'s Facebook branch does a genuine token
exchange + `GET /me?fields=id,name,email,picture` call, and `SignupPage.tsx` has a real "Sign in
with Facebook" button wired to it (not a stub).

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

## 2. Screencast walkthrough

1. Go to the public signup page (not already logged in)
2. Click **"Sign in with Facebook"**
3. Complete the real Facebook login/consent popup with a real account
4. Show the popup closing and the new account being created - land on the dashboard, logged in
5. Point out the account's name (from `public_profile`) is correctly populated (e.g. in the top-right
   user menu)

## 3. After submission

- Standard Access (works for you/other developers/testers on the app) is unaffected while review
  is pending
- If Meta requests changes, re-submit from the same **Review** tab once addressed
- Once approved, no code changes are required - the flow already works correctly for anyone with a
  role on the app; this only expands it to real outside users
