'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { bootstrappedHarness, createEquipment, expectAppError, expectOk } = require('./test-helpers.cjs');

test('equipment image validation accepts GIF signatures and rejects MIME spoofing', () => {
  const harness = bootstrappedHarness();
  const gif = [...Buffer.from('R0lGODlhAQABAAD/ACwAAAAAAQABAAACAUwAOw==', 'base64')];
  assert.equal(harness.invoke('assertImageSignature_', gif, 'image/gif'), undefined);
  const gif87a = [...gif];
  gif87a[4] = '7'.charCodeAt(0);
  assert.equal(harness.invoke('assertImageSignature_', gif87a, 'image/gif'), undefined);
  expectAppError(() => harness.invoke('assertImageSignature_', gif, 'image/png'), 'VALIDATION_FAILED');
  expectAppError(() => harness.invoke('assertImageSignature_', [...Buffer.from('GIF88a')], 'image/gif'),
    'VALIDATION_FAILED');
});

test('a rejected image share releases its operation so equipment can still be edited', () => {
  const harness = bootstrappedHarness();
  const equipment = createEquipment(harness, { suffix: 'image-share' });
  const bytes = Buffer.from('R0lGODlhAQABAAD/ACwAAAAAAQABAAACAUwAOw==', 'base64');
  const imageFileId = 'test-image-file-id';
  let filename = '';
  let trashed = false;
  const file = {
    getId: () => imageFileId,
    getName: () => filename,
    getMimeType: () => 'image/gif',
    getSize: () => bytes.length,
    getBlob: () => ({ getBytes: () => [...bytes] }),
    isTrashed: () => trashed,
    setTrashed(value) { trashed = Boolean(value); return this; },
    setSharing() { throw new Error('Sharing disabled by test policy'); },
    getSharingAccess: () => 'PRIVATE',
    getSharingPermission: () => 'NONE'
  };
  const folder = {
    getSharingAccess: () => 'PRIVATE',
    getSharingPermission: () => 'NONE',
    createFile(blob) { filename = blob.getName(); return file; },
    getFilesByName(name) {
      const matches = name === filename && !trashed ? [file] : [];
      return { hasNext: () => matches.length > 0, next: () => matches.shift() };
    }
  };
  harness.properties.setProperty('DRIVE_FOLDER_ID', 'test-image-folder');
  harness.context.DriveApp.getFolderById = () => folder;
  harness.context.DriveApp.getFileById = (id) => {
    if (id !== imageFileId) throw new Error('Unknown image');
    return file;
  };

  const upload = harness.invoke('adminUploadEquipmentImage', {
    command_id: 'upload-share-failed-001',
    asset_id: equipment.asset_id,
    expected_version: equipment.row_version,
    mime_type: 'image/gif',
    base64_data: bytes.toString('base64')
  });
  assert.equal(upload.ok, false);
  assert.equal(upload.error.code, 'DRIVE_SHARING_FAILED');
  assert.equal(upload.error.retryable, false);
  assert.equal(harness.find('Operations', 'operation_id', 'upload-share-failed-001').status,
    'ABORTED');
  assert.equal(trashed, true);

  const edited = expectOk(harness.invoke('adminUpdateEquipment', {
    command_id: 'edit-after-image-failed-001',
    asset_id: equipment.asset_id,
    expected_version: equipment.row_version,
    sku: equipment.sku,
    name: 'Changed after image failure',
    category_id: equipment.category_id,
    brand: equipment.brand,
    model: equipment.model,
    serial_number: equipment.serial_number,
    specification: equipment.specification,
    description: equipment.description,
    department: equipment.department,
    location: equipment.location,
    note: equipment.note
  }));
  assert.equal(edited.name, 'Changed after image failure');
});

test('a sharing failure remains pending when image cleanup cannot be verified', () => {
  const harness = bootstrappedHarness();
  const equipment = createEquipment(harness, { suffix: 'cleanup-denied' });
  const bytes = Buffer.from('R0lGODlhAQABAAD/ACwAAAAAAQABAAACAUwAOw==', 'base64');
  let filename = '';
  const file = {
    getId: () => 'test-uncertain-image',
    getName: () => filename,
    getMimeType: () => 'image/gif',
    getSize: () => bytes.length,
    getBlob: () => ({ getBytes: () => [...bytes] }),
    isTrashed: () => false,
    setTrashed() { throw new Error('Drive refused cleanup'); },
    setSharing() { throw new Error('Drive refused sharing'); },
    getSharingAccess: () => 'PRIVATE',
    getSharingPermission: () => 'NONE'
  };
  harness.properties.setProperty('DRIVE_FOLDER_ID', 'test-cleanup-denied-folder');
  harness.context.DriveApp.getFolderById = () => ({
    getSharingAccess: () => 'PRIVATE',
    getSharingPermission: () => 'NONE',
    createFile(blob) { filename = blob.getName(); return file; },
    getFilesByName: () => ({ hasNext: () => false })
  });
  harness.context.DriveApp.getFileById = () => file;
  const response = harness.invoke('adminUploadEquipmentImage', {
    command_id: 'upload-uncertain-cleanup-001',
    asset_id: equipment.asset_id,
    expected_version: equipment.row_version,
    mime_type: 'image/gif',
    base64_data: bytes.toString('base64')
  });
  assert.equal(response.error.code, 'DRIVE_SHARING_FAILED');
  assert.equal(response.error.retryable, true);
  assert.equal(harness.find('Operations', 'operation_id', 'upload-uncertain-cleanup-001').status,
    'STARTED');
  assert.equal(harness.find('Equipment', 'asset_id', equipment.asset_id).row_version,
    equipment.row_version);
});

