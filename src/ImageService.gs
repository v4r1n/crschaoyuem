var IMAGE_MIME_TYPES = Object.freeze({
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/gif': 'gif'
});

function uploadEquipmentImage_(input, actor) {
  input = input || {};
  var assetId = requireAssetId_(input.asset_id);
  var commandId = requireCommandId_(input.command_id);
  var mimeType = normalizeWhitespace_(input.mime_type).toLowerCase();
  assertApp_(IMAGE_MIME_TYPES[mimeType], 'VALIDATION_FAILED',
    'รองรับเฉพาะไฟล์ภาพ JPEG, PNG, WebP หรือ GIF', {
      fieldErrors: fieldError_('image', 'กรุณาเลือกไฟล์ JPEG, PNG, WebP หรือ GIF')
    }, false);
  var config = getRuntimeConfig_();
  var pendingOperation = findRecordById_(SHEETS.OPERATIONS, 'operation_id', commandId);
  var pendingPayload = pendingOperation && pendingOperation.action === 'UPLOAD_ASSET_IMAGE'
    ? operationPayload_(pendingOperation)
    : null;
  var maximumBytes = pendingPayload ? Number(pendingPayload.byteLength) : config.MAX_IMAGE_BYTES;
  assertApp_(Number.isSafeInteger(maximumBytes) && maximumBytes > 0 &&
    maximumBytes <= 10 * 1024 * 1024,
  'SCHEMA_ERROR', 'ขนาดไฟล์ใน operation อัปโหลดภาพไม่ถูกต้อง', null, false);
  var bytes = decodeImagePayload_(input.base64_data, mimeType, maximumBytes);
  assertApp_(bytes.length > 0 && bytes.length <= maximumBytes,
    'VALIDATION_FAILED', 'ไฟล์ภาพมีขนาดเกินกว่าที่ระบบกำหนด', {
      fieldErrors: fieldError_('image', 'ไฟล์ต้องมีขนาดไม่เกิน ' +
        Math.ceil(maximumBytes / (1024 * 1024)) + ' MB')
    }, false);
  assertImageSignature_(bytes, mimeType);
  var folderId = pendingPayload && pendingPayload.folderId
    ? pendingPayload.folderId
    : config.DRIVE_FOLDER_ID;
  var sharingMode = normalizeImageSharingMode_(pendingPayload
    ? pendingPayload.sharingMode
    : config.IMAGE_SHARING);
  assertApp_(folderId, 'CONFIG_ERROR',
    'กรุณาตั้งค่า DRIVE_FOLDER_ID ก่อนอัปโหลดภาพ', null, false);
  var digest = hashImageBytes_(bytes);
  var newFile = null;
  var resourceStored = false;
  try {
    return withAdminMutation_(actor, function (lockedActor) {
      var current = findRecordById_(SHEETS.EQUIPMENT, 'asset_id', assetId);
      assertApp_(current, 'NOT_FOUND', 'ไม่พบอุปกรณ์ที่ต้องการอัปโหลดภาพ', null, false);
      var spec = operationSpec_(commandId, 'UPLOAD_ASSET_IMAGE', 'EQUIPMENT', assetId, {
        assetId: assetId,
        expectedVersion: Number(input.expected_version),
        mimeType: mimeType,
        byteLength: bytes.length,
        digest: digest,
        sharingMode: sharingMode,
        folderId: folderId
      }, lockedActor);
      var operation = findOperationLocked_(spec);
      if (!operation) {
        var legacy = findHistoryByOperationLocked_(commandId);
        if (legacy) {
          assertOperationMatch_(legacy, 'UPLOAD_ASSET_IMAGE', 'EQUIPMENT', assetId);
          return equipmentResultLocked_(assetId);
        }
      }
      if (operation && operation.status === OPERATION_STATUS.COMPLETED) {
        var completedResult = operationResult_(operation);
        if (current.image_file_id === completedResult.image_file_id) {
          trashReplacedImageAfterCommit_(operation, operationBeforeState_(operation), current);
        }
        return mergeObjects_(completedResult, equipmentImageState_(completedResult.image_file_id));
      }
      var expectedVersion = Number(input.expected_version);
      if (!operation) {
        assertEquipmentNotDeleted_(current);
        assertExpectedVersion_(current, expectedVersion);
        assertImageFolderSharingPolicy_(getImageFolder_(folderId), sharingMode);
        operation = startOperationLocked_(spec, current);
      }
      var before = operationBeforeState_(operation);
      assertImageOperationIdentity_(operation, pendingPayload || operationPayload_(operation), before);
      var atSource = equipmentImageSourceMatches_(current, before);
      var atProjection = equipmentImageProjectionMatches_(current, before, operation);
      assertApp_(atSource || atProjection, 'STATE_CONFLICT',
        'ข้อมูลอุปกรณ์ถูกแก้ไขต่อจากคำสั่งอัปโหลดภาพที่ค้างอยู่แล้ว', null, false);
      var persistedHistory = findHistoryByOperationLocked_(operation.operation_id);
      if (persistedHistory) {
        assertApp_(atProjection && operation.resource_id &&
          current.image_file_id === operation.resource_id,
        'STATE_CONFLICT', 'หลักฐานภาพที่บันทึกแล้วไม่ตรงกับ operation', null, false);
        ensureOperationHistoryLocked_(
          equipmentImageHistoryEntry_(before, current, operation, 'Uploaded equipment image'),
          lockedActor
        );
        var persistedResult = equipmentResultLocked_(assetId);
        var persistedCompletion = finalizeOperationLocked_(operation, assetId, persistedResult);
        trashReplacedImageAfterCommit_(persistedCompletion, before, current);
        return persistedResult;
      }
      var filename = assetId + '-' + operation.operation_id + '.' + IMAGE_MIME_TYPES[mimeType];
      var inspection = operation.resource_id
        ? inspectImageFileReference_(operation.resource_id)
        : { state: 'NONE', file: null };
      var file = inspection.file;
      if (operation.resource_id && !file) {
        if (inspection.state === 'TRASHED') {
          throw new AppError_('UPLOAD_RETRY_REQUIRED',
            'ไฟล์ของคำสั่งเดิมอยู่ในถังขยะ กรุณาเริ่มอัปโหลดใหม่', null, true);
        }
        throw new AppError_('IMAGE_FILE_UNAVAILABLE',
          'ยังยืนยันไม่ได้ว่าไฟล์เดิมหายหรือเข้าถึงไม่ได้ กรุณาให้ผู้ดูแลระบบตรวจสอบ Operation ก่อนอัปโหลดใหม่',
          null, true);
      }
      if (!file) {
        var folder = getImageFolder_(folderId);
        file = findRecoverableImageByName_(
          folder, filename, digest, mimeType, bytes.length);
        if (!file) {
          newFile = folder.createFile(Utilities.newBlob(bytes, mimeType, filename));
          file = newFile;
        }
      }
      if (file !== newFile) {
        assertRecoverableImageEvidence_(file, operation, pendingPayload || operationPayload_(operation));
      }
      assertApp_(imageFileMatches_(file, digest, mimeType, bytes.length),
        'STATE_CONFLICT', 'ไฟล์ภาพใน Drive ไม่ตรงกับ operation ที่กำลังกู้คืน', null, false);
      if (operation.resource_id !== file.getId()) {
        operation = replaceOperationResourceLocked_(operation, file.getId());
        resourceStored = true;
      }
      applyImageSharing_(file, sharingMode);
      var imageUrl = buildDriveImageUrl_(file.getId(), getDriveResourceKey_(file));
      if (atSource || current.image_file_id !== file.getId() || current.image_url !== imageUrl) {
        current = updateRecordById_(SHEETS.EQUIPMENT, 'asset_id', assetId, {
          image_file_id: file.getId(),
          image_url: imageUrl,
          updated_at: operation.started_at,
          updated_by: operation.actor_email,
          row_version: Number(before.row_version) + 1
        });
      }
      ensureOperationHistoryLocked_(
        equipmentImageHistoryEntry_(before, current, operation, 'Uploaded equipment image'),
        lockedActor
      );
      var result = equipmentResultLocked_(assetId);
      var completedOperation = finalizeOperationLocked_(operation, assetId, result);
      trashReplacedImageAfterCommit_(completedOperation, before, current);
      return result;
    });
  } catch (error) {
    if (error && (error.code === 'DRIVE_SHARING_FAILED' ||
      error.code === 'UPLOAD_RETRY_REQUIRED')) {
      try {
        var aborted = abortOperationForAdmin_({
          operation_id: commandId,
          reason: error.code === 'UPLOAD_RETRY_REQUIRED'
            ? 'Pinned image is missing or inaccessible before equipment update'
            : 'Image sharing failed before the equipment record was updated'
        }, actor);
        if (aborted.status === OPERATION_STATUS.ABORTED) error.retryable = false;
      } catch (abortError) {
        console.warn('Image upload operation could not be automatically cancelled: ' +
          String(abortError && abortError.message ? abortError.message : abortError));
      }
    }
    if (newFile && !resourceStored) trashNewImageQuietly_(newFile);
    throw error;
  }
}

