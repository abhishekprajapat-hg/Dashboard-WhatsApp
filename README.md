
# Project Planning and Documentation

This is a code bundle for Project Planning and Documentation. The original project is available at https://www.figma.com/design/g7VtMCmw9qHtkZvBfvZrCk/Project-Planning-and-Documentation.

## Documentation

The project planning docs are available in [`docs/README.md`](./docs/README.md).

- PRD: [`docs/PRD.md`](./docs/PRD.md)
- TRD: [`docs/TRD.md`](./docs/TRD.md)
- App Flow: [`docs/APP_FLOW.md`](./docs/APP_FLOW.md)
- UI/UX Specification: [`docs/UI_UX_SPEC.md`](./docs/UI_UX_SPEC.md)
- Backend Schema: [`docs/BACKEND_SCHEMA.md`](./docs/BACKEND_SCHEMA.md)
- Implementation Plan: [`docs/IMPLEMENTATION_PLAN.md`](./docs/IMPLEMENTATION_PLAN.md)

## Running the code

The project is split into two app folders:

- `client/` - React + Vite frontend
- `server/` - Node.js + Express API

### Local setup

1. Install workspace dependencies from the repo root:

   ```bash
   npm install
   ```

2. Create local env files:

   ```bash
   cp client/.env.example client/.env
   cp server/.env.example server/.env
   ```

   On Windows PowerShell:

   ```powershell
   Copy-Item client/.env.example client/.env
   Copy-Item server/.env.example server/.env
   ```

3. Start MongoDB locally, then seed the first workspace/user:

   ```powershell
   powershell -ExecutionPolicy Bypass -File server/scripts/start-local-mongo.ps1
   npm run seed
   ```

4. Start the app:

   ```bash
   npm run dev:full
   ```

   Or run each side separately:

   ```bash
   npm run server
   npm run dev
   ```

The API defaults to `http://localhost:4000`. The frontend reads `VITE_API_URL`; use `http://localhost:4000/api` for local development. If `/api` is omitted, the client normalizes it automatically.

Default seeded login:

- Email: `admin@test.com`
- Password: `123456`

### Useful checks

```bash
npm run build
npm run check:server
npm test
```

### Production environment notes

For `NODE_ENV=production`, the server validates secure required settings at startup:

- `MONGODB_URI` must be set.
- `JWT_SECRET` must be set and at least 32 characters.
- `S3_BUCKET` must be set when `MEDIA_STORAGE_DRIVER=s3`.

Set `PUBLIC_BASE_URL` to the public API origin used for webhook/media URLs, and set `CORS_ORIGINS` to the allowed frontend origins, comma-separated.

### WhatsApp Cloud API connection

Admins can add Meta WhatsApp Cloud API credentials from **Settings -> WhatsApp**. The dashboard stores access tokens, verify tokens, and optional app secrets in a server-side encrypted credential blob; API responses only return configured/missing status flags. Set `WHATSAPP_CREDENTIAL_SECRET` in production if you want credential encryption independent from `JWT_SECRET`. For script-based setup, fill `WHATSAPP_PHONE_NUMBER`, `WHATSAPP_PHONE_NUMBER_ID`, `WHATSAPP_BUSINESS_ACCOUNT_ID`, `WHATSAPP_ACCESS_TOKEN`, `WHATSAPP_VERIFY_TOKEN`, and optional `WHATSAPP_APP_SECRET` in `server/.env`, then run:

```bash
npm run connect:whatsapp --workspace server
```

Use `/webhooks/whatsapp` as the Meta callback URL. If `WHATSAPP_APP_SECRET` or the dashboard app secret is configured, inbound Meta webhooks must include a valid `X-Hub-Signature-256` header.

## Real MongoDB Setup

The backend is configured for local MongoDB during development:

```txt
MONGODB_URI=mongodb://127.0.0.1:27017/whatscrm
DEMO_MODE=false
```

To use real MongoDB-backed authentication and workspace data:

1. Start MongoDB locally with `powershell -ExecutionPolicy Bypass -File server/scripts/start-local-mongo.ps1`.
2. Confirm `server/.env` has `MONGODB_URI=mongodb://127.0.0.1:27017/whatscrm`.
3. Run `npm run seed` from the root.
4. Start the app with `npm run dev:full`.

When moving MongoDB to your VPS later, replace `MONGODB_URI` in `server/.env` with the VPS connection string and run the same seed/start commands.

## Google Sheet Lead Sync

Create a Google Sheet with this header row:

```text
Timestamp | Name | Phone | Email | Message | Source | Status | Stage | Conversation ID | Contact ID | Provider Message ID
```

Open **Extensions > Apps Script**, paste this script, deploy it as a **Web app**, and set access to **Anyone**. Add the deployed URL to `server/.env` as `GOOGLE_SHEET_WEBHOOK_URL`.

```js
const SHEET_NAME = "Leads";
const SECRET = "change-this-secret";

function doPost(e) {
  const payload = JSON.parse(e.postData.contents || "{}");
  if (SECRET && payload.secret !== SECRET) {
    return ContentService.createTextOutput("Unauthorized").setMimeType(ContentService.MimeType.TEXT);
  }

  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName(SHEET_NAME) || ss.insertSheet(SHEET_NAME);
  if (sheet.getLastRow() === 0) {
    sheet.appendRow([
      "Timestamp",
      "Name",
      "Phone",
      "Email",
      "Message",
      "Source",
      "Status",
      "Stage",
      "Conversation ID",
      "Contact ID",
      "Provider Message ID",
    ]);
  }

  sheet.appendRow([
    payload.timestamp || new Date().toISOString(),
    payload.name || "",
    payload.phone || "",
    payload.email || "",
    payload.message || "",
    payload.source || "WhatsApp",
    payload.status || "lead",
    payload.stage || "new_lead",
    payload.conversationId || "",
    payload.contactId || "",
    payload.providerMessageId || "",
  ]);

  return ContentService.createTextOutput("OK").setMimeType(ContentService.MimeType.TEXT);
}
```
