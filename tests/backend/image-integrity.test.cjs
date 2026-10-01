'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { bootstrappedHarness, createEquipment, createUser, expectError, expectOk } =
  require('./test-helpers.cjs');

const GIF = Buffer.from('R0lGODlhAQABAAD/ACwAAAAAAQABAAACAUwAOw==', 'base64');

function attachDrive(harness) {
  const files = new Map();
  const folders = new Map();
  const folderId = 'test-private-image-folder';
  let nextId = 0;
  function addFolder(id) {
    const folder = {
      getId: () => id,
      getSharingAccess: () => 'PRIVATE',
      getSharingPermission: () => 'NONE',
      getFiles() {
        const matches = [...files.values()].filter((file) =>
          file.testFolderId === id && !file.isTrashed());
        return { hasNext: () => matches.length > 0, next: () => matches.shift() };
      },
      getFilesByName(name) {
        const matches = [...files.values()].filter((file) =>
          file.testFolderId === id && file.getName() === name && !file.isTrashed());
        return { hasNext: () => matches.length > 0, next: () => matches.shift() };
      },
      createFile(blob) {
        nextId += 1;
        const fileId = `test-image-${nextId}`;
        let trashed = false;
        let owner = 'admin@example.com';
        let access = 'PRIVATE';
        let permission = 'NONE';
        const bytes = Buffer.from(blob.getBytes());
        const file = {
          testFolderId: id,
          getId: () => fileId,
          getName: () => blob.getName(),
          getMimeType: () => blob.getContentType(),
          getSize: () => bytes.length,
          getBlob: () => ({ getBytes: () => [...bytes] }),
          getResourceKey: () => '',
          getOwner: () => ({ getEmail: () => owner }),
          setOwnerForTest(value) { owner = value; },
          getParents: () => {
            const parents = [folder];
            return { hasNext: () => parents.length > 0, next: () => parents.shift() };
          },
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
        files.set(fileId, file);
        return file;
      }
    };
    folders.set(id, folder);
    return folder;
  }
  const folder = addFolder(folderId);
  harness.properties.setProperty('DRIVE_FOLDER_ID', folderId);
  harness.context.DriveApp.getFolderById = (id) => {
    if (!folders.has(id)) throw new Error('Folder not found');
    return folders.get(id);
  };
  harness.context.DriveApp.getFileById = (id) => {
    if (!files.has(id)) throw new Error('File not found');
    return files.get(id);
  };
  return { files, folders, folder, addFolder, get created() { return nextId; } };
}

function upload(harness, equipment, commandId) {
  return harness.invoke('adminUploadEquipmentImage', {
    asset_id: equipment.asset_id,
    expected_version: equipment.row_version,
    command_id: commandId,
    mime_type: 'image/gif',
    base64_data: GIF.toString('base64')
  });
}

test('preview reports missing references, protected STARTED uploads, and managed orphans', () => {
  const harness = bootstrappedHarness();
  const drive = attachDrive(harness);
  const uploadedAsset = createEquipment(harness, { suffix: 'integrity-uploaded' });
  const uploaded = expectOk(upload(harness, uploadedAsset, 'image-integrity-upload-001'));
  drive.files.get(uploaded.image_file_id).setTrashed(true);
  const missingAsset = createEquipment(harness, { suffix: 'integrity-missing' });
  harness.replaceCell('Equipment', 'asset_id', missingAsset.asset_id,
    'image_file_id', 'deleted-image-file-001');
  harness.replaceCell('Equipment', 'asset_id', missingAsset.asset_id,
    'image_url', 'https://drive.google.com/thumbnail?id=deleted-image-file-001');
  const staleUrlAsset = createEquipment(harness, { suffix: 'integrity-stale-url' });
  harness.replaceCell('Equipment', 'asset_id', staleUrlAsset.asset_id,
    'image_url', 'https://drive.google.com/thumbnail?id=another-deleted-file');

  const interruptedAsset = createEquipment(harness, { suffix: 'integrity-interrupted' });
  const equipmentSheet = harness.spreadsheet.getSheetByName('Equipment');
  const originalRange = equipmentSheet.getRange.bind(equipmentSheet);
  let failOnce = true;
  equipmentSheet.getRange = (...args) => {
    const range = originalRange(...args);
    const originalWrite = range.setValues.bind(range);
    range.setValues = (values) => {
      if (failOnce && values[0].includes('test-image-2')) {
        failOnce = false;
        throw new Error('Simulated interruption after Drive create');
      }
      return originalWrite(values);
    };
    return range;
  };
  assert.equal(upload(harness, interruptedAsset, 'image-integrity-started-001').ok, false);
  assert.equal(expectOk(harness.invoke('adminGetOperationDetail',
    'image-integrity-started-001')).status, 'STARTED');
  const orphan = drive.folder.createFile(harness.context.Utilities.newBlob(
    [...GIF], 'image/gif', 'AST-999999-orphan-cleanup-001.gif'));

  const audit = expectOk(harness.invoke('adminPreviewImageIntegrity'));
  assert.equal(audit.issues.some((issue) => issue.kind === 'TRASHED_REFERENCE' &&
    issue.asset_id === uploadedAsset.asset_id), true);
  assert.equal(audit.issues.some((issue) => issue.kind === 'UNAVAILABLE_REFERENCE' &&
    issue.asset_id === missingAsset.asset_id), true);
  assert.equal(audit.issues.some((issue) => issue.kind === 'STALE_URL' &&
    issue.asset_id === staleUrlAsset.asset_id), true);
  assert.equal(audit.issues.some((issue) => issue.kind === 'STARTED_UPLOAD' &&
    issue.operation_id === 'image-integrity-started-001'), true);
  assert.equal(audit.issues.some((issue) => issue.kind === 'ORPHAN_FILE' &&
    issue.file_id === orphan.getId() && issue.can_repair), true);
  assert.equal(audit.issues.some((issue) => issue.kind === 'ORPHAN_FILE' &&
    issue.file_id === 'test-image-2'), false);
  expectError(harness.invoke('adminRepairImageIntegrity', {
    kind: 'ORPHAN_FILE', file_id: 'test-image-2', confirm: true
  }), 'STATE_CONFLICT');
  assert.equal(drive.files.get('test-image-2').isTrashed(), false);
});

test('STARTED image repair reuses the original operation and pinned Drive file', () => {
  const harness = bootstrappedHarness();
  const drive = attachDrive(harness);
  const equipment = createEquipment(harness, { suffix: 'integrity-reconcile' });
  const equipmentSheet = harness.spreadsheet.getSheetByName('Equipment');
  const originalRange = equipmentSheet.getRange.bind(equipmentSheet);
  let failOnce = true;
  equipmentSheet.getRange = (...args) => {
    const range = originalRange(...args);
    const originalWrite = range.setValues.bind(range);
    range.setValues = (values) => {
      if (failOnce && values[0].includes('test-image-1')) {
        failOnce = false;
        throw new Error('Simulated interruption after Drive create');
      }
      return originalWrite(values);
    };
    return range;
  };
  const commandId = 'image-integrity-reconcile-001';
  assert.equal(upload(harness, equipment, commandId).ok, false);
  const recovered = expectOk(harness.invoke('adminRepairImageIntegrity', {
    kind: 'STARTED_UPLOAD', operation_id: commandId, confirm: true
  }));
  assert.equal(recovered.status, 'COMPLETED');
  assert.equal(expectOk(harness.invoke('getEquipmentDetail', equipment.asset_id))
    .image_file_id, 'test-image-1');
  assert.equal(drive.created, 1);
});

test('orphan repair requires confirmation and rechecks references under the lock', () => {
  const harness = bootstrappedHarness();
  const drive = attachDrive(harness);
  const orphan = drive.folder.createFile(harness.context.Utilities.newBlob(
    [...GIF], 'image/gif', 'AST-999999-orphan-cleanup-002.gif'));
  const id = orphan.getId();
  expectError(harness.invoke('adminRepairImageIntegrity', { kind: 'ORPHAN_FILE', file_id: id }),
    'VALIDATION_FAILED');
  assert.equal(orphan.isTrashed(), false);

  const equipment = createEquipment(harness, { suffix: 'integrity-race' });
  harness.replaceCell('Equipment', 'asset_id', equipment.asset_id, 'image_file_id', id);
  expectError(harness.invoke('adminRepairImageIntegrity', {
    kind: 'ORPHAN_FILE', file_id: id, confirm: true
  }), 'STATE_CONFLICT');
  assert.equal(orphan.isTrashed(), false);
  harness.replaceCell('Equipment', 'asset_id', equipment.asset_id, 'image_file_id', '');
  const repaired = expectOk(harness.invoke('adminRepairImageIntegrity', {
    kind: 'ORPHAN_FILE', file_id: id, confirm: true
  }));
  assert.equal(repaired.status, 'TRASHED');
  assert.equal(orphan.isTrashed(), true);
});

test('image integrity repair refuses a file not owned by the deployer and non-admin callers', () => {
  const harness = bootstrappedHarness();
  const drive = attachDrive(harness);
  const orphan = drive.folder.createFile(harness.context.Utilities.newBlob(
    [...GIF], 'image/gif', 'AST-999999-orphan-cleanup-003.gif'));
  orphan.setOwnerForTest('someone@example.com');
  const issue = expectOk(harness.invoke('adminPreviewImageIntegrity')).issues.find((entry) =>
    entry.file_id === orphan.getId());
  assert.equal(issue.can_repair, false);
  expectError(harness.invoke('adminRepairImageIntegrity', {
    kind: 'ORPHAN_FILE', file_id: orphan.getId(), confirm: true
  }), 'FORBIDDEN');

  const user = createUser(harness, { suffix: 'integrity-reader' });
  harness.signInAs(user.email);
  expectError(harness.invoke('adminPreviewImageIntegrity'), 'FORBIDDEN');
  expectError(harness.invoke('adminRepairImageIntegrity', {
    kind: 'ORPHAN_FILE', file_id: orphan.getId(), confirm: true
  }), 'FORBIDDEN');
});

test('orphan cleanup refuses unrelated files and files outside the configured folder', () => {
  const harness = bootstrappedHarness();
  const drive = attachDrive(harness);
  const untrackedFolder = drive.addFolder('untracked-image-folder-001');
  const unrelated = drive.folder.createFile(harness.context.Utilities.newBlob(
    [...GIF], 'image/gif', 'unrelated-upload.gif'));
  const external = untrackedFolder.createFile(harness.context.Utilities.newBlob(
    [...GIF], 'image/gif', 'AST-999999-external-upload-001.gif'));
  const audit = expectOk(harness.invoke('adminPreviewImageIntegrity'));
  assert.equal(audit.issues.find((issue) => issue.file_id === unrelated.getId()).can_repair, false);
  expectError(harness.invoke('adminRepairImageIntegrity', {
    kind: 'ORPHAN_FILE', file_id: unrelated.getId(), confirm: true
  }), 'STATE_CONFLICT');
  expectError(harness.invoke('adminRepairImageIntegrity', {
    kind: 'ORPHAN_FILE', file_id: external.getId(), confirm: true
  }), 'STATE_CONFLICT');
  assert.equal(unrelated.isTrashed(), false);
  assert.equal(external.isTrashed(), false);
});

test('preview and repair include a managed orphan in a historical image folder', () => {
  const harness = bootstrappedHarness();
  const drive = attachDrive(harness);
  const oldFolder = drive.addFolder('historical-image-folder-001');
  harness.properties.setProperty('DRIVE_FOLDER_ID', oldFolder.getId());
  const equipment = createEquipment(harness, { suffix: 'historical-folder' });
  const uploaded = expectOk(upload(harness, equipment, 'historical-image-upload-001'));
  const oldFile = drive.files.get(uploaded.image_file_id);
  harness.replaceCell('Equipment', 'asset_id', equipment.asset_id, 'image_file_id', '');
  harness.replaceCell('Equipment', 'asset_id', equipment.asset_id, 'image_url', '');
  harness.properties.setProperty('DRIVE_FOLDER_ID', drive.folder.getId());

  const audit = expectOk(harness.invoke('adminPreviewImageIntegrity'));
  const issue = audit.issues.find((entry) =>
    entry.kind === 'ORPHAN_FILE' && entry.file_id === oldFile.getId());
  assert.ok(issue, 'orphan in historical folder must be visible');
  assert.equal(issue.folder_id, oldFolder.getId());
  assert.equal(issue.can_repair, true);
  const repaired = expectOk(harness.invoke('adminRepairImageIntegrity', {
    kind: 'ORPHAN_FILE', file_id: oldFile.getId(), confirm: true
  }));
  assert.equal(repaired.status, 'TRASHED');
  assert.equal(oldFile.isTrashed(), true);
});

test('preview reports an inaccessible historical folder without hiding current-folder findings', () => {
  const harness = bootstrappedHarness();
  const drive = attachDrive(harness);
  const oldFolder = drive.addFolder('historical-image-folder-002');
  harness.properties.setProperty('DRIVE_FOLDER_ID', oldFolder.getId());
  const equipment = createEquipment(harness, { suffix: 'unreadable-historical-folder' });
  expectOk(upload(harness, equipment, 'historical-image-upload-002'));
  harness.properties.setProperty('DRIVE_FOLDER_ID', drive.folder.getId());
  const currentOrphan = drive.folder.createFile(harness.context.Utilities.newBlob(
    [...GIF], 'image/gif', 'AST-999999-current-orphan-002.gif'));
  drive.folders.delete(oldFolder.getId());

  const audit = expectOk(harness.invoke('adminPreviewImageIntegrity'));
  assert.equal(audit.issues.some((issue) =>
    issue.kind === 'HISTORICAL_FOLDER_UNREADABLE' &&
    issue.folder_id === oldFolder.getId()), true);
  assert.equal(audit.summary.counts.unreadable_folders, 1);
  assert.equal(audit.issues.some((issue) =>
    issue.kind === 'ORPHAN_FILE' && issue.file_id === currentOrphan.getId()), true);
});