function hashImageBytes_(bytes) {
  return Utilities.base64EncodeWebSafe(
    Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, bytes)
  ).replace(/=+$/, '');
}

function decodeImagePayload_(payload, expectedMimeType, maximumBytes) {
  var encoded = String(payload || '').trim();
  var dataUrl = /^data:([^;,]+);base64,(.*)$/i.exec(encoded);
  if (dataUrl) {
    assertApp_(normalizeWhitespace_(dataUrl[1]).toLowerCase() === expectedMimeType,
      'VALIDATION_FAILED', 'ชนิดไฟล์ภาพไม่ตรงกับข้อมูลที่ส่งมา', {
        fieldErrors: fieldError_('image', 'ชนิดไฟล์ภาพไม่ถูกต้อง')
      }, false);
    encoded = dataUrl[2];
  }
  encoded = encoded.replace(/\s+/g, '');
  assertApp_(encoded && /^[A-Za-z0-9+/]*={0,2}$/.test(encoded) && encoded.length % 4 === 0,
    'VALIDATION_FAILED', 'ข้อมูลไฟล์ภาพไม่ถูกต้อง', {
      fieldErrors: fieldError_('image', 'ไม่สามารถอ่านไฟล์ภาพนี้ได้')
    }, false);
  assertApp_(Math.floor(encoded.length * 3 / 4) <= Number(maximumBytes) + 2,
    'VALIDATION_FAILED', 'ไฟล์ภาพมีขนาดเกินกว่าที่ระบบกำหนด', {
      fieldErrors: fieldError_('image', 'ไฟล์ภาพมีขนาดใหญ่เกินไป')
    }, false);
  try {
    return Utilities.base64Decode(encoded);
  } catch (error) {
    throw new AppError_('VALIDATION_FAILED', 'ข้อมูลไฟล์ภาพไม่ถูกต้อง', {
      fieldErrors: fieldError_('image', 'ไม่สามารถอ่านไฟล์ภาพนี้ได้')
    }, false);
  }
}

