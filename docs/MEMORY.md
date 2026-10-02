# CRS Yuem-Kuen Project Memory

Last updated: 2026-10-02

## Current state

- Pilot 0.1.12 adds a session-gated image fallback for Drive thumbnail failures without changing Drive sharing. The 2026-10-02 workbook confirms AST-000004 has an Equipment image_file_id matching a completed upload and an existing Drive file; the browser image path, not the upload commit, is the likely failure. Authenticated live verification remains required.
- Pilot 0.1.12 / Apps Script v22 was deployed to both existing Pilot deployments from source 9fc84cc. The app endpoint returned HTTP 200 with the new image RPC. Automated tests passed: 17 contract, 83 backend, 51 frontend. Browser verification using the user's Google account is still needed.
- Pilot 0.1.11 clarifies image guidance in the upload dialog: recommended dimensions at most 1024 × 1024 px alongside the configured byte limit. This is guidance, not a newly enforced pixel cap.
- Pilot 0.1.11 / Apps Script v21 is deployed to both existing Pilot deployments from source 0d0e127; the app endpoint returned HTTP 200 and included the image guidance.
- The 2026-10-02 workbook contains a malformed legacy Users row 3: the email occupies user_id and subsequent values are shifted. A valid administrator record exists in row 2. Preserve the legacy row until its references and migration blockers are reviewed; do not remove a Users row directly.

- The supplied workbook has one STARTED image upload for AST-000003, with a pinned Drive file but no Equipment image reference. This blocks both new uploads and edits. Admin forms now offer guarded cancellation and retain unsaved input for retry.
- Pilot 0.1.10 adds an audited ADMIN-only terminal DELETED status with exact asset-ID confirmation. Active loans and pending operations block deletion; the record, included items, image and History remain.
- Pilot 0.1.10 / Apps Script v20 deployed to both existing Pilot deployments from source 831b664. The isolated release passed 17 contract, 81 backend, and 50 frontend tests; the Pilot app endpoint returned HTTP 200. Live authenticated image replacement, editing, and deletion still require an operator walkthrough. No live operation or Drive file was changed during deployment.

- Active branch: `codex/initial-v1`
- Current version: `0.2.0` release candidate; the prior domain-only `yru.ac.th` deployment was reported working, while the external-account release now uses server-side OAuth/OIDC and still needs Web OAuth client/redirect configuration, redeployment, and live sign-off
- Completed: Phase 1 — architecture, schema, workflow, project rules, migration direction
- Completed: Phase 2 — manifest/config, schema setup, immutable migration ledger, sequences, repositories, utilities, validation, cache helpers
- Completed: Phase 3 — server-verified Google identity for Workspace/Gmail, guarded RPCs, domain services, durable operation recovery, Drive images, integrity audit, and schema v3 migrations
- Completed: Phase 4 — responsive Thai SPA shell, navigation, dashboards, equipment/borrowing/admin screens, forms, state handling, and client RPC integration
- Completed: Phase 5 — canonical QR generation/display, PNG sticker download, image-capture/file scanning, strict payload validation, and Admin exact-asset handoff
- Completed: Phase 6 — automated source contracts, in-memory Apps Script workflow tests, local-browser acceptance, responsive verification, and ID-boundary hardening
- Completed: Phase 7 — deployment guide, exact configuration/source inventory, OAuth setup, logged-in-account rollout, User/Admin acceptance, stable-URL release/rollback, monitoring, backup, and troubleshooting handoff
- Completed: authentication redesign — replaced iframe GIS with server-side Authorization Code/OIDC, protected callback, state/nonce/PKCE, one-time flow records, and per-visitor opaque application sessions
- Next: create a Web application OAuth client with exact `/usercallback` redirect, set its Client ID/secret plus `ALLOWED_DOMAINS=yru.ac.th,gmail.com`, deploy a temporary pilot, and complete separate-profile Workspace/Gmail callback/session acceptance before updating production

## Frozen contracts

- One Equipment row is one physical asset; `quantity` is retained for compatibility but fixed to `1`.
- One active workflow per asset; a pending request is a hard hold.
- Borrow and Equipment statuses use canonical English enums and synchronized transitions in BorrowService.
- Overdue is derived; return condition and disposition are separate.
- Visitor identity comes only from an ID token obtained and verified inside the server-side OAuth callback; business RPCs require a short-lived opaque session plus exact domain allowlist, one Active Users row, and a supported current role.
- QR stores/encodes a canonical detail URL but the URL is derived and refreshable.
- Sheet repositories are the only storage boundary so a future SQL migration preserves services and workflow.

