# CRS Yuem-Kuen System Architectural Decisions

Decisions are append-only. A later decision may supersede an earlier one but must not erase it.

## ADR-001 — Google Workspace serverless stack

Status: Accepted — 2026-08-21

Use Apps Script HTML Service, Google Sheets, and Google Drive so the organization needs no VPS or paid database. Accept Apps Script quotas and Sheets transaction limitations for the 1,000–5,000 asset V1 scope.

## ADR-002 — Single SPA with server includes

Status: Accepted — 2026-08-21

Serve one HTML shell and include separated view/style/script partials. This provides maintainable files while fitting Apps Script HTML Service. Use Apps Script history/location APIs for routes and QR deep links.

## ADR-003 — One row per physical asset

Status: Accepted — 2026-08-21

An Asset ID identifies one physical unit, so Equipment `quantity` is retained only for source-spec compatibility and must equal 1. Several units may share an SKU but receive separate Asset IDs.

## ADR-004 — Single active borrowing workflow

Status: Accepted — 2026-08-21

V1 allows one open Borrow record per asset. A request immediately changes Equipment from Available to Pending; approval changes it to Reserved. This simple hard-hold model avoids partially implementing calendar reservations and matches the rule that non-Available assets cannot be requested.

## ADR-005 — BorrowService owns workflow states

Status: Accepted — 2026-08-21

Borrow is the evidence of the active transaction and Equipment holds a synchronized operational projection. Only BorrowService may set Pending, Reserved, Borrowed, or Returning. All transitions occur under Script Lock and validate both records.

## ADR-006 — Overdue is derived

Status: Accepted — 2026-08-21

Overdue does not replace Borrow or Equipment status. It is calculated from the Asia/Bangkok business date for Checked Out/Return Requested records, preserving the actual workflow state and avoiding a stale scheduled update.

## ADR-007 — Return condition and disposition are separate

Status: Accepted — 2026-08-21

The observed return condition does not always determine whether the asset is Available, Damaged, under Maintenance, or Lost. Admin submits both values within a validated matrix, with a required note for abnormal returns and a snapshot checklist of included items.

## ADR-008 — Same-domain identity, fail closed

Status: Accepted — 2026-08-21

V1 uses the active Google Workspace user email and domain-restricted deployment. Blank, external, unknown, or inactive identities are denied. EffectiveUser is not accepted as the visitor because execute-as-owner deployments would make it the deployer.

## ADR-009 — Header-based repository boundary

Status: Accepted — 2026-08-21

Only repositories call Spreadsheet services. Records are keyed by stable header names and exchanged as plain objects. This supports bulk access now and repository replacement by SQL later without changing workflow or UI contracts.

## ADR-010 — Derived QR URL and stable deployment

Status: Accepted — 2026-08-21

QR encodes a canonical HTTPS equipment-detail URL derived from configured/current `/exec` base plus Asset ID. The `qr_url` column is a refreshable cache only. Reusing the same Apps Script deployment keeps printed stickers valid.

## ADR-011 — Immutable, additive schema migrations

Status: Accepted — 2026-08-21

Each migration ID owns a frozen SHA-256 checksum that never depends on the future current schema. Setup validates all already-recorded migrations through a minimal raw read before changing spreadsheet locale, headers, formatting, protection, sequences, or seed data. Future schema changes add a new migration definition instead of changing `001_initial_schema`.

## ADR-012 — Durable operation journal and resumable mutations

Status: Accepted — 2026-08-21

Google Sheets cannot atomically commit several domain rows, History, and a Google Drive resource. Every command-backed state-changing RPC (and deterministic auto-provision command) therefore owns one Operations row keyed by its idempotency key. The success protocol is `STARTED → domain rows → exactly-one History → flush → stored result/COMPLETED`; the journal retains normalized action/entity/asset, original actor/time, hashed replay payload, authoritative before-state, optional external resource ID, and a hashed client result. Payload and result hashes are verified before replay.

A retry with the same specification returns the stored completed result or resumes a started operation only when affected rows still match the recorded source or exact expected target state/version. A different started command for the same entity or asset is rejected with `OPERATION_PENDING`, including asset-first create flows whose entity ID is not allocated yet. Started payloads also reserve normalized serial numbers, user emails, and category names across relevant mutations so cross-entity uniqueness cannot race. Diverged state fails closed for audited reconciliation rather than guessing or repeating writes.

Image upload additionally permits guarded terminal `ABORTED` only while Equipment remains at exact before-state and no matching History exists. Reachable partial image files are moved to Trash and an inaccessible pinned folder produces explicit orphan-cleanup evidence. This releases an otherwise permanent asset reservation without pretending a domain mutation succeeded; the old command ID remains terminal.