function assertImageSignature_(bytes, mimeType) {
  function byteAt(index) { return Number(bytes[index]) & 255; }
  var matches = false;
  if (mimeType === 'image/jpeg') {
    matches = bytes.length >= 3 && byteAt(0) === 0xff && byteAt(1) === 0xd8 && byteAt(2) === 0xff;
  } else if (mimeType === 'image/png') {
    var png = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
    matches = bytes.length >= png.length && png.every(function (value, index) {
      return byteAt(index) === value;
    });
  } else if (mimeType === 'image/webp') {
    matches = bytes.length >= 12 &&
      String.fromCharCode(byteAt(0), byteAt(1), byteAt(2), byteAt(3)) === 'RIFF' &&
      String.fromCharCode(byteAt(8), byteAt(9), byteAt(10), byteAt(11)) === 'WEBP';
  } else if (mimeType === 'image/gif') {
    matches = bytes.length >= 6 &&
      ['GIF87a', 'GIF89a'].indexOf(String.fromCharCode(
        byteAt(0), byteAt(1), byteAt(2), byteAt(3), byteAt(4), byteAt(5))) !== -1;
  }
  assertApp_(matches, 'VALIDATION_FAILED', 'เนื้อหาไฟล์ไม่ตรงกับชนิดภาพ', {
    fieldErrors: fieldError_('image', 'ไฟล์ภาพเสียหายหรือเปลี่ยนนามสกุลไม่ถูกต้อง')
  }, false);
}

function getImageFolder_(folderId) {
  try {
    return DriveApp.getFolderById(folderId);
  } catch (error) {
    throw new AppError_('CONFIG_ERROR',
      'ไม่สามารถเปิดโฟลเดอร์รูปภาพได้ กรุณาตรวจ DRIVE_FOLDER_ID และสิทธิ์เข้าถึง', null, false);
  }
}

