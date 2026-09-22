# Migrating CRS Yuem-Kuen System Data

## Objective

ย้ายจาก Google Sheets ไป Supabase, PostgreSQL หรือ MySQL ในอนาคตโดยคง workflow, state enums, authorization policy, API DTO และ frontend behavior เดิม เปลี่ยนเฉพาะ repository/configuration และกลไก transaction

## Rules that make migration possible

- Domain services exchange plain objects and never depend on row numbers or Spreadsheet classes.
- Stable string primary/foreign keys are preserved across storage engines.
- Child collections use separate sheets/tables rather than comma-separated values.
- Business dates and UTC instants have explicit formats.
- Status values and transition rules are centralized, not inferred from display labels.
- User and asset labels required in historical reports are snapshotted on Borrow; History stores the entity ID and changed-field snapshot.
- Schema changes are additive, ordered, and recorded in SchemaMigrations.

## Relational mapping

Each Sheet maps one-to-one to a table: `Equipment -> equipment`, `Users -> users`, `Borrow -> borrows`, `Categories -> categories`, `IncludedItems -> included_items`, `BorrowItems -> borrow_items`, `History -> history`, `Operations -> operations`, `Settings -> settings`, `Sequences -> sequences`, and `SchemaMigrations -> schema_migrations`.

- Blank cells become `NULL` where allowed.
- ISO timestamps become `timestamptz`; `yyyy-MM-dd` becomes `date`.
- `changed_fields_json` becomes JSON/JSONB where supported.
- Concatenate `payload_json` + `payload_json_2` into one Operations JSON column; concatenate `result_json` through `result_json_4` likewise; `before_json` becomes JSON/JSONB. Preserve and verify both `payload_hash` and `result_hash` during import.
- `row_version` becomes an optimistic-lock integer.
- Add unique indexes on primary IDs, normalized user email, nonblank normalized serial number, borrow client request ID, and nonblank History operation ID.
- Add foreign keys after orphan/integrity checks pass.

Operations relational constraints require care:

- `actor_user_id` references `users.user_id`; optional `asset_id` references `equipment.asset_id`.
- `(entity_type, entity_id)` is polymorphic and should be enforced with application logic, a trigger, or separate nullable foreign-key columns in the target design.
- `resource_id` remains an opaque external Google Drive file ID unless files are migrated to a dedicated resource table.
- A journal-backed completed operation must have exactly one matching history row. Historical setup/system/legacy rows can have an operation ID without a corresponding Operations row, so add a strict History-to-Operations foreign key only after classifying or backfilling legacy data.
- Keep the unique operation row and stored result even when the target database supports real transactions; it remains the idempotency contract with browser retries.
- Preserve pending unique-value reservations for normalized equipment serial number, user email, and category name, or replace them with equivalent transactional unique indexes/advisory locks without weakening concurrent behavior.

## Google Sheets upgrade: migrations 001 → 002 → 003

Migration `002_operation_journal_and_required_items` upgrades schema version 1 to 2 by creating Operations and adding `is_required` to BorrowItems. Migration `003_operation_result_integrity_and_abort` upgrades version 2 to 3 by adding `result_hash`, backfilling hashes for valid completed results, and introducing terminal `ABORTED` semantics. Use this sequence:

1. Stop web-app mutations and export a backup of the spreadsheet, especially BorrowItems, IncludedItems, History, and SchemaMigrations.
2. Deploy source that contains all three immutable definitions; do not edit a recorded checksum.
3. Sign in with a configured Admin whose exact domain is in `ALLOWED_DOMAINS` (or legacy `ALLOWED_DOMAIN`) and run the private editor function `setupSystem_()` once. Its raw preflight validates every existing migration ID/checksum before locale, headers, formatting, protection, or data are changed.
4. Setup creates the missing Operations sheet and appends the missing BorrowItems header without reordering or deleting existing columns/rows.
5. Before recording 002, setup backfills blank BorrowItems `is_required` from the referenced IncludedItems definition. If the old snapshot points to a missing definition, it defaults to `true` as the fail-safe return rule.
6. Before recording 003, setup concatenates the existing result chunks of every `COMPLETED` operation, rejects invalid JSON, and backfills its SHA-256 Base64URL `result_hash`. `STARTED` rows remain pending and are not assigned a result hash.
7. Setup validates critical uniqueness, recovers sequences, updates Settings `schema_version` to `3`, and records migrations in order. Re-running setup is idempotent and skips each completed migration-specific backfill.
8. Run the integrity audit. Confirm all three migration rows, schema version 3, valid required flags and payload/result hashes, no orphan references, no duplicate active workflows, and no unexpected `STARTED` operations before reopening writes.

## Migration sequence

1. Freeze writes or place the app in maintenance mode.
2. Run the integrity audit and resolve duplicate IDs, active-loan conflicts, bad foreign keys, and equipment-status projections.
3. Export each Sheet as UTF-8 CSV without changing canonical values.
4. Load reference/parent tables, then Equipment, Borrow, child items, History, and Operations while preserving operation/history IDs and serialized before/result evidence.
5. Convert blanks/dates/JSON and add constraints/indexes.
6. Implement SQL repositories with the same method contracts and real database transactions. Preserve `STARTED|COMPLETED|ABORTED`, payload/result-hash matching, stored-result replay, safe abort evidence, and entity/asset pending guards even though domain rows and History can now commit atomically.
7. Run the same domain contract and workflow acceptance tests against the new repository.
8. Switch configuration, perform a smoke loan lifecycle, and retain the Sheet export as a read-only archive.

## Compatibility policy

Never change a canonical status value, ID, or API field silently. Introduce a schema migration and compatibility translation, document it in `docs/CHANGELOG.md`, then remove the translation only in a SemVer-major release.