## Configuration still supplied by deployer

`SPREADSHEET_ID`, `DRIVE_FOLDER_ID`, `ADMIN_EMAILS`, `ALLOWED_DOMAINS`, `GOOGLE_OAUTH_CLIENT_ID`, `GOOGLE_OAUTH_CLIENT_SECRET`, and optionally `WEB_APP_URL`, `AUTH_FLOW_TTL_SECONDS`, and `AUTH_SESSION_TTL_SECONDS` via Script Properties. `ALLOWED_DOMAIN` remains only as a legacy fallback when `ALLOWED_DOMAINS` is absent or blank.

## Phase 1 verification

- Compared architecture against all 35 requirement sections.
- Resolved quantity, overdue, return/maintenance, user return notification, future booking, QR stability, and serial uniqueness ambiguities.
- Confirmed remote repository initially contains only `LICENSE`; feature branch was created from `main`.

## Phase 2 verification

- Combined Apps Script source passes Node.js syntax checking; `appsscript.json` parses as valid JSON.
- Pure contract checks pass for leap/invalid dates, due-date ordering, overdue boundary, formula escaping, domain matching, QR URL construction, and sequence-to-schema mappings.
- In-memory Apps Script review verified first setup and rerun idempotency: 10 sheets, 13 categories, 7 sequences, 1 admin, 4 settings, and 1 migration.
- Verified automatic grid expansion past 26 columns and 1,000 rows, existing-user admin promotion, partial updates preserving untouched Date/formula cells, immutable primary keys, unknown-field rejection, cache fallback, and pagination clamping.
- Verified the immutable migration `001_initial_schema` SHA-256 checksum against its frozen V1 schema material.
- Live Google deployment checks remain for Phase 7 because deployer-owned Spreadsheet/Drive IDs are intentionally not stored in source.

## Phase 3 verification

- All 24 Apps Script files pass individual and combined V8-compatible syntax compilation; `appsscript.json` parses as valid JSON and `git diff --check` is clean.
- Static contracts verify schema version 3, the exact 21-column Operations header, `BorrowItems.is_required`, all three immutable migration IDs, and the frozen SHA-256 Base64URL checksum for migration 003.
- Verified all 32 business RPC wrappers enforce a current Users-row user/admin guard; the original browser-ID-token transport from this phase was later superseded by ADR-018's opaque application session.
- Verified source contains no `Session.getEffectiveUser()` and uses `Session.getActiveUser()` only for the private editor-run setup operator, never visitor identity. Setup validates the caller inside the Script Lock; first bootstrap requires a configured allowlisted admin, while every later run requires an active Users-row admin.
- Read-only recovery/security review covered exact source/target replay, role-specific DTO redaction, active-workflow holds, return checklist evidence, result hashes, safe image aborts, unique reservations, cache epochs, and batch row updates. It also reproduced and closed partial equipment-edit recovery, setup authorization races, stale auto-provision authorization, uncertain Drive-resource cleanup, and invalid `ABORTED` evidence cases.
- Live Workspace/Gmail OAuth callback/session identity, Apps Script authorization, Drive sharing/resource-key behavior, browser RPC, and deployed web-app acceptance remain because they require deployer-owned resources and a Web OAuth Client.

## Phase 4 verification

- All 24 Apps Script files pass individual and combined V8-compatible syntax compilation; all nine browser script partials compile, `appsscript.json` parses, and `git diff --check` is clean.
- Static integration checks match all 32 guarded public RPCs to Promise client endpoints, all nine allowlisted routes to registered renderers, all six mounted view templates to source templates, and every server include to an allowlisted HTML partial.
- Responsive Thai UI covers the desktop sidebar, mobile bottom navigation with a central Scan action, access/loading/offline/toast/confirm states, dashboard, equipment card/table catalog, detail, borrow request, My Borrow/history, account, and all six admin tabs.
- Admin workflows use current row versions and stable browser command IDs for approve, reject, checkout, return inspection, equipment/user/category mutations, and operation abort. Return inspection sends every immutable BorrowItems snapshot and enforces required-item plus condition/disposition rules before the server revalidates them.
- Read-only frontend review closed deep-link filter gaps, stale category options, an invalid catalog pagination structure, exact Asset/Borrow ID validation, dashboard admin routing/latest-borrow selection, route-selector hardening, and the signed-in admin email orphaning case. The email rule is also enforced in `UserService.gs`, not only by a read-only field.
- HTML structure checks found no duplicate static IDs, unbalanced tags/CSS braces, mojibake, inline event-handler attributes, `javascript:` URLs, or unfinished runtime markers.
- Live responsive layout, OAuth popup/callback, `google.script.run`, Workspace/Gmail identity, and browser accessibility acceptance remain because the deployment configuration and accounts are deployer-owned.

