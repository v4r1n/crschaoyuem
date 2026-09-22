# Pilot v9 verification — 2026-09-22

- Deployment source commit: `eb98716` (`fix(ui): align admin borrowing filters`).
- Full regression before deployment: 71 passed (14 contract, 42 backend, 15 frontend).
- The Admin borrowing filter uses an application-owned responsive CSS Grid instead of depending on Bootstrap column wrapping.
- At desktop width, the Search, Status, Sort, and Show controls render on one row; all three visible labels align and all four controls align within one pixel in browser acceptance.
- At smaller widths, the filter reflows without horizontal overflow; the existing 320/768/1440 responsive acceptance remains green.
- Backed up the pre-deployment Apps Script HEAD to `D:/Projects/crs-pilot-v9-predeploy-backup-20260922`.
- Uploaded 46 runtime files and created immutable Apps Script version **9**.
- Downloaded version 9 to `D:/Projects/crs-pilot-v9-verified-20260922`; all **46/46** runtime files matched after `.gs`/`.js` mapping and line-ending/trailing-whitespace normalization.
- Manifest remains `access=ANYONE` and `executeAs=USER_DEPLOYING`.
- Updated both Login and OAuth callback Pilot deployments to version 9; both endpoints returned HTTP 200. No Production deployment, Script Properties, Sheet data, Drive permissions, or OAuth client configuration changed.
