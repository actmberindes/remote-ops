# Remote Ops Agent (Windows)

A background agent that captures scheduled screenshots and a near-live desktop
preview while an employee's work session is Active, tied to their Remote Ops
account.

## How it works

1. The employee generates a **pairing code** from the web portal (10-minute
   expiry).
2. They run the agent and enter that code once. The agent exchanges it for a
   long-lived **device token** — never the employee's actual password —
   stored locally in `%APPDATA%\RemoteOpsAgent\config.json`.
3. Every 30 seconds the agent polls the backend for two things: the current
   screenshot interval / live-frame interval (admin-configurable), and
   whether the employee's session is currently **Active** (the same
   Start/Stop Session button on their Dashboard).
4. While Active, it captures and uploads:
   - A full screenshot every N minutes (5 / 10 / 30, admin-configured) →
     shows up in Admin/Manager "Screenshots"
   - A lower-frequency frame (default every 5s) → shows up in Admin/Manager
     "Live View"
5. While *not* Active (session stopped, or not yet started), it captures
   nothing.

## Project layout

```
agent/
├── src/
│   ├── index.js       entry point — pairs if needed, then starts monitoring
│   ├── config.js       local persisted device token / settings
│   ├── api.js           HTTP client for the backend
│   ├── capture.js       screen capture (screenshot-desktop)
│   ├── scheduler.js      the two capture loops + config/status polling
│   └── pairing.js        interactive "enter your pairing code" flow
├── install.ps1          copies the built .exe + registers auto-start
├── uninstall.ps1         removes it
└── package.json
```

## Building the Windows executable

From this directory (works cross-platform — no Windows machine needed to
*build* it, only to *run* it):

```bash
npm install
npm run build:win
```

This produces `dist/remote-ops-agent.exe` — a single self-contained binary
(bundles Node.js itself, so employees don't need Node installed).

I built and verified this exact artifact: `npx pkg . --targets node18-win-x64`
completed with zero warnings and produced a genuine `PE32+ executable ...
for MS Windows` binary (confirmed via `file`). What I can't verify from
this environment is runtime behavior on an actual Windows machine — I don't
have one available to execute it on. Everything that doesn't require real
Windows screen-capture APIs (pairing, config sync, session-status polling,
upload pipeline, interval scheduling) is covered by `test-agent.cjs` and
passes end-to-end against the live backend. The one Windows-specific
component, `capture.js`, is a thin wrapper around the well-established
`screenshot-desktop` package — I'd recommend a quick smoke test on one real
machine before wider rollout, same as you would for any first deployment.

## Installing on an employee's machine

1. Copy `dist/remote-ops-agent.exe`, `install.ps1`, and `uninstall.ps1` to
   the target machine (e.g. via a shared drive, or host them for download
   from the Admin portal — see "Next steps" below).
2. Employee opens PowerShell in that folder and runs:
   ```powershell
   powershell -ExecutionPolicy Bypass -File install.ps1
   ```
3. This copies the exe to `%LOCALAPPDATA%\RemoteOpsAgent\`, registers a
   Startup-folder shortcut (auto-launches on login, no admin rights needed),
   and offers to run pairing immediately.
4. Employee generates a pairing code from their Dashboard and enters it when
   prompted.
5. Done — the agent now runs in the background and starts automatically on
   every login.

To remove it: run `uninstall.ps1`, and revoke the device from
**Admin → User Management → Devices** so its token stops working immediately.

## Configuration

Nothing is hardcoded into the installer. Screenshot interval, live-frame
interval, and retention are all set once by an Admin (in the portal) and
picked up by every paired agent on its next 30-second poll — no
redistribution needed to change settings.

## What's still ahead for this piece

- **Tray icon** — right now the agent is a console window; a proper
  system-tray presence (icon + "Monitoring Active" state + right-click quit)
  is the natural next step for a production rollout, since a visible tray
  icon is also the transparency signal discussed earlier.
- **Consent screen on first run** — the pairing flow currently explains what
  gets captured in the terminal; a proper first-run dialog with an explicit
  "I acknowledge" step is worth adding before wide deployment.
- **Auto-update** — currently, updating the agent means re-running the
  installer with a new `.exe`. Fine at small scale; worth revisiting if this
  grows past a handful of machines.
