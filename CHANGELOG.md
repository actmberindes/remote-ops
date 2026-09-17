# Remote Ops Changelog

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
