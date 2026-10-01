'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { bootstrappedHarness, createEquipment, expectAppError, expectError, expectOk } = require('./test-helpers.cjs');

function attachedDrive(harness) {
  const files = new Map();
  const folderId = 'test-private-image-folder';
  let created = 0;
  const folder = {
    getId: () => folderId,
    getSharingAccess: () => 'PRIVATE',
    getSharingPermission: () => 'NONE',
    getFiles() {
      const items = [...files.values()].filter((file) => !file.isTrashed());
      return { hasNext: () => items.length > 0, next: () => items.shift() };
    },
    getFilesByName(name) {
      const items = [...files.values()].filter((file) =>
        file.getName() === name && !file.isTrashed());
      return { hasNext: () => items.length > 0, next: () => items.shift() };
    },
    createFile(blob) {
      created += 1;
      const id = `test-image-${created}`;
      let trashed = false;
      let access = 'PRIVATE';
      let permission = 'NONE';
      const bytes = Buffer.from(blob.getBytes());
      const file = {
        getId: () => id,
        getName: () => blob.getName(),
        getMimeType: () => blob.getContentType(),
        getSize: () => bytes.length,
        getBlob: () => ({ getBytes: () => [...bytes] }),
        getResourceKey: () => '',
        getParents: () => {
          const parents = [folder];
          return { hasNext: () => parents.length > 0, next: () => parents.shift() };
        },
        getOwner: () => ({ getEmail: () => 'admin@example.com' }),
        isTrashed: () => trashed,
        setTrashed(value) { trashed = Boolean(value); return this; },
        getSharingAccess: () => access,
        getSharingPermission: () => permission,
        setSharing(nextAccess, nextPermission) {
          access = nextAccess;
          permission = nextPermission;
          return this;
        }
      };
      files.set(id, file);
      return file;
    }
  };
  harness.properties.setProperty('DRIVE_FOLDER_ID', folderId);
  harness.context.DriveApp.getFolderById = (id) => {
    if (id !== folderId) throw new Error('Wrong folder');
    return folder;
  };
  harness.context.DriveApp.getFileById = (id) => {
    const file = files.get(id);
    if (!file) throw new Error('File not found');
    return file;
  };
  return { files, folder, get created() { return created; } };
}

const TEST_GIF = Buffer.from('R0lGODlhAQABAAD/ACwAAAAAAQABAAACAUwAOw==', 'base64');

function imageCommand(equipment, commandId) {
  return {
    command_id: commandId,
    asset_id: equipment.asset_id,
    expected_version: equipment.row_version,
    mime_type: 'image/gif',
    base64_data: TEST_GIF.toString('base64')
  };
}

function interruptAfterDriveCreate(harness, equipment, commandId) {
  const drive = attachedDrive(harness);
  const equipmentSheet = harness.spreadsheet.getSheetByName('Equipment');
  const originalRange = equipmentSheet.getRange.bind(equipmentSheet);
  let interruptNextImageWrite = true;
  equipmentSheet.getRange = (...args) => {
    const range = originalRange(...args);
    const originalSetValues = range.setValues.bind(range);
    range.setValues = (values) => {
      if (interruptNextImageWrite && values[0].includes('test-image-1')) {
        interruptNextImageWrite = false;
        throw new Error('Sheet write interrupted after Drive create');
      }
      return originalSetValues(values);
    };
    return range;
  };
  const initial = harness.invoke('adminUploadEquipmentImage', imageCommand(equipment, commandId));
  assert.equal(initial.ok, false);
  assert.equal(expectOk(harness.invoke('adminGetOperationDetail', commandId)).status, 'STARTED');
  return drive;
}

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

test('equipment detail hides a stale image URL when its Drive file is gone', () => {
  const harness = bootstrappedHarness();
  const equipment = createEquipment(harness, { suffix: 'deleted-image' });
  harness.replaceCell('Equipment', 'asset_id', equipment.asset_id,
    'image_file_id', 'deleted-drive-file');
  harness.replaceCell('Equipment', 'asset_id', equipment.asset_id,
    'image_url', 'https://drive.google.com/thumbnail?id=deleted-drive-file&sz=w1600');
  harness.context.DriveApp.getFileById = () => { throw new Error('File not found'); };

  const detail = expectOk(harness.invoke('getEquipmentDetail', equipment.asset_id));
  assert.equal(detail.imageAvailable, false);
  assert.equal(detail.image_url, '');
});

