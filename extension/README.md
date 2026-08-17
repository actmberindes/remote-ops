# Remote Ops Activity Tracker (Chrome/Edge Extension)

Companion to the desktop agent — tracks domain-level web usage time
(domain + minutes, never full URLs or page content) and reports it to the
same backend, using the same pairing-code flow.

## How it works

- `logic.js` — pure functions (domain parsing, time accumulation, segment
  transitions). No Chrome APIs. Fully unit tested (`test-logic.mjs`, 22
  checks, all passing) without needing a real browser.
- `background.js` — the MV3 service worker. Thin wrapper around `logic.js`
  that watches `chrome.tabs`, `chrome.windows`, and `chrome.idle` for changes,
  and flushes accumulated time to the backend once a minute via
  `chrome.alarms`.
- `popup.html` / `popup.js` — the pairing UI, shown when clicking the
  extension icon.

**Important MV3 detail**: service workers can be killed and restarted by
Chrome at any time between events — they don't stay resident like a normal
background page. `background.js` persists all tracking state to
`chrome.storage.local` rather than plain JS variables specifically so a
worker restart mid-session doesn't silently drop accumulated time.

## What's tracked, and what isn't

- **Domain only** (e.g. `github.com`), not full URLs, query strings, or page
  content — matches the "log URL domains" requirement without capturing
  anything more sensitive.
- Only while the tab is **active, focused, and the user isn't idle**
  (60-second idle threshold) — background tabs and idle time aren't counted.
- Only **after pairing** — before that, the extension is inert.
- Internal browser pages (`chrome://...`, extension pages) are excluded.

## Installing (development / internal distribution)

Chrome extensions distributed outside the Chrome Web Store must be loaded in
Developer Mode, or pushed via a Chrome Enterprise policy (`ExtensionInstallForcelist`)
if you're managing company devices centrally. For an internal tool like this,
Developer Mode is the fastest path; enterprise policy is worth doing once
you're past a handful of machines, since it removes the manual step entirely.

**Manual install (per machine):**
1. Open `chrome://extensions` (or `edge://extensions`)
2. Enable **Developer mode** (top-right toggle)
3. Click **Load unpacked**, select this `extension/` folder
4. Click the extension icon in the toolbar → enter the pairing code from
   the employee's Dashboard

**Enterprise policy (recommended past a few machines):** package this folder
as a `.crx` + host it internally, then push install + your extension ID via
Group Policy / Chrome Browser Cloud Management. This is a company-IT-infra
step outside what I can set up from here, but the extension itself doesn't
need any changes to support it.

## Configuring a non-default backend URL

By default the extension talks to `http://localhost:4000/api`. To point it
at a deployed backend, set `apiUrl` in `chrome.storage.local` before pairing
— e.g. via the extension's service worker console:
```js
chrome.storage.local.set({ apiUrl: 'https://your-backend.example.com/api' });
```
Worth adding a small settings field in the popup for this if you deploy to
more than a couple of machines by hand.

## Testing

```bash
node test-logic.mjs     # pure logic, no browser or backend needed
node test-pairing.mjs   # pairing + web-usage flow against a running backend
```

I ran both — 22/22 and 9/9 passing respectively, the latter against the live
backend including confirming a revoked device's token is rejected
server-side. What I can't test from here is the actual `chrome.tabs` /
`chrome.idle` behavior inside a real Chrome instance, since that needs an
actual browser UI — worth loading it unpacked and clicking through a few
tabs as a smoke test before wider rollout, same caveat as the desktop agent.