This adds storage and recovery complexity, and payload/result text must be split into bounded Sheet cells, but it closes the crash window where domain rows could persist without History or a stable retry result. Operations has no generic CRUD endpoint and is retained as evidence; it is not a replacement for History or for the Borrow source-of-truth model.

## ADR-013 — Client-side SPA routing and stable retry commands

Status: Accepted — 2026-08-27

The browser uses one Apps Script HTML-service shell with allowlisted partials and routes. `google.script.history`/`google.script.url` preserve navigation and Asset deep links without full reloads; each renderer owns a view token so late asynchronous responses cannot overwrite a newer route. Admin visibility is a usability gate only—every RPC remains server-authorized.

Every browser mutation stores a command ID, payload fingerprint, and uncertainty flag in `sessionStorage` before calling `google.script.run`. A definite pre-start validation/authorization error clears the entry; success clears it; an uncertain transport or server result locks the exact payload to the same command ID so a retry cannot create a second operation. The server Operations journal remains authoritative and Admin reconciliation handles commands that cannot be resolved safely in the originating browser session.

## ADR-014 — Vendored QR generation and image-capture scanning

Status: Accepted — 2026-08-28

V1 vendors exact browser distributions of `qrcode-generator` 2.0.4 and `html5-qrcode` 2.3.8 with checksums and license notices. QR symbols use error-correction level Q, an integer-pixel matrix, and a four-module quiet zone. The encoded value is only the canonical HTTPS Equipment Detail URL; it carries no identity, authorization, borrow command, or secret.

Apps Script HTML Service restricts permission-sensitive `navigator.mediaDevices.getUserMedia()` use inside its sandbox. The in-app scanner therefore calls only `html5-qrcode.scanFile()` against a user-selected image; `capture="environment"` lets supported mobile browsers offer their native camera while manual Asset ID remains available. The application does not call the library's live-camera APIs. A future continuous preview requires a separately hosted HTTPS scanner and a new reviewed trust boundary.

Decoded content is untrusted. The client accepts only an exact Asset ID or an HTTPS URL whose origin and path equal `bootstrap.app.webAppUrl`, whose optional view is `equipment-detail`, and whose sole ID matches `AST-000001`. Valid scans navigate internally and never execute a decoded URL or mutation. Admin scan follow-up passes an exact `assetId` to the already-authorized borrowing query and reuses confirmation-based workflows.

## ADR-015 — Deterministic local acceptance and explicit deployment acceptance

Status: Accepted — 2026-08-30

Phase 6 uses three complementary local layers. Node source contracts compile every Apps Script and browser partial and freeze security-sensitive registries and formats. Backend tests execute the real repositories and domain services against faithful in-memory doubles for the Apps Script services needed by the tested workflows. Playwright assembles the real HTML-service includes, substitutes deterministic test-only Bootstrap and `google.script.run` adapters, and verifies UI behavior and responsive containment without a deployed URL.

These doubles are test infrastructure only and are never included in `src/` or the Apps Script deployment. They provide reproducible workflow and regression evidence but cannot establish live Google Workspace identity, authorization prompts, quotas, Drive sharing, HTML-service sandbox behavior, or native mobile capture. Those boundaries remain an explicit Phase 7 deployment matrix instead of being represented by misleading local mocks.

## ADR-016 — Owner-executed, domain-only versioned deployment

Status: Accepted — 2026-08-31

Production uses a versioned Web app that executes as a long-lived organization-controlled Workspace deployer (`USER_DEPLOYING`) and is accessible only to that Workspace domain (`DOMAIN`). The deployer owns or can edit the configured Sheet and Drive folder; ordinary application users receive no direct datastore access at any role. Apps Script editors are approved release operators because they can change project-wide properties immediately. The manifest pins the exact Drive, Sheets, and user-email scopes required by source.

`DOMAIN_WITH_LINK` is the default image policy, while `ANYONE_WITH_LINK` requires an explicit organization risk decision. This means any same-domain link holder can read an equipment image even without an active Users row; images must be classified for that audience. Sharing-property changes are not retroactive, and replaced files are retained until an evidence-aware storage reconciliation is performed.

Because Google does not guarantee that Active User email is available in every execution context, rollout requires a second-account same-domain identity pilot. A blank or incorrect visitor identity stops rollout; it must not be worked around with EffectiveUser, anonymous/public access, or client-supplied identity. Changing to execute-as-user would require each visitor to authorize and access the underlying resources, so it is a new security architecture rather than a deployment toggle.