test('an image already shared at the required level needs no new Drive permission', () => {
  const harness = bootstrappedHarness();
  let setSharingCalls = 0;
  const inherited = {
    getSharingAccess: () => 'ANYONE_WITH_LINK',
    getSharingPermission: () => 'VIEW',
    setSharing() { setSharingCalls += 1; throw new Error('Unexpected permission mutation'); }
  };
  assert.doesNotThrow(() => harness.invoke('applyImageSharing_', inherited, 'ANYONE_WITH_LINK'));
  assert.equal(setSharingCalls, 0);
});

test('a folder shared more broadly than IMAGE_SHARING is rejected before reserving an operation', () => {
  const harness = bootstrappedHarness();
  const equipment = createEquipment(harness, { suffix: 'folder-policy' });
  const bytes = Buffer.from('R0lGODlhAQABAAD/ACwAAAAAAQABAAACAUwAOw==', 'base64');
  let createdFiles = 0;
  harness.properties.setProperty('DRIVE_FOLDER_ID', 'test-public-folder');
  harness.context.DriveApp.getFolderById = () => ({
    getSharingAccess: () => 'ANYONE_WITH_LINK',
    getSharingPermission: () => 'VIEW',
    getFilesByName: () => ({ hasNext: () => false }),
    createFile() { createdFiles += 1; throw new Error('Unexpected file creation'); }
  });
  const response = harness.invoke('adminUploadEquipmentImage', {
    command_id: 'upload-in-public-folder-001',
    asset_id: equipment.asset_id,
    expected_version: equipment.row_version,
    mime_type: 'image/gif',
    base64_data: bytes.toString('base64')
  });
  assert.equal(response.ok, false);
  assert.equal(response.error.code, 'CONFIG_ERROR');
  assert.equal(createdFiles, 0);
  assert.equal(harness.find('Operations', 'operation_id', 'upload-in-public-folder-001'), null);
});

test('an image inheriting the requested public-link access uploads without changing permissions', () => {
  const harness = bootstrappedHarness();
  const equipment = createEquipment(harness, { suffix: 'inherited-share' });
  const bytes = Buffer.from('R0lGODlhAQABAAD/ACwAAAAAAQABAAACAUwAOw==', 'base64');
  let setSharingCalls = 0;
  const file = {
    getId: () => 'test-inherited-image',
    getName: () => 'test-inherited-image.gif',
    getMimeType: () => 'image/gif',
    getSize: () => bytes.length,
    getBlob: () => ({ getBytes: () => [...bytes] }),
    isTrashed: () => false,
    getSharingAccess: () => 'ANYONE_WITH_LINK',
    getSharingPermission: () => 'VIEW',
    setSharing() { setSharingCalls += 1; throw new Error('Already inherited'); }
  };
  harness.properties.setProperty('DRIVE_FOLDER_ID', 'test-inherited-folder');
  harness.properties.setProperty('IMAGE_SHARING', 'ANYONE_WITH_LINK');
  harness.context.DriveApp.getFolderById = () => ({
    getSharingAccess: () => 'ANYONE_WITH_LINK',
    getSharingPermission: () => 'VIEW',
    getFilesByName: () => ({ hasNext: () => false }),
    createFile: () => file
  });
  const uploaded = expectOk(harness.invoke('adminUploadEquipmentImage', {
    command_id: 'upload-inherited-share-001',
    asset_id: equipment.asset_id,
    expected_version: equipment.row_version,
    mime_type: 'image/gif',
    base64_data: bytes.toString('base64')
  }));
  assert.equal(uploaded.image_file_id, 'test-inherited-image');
  assert.equal(setSharingCalls, 0);
  assert.equal(harness.find('Operations', 'operation_id', 'upload-inherited-share-001').status,
    'COMPLETED');
});