## Phase 5 verification

- QR libraries are pinned and vendored from official packages: `qrcode-generator` 2.0.4 and `html5-qrcode` 2.3.8. Distribution SHA-256 values and complete MIT/Apache-2.0 licenses are recorded in `docs/THIRD_PARTY_NOTICES.md`.
- QR output derives only from `bootstrap.app.webAppUrl` plus an exact `AST-000001` identifier, uses level-Q correction, integer-pixel modules, a four-module quiet zone, and a high-resolution sticker PNG.
- Scan input accepts PNG/JPEG/WebP up to 10 MB, performs local `scanFile()` decoding, rejects unknown origins/paths/routes/query keys/duplicate IDs, and never calls live-camera APIs. Manual Asset ID remains available.
- Valid admin scan follow-up uses the existing exact `assetId` server filter and confirmation-based borrow workflow rather than mutating from decoded content.
- QR contract checks pass 5 valid and 22 hostile payload cases, including inherited `Object.prototype` query-key names; server web-app URL normalization passes 14 HTTPS/malformed/credential/port cases, and the generated canonical URL produces a valid 49-by-49 level-Q matrix.
- Final static integration checks pass all 23 individual and combined `.gs` sources, nine browser scripts, 18 allowlisted includes, nine registered routes, 321 unique literal markup IDs, `appsscript.json`, vendor checksums, `git diff --check`, and the no-live-camera-call contract outside vendored code.
- Local Chromium download/clipboard acceptance passes; live mobile file-picker/camera capture, physical sticker scanning, and deployed HTML-service acceptance remain for Phase 7.

## Phase 6 verification

- The Phase 6 baseline passed 46 automated tests: eleven source/security contracts, twenty-seven backend service tests, and eight Playwright browser acceptance tests.
- The backend suite runs the real setup, repository, authentication, operation journal, equipment, borrowing, user, category, dashboard, history, and integrity services against faithful in-memory Spreadsheet, Properties, Cache, Lock, Session, Utilities, and Script service doubles.
- End-to-end service coverage verifies fail-closed identity and Admin permissions, the guarded request → approve → checkout → return-request → inspected-return lifecycle, idempotent retries, double-book prevention including a STARTED operation before Borrow ID allocation, overdue boundaries, return checklist rules, append-only History, setup idempotency, migration checksum drift, duplicate business keys, and integrity-audit findings.
- Sequence allocation now preserves exact six-digit IDs and exact three-digit Category IDs at the upper boundary. Requests that cannot fit the frozen format fail atomically with `ID_EXHAUSTED`; public User/Category validators and BorrowItems recovery checks reject over-width IDs.
- The callable top-level server surface is the 32 session-guarded business RPCs, four narrow auth lifecycle RPCs, and deliberate `doGet`; callback/setup/error helpers remain private.
- Playwright assembles the real Apps Script HTML includes locally, uses deterministic server-OAuth and `google.script.run` doubles, and covers opt-in session persistence, expiry reauthentication/re-bootstrap, cross-tab logout, QR sticker download/copy, strict scan/manual fallback, Admin exact-asset handoff, guarded Admin action modals, Thai failure feedback, and route/viewport combinations across 320, 768, and 1440 pixels without document overflow.
- The 320-pixel Admin tab strip is horizontally contained and remains scrollable; quick filters and data tables scroll within their own regions.
- Actual Workspace identity, Apps Script authorization prompts/quotas, Google Sheets and Drive behavior, deployed HTML-service sandbox behavior, physical sticker scanning, and native mobile camera/file-picker behavior remain Phase 7 deployer acceptance because they require organization-owned resources and devices.

