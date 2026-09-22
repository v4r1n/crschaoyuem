# CRS Yuem-Kuen System Workflows and State Contracts

## Booking model

V1 permits exactly one active workflow per physical asset. Submitting a request immediately holds the asset even when the requested borrow date is in the future. Date-range reservations, queues, recurring loans, and no-show expiry are outside V1.

## Canonical transitions

| Action | Borrow before → after | Equipment before → after | Actor |
|---|---|---|---|
| Request | none → `PENDING_APPROVAL` | `AVAILABLE` → `PENDING` | User/Admin |
| Approve | `PENDING_APPROVAL` → `APPROVED` | `PENDING` → `RESERVED` | Admin |
| Reject | `PENDING_APPROVAL` → `REJECTED` | `PENDING` → `AVAILABLE` | Admin |
| Checkout | `APPROVED` → `CHECKED_OUT` | `RESERVED` → `BORROWED` | Admin |
| Request return | `CHECKED_OUT` → `RETURN_REQUESTED` | `BORROWED` → `RETURNING` | Borrower/Admin |
| Direct inspected return | `CHECKED_OUT` → `RETURNED` | `BORROWED` → disposition | Admin |
| Inspected return | `RETURN_REQUESTED` → `RETURNED` | `RETURNING` → disposition | Admin |

Repeated or out-of-order transitions return `STATE_CONFLICT` and never append duplicate history.

## Return inspection

Condition describes what the admin observed; disposition controls the resulting Equipment status.

| Condition | Allowed disposition |
|---|---|
| `NORMAL` | `AVAILABLE` |
| `COSMETIC_DAMAGE` | `AVAILABLE`, `MAINTENANCE` |
| `DAMAGED` | `DAMAGED`, `MAINTENANCE` |
| `MISSING_ITEMS` | `DAMAGED`, `MAINTENANCE` |
| `LOST` | `LOST` |

Abnormal returns require a note. At checkout, BorrowItems snapshots `item_name`, `expected_quantity`, and `is_required` from the active IncludedItems definitions; later definition changes do not rewrite an existing loan.

Return inspection must submit every snapshot row and an explicit returned quantity from zero through the expected quantity. The rules distinguish all-item completeness from required-item completeness:

- any incomplete required item prevents `AVAILABLE` disposition and requires condition `MISSING_ITEMS` or `LOST`
- an incomplete optional item is still recorded but does not by itself block `AVAILABLE` or force a missing-item condition
- `MISSING_ITEMS` is invalid when every snapshot item is complete
- the condition/disposition matrix above and the abnormal-note requirement still apply after checklist validation

## Overdue

`is_overdue = today(Asia/Bangkok) > due_date AND borrow.status IN (CHECKED_OUT, RETURN_REQUESTED)`

Due today is not overdue. `OVERDUE` is an effective UI badge/filter and does not replace the persisted Borrow or Equipment status.

## Manual equipment status changes

Admin may change an asset with no active borrow among operational states `AVAILABLE`, `MAINTENANCE`, `DAMAGED`, `LOST`, and `RETIRED`. Admin may not manually set `PENDING`, `RESERVED`, `BORROWED`, or `RETURNING`; those belong to BorrowService. Every correction is audited.

## Concurrency and idempotency

All availability checks and transitions are re-evaluated inside a Script Lock. A new request fails if either Equipment is not `AVAILABLE` or any active Borrow row exists. Browser mutations send a command/request ID and are journaled in Operations.

A new mutation first writes `STARTED` with normalized payload/hash and authoritative before-state. It then writes or resumes exact domain target rows, guarantees exactly one History row for the command, flushes those facts, stores the result/hash, and marks the operation `COMPLETED`. Return commands also persist a hash of immutable BorrowItems definitions and accept every evidence row only at blank source or exact inspected target. Retry verifies the persisted payload or result hash before use. A completed command returns the stored result; a started command replays only missing steps when each affected row is still at the recorded source or expected target version. Any unrelated later change returns `STATE_CONFLICT`.

Only the same command specification may resume an operation. A different command is rejected while a `STARTED` row exists for the same `(entity_type, entity_id)` or the same `asset_id`; the asset-level guard also protects create/request flows before an entity ID has been allocated. Pending payloads additionally reserve normalized nonblank equipment serial numbers, user emails, and category names across relevant create/edit/auto-provision actions. These conflicts return `OPERATION_PENDING` rather than risking a second workflow or duplicate business key. An administrator may use the original command and payload for controlled reconciliation, but must not edit Operations or History rows directly.

An image operation that has not changed Equipment may be terminally `ABORTED` by an admin with a recorded reason. The abort endpoint is idempotent for the same reason, refuses operations with domain/History divergence, trashes reachable operation-owned image files, and records an orphan-cleanup warning if the pinned Drive folder is no longer accessible. `ABORTED` commands cannot be replayed with the old command ID.

## QR workflow

Canonical link shape is `WEB_APP_EXEC_URL?view=equipment-detail&id=AST-000001`; `?id=` alone is also accepted. The scanner validates an Asset ID or same-app URL and routes to details. It never opens arbitrary scanned URLs and never approves/checks out/returns automatically.
