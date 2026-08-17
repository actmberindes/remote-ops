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
applications, time-tracking sessions, notifications, tickets, ticket
messages/attachments, assets, asset assignments, and asset audit logs. It's a
plain JSON file for simplicity — no separate database server to install — but
every route in `backend/src/routes/` is a normal Express handler, so swapping
in Postgres, MySQL, or SQLite later is a matter of changing what those
handlers read/write, not the API surface itself.

Uploaded files (WFH speedtest screenshots, ticket attachments) are saved to
`backend/uploads/` and served statically at `/uploads/<filename>`.

## Tickets & Assets (added on top of the original scope)

**Ticketing** — Employees, Managers, and Admins can all create tickets
(`Request` / `Borrow` / `Incident`, with `Low`–`Urgent` priority and an
optional file attachment). Status flows through `Open → In Progress →
Pending → Resolved → Closed`. Employees can view their own tickets, reply,
and self-close them; Managers and Admins can view every ticket and reply;
only Admins can change status or assign a ticket to another Admin.

**Assets** — Admins manage the full asset lifecycle (create, edit, assign,
mark returned, retire, delete) with every action written to an audit log
(`backend/src/routes/assets.js`). Employees only ever see assets currently
assigned to them; Managers see the full asset list but strictly read-only —
enforced both by the UI (no action buttons render) and the API (every
mutating route is `requireRole('Admin')`).

**Cross-module integration** — Approving a `Borrow`-type ticket lets an Admin
one-click-assign an available asset directly from the ticket thread. That
single action creates the asset assignment, flips the asset to `In Use`,
closes the ticket, and posts a system message in the thread — all in one
backend call (`POST /api/tickets/:id/assign-asset`).

**Screenshot evidence** — WFH speedtest screenshots and ticket attachments
render as clickable thumbnails; clicking opens a full-resolution modal with
Zoom, Download, and Close controls (`ScreenshotEvidence` component in
`frontend/src/App.jsx`).

### Permission matrix (enforced server-side, not just hidden in the UI)

| Feature | Employee | Manager | Admin |
| :--- | :---: | :---: | :---: |
| Create Ticket | ✅ | ✅ | ✅ |
| View Own Tickets | ✅ | ✅ | ✅ |
| View Team/All Tickets | ❌ | ✅ (own direct reports only) | ✅ (all) |
| Change Ticket Status | ❌ (can self-close only) | ❌ | ✅ |
| Assets List | Assigned only | Own team only (read only) | Full |
| Assign Asset | ❌ | ❌ | ✅ |
| Delete Asset | ❌ | ❌ | ✅ |

Managers are scoped to their own direct reports everywhere — Tickets, Assets,
Applications, and Schedules alike. A Manager's token literally cannot fetch
another Manager's team's data; this is enforced in `backend/src/routes/`, not
just hidden in the UI.

### Asset details: type-specific specs, images, and expanded categories

Asset types now include peripherals (`Mouse`, `Keyboard`, `Headset`) and
`Software License` alongside the original hardware types. The Add/Edit Asset
form renders a different set of specification fields depending on the
selected type (`TYPE_SPEC_FIELDS` in `frontend/src/App.jsx`):

- **Desktop / Laptop**: Motherboard, CPU, RAM, Storage Size, Video Card, OS
- **Monitor**: Display Size, Panel Type, Resolution, Viewing Angle, Refresh Rate, Inputs, Wall Mount Compatible
- **Printer**: Print Type, Connectivity, Duty Cycle, Paper Size
- **Server**: CPU, RAM, Storage Size, RAID Configuration, OS
- **UPS**: Capacity (VA), Battery Type, Runtime, Outlets
- **Mouse / Keyboard / Headset**: connectivity and peripheral-specific fields
- **Software License**: License Key, Seats Licensed, Vendor, Expiry Date

These are stored as a free-form `specs` object on the asset record, so adding
a new type is just adding an entry to `TYPE_SPEC_FIELDS` — no schema
migration needed. Assets also support an uploaded image (`imageUrl`), shown
as a thumbnail in the asset table and full-size in the asset detail view.