## Phase 7 verification

- The server-side OAuth redesign passed all 48 automated tests on 2026-09-05: eleven source/security/deployment contracts, twenty-eight backend tests, and nine Playwright browser acceptance tests. Live callback/channel-binding acceptance remains unsigned.
- Traced the deployment procedure against all 46 runtime source files, all 11 managed Sheet schemas, all Script Property names and numeric constraints, first-admin bootstrap rules, image-sharing modes, setup/migration behavior, server-side OAuth/OIDC configuration, and canonical `/exec` QR URL validation.
- Production topology remains an organization-controlled deployer with `USER_DEPLOYING`, private Sheet/Drive ACLs, and a stable versioned `/exec`; Production access remains unchanged at `ANYONE`. The Pilot may use `ANYONE_ANONYMOUS` to serve the app shell, while protected RPCs require Google OAuth and a validated application session.
- Google authorization runs through Apps Script `/usercallback`: StateTokenBuilder state, OIDC nonce, PKCE S256, one-time ScriptCache records, server-side code exchange, and strict RS256/PKCS#1 ID-token verification precede Users authorization. Business RPCs receive only an opaque application session and re-read exactly one Active Users row/current role; unknown rows never auto-provision.
- Automated coverage includes `@yru.ac.th`, `@gmail.com`, allowlist fallback, callback/state/nonce/PKCE/replay failures, malformed/bad-signature/wrong-key/wrong-audience/wrong-issuer/expired/unverified/wrong-hosted-domain tokens, session absence/expiry/isolation/logout, JWKS hardening, unknown/inactive users, and privilege escalation.
- The private `setupSystem_()` preflights OAuth client ID/secret, auth TTLs, domains, image-sharing policy, configured Drive folder access, and exact current Web app URL before managed-sheet mutation, then writes a structured success event. Drive sharing exceptions map to `DRIVE_SHARING_FAILED`.
- QR URL derivation accepts only the canonical current `script.google.com/macros/s/.../exec` deployment; `/dev`, redirect/external hosts, credentials/ports, query/fragment suffixes, extra paths, and mismatched deployments fail closed.
- Manifest scopes are `drive`, `spreadsheets`, `userinfo.email`, and `script.external_request`; the last supports Google's token endpoint and JWKS. Deployment documentation covers the exact callback URI, OAuth External audience, temporary-user-key pilot, external-account image-link boundary, non-retroactive sharing, restricted editors, stable-URL upgrades, rollback, backups, monitoring, quotas, and troubleshooting.
- Reviewed official Google documentation for Web-server OAuth/OIDC, Apps Script state-token callbacks, ID-token verification/JWKS caching, Session temporary-user-key limitations, Web app access/execute-as settings, Script Properties, scopes, deployments, logging, and quotas through 2026-09-04.
- The user reports the earlier domain-only `yru.ac.th` deployment works. The `0.2.0` external-account release is not yet live-verified because its Web OAuth Client ID/secret, exact `/usercallback` redirect, temporary pilot/redeployment, Gmail Users row, image-sharing decision, and cross-account acceptance remain deployer actions. The acceptance matrix stays unsigned for those checks.

## Current pilot architecture update

The /usercallback design above is historical and superseded by ADR-019/ADR-020. New code uses GOOGLE_OAUTH_REDIRECT_URI for exact Pilot /exec callback, opaque server-side state, and a manual six-digit one-time callback OTP. The OTP is stored only as a flow-bound keyed hash, expires after five minutes, locks after five failures, and is consumed on success. No callback temporary-key match is required. Callback stores a candidate only; completeOAuthSignIn requires OTP + poll + session proofs before activation. Live deployment/configuration and acceptance must be recorded separately from local test results.

ADR-021 adds a six-hour absolute application-session TTL. The browser stores only the opaque application token and expiry, in `sessionStorage` by default or `localStorage` after explicit opt-in; logout synchronizes across tabs and invalid/evicted sessions fail closed. The callback Copy action now sends a one-time flow-bound acknowledgement so the initiating browser can close the popup reliably without weakening OTP activation. ADR-022 replaces the temporary-user-key dependency with independent browser-held poll/session proofs for Pilot anonymous access because runtime returned an empty key; Production is not changed. Deployment policy requires `USER_DEPLOYING`, Pilot `ANYONE_ANONYMOUS`, commit/push for every deployment, and no separate pre-deploy source backup; the newly created immutable version is still downloaded and compared for verification.

