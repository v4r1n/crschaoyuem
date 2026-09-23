# CRS Yuem-Kuen System Project Memory

Last updated: 2026-09-04

## Current state

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
- Production topology remains an organization-controlled deployer with `USER_DEPLOYING`, private Sheet/Drive ACLs, and a stable versioned `/exec`; Web app access is `ANYONE` for logged-in Google Accounts and explicitly never `ANYONE_ANONYMOUS`.
- Google authorization runs through Apps Script `/usercallback`: StateTokenBuilder state, OIDC nonce, PKCE S256, one-time ScriptCache records, server-side code exchange, and strict RS256/PKCS#1 ID-token verification precede Users authorization. Business RPCs receive only an opaque application session and re-read exactly one Active Users row/current role; unknown rows never auto-provision.
- Automated coverage includes `@yru.ac.th`, `@gmail.com`, allowlist fallback, callback/state/nonce/PKCE/replay failures, malformed/bad-signature/wrong-key/wrong-audience/wrong-issuer/expired/unverified/wrong-hosted-domain tokens, session absence/expiry/isolation/logout, JWKS hardening, unknown/inactive users, and privilege escalation.
- The private `setupSystem_()` preflights OAuth client ID/secret, auth TTLs, domains, image-sharing policy, configured Drive folder access, and exact current Web app URL before managed-sheet mutation, then writes a structured success event. Drive sharing exceptions map to `DRIVE_SHARING_FAILED`.
- QR URL derivation accepts only the canonical current `script.google.com/macros/s/.../exec` deployment; `/dev`, redirect/external hosts, credentials/ports, query/fragment suffixes, extra paths, and mismatched deployments fail closed.
- Manifest scopes are `drive`, `spreadsheets`, `userinfo.email`, and `script.external_request`; the last supports Google's token endpoint and JWKS. Deployment documentation covers the exact callback URI, OAuth External audience, temporary-user-key pilot, external-account image-link boundary, non-retroactive sharing, restricted editors, stable-URL upgrades, rollback, backups, monitoring, quotas, and troubleshooting.
- Reviewed official Google documentation for Web-server OAuth/OIDC, Apps Script state-token callbacks, ID-token verification/JWKS caching, Session temporary-user-key limitations, Web app access/execute-as settings, Script Properties, scopes, deployments, logging, and quotas through 2026-09-04.
- The user reports the earlier domain-only `yru.ac.th` deployment works. The `0.2.0` external-account release is not yet live-verified because its Web OAuth Client ID/secret, exact `/usercallback` redirect, temporary pilot/redeployment, Gmail Users row, image-sharing decision, and cross-account acceptance remain deployer actions. The acceptance matrix stays unsigned for those checks.

## Current pilot architecture update

The /usercallback design above is historical and superseded by ADR-019/ADR-020. New code uses GOOGLE_OAUTH_REDIRECT_URI for exact Pilot /exec callback, opaque server-side state, and a manual six-digit one-time callback OTP. The OTP is stored only as a flow-bound keyed hash, expires after five minutes, locks after five failures, and is consumed on success. No callback temporary-key match is required. Callback stores a candidate only; completeOAuthSignIn requires OTP + poll + session proofs before activation. Live deployment/configuration and acceptance must be recorded separately from local test results.

ADR-021 adds a six-hour absolute application-session TTL. The browser stores only the opaque application token and expiry, in `sessionStorage` by default or `localStorage` after explicit opt-in; logout synchronizes across tabs and invalid/evicted sessions fail closed. The callback Copy action now sends a one-time flow-bound acknowledgement so the initiating browser can close the popup reliably without weakening OTP activation. Deployment policy requires `USER_DEPLOYING` + `ANYONE`, a commit/push for every deployment, and no separate pre-deploy source backup; the newly created immutable version is still downloaded and compared for verification.
