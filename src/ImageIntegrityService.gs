var IMAGE_INTEGRITY_MAX_ISSUES_ = 500;
var IMAGE_INTEGRITY_MANAGED_NAME_ = /^AST-\d{6}-[A-Za-z0-9_-]{8,100}\.(?:jpg|png|webp|gif)$/;

function imageIntegrityState_() {
  var equipment = listRecords_(SHEETS.EQUIPMENT);
  var imageOperations = listRecords_(SHEETS.OPERATIONS).filter(function (operation) {
    return operation.action === 'UPLOAD_ASSET_IMAGE';
  });
  var operations = imageOperations.filter(function (operation) {
    return operation.status === OPERATION_STATUS.STARTED;
  });
  var referenced = {};
  var protectedResources = {};
  var protectedNames = {};
  equipment.forEach(function (record) {
    var id = normalizeWhitespace_(record.image_file_id);
    if (id) referenced[id] = true;
  });
  operations.forEach(function (operation) {
    if (operation.resource_id) protectedResources[operation.resource_id] = true;
    var assetId = normalizeWhitespace_(operation.asset_id || operation.entity_id);
    if (!assetId) return;
    Object.keys(IMAGE_MIME_TYPES).forEach(function (mimeType) {
      protectedNames[assetId + '-' + operation.operation_id + '.' + IMAGE_MIME_TYPES[mimeType]] = true;
    });
  });
  return {
    equipment: equipment,
    imageOperations: imageOperations,
    operations: operations,
    referenced: referenced,
    protectedResources: protectedResources,
    protectedNames: protectedNames
  };
}

function imageIntegrityKnownFolders_(state, currentFolderId) {
  var ids = [currentFolderId];
  var seen = Object.create(null);
  var invalidEvidence = [];
  seen[currentFolderId] = true;
  state.imageOperations.forEach(function (operation) {
    var folderId = '';
    try {
      folderId = normalizeWhitespace_(operationPayload_(operation).folderId);
    } catch (ignored) {}
    if (!folderId) {
      invalidEvidence.push(operation.operation_id);
      return;
    }
    if (!seen[folderId]) {
      seen[folderId] = true;
      ids.push(folderId);
    }
  });
  return { ids: ids, invalidEvidence: invalidEvidence };
}

function imageIntegrityFileOwnedByDeployer_(file) {
  try {
    var owner = normalizeWhitespace_(file.getOwner().getEmail()).toLowerCase();
    var deployer = normalizeWhitespace_(Session.getEffectiveUser().getEmail()).toLowerCase();
    return Boolean(owner && deployer && owner === deployer);
  } catch (ignored) {
    return false;
  }
}

function imageIntegrityFileInFolder_(file, folderId) {
  try {
    var parents = file.getParents();
    while (parents.hasNext()) {
      if (parents.next().getId() === folderId) return true;
    }
  } catch (ignored) {}
  return false;
}

function imageIntegrityManagedFile_(file) {
  try {
    var name = file.getName();
    return IMAGE_INTEGRITY_MANAGED_NAME_.test(name) &&
      IMAGE_MIME_TYPES[file.getMimeType()] === name.split('.').pop();
  } catch (ignored) {
    return false;
  }
}

function previewImageIntegrity_(actor) {
  assertAdminActor_(actor);
  var folderId = getRuntimeConfig_().DRIVE_FOLDER_ID;
  assertApp_(folderId, 'CONFIG_ERROR', 'กรุณาตั้งค่า DRIVE_FOLDER_ID ก่อนตรวจสอบภาพ', null, false);
  var state = imageIntegrityState_();
  var knownFolders = imageIntegrityKnownFolders_(state, folderId);
  var issues = [];
  var counts = {
    unavailable_references: 0,
    trashed_references: 0,
    stale_urls: 0,
    orphan_files: 0,
    started_uploads: 0,
    unreadable_folders: 0,
    invalid_folder_evidence: 0
  };
  function add(issue) {
    if (issues.length < IMAGE_INTEGRITY_MAX_ISSUES_) issues.push(issue);
  }
  state.equipment.forEach(function (record) {
    var fileId = normalizeWhitespace_(record.image_file_id);
    if (!fileId) {
      if (normalizeWhitespace_(record.image_url)) {
        counts.stale_urls += 1;
        add({ kind: 'STALE_URL', asset_id: record.asset_id, file_id: '',
          can_repair: false, suggested_action: 'REUPLOAD_IMAGE' });
      }
      return;
    }
    var inspection = inspectImageFileReference_(fileId);
    if (inspection.state === 'AVAILABLE') {
      try {
        if (IMAGE_MIME_TYPES[inspection.file.getMimeType()] &&
          Number(inspection.file.getSize()) > 0) return;
      } catch (ignored) {}
    }
    var trashed = inspection.state === 'TRASHED';
    counts[trashed ? 'trashed_references' : 'unavailable_references'] += 1;
    add({ kind: trashed ? 'TRASHED_REFERENCE' : 'UNAVAILABLE_REFERENCE',
      asset_id: record.asset_id, file_id: fileId, can_repair: false,
      suggested_action: 'REUPLOAD_IMAGE' });
  });
  state.operations.forEach(function (operation) {
    counts.started_uploads += 1;
    add({ kind: 'STARTED_UPLOAD', asset_id: operation.asset_id || operation.entity_id,
      file_id: operation.resource_id || '', operation_id: operation.operation_id,
      can_repair: true, suggested_action: 'RECONCILE_OPERATION' });
  });
  knownFolders.invalidEvidence.forEach(function (operationId) {
    counts.invalid_folder_evidence += 1;
    add({ kind: 'HISTORICAL_FOLDER_EVIDENCE_INVALID', operation_id: operationId,
      folder_id: '', can_repair: false, suggested_action: 'INSPECT_OPERATION' });
  });
  var scannedFiles = Object.create(null);
  knownFolders.ids.forEach(function (scanFolderId) {
    try {
      var files = getImageFolder_(scanFolderId).getFiles();
      while (files.hasNext()) {
        var file = files.next();
        if (file.isTrashed() || !IMAGE_MIME_TYPES[file.getMimeType()]) continue;
        var id = file.getId();
        if (scannedFiles[id]) continue;
        scannedFiles[id] = true;
        if (state.referenced[id] || state.protectedResources[id] ||
          state.protectedNames[file.getName()]) continue;
        counts.orphan_files += 1;
        var repairable = imageIntegrityManagedFile_(file) &&
          imageIntegrityFileOwnedByDeployer_(file) &&
          imageIntegrityFileInFolder_(file, scanFolderId);
        add({ kind: 'ORPHAN_FILE', asset_id: '', file_id: id,
          folder_id: scanFolderId, file_name: file.getName(), can_repair: repairable,
          suggested_action: repairable ? 'TRASH_ORPHAN' : 'INSPECT_FILE' });
      }
    } catch (error) {
      if (scanFolderId === folderId) {
        if (error && error.name === 'AppError') throw error;
        throw new AppError_('CONFIG_ERROR', 'ไม่สามารถอ่านไฟล์จากโฟลเดอร์ภาพได้', null, false);
      }
      counts.unreadable_folders += 1;
      add({ kind: 'HISTORICAL_FOLDER_UNREADABLE', folder_id: scanFolderId,
        can_repair: false, suggested_action: 'INSPECT_FOLDER' });
    }
  });
  var total = counts.unavailable_references + counts.trashed_references +
    counts.stale_urls + counts.orphan_files + counts.started_uploads +
    counts.unreadable_folders + counts.invalid_folder_evidence;
  return {
    generated_at: nowIso_(),
    generated_by: stripSheetEscape_(actor.email),
    summary: { total_issues: total, returned_issues: issues.length,
      truncated: total > issues.length, counts: counts },
    issues: issues
  };
}