test('equipment list hides a trashed image even when the stored URL remains', () => {
  const harness = bootstrappedHarness();
  const equipment = createEquipment(harness, { suffix: 'trashed-image' });
  const drive = attachedDrive(harness);
  const uploaded = expectOk(harness.invoke('adminUploadEquipmentImage',
    imageCommand(equipment, 'image-to-be-trashed-001')));
  drive.files.get(uploaded.image_file_id).setTrashed(true);

  const list = expectOk(harness.invoke('listEquipment', { search: equipment.asset_id }));
  assert.equal(list.items[0].imageAvailable, false);
  assert.equal(list.items[0].image_url, '');
});

test('equipment detail derives the image URL from the file ID instead of a stale stored URL', () => {
  const harness = bootstrappedHarness();
  const equipment = createEquipment(harness, { suffix: 'stale-image-url' });
  attachedDrive(harness);
  const uploaded = expectOk(harness.invoke('adminUploadEquipmentImage',
    imageCommand(equipment, 'image-stale-url-001')));
  harness.replaceCell('Equipment', 'asset_id', equipment.asset_id,
    'image_url', 'https://drive.google.com/thumbnail?id=another-file&sz=w1600');

  const detail = expectOk(harness.invoke('getEquipmentDetail', equipment.asset_id));
  assert.equal(detail.imageAvailable, true);
  assert.equal(detail.image_url,
    'https://drive.google.com/thumbnail?id=' + uploaded.image_file_id + '&sz=w1600');
});

test('replaying a completed equipment edit refreshes image availability after Drive deletion', () => {
  const harness = bootstrappedHarness();
  const equipment = createEquipment(harness, { suffix: 'edit-image-replay' });
  const drive = attachedDrive(harness);
  const uploaded = expectOk(harness.invoke('adminUploadEquipmentImage',
    imageCommand(equipment, 'image-before-edit-replay-001')));
  const edit = {
    command_id: 'edit-image-replay-001',
    asset_id: uploaded.asset_id,
    expected_version: uploaded.row_version,
    sku: uploaded.sku,
    name: 'Edited equipment with image',
    category_id: uploaded.category_id,
    brand: uploaded.brand,
    model: uploaded.model,
    serial_number: uploaded.serial_number,
    specification: uploaded.specification,
    description: uploaded.description,
    department: uploaded.department,
    location: uploaded.location,
    note: uploaded.note
  };
  const first = expectOk(harness.invoke('adminUpdateEquipment', edit));
  assert.equal(first.imageAvailable, true);
  drive.files.delete(uploaded.image_file_id);

  const replay = expectOk(harness.invoke('adminUpdateEquipment', edit));
  assert.equal(replay.imageAvailable, false);
  assert.equal(replay.image_url, '');
});

test('an interrupted upload recovers its pinned Drive file once without creating a duplicate', () => {
  const harness = bootstrappedHarness();
  const equipment = createEquipment(harness, { suffix: 'interrupted-image' });
  const commandId = 'image-interrupted-recovery-001';
  const drive = interruptAfterDriveCreate(harness, equipment, commandId);
  assert.equal(expectOk(harness.invoke('getEquipmentDetail', equipment.asset_id)).image_file_id, '');

  const recovered = expectOk(harness.invoke('adminReconcileOperation', commandId));
  assert.equal(recovered.status, 'COMPLETED');
  const detail = expectOk(harness.invoke('getEquipmentDetail', equipment.asset_id));
  assert.equal(detail.image_file_id, 'test-image-1');
  assert.equal(detail.imageAvailable, true);
  assert.equal(drive.created, 1);
  assert.equal(expectOk(harness.invoke('adminReconcileOperation', commandId)).status, 'COMPLETED');
  assert.equal(drive.created, 1);
});

