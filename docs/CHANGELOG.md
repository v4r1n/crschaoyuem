# CRS Yuem-Kuen System Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- Opt-in six-hour remembered application sessions with default same-tab `sessionStorage`, explicit `localStorage`, expiry validation, fail-closed eviction handling, and synchronized cross-tab logout; browser storage contains only the opaque application token and expiry.
- One-time callback Copy acknowledgement so the initiating tab can reliably close the Apps Script popup despite the callback iframe boundary.
- Shared desktop borrowing-filter grid for Admin and My Borrow so search, status, sort, and submit controls align on one row.
- Six-digit OAuth confirmation OTP with server-keyed CSPRNG generation, flow-bound hash-only storage, five-minute expiry, five-attempt lockout, replay prevention, callback copy control, and accessible six-field paste-aware input.
- Anonymous Pilot OAuth binding uses independent browser-held poll/session proofs rather than the empty Apps Script temporary-user key; server-side token, OTP, Users-row, status, domain, role, and business-RPC session checks remain enforced.

- Phase 1 system architecture for a Google Apps Script HTML-service SPA.
- Migration-friendly Google Sheets schema with stable IDs and append-only history.
- Explicit borrow/equipment state machine, return inspection contract, and derived overdue rule.
- Security, performance, coding, and phase-end project conventions.
- Initial migration guide and architectural decision log.
- Apps Script V8 manifest and centralized deployment configuration with Script Property overrides.
- Idempotent private editor function `setupSystem_()` for all eleven Sheets, formatting, warning protection, default categories, settings, sequences, migrations, and bootstrap admins.
- Header-based bulk repository with grid growth, partial updates, immutable primary keys, serialization, and best-effort cache helpers.
- Lock-safe collision-resistant ID allocation and recovery for assets, borrows, users, categories, items, and logs.
- Immutable migration ledger with pre-mutation checksum validation and duplicate-data preflight.
- Shared Thai-safe errors, validation, date/overdue, normalization, formula-injection, and QR URL utilities.
- Fail-closed authentication and active-user/admin authorization with role-specific response DTOs.
- Guarded RPC surface for dashboard, equipment, borrowing, history, users, categories, image upload, integrity audit, and operation recovery.
- Equipment, included-item, borrow approval/checkout/return, user, category, dashboard, history, and Google Drive image services with optimistic row versions.
- Durable Operations journal with payload/result hashes, exact source-or-target replay, admin reconciliation, pending-entity reservations, and evidence-based terminal abort for untouched image uploads.
- Return-time immutable included-item snapshots, required-item enforcement, exact checklist validation, and separate condition/disposition decisions.
- Schema migrations 002 and 003 for the Operations journal, required-item evidence, multi-cell stored results, result integrity hashes, and `ABORTED` operations.
- Cross-sheet integrity audit for IDs, references, state projections, operation/history evidence, migration checksums, and required-item snapshots.
- Responsive Thai single-page shell with desktop sidebar, mobile bottom navigation, Noto Sans Thai design system, access/loading/offline states, confirmations, and toast feedback.
- Dashboard views for users and admins, including current metrics, latest loans, due-soon/overdue lists, and most-borrowed equipment.
- Searchable, filterable, sortable, paginated equipment catalog with card/table modes, detail view, included items, and admin equipment editor, status, and Drive-image workflows.
- Borrow request, My Borrow, personal history, return-request, account, and complete admin-center screens for borrowing, assets, users, categories, history, integrity audit, and durable operation recovery.
- Promise-based client API for all 32 guarded business RPCs, SPA history/deep links, optimistic row versions, field-level Thai errors, and session-backed stable command IDs for uncertain retries.
- Vendored, checksummed `qrcode-generator` 2.0.4 and `html5-qrcode` 2.3.8 distributions with license and third-party notices.
- Equipment QR display, canonical-link copy, and high-resolution PNG sticker download with level-Q correction and a four-module quiet zone.
- Mobile-first QR image capture/file scanning, strict canonical payload validation, manual Asset ID fallback, route cleanup, and exact-asset Admin borrowing handoff.
- Deterministic Node test harnesses for Apps Script services and source/security contracts, plus an offline Playwright HTML-service harness with responsive acceptance at 320, 768, and 1440 pixels.
- Automated coverage for the complete borrow/return lifecycle, double booking, permissions, overdue projection, duplicate IDs and business keys, setup/migration integrity, QR browser actions, Thai error states, and Admin scan handoff.
- Phase 7 step-by-step Google Workspace deployment guide covering the complete runtime inventory, Script Properties, first-admin bootstrap, authorization, Web app publication, User/Admin acceptance, stable-URL upgrades, rollback, backups, monitoring, quotas, and troubleshooting.
- Production sign-off guidance for the server-side OAuth callback, Workspace/Gmail OIDC verification, temporary-user-key binding, Drive image sharing, physical QR scanning, native mobile capture, deployed HTML-service behavior, and organization-owned evidence.
- Server-side OAuth 2.0/OpenID Connect Authorization Code flow using Apps Script `StateTokenBuilder`, exact `/usercallback` redirect, CSRF state, nonce, PKCE S256, one-time callback claims, and server-side code exchange.
- Backend Google ID-token verification against rotating JWKS, including signature, issuer, audience, authorized-party, time, nonce, subject, verified-email, Gmail, and Workspace hosted-domain checks; the ID token never enters browser application state.
- Opaque application sessions backed by hashed, expiring `ScriptCache` records and bound to verified identity, Users row, OAuth client, and temporary active-user key.
- Multi-domain configuration through `ALLOWED_DOMAINS` with backward-compatible `ALLOWED_DOMAIN` fallback and deployment-only `GOOGLE_OAUTH_CLIENT_ID`, `GOOGLE_OAUTH_CLIENT_SECRET`, `AUTH_FLOW_TTL_SECONDS`, and `AUTH_SESSION_TTL_SECONDS` Script Properties.
- Automated authentication coverage for Workspace and Gmail users, callback state/nonce/PKCE and replay handling, invalid domains, invalid/expired tokens and sessions, inactive accounts, isolation, logout, and role escalation attempts.
- Automated deployment-runbook contract that keeps all runtime filenames, configuration keys, and eleven required rollout steps synchronized with source.
- Setup preflight coverage for invalid image-sharing policy, inaccessible Drive folders, `/dev` URLs, and mismatched Web app deployments.

