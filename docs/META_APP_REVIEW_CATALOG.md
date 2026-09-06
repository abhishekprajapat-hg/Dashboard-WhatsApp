# Meta App Review — Catalog API (`catalog_management`) submission

Goal: get the Meta app (App ID `1622746365465041`) approved for Advanced Access on
`catalog_management`, so the dashboard's WhatsApp Commerce feature can read any customer's real
product catalog instead of only the one dev catalog a System User token happens to have Standard
Access to. This is a separate review from [`META_APP_REVIEW.md`](./META_APP_REVIEW.md) (WhatsApp
messaging/management, already approved) — that submission's screencast doesn't cover this.

## Why this is a genuinely separate permission, not covered by the two already-approved ones

Confirmed live (2026-08-23, see `dashboard-whatsapp-catalog-commerce` memory): the main WhatsApp
access token — already Advanced Access on `whatsapp_business_messaging`/
`whatsapp_business_management` — gets a real `(#100) This application has not been approved to use
this api` error when reading a catalog's products (`GET /{catalog-id}/products`). *Sending* a
product message doesn't need this permission; *reading* the catalog to build the picker does.

## 1. Permission justification text (paste into the App Review request form)

**`catalog_management`**

> Our app is a WhatsApp CRM/marketing dashboard. Settings → WhatsApp lets a business connect the
> Catalog ID of their own Meta Commerce Manager catalog (the same catalog they already use for
> Facebook/Instagram Shops). When an agent replies to a customer in the Inbox, they can browse that
> catalog and send a single product as an interactive WhatsApp message (`GET
> /{catalog-id}/products` to list it, then a standard `interactive` "product" message send). This
> permission is used read-only, against the business's own connected catalog — no cross-tenant
> access, and no write operations against the catalog itself.

## 2. Screencast walkthrough (record against a real connected catalog)

1. **Settings → WhatsApp** → open the connected account, show the **Catalog ID** field already
   filled in (from Meta Commerce Manager) and a **Catalog access token** configured — point out
   these are separate fields from the main WhatsApp access token above them
2. Switch to **Inbox**, open a conversation, click the product/catalog attachment icon in the
   composer
3. Show the product picker loading real products (name, image, price) from the connected catalog —
   this is the `GET /{catalog-id}/products` call this permission gates
4. Search/filter the list to show it's a live query, not a static list
5. Select a product and send it into the conversation
6. Show the interactive product message appearing in the conversation thread with the real
   product's image/name/price

## 3. After submission

- Same discipline as the other two reviews: Standard Access (your own dev catalog via the System
  User token) is unaffected while review is pending, keep developing on `main` as normal
- If Meta requests changes, re-submit from the same **Review** tab once addressed
- Once approved, no code changes are required — `whatsappCommerce.js`'s `fetchCatalogProducts`
  already talks to the real Graph API; it's just currently limited to catalogs your own token has
  Standard Access to
