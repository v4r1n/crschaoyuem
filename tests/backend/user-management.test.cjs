'use strict';
const assert = require('node:assert/strict');
const test = require('node:test');
const { bootstrappedHarness, createUser, expectOk, expectError } = require('./test-helpers.cjs');

function pilot() {
  return bootstrappedHarness({ properties: { ALLOWED_DOMAINS: 'example.com,yru.ac.th,gmail.com', AUTO_PROVISION_USERS: 'false' } });
}
function payload(email, command = 'create-gmail-user') {
  return { command_id: command, email, name: 'Gmail user', department: '', role: 'USER', status: 'ACTIVE' };
}
function edit(h, user, overrides = {}) {
  const listed = expectOk(h.invoke('adminListUsers', {})).items.find(row => row.user_id === user.user_id);
  return { ...payload(user.email, 'edit-gmail-user'), user_id: user.user_id,
    expected_version: user.row_version, edit_proof: listed.edit_proof, ...overrides };
}
function legacy(h, id = 'old-user', email = 'legacy@gmail.com') {
  const template = h.find('Users', 'user_id', 'USR-000001');
  const row = { ...template, user_id: id, email, role: 'USER', name: 'Legacy', row_version: 1 };
  delete row.__rowNumber;
  h.invoke('insertRecord_', 'Users', row);
  return expectOk(h.invoke('adminAuditLegacyUsers')).candidates.find(item => item.email === email);
}
function repair(h, candidate, extra = {}) {
  return h.invoke('adminRepairLegacyUser', { row: candidate.row, fingerprint: candidate.fingerprint,
    confirm: true, command_id: 'repair-legacy-user', ...extra });
}

test('Gmail create generates sequential IDs under lock and rejects browser IDs', () => {
  const h = pilot();
  const locks = h.scriptLock.acquireCount;
  const first = expectOk(h.invoke('adminCreateUser', payload(' First@GMAIL.com ')));
  const second = expectOk(h.invoke('adminCreateUser', payload('second@gmail.com', 'second-gmail-user')));
  assert.equal(first.user_id, 'USR-000002');
  assert.equal(second.user_id, 'USR-000003');
  assert.equal(first.email, 'first@gmail.com');
  assert.ok(h.scriptLock.acquireCount >= locks + 2);
  assert.equal(h.scriptLock.held, false);
  assert.equal(expectOk(h.invoke('adminCreateUser', payload(' First@GMAIL.com '))).user_id, first.user_id);
  expectError(h.invoke('adminCreateUser', { ...payload('evil@gmail.com'), user_id: 'USR-999999' }), 'VALIDATION_FAILED');
  h.invoke('updateRecordById_', 'Sequences', 'sequence_name', 'USER', { next_value: 1 });
  assert.equal(expectOk(h.invoke('adminCreateUser', payload('third@gmail.com', 'third-gmail-user'))).user_id, 'USR-000004');
});

test('normalized duplicates including blank legacy IDs, domains, role and status fail closed', () => {
  const h = pilot();
  createUser(h, { email: 'one@gmail.com' });
  expectError(h.invoke('adminCreateUser', payload(' ONE@GMAIL.COM ')), 'DUPLICATE_EMAIL');
  legacy(h, '', 'blank@gmail.com');
  expectError(h.invoke('adminCreateUser', payload('BLANK@gmail.com')), 'DUPLICATE_EMAIL');
  expectError(h.invoke('adminCreateUser', payload('x@invalid.org')), 'VALIDATION_FAILED');
  expectError(h.invoke('adminCreateUser', { ...payload('x@gmail.com'), role: 'OWNER' }), 'VALIDATION_FAILED');
  expectError(h.invoke('adminCreateUser', { ...payload('x@gmail.com'), status: 'DELETED' }), 'VALIDATION_FAILED');
});

test('edit proof binds immutable record ID/version and expires; primary key never changes', () => {
  const h = pilot();
  const first = createUser(h, { suffix: 'first', email: 'first@gmail.com' });
  const second = createUser(h, { suffix: 'second', email: 'second@gmail.com' });
  const input = edit(h, first, { name: 'Updated' });
  expectError(h.invoke('adminUpdateUser', { ...input, user_id: second.user_id }), 'STATE_CONFLICT');
  expectError(h.invoke('adminUpdateUser', { ...input, edit_proof: '' }), 'STATE_CONFLICT');
  assert.equal(expectOk(h.invoke('adminUpdateUser', input)).user_id, first.user_id);
  assert.equal(h.find('Users', 'user_id', second.user_id).name, second.name);
  const next = edit(h, h.find('Users', 'user_id', first.user_id), { command_id: 'expired-edit-user' });
  h.advanceTime(3600001);
  // Direct service call isolates edit-proof TTL from the independently expiring app session.
  assert.throws(() => h.invoke('verifyUserEditProof_', next, { user_id: 'USR-000001' }), e => e.code === 'STATE_CONFLICT');
});