### Changed

- Upgraded the additive data contract to schema version 3 and expanded setup/repositories for the Operations sheet and batched multi-row writes.
- Made a pending borrow request an immediate hard hold and synchronized every workflow transition between Borrow and Equipment under the Script Lock.
- Drive image URLs retain resource keys when present and support only verified `DOMAIN_WITH_LINK` or `ANYONE_WITH_LINK` sharing.
- Admin/user dashboard links preserve route filters, equipment creation supports an admin deep link, and category mutations refresh the in-memory active-category reference list.
- Keep every sequential domain ID at its documented fixed width and fail atomically with `ID_EXHAUSTED` when its numeric range is full.
- Contain the six-tab Admin navigation in a horizontal scroll region on narrow screens.
- Emit a structured `SETUP_COMPLETED` execution-log event after successful setup so deployers can verify the target Sheet, created schema, request ID, and configuration warnings.
- Mark the seven-phase source as a release candidate while keeping live Workspace deployment and acceptance explicitly unsigned until the organization completes them.
- Restrict server QR bases to the canonical current Apps Script `/exec` deployment and reject development, redirect, external, credential-bearing, query/fragment, and mismatched deployment URLs.
- Preflight configured Drive folder access, image-sharing mode, and Web app URL before setup creates or migrates managed sheets; normalize Drive policy failures to `DRIVE_SHARING_FAILED`.
- Change the Web app topology from domain-only Session identity to `USER_DEPLOYING` + `ANYONE` (logged-in Google Accounts) while retaining private Sheet/Drive ACLs and stable versioned `/exec` upgrades.
- Make `setupSystem_` an editor-only private helper rather than a callable application RPC.

### Security

- Re-authorize every mutation from the current Users row inside the Script Lock; missing/invalid/expired sessions, disallowed domains, unknown/inactive users, and insufficient roles fail closed.
- Restrict first setup to configured allowlisted-domain admins and subsequent setup runs to currently active admins, with authorization checked inside the setup lock.
- Redact procurement, Drive file, active-workflow, and staff audit fields from non-admin equipment/borrowing responses.
- Escape dynamic client markup, allowlist routes/includes and Drive thumbnail URLs, gate admin routes in the client, and re-authorize every admin operation on the server.
- Prevent an active admin from changing the email of their own signed-in Users row, avoiding identity orphaning; another admin may perform the controlled change.
- Keep scan images local, reject external/malformed/ambiguous QR payloads, and avoid permission-sensitive live-camera APIs inside the Apps Script HTML-service sandbox.
- Remove the internal error constructor from the callable Apps Script surface by renaming it `AppError_`; automated contracts now fail if an unreviewed public server function appears.
- Freeze the production topology to an organization-controlled deployer, logged-in-account access (`ANYONE`, never `ANYONE_ANONYMOUS`), server-verified Google identity, private datastore ACLs, and a stable versioned `/exec` deployment.
- Pin the manifest to Drive, Sheets, deployer email, and `script.external_request` for Google token exchange/JWKS; document the exact `/usercallback` URI, temporary-user-key pilot, external-account image-link boundary, non-retroactive sharing, restricted project editors, and project-wide property rollback risk.
- Require exactly one active Users row and current server-side role for every request; verified Google identity never auto-provisions or grants application privilege.
- Cache Google's JWKS in its validated document shape while honoring `Cache-Control: max-age`/`Age`, including immediate no-cache responses; treat cache failures as non-fatal and reject unknown key IDs against a fresh key set without attacker-triggered refresh loops.
- Keep OAuth poll/session candidates in page memory during authorization; after activation persist only the opaque application token according to the user's remember choice, revoke it on sign-out, and require a fresh flow after rejection or expiry.
- Prohibit deployer-shared `UserProperties` as an auth/session store and prohibit ID, access, refresh, or application-session tokens in URLs.

[Unreleased]: https://github.com/v4r1n/crschaoyuem/commits/main
