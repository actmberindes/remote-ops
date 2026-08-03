# Remote Ops — Full-Stack Remote Work Management System

A real client/server app: a Node/Express API with its own database, and a React
(Vite) frontend that talks to it over HTTP. Anyone who signs up or makes a
change (approving a WFH request, editing a user, logging a work session) is
writing to the server — it's there the next time you or anyone else opens the
app, on any device.

```
remote-ops/
├── backend/    Express API + JSON-file database (auth, users, applications, sessions, notifications)
└── frontend/   Vite + React + Tailwind single-page app
```

## Quick start

You'll need Node.js 18+ installed. Open two terminals.

**Terminal 1 — backend**
```bash
cd backend
npm install
cp .env.example .env      # edit JWT_SECRET before deploying anywhere real
npm run dev
```
This starts the API at `http://localhost:4000`. On first run it creates
`backend/data/db.json` and seeds it with the same 9 users your mock version
had (`admin@88thfloor.com`, `darylg@88thfloor.com`, etc. — all with password
`password123`).

**Terminal 2 — frontend**
```bash
cd frontend
npm install
npm run dev
```
This starts the app at `http://localhost:5173`. Open it in your browser —
sign in with any seeded account, or use "Create Account" to register a real
new employee.

## How auth works

- Passwords are hashed with bcrypt server-side — never stored or sent in
  plain text.
- Signing in returns a JWT, which the frontend stores in `localStorage` and
  sends as `Authorization: Bearer <token>` on every request.
- Sessions persist across page refreshes and browser restarts (until the
  token expires, 7 days by default) because the token itself — not any
  in-memory state — is what proves who's signed in.
- Every API route checks the token and the caller's role. A Manager's
  `/api/applications` request only ever returns their own direct reports —
  enforced on the server, not just hidden in the UI.

## What's stored where

`backend/data/db.json` is the single source of truth: users, WFH
applications, time-tracking sessions, and notifications. It's a plain JSON
file for simplicity — no separate database server to install — but every
route in `backend/src/routes/` is a normal Express handler, so swapping in
Postgres, MySQL, or SQLite later is a matter of changing what those handlers
read/write, not the API surface itself.

## Customizing

- **Departments, seed users, demo data** — edit `backend/src/db.js`
  (`seedIfEmpty`). It only runs once, the first time `data/db.json` doesn't
  exist yet; delete that file to reseed from scratch.
- **JWT secret / expiry** — `backend/.env` and `backend/src/auth.js`.
- **API base URL the frontend calls** — `frontend/.env` (`VITE_API_URL`),
  defaults to `http://localhost:4000/api`.

## Deploying

- **Backend**: any Node host (Render, Railway, Fly.io, a VPS). Set
  `JWT_SECRET` and `CORS_ORIGIN` (your deployed frontend's URL) as real
  environment variables — don't ship the `.env` file itself.
- **Frontend**: `npm run build` produces a static `dist/` folder deployable
  to Vercel, Netlify, Cloudflare Pages, or any static host. Set
  `VITE_API_URL` to your deployed backend's URL at build time.
- If you outgrow the JSON file (concurrent writes, larger data, backups),
  swap `lowdb` in `backend/src/db.js` for a real database client — the routes
  don't need to change shape, just how `db.data.users` etc. are read/written.

## Security notes for going further

This is a solid foundation, not a hardened production system yet. Before
handling real employee data, you'd want to add: rate limiting on
`/api/auth/login`, refresh tokens (rather than one long-lived 7-day JWT),
HTTPS in front of the API, input validation beyond the basic checks already
in place, and a real database with backups.
