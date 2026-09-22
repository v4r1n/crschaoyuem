# Pilot v8 verification — 2026-09-22

- Deployment source commit: `2c5e38a` (`fix(auth): center OTP callback and close after copy`).
- Full regression before deployment: 70 passed (14 contract, 42 backend, 14 frontend).
- The OAuth callback card and all of its contents are centered horizontally and vertically across responsive viewport sizes.
- A successful Copy action announces that the window will close and calls `window.close()` after 750 ms. The Login page retains its existing best-effort popup close after successful OTP verification, so manually entered OTPs also close the callback after authentication succeeds.
- Backed up the pre-deployment Apps Script HEAD to `D:/Projects/crs-pilot-v8-predeploy-backup-20260922`.
- Uploaded 46 runtime files and created immutable Apps Script version **8**.
- Downloaded version 8 to `D:/Projects/crs-pilot-v8-verified-20260922`; all **46/46** runtime files matched after `.gs`/`.js` mapping and line-ending/trailing-whitespace normalization, with no missing or extra files.
- Downloaded manifest remains `access=ANYONE` and `executeAs=USER_DEPLOYING`.
- Updated both the Login Pilot and its configured OAuth callback deployment to version 8. Deployment IDs and redirect URIs remain unchanged, and the post-deployment parity check passed.
- Both Pilot endpoints returned HTTP 200. No Script Properties, Sheet data, Drive permissions, OAuth client configuration, or Production deployment was changed.

## Live acceptance

Start a completely new OAuth flow in a fresh browser profile. Confirm that the callback card is centered, Copy places the six-digit OTP on the clipboard and closes the popup, manual OTP entry closes the popup only after successful verification, and invalid OTP keeps the flow open for a permitted retry.