Releases edit the existing deployment to point to a new immutable Apps Script version. This preserves the deployment ID and `/exec` URL used by printed QR stickers. Only a canonical `https://script.google.com/macros/s/.../exec` URL matching the service-reported deployment may become the QR base; `/dev`, redirect hosts, arbitrary HTTPS origins, and different deployments fail closed.

The deployer account and deployment record are operational dependencies: versioned deployment ownership is not assumed to transfer safely when an employee account is removed. Code/manifest versions do not snapshot project-wide Script Properties or datastore state, so rollback also requires a separately controlled property baseline and schema compatibility review.

## ADR-017 — Verified Google ID tokens for multi-domain accounts

Status: Accepted — 2026-09-01

This decision supersedes the visitor-identity and domain-access portions of ADR-008 and ADR-016; their datastore isolation, versioned deployment, stable URL, and operational ownership decisions remain in force.

The browser uses Google Identity Services with an organization-controlled Web OAuth Client ID and passes the returned ID token as the first argument of every application RPC. The backend validates the RS256 signature against Google's rotating JWKS, issuer, audience/authorized party, issued/not-before/expiry times, subject, verified email, and authoritative-email rule before looking up authorization. It never treats `Session.getActiveUser()`, `Session.getEffectiveUser()`, a decoded-but-unverified JWT, or a browser-supplied email/role as visitor identity. Missing, malformed, invalid, expired, or wrongly-audienced tokens fail closed.

`ALLOWED_DOMAINS` is an exact comma-separated allowlist and takes precedence when non-empty; deployments that have not migrated retain compatibility through the singular `ALLOWED_DOMAIN` fallback. Gmail is accepted only for `@gmail.com` with `email_verified=true`. A Workspace/non-Gmail identity additionally requires an `hd` claim equal to the email domain. No subdomain, alias, consumer account using a third-party address, or other domain is implied. Verified identity is necessary but insufficient: exactly one matching Users row must exist and be `ACTIVE`, and each Admin action rechecks the current `ADMIN` role. Visitor auto-provisioning is disabled.

The versioned Web app continues to execute as the organization-controlled deployer (`USER_DEPLOYING`) so visitors receive no direct Sheet or Drive permission. Its access changes from `DOMAIN` to `ANYONE`, which Apps Script defines as any logged-in Google user; `ANYONE_ANONYMOUS` is prohibited. This Google login gate does not replace application authentication or authorization, and every RPC still requires a valid ID token.

The manifest adds `script.external_request` solely so the backend can retrieve Google's rotating signing keys. `GOOGLE_OAUTH_CLIENT_ID` is a Script Property and is never committed with credentials or resource IDs. The GIS client requests only basic sign-in identity; the deployer's Apps Script Drive/Sheets authorization is a separate trust boundary.

Apps Script HTML Service renders active client code inside a sandboxed iframe, while a Google Web OAuth Client accepts exact Authorized JavaScript origins without wildcards. Production rollout must therefore observe and register the exact iframe origin used by the `/exec` deployment and test it with both Workspace and Gmail identities across supported browser/device profiles. If that origin is not stable or cannot be registered, rollout stops; moving the sign-in surface to a stable organization-controlled origin requires a new architecture review.

Image authorization remains independent of app authorization. `DOMAIN_WITH_LINK` cannot serve external Gmail users and is broader than the Users sheet for same-domain link holders. `ANYONE_WITH_LINK` supports external viewers but makes the image readable by anyone with its URL, without an ID token or Users row, so it requires explicit data-classification approval. Neither sharing change applies retroactively to existing files.

For backward compatibility, application authorization remains keyed by the verified email stored in Users; the verified Google `sub` is checked for presence but is not persisted in schema v3. An organization that renames or reassigns an email address must inactivate/review the old Users row before the new account can sign in. Persisting and binding `google_sub` requires an additive migration and explicit first-bind/recovery policy, and is reserved as a future hardening decision.

## ADR-018 — Server-side OAuth/OIDC authorization-code flow

Status: Accepted — 2026-09-04

This decision supersedes the GIS-in-iframe and per-RPC Google-ID-token portions of ADR-017. ADR-017's exact domain rules, verified-email/hosted-domain requirements, explicit Active Users-row authorization, role checks, disabled auto-provisioning, `USER_DEPLOYING` + `ANYONE` topology, private datastore ACLs, and image boundary remain in force.