test('safe malformed legacy migration allocates ID, preserves audit and is idempotent', () => {
  const h = pilot();
  const candidate = legacy(h);
  assert.equal(candidate.repairable, true, JSON.stringify(candidate.blockers));
  const oldHistory = JSON.stringify(h.records('History'));
  const result = expectOk(repair(h, candidate));
  assert.equal(result.user_id, 'USR-000002');
  assert.equal(result.row_version, 2);
  assert.equal(expectOk(repair(h, candidate)).user_id, result.user_id);
  assert.equal(h.records('Users').filter(row => row.email === 'legacy@gmail.com').length, 1);
  assert.equal(h.records('History').filter(row => row.action === 'REPAIR_USER_ID').length, 1);
  assert.equal(JSON.stringify(h.records('History').filter(row => row.action !== 'REPAIR_USER_ID')), oldHistory);
});

test('migration rejects references, blank audit ambiguity, unknown sheets and stale fingerprints', () => {
  const h = pilot();
  const candidate = legacy(h);
  h.replaceCell('Users', 'user_id', 'old-user', 'name', 'Changed');
  expectError(repair(h, candidate), 'STATE_CONFLICT');
  const changed = expectOk(h.invoke('adminAuditLegacyUsers')).candidates[0];
  h.spreadsheet.insertSheet('UnreviewedReferences');
  expectError(repair(h, changed), 'MIGRATION_BLOCKED');

  const referenced = pilot();
  const user = createUser(referenced, { email: 'historic@gmail.com' });
  referenced.replaceCell('Users', 'user_id', user.user_id, 'user_id', 'historic-id');
  const audit = expectOk(referenced.invoke('adminAuditLegacyUsers')).candidates[0];
  assert.equal(audit.repairable, false);
  expectError(repair(referenced, audit), 'MIGRATION_BLOCKED');
  const blank = legacy(referenced, '', 'blank@gmail.com');
  assert.equal(blank.repairable, false);
  expectError(repair(referenced, blank, { command_id: 'repair-blank-user' }), 'MIGRATION_BLOCKED');
});

test('USER cannot invoke admin create/update/audit/repair; missing sessions denied', () => {
  const h = pilot();
  const user = createUser(h, { email: 'regular@gmail.com' });
  const input = edit(h, user);
  h.setActiveEmail(user.email);
  for (const method of ['adminCreateUser', 'adminUpdateUser', 'adminAuditLegacyUsers', 'adminRepairLegacyUser']) {
    expectError(h.invoke(method, input), 'FORBIDDEN');
    expectError(h.invokeWithToken(method, '', input), 'UNAUTHENTICATED');
  }
  assert.equal(h.find('Users', 'user_id', user.user_id).role, 'USER');
});

test('repair recovers after row write without allocating a second ID or duplicating audit', () => {
  const h = pilot();
  const candidate = legacy(h);
  const originalHistory = h.context.ensureOperationHistoryLocked_;
  h.context.ensureOperationHistoryLocked_ = () => { throw new Error('Simulated audit write outage'); };
  assert.equal(repair(h, candidate).ok, false);
  assert.equal(h.find('Users', 'user_id', 'USR-000002').email, 'legacy@gmail.com');
  h.context.ensureOperationHistoryLocked_ = originalHistory;
  expectOk(h.invoke('adminReconcileOperation', 'repair-legacy-user'));
  assert.equal(expectOk(repair(h, candidate)).user_id, 'USR-000002');
  assert.equal(h.records('History').filter(row => row.action === 'REPAIR_USER_ID').length, 1);
});

test('lock contention cannot allocate or insert a user', () => {
  const h = pilot();
  const before = JSON.stringify({ users: h.records('Users'), sequence: h.records('Sequences') });
  h.scriptLock.failNext = true;
  expectError(h.invoke('adminCreateUser', payload('locked@gmail.com')), 'LOCK_TIMEOUT');
  assert.equal(JSON.stringify({ users: h.records('Users'), sequence: h.records('Sequences') }), before);
});