function assertImageFolderSharingPolicy_(folder, sharingMode) {
  var access;
  var permission;
  try {
    access = folder.getSharingAccess();
    permission = folder.getSharingPermission();
  } catch (error) {
    throw new AppError_('CONFIG_ERROR',
      'ไม่สามารถตรวจสิทธิ์โฟลเดอร์ภาพได้ กรุณาตรวจ DRIVE_FOLDER_ID และสิทธิ์ของบัญชีที่ deploy', {
        cause: String(error && error.message ? error.message : error)
      }, false);
  }
  var broaderAccess = access === DriveApp.Access.ANYONE ||
    (sharingMode === 'DOMAIN_WITH_LINK' &&
      (access === DriveApp.Access.ANYONE_WITH_LINK || access === DriveApp.Access.DOMAIN));
  var elevatedPermission = access !== DriveApp.Access.PRIVATE &&
    permission !== DriveApp.Permission.VIEW;
  assertApp_(!broaderAccess && !elevatedPermission, 'CONFIG_ERROR',
    'สิทธิ์โฟลเดอร์ภาพกว้างกว่า IMAGE_SHARING ที่กำหนด กรุณาปรับสิทธิ์โฟลเดอร์หรือนโยบายข้อมูลก่อนอัปโหลด', {
      imageSharing: sharingMode,
      folderAccess: String(access),
      folderPermission: String(permission)
    }, false);
}

function getImageFileIfPresent_(fileId) {
  try {
    var file = DriveApp.getFileById(fileId);
    return file.isTrashed() ? null : file;
  } catch (ignored) {
    return null;
  }
}

function inspectImageFileReference_(fileId) {
  if (!normalizeWhitespace_(fileId)) return { state: 'NONE', file: null };
  try {
    var file = DriveApp.getFileById(fileId);
    return file.isTrashed()
      ? { state: 'TRASHED', file: null }
      : { state: 'AVAILABLE', file: file };
  } catch (ignored) {
    return { state: 'UNKNOWN', file: null };
  }
}

function findRecoverableImageByName_(folder, filename, digest, mimeType, byteLength) {
  var files = folder.getFilesByName(filename);
  var match = null;
  while (files.hasNext()) {
    var candidate = files.next();
    if (candidate.isTrashed()) continue;
    assertApp_(imageFileMatches_(candidate, digest, mimeType, byteLength), 'STATE_CONFLICT',
      'พบไฟล์ชื่อเดียวกับ operation แต่เนื้อหาไม่ตรงกับหลักฐาน กรุณาตรวจสอบก่อนกู้คืน', null, false);
    assertApp_(!match, 'STATE_CONFLICT',
      'พบไฟล์กู้คืนของ operation เดียวกันมากกว่าหนึ่งไฟล์ กรุณาติดต่อผู้ดูแลระบบ', null, false);
    match = candidate;
  }
  return match;
}

function assertImageOperationIdentity_(operation, payload, before) {
  assertApp_(operation.action === 'UPLOAD_ASSET_IMAGE' &&
    operation.entity_type === 'EQUIPMENT' && operation.entity_id === operation.asset_id &&
    payload.assetId === operation.asset_id && before && before.asset_id === operation.asset_id &&
    Number.isSafeInteger(Number(payload.expectedVersion)) &&
    Number(payload.expectedVersion) === Number(before.row_version) &&
    IMAGE_MIME_TYPES[payload.mimeType] && Number.isSafeInteger(Number(payload.byteLength)) &&
    Number(payload.byteLength) > 0 && Number(payload.byteLength) <= 10 * 1024 * 1024 &&
    /^[A-Za-z0-9_-]{43}$/.test(String(payload.digest || '')),
  'STATE_CONFLICT', 'หลักฐานอุปกรณ์หรือไฟล์ของ operation อัปโหลดภาพไม่ตรงกัน', null, false);
}

