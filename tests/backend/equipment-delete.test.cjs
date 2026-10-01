'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { bootstrappedHarness, createEquipment, createUser, createBorrowRequest,
  expectOk, expectError } = require('./test-helpers.cjs');

function command(equipment, overrides = {}) {
  return { command_id: 'delete-equipment-001', asset_id: equipment.asset_id,
    expected_version: equipment.row_version, confirm: true,
    confirm_asset_id: equipment.asset_id, ...overrides };
}

test('delete hides equipment from the catalog and dashboard while retaining its records and audit', () => {
  const h = bootstrappedHarness();
  const e = createEquipment(h);
  const items = h.records('IncludedItems').length;
  const result = expectOk(h.invoke('adminDeleteEquipment', command(e)));
  assert.equal(result.status, 'DELETED');
  assert.equal(result.row_version, e.row_version + 1);
  assert.equal(h.records('Equipment').length, 1);
  assert.equal(h.records('IncludedItems').length, items);
  assert.equal(h.records('History').filter(x => x.action === 'DELETE_ASSET').length, 1);
  assert.equal(expectOk(h.invoke('listEquipment', {})).items.length, 0);
  assert.equal(expectOk(h.invoke('adminGetDashboard')).metrics.total, 0);
  assert.equal(expectOk(h.invoke('getEquipmentDetail', e.asset_id)).status, 'DELETED');
  assert.equal(expectOk(h.invoke('listEquipment', { status: 'DELETED' })).items.length, 1);
  const user = createUser(h);
  h.setActiveEmail(user.email);
  expectError(h.invoke('getEquipmentDetail', e.asset_id), 'NOT_FOUND');
  assert.equal(expectOk(h.invoke('listEquipment', { status: 'DELETED' })).items.length, 0);
  expectError(h.invoke('createBorrowRequest', { command_id: 'borrow-deleted-001',
    asset_id: e.asset_id, borrow_date: '2000-01-01', due_date: '2000-01-02', purpose: 'Test' }), 'RESERVATION_CONFLICT');
});

test('delete requires current ADMIN authorization, typed asset confirmation and a current row version', () => {
  const h = bootstrappedHarness();
  const e = createEquipment(h);
  expectError(h.invoke('adminDeleteEquipment', command(e, { confirm: false })), 'VALIDATION_FAILED');
  expectError(h.invoke('adminDeleteEquipment', command(e, { confirm_asset_id: 'AST-999999' })), 'VALIDATION_FAILED');
  expectError(h.invoke('adminDeleteEquipment', command(e, { expected_version: 99 })), 'STATE_CONFLICT');
  const user = createUser(h);
  h.setActiveEmail(user.email);
  expectError(h.invoke('adminDeleteEquipment', command(e)), 'FORBIDDEN');
  assert.equal(h.find('Equipment', 'asset_id', e.asset_id).status, 'AVAILABLE');
});

test('delete refuses active borrowing and unfinished operations', () => {
  const h = bootstrappedHarness();
  const e = createEquipment(h);
  createBorrowRequest(h, e.asset_id);
  const current = expectOk(h.invoke('getEquipmentDetail', e.asset_id));
  expectError(h.invoke('adminDeleteEquipment', command(current)), 'STATE_CONFLICT');
  const other = createEquipment(h, { suffix: 'pending-delete' });
  const actor = h.invoke('requireAdmin_', h.state.sessionToken);
  h.invoke('startOperationLocked_', h.invoke('operationSpec_', 'pending-upload-delete-001',
    'UPLOAD_ASSET_IMAGE', 'EQUIPMENT', other.asset_id, {}, actor),
    h.find('Equipment', 'asset_id', other.asset_id));
  expectError(h.invoke('adminDeleteEquipment', command(other)), 'OPERATION_PENDING');
});

test('delete retries are idempotent and deleted equipment rejects further edits and status changes', () => {
  const h = bootstrappedHarness();
  const e = createEquipment(h);
  const deleted = expectOk(h.invoke('adminDeleteEquipment', command(e)));
  expectOk(h.invoke('adminDeleteEquipment', command(e)));
  assert.equal(h.records('History').filter(x => x.action === 'DELETE_ASSET').length, 1);
  expectError(h.invoke('adminUpdateEquipment', { ...e, command_id: 'edit-deleted-001',
    expected_version: deleted.row_version }), 'STATE_CONFLICT');
  expectError(h.invoke('adminChangeEquipmentStatus', { asset_id: e.asset_id,
    command_id: 'reactivate-deleted-001', expected_version: deleted.row_version, status: 'AVAILABLE' }), 'STATE_CONFLICT');
  h.properties.setProperty('DRIVE_FOLDER_ID', 'test-image-folder');
  expectError(h.invoke('adminUploadEquipmentImage', { asset_id: e.asset_id,
    command_id: 'upload-deleted-001', expected_version: deleted.row_version,
    mime_type: 'image/gif', base64_data: 'R0lGODlhAQABAAD/ACwAAAAAAQABAAACAUwAOw==' }), 'STATE_CONFLICT');
  const audit = expectOk(h.invoke('adminRunIntegrityAudit'));
  assert.equal(audit.summary.errors, 0);
});

test('delete interrupted after the Equipment write resumes without losing or duplicating History', () => {
  const h = bootstrappedHarness();
  const e = createEquipment(h);
  const original = h.context.ensureOperationHistoryLocked_;
  let fail = true;
  h.context.ensureOperationHistoryLocked_ = (entry, actor) => {
    if (entry.action === 'DELETE_ASSET' && fail) {
      fail = false;
      throw new Error('History write interrupted');
    }
    return original(entry, actor);
  };
  expectError(h.invoke('adminDeleteEquipment', command(e)), 'INTERNAL');
  assert.equal(h.find('Equipment', 'asset_id', e.asset_id).status, 'DELETED');
  const repaired = expectOk(h.invoke('adminReconcileOperation', 'delete-equipment-001'));
  assert.equal(repaired.status, 'COMPLETED');
  expectOk(h.invoke('adminDeleteEquipment', command(e)));
  assert.equal(h.records('History').filter(x => x.action === 'DELETE_ASSET').length, 1);
  assert.equal(h.find('Equipment', 'asset_id', e.asset_id).row_version, 2);
});
