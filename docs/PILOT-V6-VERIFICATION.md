# Pilot v6 verification — 2026-09-21

- Deployment source commit: `ce813adeb0550f28f01bec32d9551773f2814c99`.
- GitHub mirror: `v4r1n/crschaoyuem`, branch `main`; pushed by fast-forward from its initial commit without force.
- Full regression before deployment: 62 passed (12 contract, 39 backend, 11 frontend).
- The Login access card no longer contains the `retry-bootstrap` button or handler. Google OAuth, confirmation, failure handling and server authorization remain unchanged.
- Backed up the pre-deployment Apps Script HEAD to `D:/Projects/crs-pilot-v6-predeploy-backup-20260921`.
- The mutable Apps Script HEAD had drifted to `ANYONE_ANONYMOUS`; immutable version 5 and Git source remained `ANYONE`. Uploading the reviewed source restored the required `ANYONE` / `USER_DEPLOYING` manifest before version creation.
- Created immutable Apps Script version **6** and downloaded it to `D:/Projects/crs-pilot-v6-verified-20260921`.
- Compared 46/46 runtime files after mapping `.gs` to downloaded `.js` and normalizing line endings/trailing file whitespace. No differences, missing files or extras.
- Downloaded version 6 manifest: `access=ANYONE`, `executeAs=USER_DEPLOYING`.
- Aggregate normalized runtime source SHA-256: `30c09bad1ca2e053ec249e0183c2fbcee1c688fbc8c9b38368b63cc9e39e58ea`.
- Updated only the existing Pilot deployment to version 6. Its `/exec` URL and OAuth redirect URI remain unchanged.
- Post-deployment listing confirmed the protected old/Production deployment remains at version 1. No new deployment was created and no Sheet/Drive data or Script Properties were changed.

## Live check

Open the existing Pilot `/exec` URL in a fresh signed-in browser session. Confirm the access card initially shows only “ลงชื่อเข้าใช้ด้วย Google”; the six-field OTP control appears only after a callback is awaiting confirmation. Verify callback Copy, single-paste distribution, five-minute expiry, five-failure lockout, and replay rejection. Complete one YRU and one approved Gmail login before any Production promotion.