function assertRecoverableImageEvidence_(file, operation, payload) {
  var filename = operation.asset_id + '-' + operation.operation_id + '.' +
    IMAGE_MIME_TYPES[payload.mimeType];
  assertApp_(file && imageFileMatches_(file, payload.digest, payload.mimeType,
    payload.byteLength), 'STATE_CONFLICT',
  'ไฟล์ภาพที่กู้คืนมีเนื้อหา ชนิด หรือขนาดไม่ตรงกับ operation', null, false);
  var ownerEmail = '';
  var deployerEmail = '';
  var inFolder = false;
  var actualName = '';
  try {
    actualName = file.getName();
    var parents = file.getParents();
    while (parents.hasNext()) {
      if (parents.next().getId() === payload.folderId) inFolder = true;
    }
    var owner = file.getOwner();
    ownerEmail = owner ? normalizeEmail_(owner.getEmail()) : '';
    deployerEmail = normalizeEmail_(Session.getEffectiveUser().getEmail());
  } catch (error) {
    throw new AppError_('STATE_CONFLICT',
      'ไม่สามารถตรวจชื่อ โฟลเดอร์ หรือเจ้าของไฟล์ภาพก่อนกู้คืนได้', null, false);
  }
  assertApp_(actualName === filename && inFolder && deployerEmail &&
    (!ownerEmail || ownerEmail === deployerEmail), 'STATE_CONFLICT',
  'ไฟล์ภาพไม่อยู่ในโฟลเดอร์ของคำสั่ง หรือไม่ได้เป็นของบัญชีที่ deploy', null, false);
}

function trashReplacedImageAfterCommit_(operation, before, current) {
  var oldFileId = before && normalizeWhitespace_(before.image_file_id);
  if (!oldFileId || oldFileId === current.image_file_id ||
    operation.status !== OPERATION_STATUS.COMPLETED ||
    operation.resource_id !== current.image_file_id) return;
  // A failed Drive cleanup must not roll back an Equipment row that now points to the new image.
  try {
    var operations = listRecords_(SHEETS.OPERATIONS);
    var stillReferenced = listRecords_(SHEETS.EQUIPMENT).some(function (record) {
      return record.image_file_id === oldFileId;
    }) || operations.some(function (record) {
      return record.status === OPERATION_STATUS.STARTED && record.resource_id === oldFileId;
    });
    if (stillReferenced) return;
    var oldFile = getImageFileIfPresent_(oldFileId);
    if (!oldFile) return;
    var payload = operationPayload_(operation);
    var oldOperation = operations.find(function (record) {
      return record.action === 'UPLOAD_ASSET_IMAGE' &&
        record.status === OPERATION_STATUS.COMPLETED &&
        record.entity_id === current.asset_id && record.resource_id === oldFileId;
    });
    var originFolderId = oldOperation
      ? operationPayload_(oldOperation).folderId
      : payload.folderId;
    var managedName = /^AST-\d{6}-[A-Za-z0-9_-]{8,100}\.(jpg|png|webp|gif)$/;
    if (!managedName.test(oldFile.getName()) ||
      oldFile.getName().indexOf(current.asset_id + '-') !== 0 ||
      IMAGE_MIME_TYPES[oldFile.getMimeType()] !== oldFile.getName().split('.').pop()) return;
    var parents = oldFile.getParents();
    var inFolder = false;
    while (parents.hasNext()) {
      if (parents.next().getId() === originFolderId) inFolder = true;
    }
    var owner = oldFile.getOwner();
    var deployer = normalizeEmail_(Session.getEffectiveUser().getEmail());
    if (!inFolder || !deployer || (owner && normalizeEmail_(owner.getEmail()) !== deployer)) return;
    oldFile.setTrashed(true);
  } catch (error) {
    console.warn('Unable to trash replaced image after Equipment commit: ' +
      String(error && error.message ? error.message : error));
  }
}

function listUntrashedImagesByName_(folder, filename) {
  var files = folder.getFilesByName(filename);
  var result = [];
  while (files.hasNext()) {
    var file = files.next();
    if (!file.isTrashed()) result.push(file);
  }
  return result;
}

function imageFileMatches_(file, digest, mimeType, byteLength) {
  try {
    if (!file || file.isTrashed() || file.getMimeType() !== mimeType ||
      Number(file.getSize()) !== Number(byteLength)) return false;
    return hashImageBytes_(file.getBlob().getBytes()) === digest;
  } catch (ignored) {
    return false;
  }
}

