# Pilot v13 deployment verification

Date: 2026-09-24 (Asia/Bangkok)

## Source and automated verification

- Git source commit: `1a9306689245040bc4831429b1d739d0fcc36ce6` (`main`, pushed to `origin/main` before deployment).
- Full automated suite passed before upload: 14 contract + 44 backend + 19 Playwright = 77 tests.
- `clasp status` showed no source files pending upload.
- No separate pre-deploy source backup was created.

## Apps Script verification

- Created immutable Apps Script version 13 and updated only the existing Login Pilot deployment; its deployment URL/ID was preserved.
- Apps Script API confirmed the active Pilot entry point is `ANYONE_ANONYMOUS` + `USER_DEPLOYING`, matching the user's explicit confirmation that unauthenticated visitors may open the app shell while OAuth and application authorization remain required for protected operations.
- Downloaded immutable version 13 using the Apps Script API. All 46 runtime files were retrieved; 45 matched repository source after newline normalization. The sole intentional difference is `webapp.access` in `appsscript.json`: repository baseline `ANYONE`, deployed version `ANYONE_ANONYMOUS`, as approved for this Pilot. `webapp.executeAs` and all other manifest fields match.
- Public HTTP smoke probe of the canonical Pilot `/exec` URL returned HTTP 200. This checks reachability only; it is not a substitute for real YRU/Gmail OAuth acceptance.
- The separate OAuth callback Pilot deployment remained at version 10. Production was not changed.

## Acceptance still required

- Complete real YRU and Gmail sign-in through the Pilot, verify OTP copy/confirmation and remembered-session behavior, and ensure the ordinary user resolves to an `ACTIVE` Users row with an allowed domain/role.
- Verify that the Script Property and Google OAuth client's Authorized redirect URI still exactly match the existing Pilot `/exec` URL. No URL change was made because this update preserved the Pilot deployment URL/ID.