test('retrying the same interrupted command reuses its pinned Drive file', () => {
  const harness = bootstrappedHarness();
  const equipment = createEquipment(harness, { suffix: 'same-command-retry' });
  const commandId = 'image-same-command-retry-001';
  const drive = interruptAfterDriveCreate(harness, equipment, commandId);

  const uploaded = expectOk(harness.invoke('adminUploadEquipmentImage',
    imageCommand(equipment, commandId)));
  assert.equal(uploaded.image_file_id, 'test-image-1');
  assert.equal(drive.created, 1);
});

test('an abandoned image upload is visible to the editor and cancellation unblocks a fresh upload and edit', () => {
  const harness = bootstrappedHarness();
  const equipment = createEquipment(harness, { suffix: 'abandoned-upload' });
  const commandId = 'image-abandoned-upload-001';
  const drive = interruptAfterDriveCreate(harness, equipment, commandId);
  expectError(harness.invoke('adminUploadEquipmentImage',
    imageCommand(equipment, 'image-new-attempt-001')), 'OPERATION_PENDING');
  expectError(harness.invoke('adminUpdateEquipment', {
    ...equipment, command_id: 'edit-blocked-001', expected_version: equipment.row_version,
    name: 'New equipment name'
  }), 'OPERATION_PENDING');
  const detail = expectOk(harness.invoke('getEquipmentDetail', equipment.asset_id));
  assert.equal(detail.pending_operation.operation_id, commandId);
  assert.equal(detail.pending_operation.can_abort, true);
  assert.equal(detail.pending_operation.action, 'UPLOAD_ASSET_IMAGE');
  expectOk(harness.invoke('adminAbortOperation', {
    operation_id: commandId, reason: 'Cancel abandoned upload before uploading a new image'
  }));
  assert.equal(drive.files.get('test-image-1').isTrashed(), true);
  assert.equal(expectOk(harness.invoke('getEquipmentDetail', equipment.asset_id)).pending_operation, null);
  const uploaded = expectOk(harness.invoke('adminUploadEquipmentImage',
    imageCommand(equipment, 'image-new-after-cancel-001')));
  const edited = expectOk(harness.invoke('adminUpdateEquipment', {
    ...equipment, command_id: 'edit-after-cancel-001', expected_version: uploaded.row_version,
    name: 'New equipment name'
  }));
  assert.equal(edited.name, 'New equipment name');
  assert.equal(edited.image_file_id, uploaded.image_file_id);
  assert.equal(drive.created, 2);
});

test('an upload that has already updated Equipment is not offered as cancellable', () => {
  const h = bootstrappedHarness();
  const e = createEquipment(h, { suffix: 'projected-image' });
  attachedDrive(h);
  const original = h.context.ensureOperationHistoryLocked_;
  h.context.ensureOperationHistoryLocked_ = (entry, actor) => {
    if (entry.action === 'UPLOAD_ASSET_IMAGE') throw new Error('Interrupted before History');
    return original(entry, actor);
  };
  expectError(h.invoke('adminUploadEquipmentImage', imageCommand(e, 'projected-image-001')), 'INTERNAL');
  const detail = expectOk(h.invoke('getEquipmentDetail', e.asset_id));
  assert.equal(detail.pending_operation.can_abort, false);
  assert.equal(detail.image_file_id, 'test-image-1');
  expectError(h.invoke('adminAbortOperation', { operation_id: 'projected-image-001', reason: 'Cancel' }), 'STATE_CONFLICT');
});

