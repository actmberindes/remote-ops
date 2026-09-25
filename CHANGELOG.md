# Remote Ops Changelog

## v1.1.0 — 2026-09-25

**Multi-user session-aware monitoring**

- Added Windows WTS session-aware identity detection for shared devices and Fast User Switching.
- Monitoring now binds heartbeat telemetry, screenshots, and Live View frames to the active Windows session ID.
- Historical captures retain the domain user and session identity present when they were captured.
- Local locked sessions pause monitoring; the existing RDP locked-session monitoring behavior is preserved.
- Windows Agent updated to **v2.1.0**.
- Release baseline commit: `b2776b0bf699f9768d00687e85b0f12d5e91c896`.

## v1.0.1 — 2026-09-22

**Capture storage cleanup**

- Live and scheduled screenshot captures now stay in memory while being uploaded.
- Removed agent-created screenshot files from the Windows TEMP workflow.
- Windows Agent updated to **v2.1.0**.
- Release baseline commit: `2143520a09c9fbf7ebf3953f57cd54e78663eee5`.


This file tracks user-visible Remote Ops releases. Every major feature or meaningful change should have a matching version entry and release commit.

## v1.0.0 — 2026-09-17

**Stable baseline**

- Established the first tracked Remote Ops portal release.
- Added portal version metadata and an in-portal version history viewer.
- Added a public backend version endpoint used by the portal.
- Windows Agent baseline: **v2.0.1**.
- Release baseline commit: `1585c2ee5f135a3be7129566eacc076fd9311fc5`.

## Versioning rules

- **Major (`X.0.0`)** — breaking changes or a substantial system redesign.
- **Minor (`X.Y.0`)** — new features or significant user-visible functionality.
- **Patch (`X.Y.Z`)** — bug fixes, small improvements, and non-breaking maintenance.
- Every user-visible release should update `backend/src/version.js` and this changelog in the same change set.
- The release commit recorded in `backend/src/version.js` should point to the commit that establishes that release.
- Windows Agent versions remain independent from the portal version and should be updated in the agent project when the executable changes.