### Search, filters, and dashboard charts

Admin and Manager Tickets/Assets pages have a search box plus type/status
(and priority, for tickets) filter dropdowns, filtering the already-loaded
data client-side. The Admin Dashboard adds a "Tickets by Status" bar chart, an
"Assets by Status" pie chart, and KPI cards for open tickets, resolved
tickets, and assets in use/available.

### Messages on every ticket and asset

Every ticket gets an automatic system message the moment it's created
("Ticket TCK-0001 created by Roshell Tecson. Status set to Open…"), so the
conversation thread is never empty. Every asset action (created, assigned,
returned, retired, edited, deleted) writes a friendly, human-readable message
into `asset_logs`, shown as an activity feed in the asset's History modal.

## Customizing

- **Departments, seed users, demo data** — edit `backend/src/db.js`
  (`seedIfEmpty`). It only runs once, the first time `data/db.json` doesn't
  exist yet; delete that file to reseed from scratch.
- **JWT secret / expiry** — `backend/.env` and `backend/src/auth.js`.
- **API base URL the frontend calls** — `frontend/.env` (`VITE_API_URL`),
  defaults to `http://localhost:4000/api`.

## Desktop Agent & Activity Monitoring

`agent/` is a separate Windows background app — see `agent/README.md` for
full details. Quick summary:

- Employees pair it once from their Dashboard ("Pair This Device" — generates
  a 10-minute code), never sharing their portal password with the agent.
- While a session is Active, it uploads a scheduled screenshot (interval set
  by Admin: 5/10/30 min) and a near-live low-frequency frame, both consumed
  by the Admin/Manager **Live View** and **Screenshots** pages.
- Admins manage paired devices (see who's linked, revoke access instantly)
  from **User Management → Paired Devices**.
- A pre-built `agent/dist/remote-ops-agent.exe` is included — copy it plus
  `agent/install.ps1` to a Windows machine and run the installer. Rebuild it
  yourself anytime with `cd agent && npm install && npm run build:win`.

The companion browser extension (`extension/`) tracks domain-level web usage
the same way — see `extension/README.md`. It uses the identical pairing-code
flow as the desktop agent, just paired separately (each device — desktop
agent and browser — gets its own token, both visible and revocable from
**User Management → Paired Devices**).

I built and packaging-tested this artifact (`pkg` produces a genuine PE32+
Windows binary with zero warnings) and end-to-end tested everything that
doesn't require a real Windows display — pairing, config sync, session-status
polling, and the upload pipeline all pass against the live backend
(`agent/README.md` has the details). The one piece I can't verify from this
environment is the actual screen-capture call on real Windows, since I don't
have a Windows machine to run it on — worth a quick smoke test on one machine
before wider rollout.

## Section 2–4 portal updates (nav consolidation, Add User, peripheral stock, bulk assign)

- **Employee**: "Time & Attendance" renamed to "Dashboard"; WFH Request + My
  Schedule merged into one tabbed page; Start Session is always enabled
  (the old WFH-approval gate is gone); Logged Work Sessions has a date
  filter; a new Assigned Assets widget links to the full Assets page.
- **Admin/Manager**: Applications + Schedules merged into one tabbed page.
  Ticket/Asset search bars are a single compact row instead of a wrapped
  block.
- **User Management**: "Add New User" creates real accounts (same endpoint
  the sign-up flow uses); Edit User now has a Reporting Manager dropdown so
  employees can be reassigned across departments.
- **Assets**: thumbnails are clickable → full-size zoom/download modal.
  Peripheral types (Mouse/Keyboard/Headset) get a **Quantity** field —
  assigning one decrements stock automatically, and hitting 0 fires an
  Admin notification and flips status to "Out of Stock" (all enforced
  server-side, verified with a live create → assign → assign → 409-on-third
  → notification → return → back-to-Available test sequence). Standard
  (non-quantity) assets support **bulk assignment** to multiple employees
  at once via checkboxes — useful for shared equipment like a meeting-room
  device — while Return now lets an Admin pick which specific employee's
  assignment to close out when more than one exists.

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