test('an unresolvable pinned image stays pending until an admin explicitly aborts it', () => {
  const harness = bootstrappedHarness();
  const equipment = createEquipment(harness, { suffix: 'missing-pinned-image' });
  const commandId = 'image-missing-pinned-001';
  const drive = interruptAfterDriveCreate(harness, equipment, commandId);
  drive.files.delete('test-image-1');

  expectError(harness.invoke('adminReconcileOperation', commandId), 'IMAGE_FILE_UNAVAILABLE');
  assert.equal(expectOk(harness.invoke('adminGetOperationDetail', commandId)).status, 'STARTED');
  expectError(harness.invoke('adminAbortOperation', {
    operation_id: commandId,
    reason: 'Verified pinned file is no longer accessible'
  }), 'IMAGE_FILE_UNAVAILABLE');
  const resolved = expectOk(harness.invoke('adminAbortOperation', {
    operation_id: commandId,
    reason: 'Verified pinned file is no longer accessible',
    allow_unverified_cleanup: true
  }));
  assert.equal(resolved.status, 'ABORTED');
  const uploaded = expectOk(harness.invoke('adminUploadEquipmentImage',
    imageCommand(equipment, 'image-after-missing-pinned-002')));
  assert.equal(uploaded.image_file_id, 'test-image-2');
  assert.equal(uploaded.imageAvailable, true);
});

test('retrying an unresolvable pinned image never creates a duplicate before admin review', () => {
  const harness = bootstrappedHarness();
  const equipment = createEquipment(harness, { suffix: 'missing-retry-image' });
  const commandId = 'image-missing-retry-001';
  const drive = interruptAfterDriveCreate(harness, equipment, commandId);
  drive.files.delete('test-image-1');

  const retry = expectError(harness.invoke('adminUploadEquipmentImage',
    imageCommand(equipment, commandId)), 'IMAGE_FILE_UNAVAILABLE');
  assert.equal(retry.retryable, true);
  assert.equal(drive.created, 1);
  assert.equal(expectOk(harness.invoke('adminGetOperationDetail', commandId)).status, 'STARTED');
  expectOk(harness.invoke('adminAbortOperation', {
    operation_id: commandId,
    reason: 'Verified pinned file is no longer accessible',
    allow_unverified_cleanup: true
  }));
  const replacement = expectOk(harness.invoke('adminUploadEquipmentImage',
    imageCommand(equipment, 'image-after-missing-retry-002')));
  assert.equal(replacement.image_file_id, 'test-image-2');
});

test('a confirmed trashed pinned image is aborted and permits a fresh upload', () => {
  const harness = bootstrappedHarness();
  const equipment = createEquipment(harness, { suffix: 'trashed-retry-image' });
  const commandId = 'image-trashed-retry-001';
  const drive = interruptAfterDriveCreate(harness, equipment, commandId);
  drive.files.get('test-image-1').setTrashed(true);

  const resolved = expectOk(harness.invoke('adminReconcileOperation', commandId));
  assert.equal(resolved.status, 'ABORTED');
  const replacement = expectOk(harness.invoke('adminUploadEquipmentImage',
    imageCommand(equipment, 'image-after-trashed-retry-002')));
  assert.equal(replacement.image_file_id, 'test-image-2');
});

test('reconciliation rejects a pinned Drive file owned by another account', () => {
  const harness = bootstrappedHarness();
  const equipment = createEquipment(harness, { suffix: 'foreign-owned-image' });
  const commandId = 'image-foreign-owner-001';
  const drive = interruptAfterDriveCreate(harness, equipment, commandId);
  drive.files.get('test-image-1').getOwner = () => ({ getEmail: () => 'other@example.com' });

  expectError(harness.invoke('adminReconcileOperation', commandId), 'STATE_CONFLICT');
  assert.equal(expectOk(harness.invoke('adminGetOperationDetail', commandId)).status, 'STARTED');
  assert.equal(expectOk(harness.invoke('getEquipmentDetail', equipment.asset_id)).image_file_id, '');
});

test('recovery rejects a pinned file whose bytes no longer match its recorded digest', () => {
  const harness = bootstrappedHarness();
  const equipment = createEquipment(harness, { suffix: 'tampered-image' });
  const commandId = 'image-tampered-digest-001';
  const drive = interruptAfterDriveCreate(harness, equipment, commandId);
  const file = drive.files.get('test-image-1');
  file.getBlob = () => ({ getBytes: () => [...Buffer.from('GIF89aChanged')] });

  expectError(harness.invoke('adminReconcileOperation', commandId), 'STATE_CONFLICT');
  assert.equal(expectOk(harness.invoke('adminGetOperationDetail', commandId)).status, 'STARTED');
  assert.equal(expectOk(harness.invoke('getEquipmentDetail', equipment.asset_id)).image_file_id, '');
});

