
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

Run `npm install` from the root to install workspace dependencies.

Run `npm run dev` to start only the frontend.

Run `npm run server` to start the API server.

Run `npm run dev:full` to start both the frontend and API together.

The API defaults to `http://localhost:4000` and the frontend expects `VITE_API_URL=http://localhost:4000/api`.

Use `client/.env.example` for frontend environment variables and `server/.env.example` for backend environment variables.

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

Default seeded login:

- Email: `admin@test.com`
- Password: `123456`
