# Pilot v7 verification — 2026-09-22

- Deployment source commit: `5eff9b7` (`feat: add secure OTP login and adaptive theme`).
- GitHub mirror: `v4r1n/crschaoyuem`, branch `main`; pushed by fast-forward without force.
- Full regression before deployment: 69 passed (14 contract, 41 backend, 14 frontend).
- `git diff --check` passed. Credential scanning found only documented placeholder/test-fixture values; no deployer OAuth credential was committed.
- Backed up the pre-deployment Apps Script HEAD to `D:/Projects/crs-pilot-v7-predeploy-backup-20260922`.
- Uploaded 46 runtime files and created immutable Apps Script version **7**.
- Downloaded version 7 to `D:/Projects/crs-pilot-v7-verified-20260922` and compared every runtime file after mapping `.gs` to `.js` and normalizing line endings/trailing file whitespace: **46/46 matched**, with no missing or extra files.
- Downloaded version 7 manifest: `access=ANYONE`, `executeAs=USER_DEPLOYING`.
- Reconciled the target against the configured Pilot `/exec` URL: the current OAuth Pilot deployment was updated from version 1 to version 7, preserving its deployment ID and redirect URI.
- During target reconciliation, the older Pilot deployment was briefly pointed at version 7 and immediately restored to version 6 before live acceptance. The final deployment listing confirms the current OAuth Pilot at version 7, the older Pilot at version 6, and the HEAD deployment unchanged.
- No Script Properties, Sheet data, Drive permissions, OAuth client configuration, or Production promotion was performed by this rollout.

## Live acceptance still required

Open the existing Pilot `/exec` URL in separate fresh browser profiles and complete one approved YRU login and one approved Gmail login. Verify the six-digit OTP display/copy flow, six-field type/paste/backspace behavior, expiry, five-failure lockout, replay denial, YRU/Gmail session isolation, current Users/ACTIVE/Role checks, light/dark/system persistence, and mobile readability before any Production promotion.