The anonymous-login regression is fixed in `OAuthService.gs`: OAuth/session ownership no longer depends on `Session.getTemporaryActiveUserKey()`. Contract, backend, and Playwright suites pass 79/79 on 2026-09-24. Source commit `4cd924f` is pushed to `origin/main`; all 46 Apps Script runtime files were pushed and immutable version 14 was downloaded and matched against local source. The existing Pilot deployment now points to version 14; Production remains unchanged. **Deployment access follow-up required:** after `clasp deploy`, Apps Script reports Pilot access as `ANYONE`, not the required `ANYONE_ANONYMOUS`. The deployment update API rejects `entryPoints` as an unsupported field, so restore anonymous access in Apps Script **Deploy > Manage deployments > Edit** on the existing Pilot, keeping `USER_DEPLOYING`; then verify the API reports `ANYONE_ANONYMOUS` and perform live Workspace/Gmail sign-in acceptance. Do not create another deployment or an extra backup version.

## Settings and account UI release verification

- The Settings workspace now renders Keyboard Shortcuts directly; its Sidebar shortcut switch, key capture, and restore action use the existing shortcut service. The Help dialog remains available.
- This release also includes the account/Help popovers, language and appearance settings, responsive sidebar controls, and search/filter layout refinements. Authentication and business authorization were not changed in this UI release.
- On 2026-09-29, local contracts, backend, and Playwright tests passed 99/99 (14 + 46 + 39). Pilot start and callback deployments were both verified as `ANYONE_ANONYMOUS` / `USER_DEPLOYING` before rollout.
- Source commit `f6a96e8` is pushed to `origin/main`. All 47 runtime files were uploaded; immutable Apps Script version 16 was fetched and compared against local source with no mismatches. Both existing Pilot start and callback deployments now point to version 16; their `ANYONE_ANONYMOUS` / `USER_DEPLOYING` settings were confirmed after the update, and both `/exec` endpoints returned HTTP 200. Production was not changed.
- Next phase: complete real Workspace/Gmail login and UI acceptance on Pilot, including callback confirmation and Keyboard Shortcuts. HTTP 200 and local mocks do not prove a successful authenticated session. Production promotion remains separate and requires approval.

## Version 0.1.7 image upload release verification

- The previous immutable Apps Script v16 is designated baseline release `0.1.6`; its existing snapshot cannot be relabeled retroactively. The next release sets `APP_VERSION` to `0.1.7` in source and ignores any stale Script Property override so the Sidebar shows the source release version.
- The equipment image modal now uses one accessible drop zone in the former preview area for native browse and drag/drop. GIF preview and upload MIME are supported alongside JPEG, PNG, and WebP; the backend validates GIF87a/GIF89a headers and still enforces the configured size limit.
- On 2026-09-29, local contracts, backend, and Playwright suites passed 102/102 (15 + 47 + 40), including native file chooser, dropped GIF preview, upload payload, and spoofed-MIME rejection.
- Source commit `21d8c9e` was pushed to `origin/main`. All 47 runtime files were uploaded; immutable Apps Script v17 was fetched and compared against local source with no mismatches. Both existing Pilot start and callback deployments now point to v17, retain `ANYONE_ANONYMOUS` / `USER_DEPLOYING`, and returned HTTP 200. Production was not changed.
- Next phase: run real Workspace/Gmail sign-in and GIF drag/drop, upload, and stored-image acceptance on Pilot. The existing Drive thumbnail URL may show a still frame rather than GIF animation; confirm the expected post-upload behavior before changing image delivery or sharing policy. Local mocks and HTTP 200 do not prove live OAuth or Drive behavior. Production promotion remains separate.

## Image-sharing failure and pending equipment edit (local fix; not deployed)