Google does not accept the transient `*.googleusercontent.com` HTML-service iframe host as an Authorized JavaScript Origin. The SPA therefore does not load or initialize Google Identity Services JavaScript. A user gesture opens Google's authorization endpoint and uses the OAuth 2.0/OpenID Connect Authorization Code flow with an organization-controlled **Web application** client. Its exact redirect is `https://script.google.com/macros/d/{SCRIPT_ID}/usercallback`; no Authorized JavaScript Origin is required. Apps Script `StateTokenBuilder` supplies signed/encrypted, expiring CSRF state and dispatches a private callback; the request also carries an OIDC nonce and PKCE S256 challenge. The callback atomically claims the one-time flow, posts the code, client ID, client secret, redirect URI, and verifier to Google's token endpoint, then verifies the returned ID token signature, issuer, audience/authorized party, times, nonce, subject, verified email, and authoritative-domain rule. ID/access/application-session tokens are never placed in a URL; the callback URL contains only Google's one-time authorization code protected by state and PKCE.

The browser generates independent high-entropy polling and candidate-session secrets with Web Crypto and sends only their hashes when beginning a flow. It retains raw secrets only in page memory, polls the result through `google.script.run`, and after authorization uses its opaque session secret as the first argument to every business RPC. Reloading, signing out, expiry, or cache eviction requires a fresh sign-in. Auth/session secrets are not stored in cookies, `localStorage`, `sessionStorage`, Sheet, Drive, Script Properties, or logs.

Pending flows, callback claims, and application sessions live only in `ScriptCache` beneath hashes of unguessable secrets and are consumed or expire closed under `ScriptLock`. `UserProperties` is prohibited: with an execute-as-deployer Web app it may represent a shared deployer context rather than isolated visitors. A session is bounded by the configured TTL and verified ID-token expiry, and binds the verified Google `sub`, email, Users-row ID, OAuth client, and `Session.getTemporaryActiveUserKey()` hash. The temporary key is only a secondary same-visitor context binding—not identity or authorization—and every business RPC still re-reads the exact Users row/status/role. Because callback and opener must receive the same temporary key, production promotion requires a temporary deployment pilot with separate Workspace and Gmail browser profiles; a missing or inconsistent key stops rollout rather than falling back to ActiveUser, EffectiveUser, client identity, or anonymous access.

`GOOGLE_OAUTH_CLIENT_ID` and `GOOGLE_OAUTH_CLIENT_SECRET` are Script Properties and must never be committed. `AUTH_FLOW_TTL_SECONDS` and `AUTH_SESSION_TTL_SECONDS` are bounded tuning properties. `script.external_request` now supports both the server-side token POST and rotating JWKS fetch. Cache eviction is an availability event, not an authorization bypass: requests fail closed and the user signs in again.

## ADR-019 — Pilot /exec callback with explicit browser confirmation

Accepted for pilot: supersedes ADR-018's /usercallback/StateTokenBuilder transport and cross-callback temporary-key equality. Runtime evidence showed polling executions but no callback execution and a platform authorization error. doGet now routes opaque-state authorization responses on the configured exact Pilot /exec URL. State is one-time, server-side and TTL-bound; PKCE, nonce and ID-token validation remain. Callback creates only a pending identity candidate and displays a high-entropy one-time confirmation code. Session activation requires the user to paste that code into the original tab, together with its independent poll/session proofs. Automatic polling cannot activate a victim's session for an attacker who started the flow. Never share confirmation codes; actively relaying one to an attacker remains a phishing risk. Tests must explicitly use different callback contexts and prevent activation without handoff proof. Production remains unchanged pending live Workspace/Gmail acceptance.

## ADR-020 — Rate-limited six-digit OAuth confirmation OTP

Status: Accepted for Pilot — 2026-09-22

ADR-019's explicit callback-to-original-tab confirmation remains, but the user-facing proof is now a six-digit numeric OTP. The server derives OTP entropy with HMAC-SHA256 keyed by the confidential OAuth client secret and rejection sampling; `Math.random()` is prohibited. Cache stores only a keyed OTP HMAC bound to the exact flow, visitor binding, poll proof, and candidate-session proof. Plaintext exists only long enough to render the callback page.

The OTP expires after 300 seconds, allows at most five failed submissions, is deleted before session activation, and cannot be replayed. A valid OTP alone is insufficient: the original browser must also present both independent in-memory proofs. State, nonce, PKCE, Google ID-token verification, exact Users/ACTIVE/Role authorization, current-user rechecks, and per-visitor session isolation remain unchanged. Production promotion remains blocked until Pilot YRU/Gmail acceptance passes.
