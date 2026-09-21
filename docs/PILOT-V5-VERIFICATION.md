# Pilot v5 verification — 2026-09-10

- User authorized retaining the operator test helper as private `authorizePilot_()` and continuing Pilot deployment.
- `npm test`: 61 passed (11 contracts, 39 backend, 11 Playwright frontend); exit code 0.
- `git diff --check`: passed.
- Fresh remote HEAD backup: `D:/Projects/crs-pilot-v5-predeploy-backup-20260910`. Its 46 runtime files matched the previously reviewed backup, including the original helper.
- Uploaded 46 runtime files; created immutable Apps Script version **5**.
- Downloaded version 5 into `D:/Projects/crs-pilot-v5-verified-20260910`.
- Compared both inventories and every file, mapping `.gs` to downloaded `.js` and normalizing CRLF/trailing file whitespace. **46/46 matched**, no missing or extra runtime files.
- Aggregate normalized source SHA-256: `037c471e57e6915ac08d49bb74544681d51f008c3451613d4b33735649d3eb94`.
- Updated the existing Pilot deployment from version 4 to version 5. The Pilot `/exec` URL is unchanged.
- Post-deployment listing confirmed Pilot version 5 and the protected Production/old deployment still at version 1. No replacement deployment created.
- Manifest remains `USER_DEPLOYING` / `ANYONE`. No Script Properties, Sheet records, Drive permissions or Production deployment were changed by this rollout.
- The subsequent login UI mirror removes the access-card `retry-bootstrap` button and its click handler. Google sign-in, protected callback confirmation, OAuth errors and all server authorization checks remain unchanged. Full regression after this UI change: 62 passed (12 contracts, 39 backend, 11 frontend).

## Remaining live acceptance

Refresh/reopen the existing Pilot URL and sign in as Admin. Edit/cancel an existing user, then add an approved Gmail account as ACTIVE/USER. Verify the create action, generated canonical ID, unique email row, immutable edit ID, Gmail login and YRU login/session isolation.

Automated results use mocks and do not establish live account acceptance. Direct Sheet inspection previously returned 403; no live legacy audit or repair has been executed. Use the read-only Admin audit described in DEPLOYMENT.md first. Do not run repair on shared Production data or when reference/audit integrity cannot be established.