function applyImageSharing_(file, sharingMode) {
  var mode = normalizeImageSharingMode_(sharingMode);
  var expectedAccess = null;
  if (mode === 'DOMAIN_WITH_LINK') {
    expectedAccess = DriveApp.Access.DOMAIN_WITH_LINK;
  } else if (mode === 'ANYONE_WITH_LINK') {
    expectedAccess = DriveApp.Access.ANYONE_WITH_LINK;
  }
  try {
    var actualAccess = file.getSharingAccess();
    var actualPermission = file.getSharingPermission();
    if (actualAccess === expectedAccess && actualPermission === DriveApp.Permission.VIEW) return;
    file.setSharing(expectedAccess, DriveApp.Permission.VIEW);
    actualAccess = file.getSharingAccess();
    actualPermission = file.getSharingPermission();
    assertApp_(actualAccess === expectedAccess &&
      actualPermission === DriveApp.Permission.VIEW,
      'DRIVE_SHARING_FAILED',
      'ไม่สามารถตั้งค่าสิทธิ์ไฟล์ภาพตามนโยบายที่กำหนดได้', {
        expectedAccess: String(expectedAccess),
        actualAccess: String(actualAccess),
        actualPermission: String(actualPermission)
      }, true);
  } catch (error) {
    if (error && error.name === 'AppError') throw error;
    throw new AppError_('DRIVE_SHARING_FAILED',
      'ไม่สามารถตั้งค่าสิทธิ์ไฟล์ภาพตามนโยบายที่กำหนดได้', {
        cause: String(error && error.message ? error.message : error)
      }, true);
  }
}

function getDriveResourceKey_(file) {
  try { return String(file.getResourceKey() || ''); }
  catch (ignored) { return ''; }
}

function buildDriveImageUrl_(fileId, resourceKey) {
  var url = 'https://drive.google.com/thumbnail?id=' + encodeURIComponent(fileId) + '&sz=w1600';
  return resourceKey ? url + '&resourcekey=' + encodeURIComponent(resourceKey) : url;
}

function equipmentImageState_(fileId) {
  if (!normalizeWhitespace_(fileId)) return { imageAvailable: false, image_url: '' };
  var file = getImageFileIfPresent_(fileId);
  if (!file) return { imageAvailable: false, image_url: '' };
  try {
    if (!IMAGE_MIME_TYPES[file.getMimeType()] || Number(file.getSize()) <= 0) {
      return { imageAvailable: false, image_url: '' };
    }
    return {
      imageAvailable: true,
      image_url: buildDriveImageUrl_(fileId, getDriveResourceKey_(file))
    };
  } catch (ignored) {
    return { imageAvailable: false, image_url: '' };
  }
}

function equipmentImageSourceMatches_(current, before) {
  return operationRecordMatchesSnapshot_(SHEETS.EQUIPMENT, current, before);
}

function equipmentImageProjectionMatches_(current, before, operation) {
  if (Number(current.row_version) !== Number(before.row_version) + 1 ||
    current.updated_at !== operation.started_at || current.updated_by !== operation.actor_email ||
    !current.image_file_id || !isDriveImageUrlForFile_(current.image_url, current.image_file_id)) return false;
  var changedFields = {
    image_file_id: true,
    image_url: true,
    updated_at: true,
    updated_by: true,
    row_version: true
  };
  return SHEET_SCHEMAS[SHEETS.EQUIPMENT].every(function (fieldName) {
    if (changedFields[fieldName]) return true;
    return stableJson_(toSerializable_(current[fieldName])) ===
      stableJson_(toSerializable_(before[fieldName]));
  });
}

function isDriveImageUrlForFile_(url, fileId) {
  var base = buildDriveImageUrl_(fileId, '');
  return url === base || String(url || '').indexOf(base + '&resourcekey=') === 0;
}

function equipmentImageHistoryEntry_(before, current, operation, note) {
  return {
    entityType: 'EQUIPMENT',
    entityId: current.asset_id,
    assetId: current.asset_id,
    action: 'UPLOAD_ASSET_IMAGE',
    oldStatus: before.status,
    newStatus: before.status,
    note: note,
    changedFields: changedFields_(before, current, ['image_file_id', 'image_url']),
    operationId: operation.operation_id
  };
}

function trashNewImageQuietly_(file) {
  try {
    if (!file.isTrashed()) file.setTrashed(true);
  } catch (ignored) {
    console.warn('Unable to trash unattached image file: ' + (file && file.getId ? file.getId() : 'unknown'));
  }
}