function repairImageIntegrity_(input, actor) {
  assertAdminActor_(actor);
  input = input || {};
  assertApp_(input.confirm === true, 'VALIDATION_FAILED',
    'กรุณายืนยันการซ่อมรายการภาพก่อนดำเนินการ', null, false);
  var kind = normalizeWhitespace_(input.kind);
  if (kind === 'STARTED_UPLOAD') {
    var operationId = requireCommandId_(input.operation_id);
    var operation = findRecordById_(SHEETS.OPERATIONS, 'operation_id', operationId);
    assertApp_(operation && operation.action === 'UPLOAD_ASSET_IMAGE',
      'NOT_FOUND', 'ไม่พบ operation อัปโหลดภาพ', null, false);
    return reconcileOperationForAdmin_(operationId, actor);
  }
  assertApp_(kind === 'ORPHAN_FILE', 'VALIDATION_FAILED',
    'ซ่อมรายการภาพชนิดนี้ผ่านระบบอัปโหลดหรือกู้คืน operation', null, false);
  var fileId = normalizeWhitespace_(input.file_id);
  assertApp_(/^[A-Za-z0-9_-]{8,200}$/.test(fileId), 'VALIDATION_FAILED',
    'รหัสไฟล์ภาพไม่ถูกต้อง', null, false);
  return withAdminMutation_(actor, function () {
    var folderId = getRuntimeConfig_().DRIVE_FOLDER_ID;
    assertApp_(folderId, 'CONFIG_ERROR', 'กรุณาตั้งค่า DRIVE_FOLDER_ID', null, false);
    var file;
    try { file = DriveApp.getFileById(fileId); }
    catch (ignored) {
      throw new AppError_('NOT_FOUND', 'ไม่พบไฟล์ภาพที่ต้องการจัดการ', null, false);
    }
    var state = imageIntegrityState_();
    var knownFolders = imageIntegrityKnownFolders_(state, folderId);
    var parentFolderId = knownFolders.ids.filter(function (knownId) {
      return imageIntegrityFileInFolder_(file, knownId);
    })[0];
    assertApp_(parentFolderId && imageIntegrityManagedFile_(file), 'STATE_CONFLICT',
    'ไฟล์ไม่ได้อยู่ในโฟลเดอร์ภาพของระบบหรือชื่อไฟล์ไม่ตรงรูปแบบที่ระบบสร้าง', null, false);
    assertApp_(getImageFolder_(parentFolderId).getId() === parentFolderId,
      'STATE_CONFLICT', 'โฟลเดอร์ต้นทางของภาพไม่ตรงกับหลักฐานที่ระบบบันทึก', null, false);
    assertApp_(imageIntegrityFileOwnedByDeployer_(file), 'FORBIDDEN',
      'ระบบจัดการไฟล์ที่ไม่ได้เป็นของบัญชีที่ deploy ไม่ได้', null, false);
    assertApp_(!state.referenced[fileId] && !state.protectedResources[fileId] &&
      !state.protectedNames[file.getName()], 'STATE_CONFLICT',
    'ไฟล์นี้ถูกอ้างอิงโดยอุปกรณ์หรือ operation ที่ยังทำงานอยู่', null, false);
    if (file.isTrashed()) return { file_id: fileId, status: 'TRASHED', already_trashed: true };
    try {
      file.setTrashed(true);
      if (!file.isTrashed()) throw new Error('Drive did not confirm trash status');
    }
    catch (ignored) {
      throw new AppError_('DRIVE_ERROR', 'ไม่สามารถย้ายไฟล์ภาพกำพร้าไปถังขยะได้', null, true);
    }
    return { file_id: fileId, status: 'TRASHED', already_trashed: false };
  });
}
