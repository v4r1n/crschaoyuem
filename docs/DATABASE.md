# CRS Yuem-Kuen System — Google Sheets Database Schema

Current additive contract is schema version `3`, consisting of immutable migrations `001_initial_schema`, `002_operation_journal_and_required_items`, and `003_operation_result_integrity_and_abort`.

## Storage conventions

- Header เป็น `snake_case` และใช้เป็น contract; ห้ามอิงตำแหน่งคอลัมน์จากเลขคงที่
- ID เป็น string ที่คงที่และไม่ reuse แม้รายการเดิมถูกยกเลิก
- instant เก็บ ISO-8601 UTC; business date เก็บ `yyyy-MM-dd`; timezone ธุรกิจคือ `Asia/Bangkok`
- blank ย้ายเป็น SQL `NULL` ได้; enum ใช้ค่าอังกฤษ; ชื่อผู้ใช้/หน่วยงานที่ต้องรักษาประวัติใช้ snapshot
- Equipment หนึ่งแถวเท่ากับหนึ่ง physical asset และ `quantity` ต้องเป็น `1`

## Sheets

### Equipment

Primary key: `asset_id`. Headers:

`asset_id, sku, name, category_id, brand, model, serial_number, specification, description, quantity, purchase_date, purchase_price, department, location, status, active_borrow_id, image_file_id, image_url, qr_url, note, created_at, created_by, updated_at, updated_by, row_version`

Nonblank serial numbers are globally unique after trim/lowercase normalization. `qr_url` is a derived cache, never authority. Workflow states are changed only by BorrowService.

### Users

Primary key: `user_id`. Headers:

`user_id, email, name, department, role, status, last_login_at, created_at, created_by, updated_at, updated_by, row_version`

Email is unique and lowercase. Role is `USER|ADMIN`; status is `ACTIVE|INACTIVE`. The last active admin cannot be demoted or deactivated.

### Borrow

Primary key: `borrow_id`. Headers:

`borrow_id, client_request_id, user_id, user_email, user_name, user_department, asset_id, asset_name, asset_sku, borrow_date, due_date, purpose, status, requested_at, approved_by, approved_at, rejected_by, rejected_at, rejection_reason, checkout_by, checkout_at, return_requested_by, return_requested_at, returned_by, return_at, return_condition, return_disposition, return_note, note, created_at, updated_at, row_version`

`client_request_id` makes request retries idempotent. Asset name/SKU and user fields are snapshots for stable history. Overdue is derived when local today is later than `due_date` and status is `CHECKED_OUT` or `RETURN_REQUESTED`.

### Categories

Primary key: `category_id`. Headers:

`category_id, category_name, prefix, status, sort_order, created_at, created_by, updated_at, updated_by, row_version`

Prefix is SKU metadata only; Asset IDs remain globally sequential.

### IncludedItems

Primary key: `item_id`; foreign key: `asset_id`. Headers:

`item_id, asset_id, item_name, quantity, is_required, status, sort_order, note, created_at, created_by, updated_at, updated_by`

Rows are definitions for future checkouts. Existing borrow snapshots are not rewritten when these definitions change.

### BorrowItems

Primary key: `borrow_item_id`; foreign keys: `borrow_id`, `item_id`. Headers:

`borrow_item_id, borrow_id, item_id, item_name, expected_quantity, is_required, returned_quantity, is_complete, condition, note, checked_by, checked_at`

This is the immutable-per-loan checklist snapshot and return evidence. `is_required` is copied from IncludedItems at checkout, so later edits to the definition never change the return rule of an existing loan.

### History

Primary key: `log_id`. Headers:

`log_id, timestamp, actor_user_id, user_email, entity_type, entity_id, asset_id, borrow_id, action, old_status, new_status, note, changed_fields_json, operation_id`

Append-only audit for assets, borrows, users, categories, setup, and repairs.

### Operations

Primary key: `operation_id`. Headers:

`operation_id, action, entity_type, entity_id, asset_id, resource_id, actor_user_id, actor_email, payload_hash, payload_json, payload_json_2, before_json, result_json, result_json_2, result_json_3, result_json_4, result_hash, status, started_at, completed_at, updated_at`

Durable idempotency journal for mutations. `operation_id` is an idempotency key—normally the browser command ID and, for auto-provision, a deterministic system key—not a sequential ID. Status is `STARTED|COMPLETED|ABORTED`. The row stores the normalized action/entity/asset, actor snapshot, replay payload and SHA-256 Base64URL `payload_hash`, authoritative before-state, optional external resource ID, and a terminal result plus `result_hash`. Payload and result are split into bounded text chunks to stay within a safe Sheet-cell payload size; both hashes are verified whenever stored JSON is consumed.

For create commands, `entity_id` may initially be blank and is filled immediately after allocating the domain ID. `asset_id` provides a stable contention key for asset workflows even before a Borrow ID exists. `resource_id` records a Google Drive file created by an image operation so a retry can reuse or safely reconcile that resource.

Relational meaning:

- `actor_user_id -> Users.user_id`
- `asset_id -> Equipment.asset_id` when nonblank
- `(entity_type, entity_id)` is an application-enforced polymorphic reference to Equipment, Borrow, Users, or Categories
- a `COMPLETED` journal-backed operation owns exactly one matching History row with the same `operation_id`; a safely `ABORTED` image operation has no domain mutation and no History row; legacy/setup/system history may legitimately have no Operations row

Operations is not append-only: a domain service may bind `entity_id`/`resource_id` and change the same row from `STARTED` to terminal `COMPLETED` or `ABORTED`. `ABORTED` is available only through the guarded admin abort use case for an image operation whose Equipment still exactly matches before-state and whose partial Drive resources are trashed when accessible. It has no generic browser CRUD endpoint and must never be edited directly.

While status is `STARTED`, the row also acts as a reservation. Besides entity and asset guards, action-specific payload values reserve normalized nonblank equipment serial numbers, user emails (including auto-provision), and category names. A competing command receives `OPERATION_PENDING` until the original operation is resumed or reconciled.

### Settings

Primary key: `setting_key`. Headers:

`setting_key, setting_value, description, updated_at, updated_by`

Includes schema version, application version, and timezone. Secrets and deployment IDs remain in Script Properties rather than cells.

### Sequences

Primary key: `sequence_name`. Headers:

`sequence_name, prefix, padding, next_value, updated_at`

Allocation occurs only under Script Lock. Gaps are valid and IDs are never decremented/reused. Padding is a fixed contract, not a minimum width: six-digit sequences stop at `999999` and Category stops at `999`. If a requested allocation would cross that boundary or only colliding IDs remain at the boundary, the whole allocation fails without advancing `next_value` and returns `ID_EXHAUSTED`.

### SchemaMigrations

Primary key: `migration_id`. Headers:

`migration_id, description, checksum, applied_at, applied_by`

Records ordered, additive, idempotent schema changes.

## ID formats

| Entity | Format |
|---|---|
| Equipment | `AST-000001` |
| Borrow | `BR-000001` |
| User | `USR-000001` |
| Category | `CAT-001` |
| Included item | `ITM-000001` |
| Borrow item | `BIT-000001` |
| History | `LOG-000001` |
| Operation | Browser command ID matching `[A-Za-z0-9_-]{8,100}` |

## Direct Sheet editing

Transaction sheets are a protected datastore. Direct changes bypass validation, authorization, locking, and history; routine administration must use the web UI. History and Operations are execution evidence and must never be edited manually. Controlled edits to initial configuration/reference data are permitted only during setup and must be followed by the integrity audit.