- The Pilot screenshots on 2026-09-30 showed `DRIVE_SHARING_FAILED` on image upload followed by `OPERATION_PENDING` on `adminUpdateEquipment` for the same asset. A deterministic backend reproduction confirmed that an image operation left `STARTED` blocks all subsequent edits for that asset. The Drive folder screenshot shows general access as anyone with the link, but the live `IMAGE_SHARING` Script Property and operation row were not readable through the connected Google Drive account; do not infer the property's actual value from the screenshot.
- Local source now checks whether a new image inherits the exact required access before calling `File.setSharing`. It rejects a folder whose general access or permission is broader than `IMAGE_SHARING` before starting an operation. If Drive rejects sharing after an upload operation starts, the existing evidence-based image abort is attempted under the script lock. Only a confirmed `ABORTED` operation returns a non-retryable error and releases the browser command ID; uncertain cleanup remains `STARTED` for Admin review. No sharing policy is changed automatically.
- `npm test` passed 107/107 (15 contracts, 51 backend, 41 frontend) on 2026-09-30; an additional backend fail-closed cleanup test passed afterward (108 total tests at the same scope). The local working tree contained separate, pre-existing branding edits and one trailing-whitespace line in `README.md`; these were preserved. This fix has not been deployed or live-verified. Next: verify the deployer's `IMAGE_SHARING` against the actual image folder policy, inspect the old `STARTED` image operation in Admin Operations, abort it only if the app's evidence checks allow it, then release a new version from an isolated/clean source set and retest upload plus equipment edit on Pilot. Production remains unchanged.

## Canonical generated-URL audit (local fix; not deployed)

- On 2026-09-30, traced all authored QR, copied equipment-detail/share, and SPA navigation link paths. Reproduced three failures: an account-routed `/macros/u/{number}/` URL disabled the server's QR base, the browser QR builder could encode that routed path, and a dashboard fallback plus relative navigation anchors could inherit the browser path. The old Sheet `qr_url` fallback could expose a stale routed URL when configuration was invalid.
- `WEB_APP_URL` is now the sole base. Exact Google `/u/{number}/s/{deployment}/exec` aliases normalize to `/macros/s/{deployment}/exec` for comparison and output; missing/malformed/mismatched configuration fails closed. New Equipment rows and edited rows persist canonical `qr_url`; DTOs never expose a stored cache fallback. Auth, OAuth and Drive/Sheet ACLs are unchanged. Google may still display an account-routed address while navigating within the SPA; generated links do not copy it.
- `npm test` passed 112/112 (17 contracts, 53 backend, 42 Playwright frontend), including `/u/0/`, `/u/1/`, `/u/2/` and a browser address-bar alias. No live Apps Script deployment or real-browser Google routing verification has occurred. Next: release this source together with the separate pending image-operation fix from a reviewed clean scope, then verify QR decode/copy and navigation anchors on Pilot while signed in through multiple Google accounts. Production remains unchanged.

## Pilot 0.1.8 release preparation

- Before rollout, both existing Pilot start and OAuth callback deployments were on Apps Script v17 (`0.1.7`) and reported `ANYONE_ANONYMOUS` + `USER_DEPLOYING` with canonical `/macros/s/.../exec` entry URLs. Production was not selected for this release.
- Incremented source-controlled `APP_VERSION`, package versions, and version assertions to `0.1.8` for the next immutable Apps Script version. `npm test` passed 112/112 (17 contracts, 53 backend, 42 Playwright frontend). The release source contains the pushed image-sharing recovery and canonical URL fixes; unrelated local branding edits remained uncommitted and were excluded from the deployment.

## Pilot 0.1.8 / Apps Script v18 deployment

- Release source commit `1c12228` was pushed to `origin/main`; a detached clean worktree of that commit supplied all 47 runtime files. Pre-upload Apps Script HEAD matched v17 across all 47 files. After upload, Apps Script HEAD and immutable v18 each matched the local release source 47/47 with no mismatches.
- The existing Pilot app and Pilot OAuth callback deployments were updated to v18 without replacing either deployment ID. After eventual consistency settled, both reported `ANYONE_ANONYMOUS` + `USER_DEPLOYING`, canonical `/macros/s/.../exec` URLs, and anonymous GET HTTP 200 with the app shell. Production was not changed. No Script Property, OAuth registration, or Drive/Sheet ACL was changed.
- Live authenticated acceptance is still required: sign in separately with Workspace and Gmail accounts, verify OTP completion and session isolation, then inspect QR/copy/navigation links from an account-routed browser URL and retry image upload plus equipment edit. HTTP 200 and local tests alone do not establish these behaviors. Existing `STARTED` image operations, if any, still require evidence-based Admin reconciliation; this deployment does not clear them automatically.
