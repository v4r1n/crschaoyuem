# Pilot v10 verification

Date: 2026-09-23 (Asia/Bangkok)

## Source and automated verification

- Git source commit: `15c8c6b` (`main`, pushed to `origin/main`).
- Full automated suite passed before upload: 14 contract + 44 backend + 19 Playwright = 77 tests.
- `git diff --check` passed and the deployment diff contained no known OAuth client secret, account password, or concrete client ID.
- `src/appsscript.json` was verified before upload with `webapp.access=ANYONE` and `webapp.executeAs=USER_DEPLOYING`.

## Apps Script verification

- Uploaded 46 runtime files and created immutable Apps Script version 10.
- Downloaded immutable version 10 into a verification-only directory after creation; all 46 files matched the repository source after `.gs`/`.js` and line-ending normalization.
- The downloaded manifest independently reported `ANYONE` + `USER_DEPLOYING`.
- No separate pre-deploy source backup was created.

## Pilot deployments

- Login Pilot `AKfycbwQvwxl8bZqTrzeF7jDTz_IClWkOYtRSaI6qe6zPA0ElMbW5m0mj9593RXffSePHXzF` now points to version 10.
- OAuth callback Pilot `AKfycbwkGujKGZBpcWyrwqGBTOk23VQJa2brA4xPmP95TWsRQZEEgr53KjHbLEhPVMoHmieZ` now points to version 10.
- Both unauthenticated HTTP probes ended at Google Account sign-in with HTTP 200, confirming the logged-in-account gate rather than anonymous application access.
- Production was not changed.

## v10 acceptance focus

- Copy the six-digit OTP: the callback sends a one-time acknowledgement and the initiating browser closes the popup; OTP + poll proof + session proof are still required to activate a session.
- On desktop, Search, Status, Sort, and Show controls align in one row on both Admin Borrowing and My Borrow.
- With “จดจำการเข้าสู่ระบบในอุปกรณ์นี้” unchecked, navigation/reload in the same tab restores from `sessionStorage`; closing the tab discards it.
- With the option checked, a valid session restores from `localStorage` for up to six hours. Logout removes it and signs out other open tabs. Cache eviction, expiry, inactive user, or role rejection clears the browser token and fails closed.
- Browser storage contains only the opaque application token and expiry; Google tokens, email, and role are not stored.