test('aborting an interrupted upload never trashes a file owned by another account', () => {
  const harness = bootstrappedHarness();
  const equipment = createEquipment(harness, { suffix: 'foreign-abort-image' });
  const commandId = 'image-foreign-abort-001';
  const drive = interruptAfterDriveCreate(harness, equipment, commandId);
  const file = drive.files.get('test-image-1');
  file.getOwner = () => ({ getEmail: () => 'other@example.com' });

  expectError(harness.invoke('adminAbortOperation', {
    operation_id: commandId,
    reason: 'Cannot verify file ownership'
  }), 'STATE_CONFLICT');
  assert.equal(file.isTrashed(), false);
  assert.equal(expectOk(harness.invoke('adminGetOperationDetail', commandId)).status, 'STARTED');
  const released = expectOk(harness.invoke('adminAbortOperation', {
    operation_id: commandId,
    reason: 'Cannot verify file ownership',
    allow_unverified_cleanup: true
  }));
  assert.equal(released.status, 'ABORTED');
  assert.equal(released.result.orphan_cleanup_required, true);
  assert.equal(file.isTrashed(), false);
});

test('replacing an image commits the new file before trashing the old file', () => {
  const harness = bootstrappedHarness();
  const equipment = createEquipment(harness, { suffix: 'replace-image' });
  const drive = attachedDrive(harness);
  const first = expectOk(harness.invoke('adminUploadEquipmentImage',
    imageCommand(equipment, 'image-replacement-first-001')));
  const oldFile = drive.files.get(first.image_file_id);
  const originalTrash = oldFile.setTrashed.bind(oldFile);
  let recordAtTrash = '';
  oldFile.setTrashed = (value) => {
    recordAtTrash = harness.find('Equipment', 'asset_id', equipment.asset_id).image_file_id;
    return originalTrash(value);
  };

  const second = expectOk(harness.invoke('adminUploadEquipmentImage',
    imageCommand(first, 'image-replacement-second-002')));
  assert.equal(second.image_file_id, 'test-image-2');
  assert.equal(recordAtTrash, second.image_file_id);
  assert.equal(oldFile.isTrashed(), true);
  assert.equal(drive.files.get(second.image_file_id).isTrashed(), false);
});

test('replacement retires the old managed image even after the configured folder changes', () => {
  const harness = bootstrappedHarness();
  const equipment = createEquipment(harness, { suffix: 'folder-moved-image' });
  const drive = attachedDrive(harness);
  const first = expectOk(harness.invoke('adminUploadEquipmentImage',
    imageCommand(equipment, 'image-before-folder-change-001')));
  const oldFile = drive.files.get(first.image_file_id);
  const originalFolderLookup = harness.context.DriveApp.getFolderById;
  const newFolderId = 'new-private-image-folder';
  const newFolder = {
    ...drive.folder,
    getId: () => newFolderId,
    createFile(blob) {
      const file = drive.folder.createFile(blob);
      file.getParents = () => {
        const parents = [newFolder];
        return { hasNext: () => parents.length > 0, next: () => parents.shift() };
      };
      return file;
    }
  };
  harness.context.DriveApp.getFolderById = (id) =>
    id === newFolderId ? newFolder : originalFolderLookup(id);
  harness.properties.setProperty('DRIVE_FOLDER_ID', newFolderId);

  const second = expectOk(harness.invoke('adminUploadEquipmentImage',
    imageCommand(first, 'image-after-folder-change-002')));
  assert.equal(second.image_file_id, 'test-image-2');
  assert.equal(oldFile.isTrashed(), true);
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
    getParents: () => {
      const parents = [folder];
      return { hasNext: () => parents.length > 0, next: () => parents.shift() };
    },
    getOwner: () => ({ getEmail: () => 'admin@example.com' }),
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
    getId: () => 'test-image-folder',
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
