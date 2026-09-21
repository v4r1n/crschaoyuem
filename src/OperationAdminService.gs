function listOperationsForAdmin_(query, actor) {
  assertAdminActor_(actor);
  query = query || {};
  var pageQuery = normalizePageQuery_(query,
    ['started_at', 'updated_at', 'status', 'action', 'entity_type'],
    'started_at', 'desc');
  var records = listRecords_(SHEETS.OPERATIONS).filter(function (operation) {
    return includesSearch_(operation,
      ['operation_id', 'action', 'entity_type', 'entity_id', 'asset_id', 'actor_email'],
      query.search) &&
      exactFilter_(operation.status, query.status) &&
      exactFilter_(operation.action, query.action) &&
      exactFilter_(operation.entity_type, query.entityType) &&
      exactFilter_(operation.asset_id, query.assetId);
  }).map(operationAdminDto_);
  var result = paginateRecords_(
    sortRecords_(records, pageQuery.sortBy, pageQuery.sortDirection), pageQuery);
  result.facets = {
    statuses: Object.keys(OPERATION_STATUS).map(function (key) { return OPERATION_STATUS[key]; })
  };
  return result;
}

function getOperationDetailForAdmin_(operationId, actor) {
  assertAdminActor_(actor);
  var normalizedId = requireCommandId_(operationId);
  var operation = findRecordById_(SHEETS.OPERATIONS, 'operation_id', normalizedId);
  assertApp_(operation, 'NOT_FOUND', 'ไม่พบ operation ที่ต้องการ', null, false);
  var dto = operationAdminDto_(operation);
  dto.payload = operationPayload_(operation);
  dto.before = operationBeforeState_(operation);
  dto.result = [OPERATION_STATUS.COMPLETED, OPERATION_STATUS.ABORTED]
    .indexOf(operation.status) !== -1
    ? operationResult_(operation)
    : null;
  return dto;
}

function reconcileOperationForAdmin_(operationId, actor) {
  assertAdminActor_(actor);
  var normalizedId = requireCommandId_(operationId);
  var operation = findRecordById_(SHEETS.OPERATIONS, 'operation_id', normalizedId);
  assertApp_(operation, 'NOT_FOUND', 'ไม่พบ operation ที่ต้องการกู้คืน', null, false);
  if (operation.status === OPERATION_STATUS.COMPLETED) {
    return getOperationDetailForAdmin_(normalizedId, actor);
  }
  assertApp_(operation.status === OPERATION_STATUS.STARTED, 'STATE_CONFLICT',
    'operation นี้ไม่ได้อยู่ในสถานะที่กู้คืนได้', null, false);
  var payload = operationPayload_(operation);
  var commandId = operation.operation_id;
  var result = null;
  if (operation.action === 'CREATE_ASSET') {
    result = createEquipment_(mergeObjects_(payload.equipment, {
      included_items: payload.includedItems,
      command_id: commandId
    }), actor);
  }
  if (operation.action === 'EDIT_ASSET') {
    var equipmentUpdateInput = mergeObjects_(payload.equipment, {
      asset_id: payload.assetId,
      expected_version: payload.expectedVersion,
      command_id: commandId
    });
    if (Array.isArray(payload.includedItems)) {
      equipmentUpdateInput.included_items = payload.includedItems;
    }
    result = updateEquipment_(equipmentUpdateInput, actor);
  }
  if (operation.action === 'CHANGE_STATUS') {
    result = changeEquipmentStatus_({
      asset_id: payload.assetId,
      expected_version: payload.expectedVersion,
      status: payload.status,
      note: payload.note,
      command_id: commandId
    }, actor);
  }
  if (operation.action === 'BORROW_REQUEST') {
    result = createBorrowRequest_({
      asset_id: payload.assetId,
      borrow_date: payload.borrowDate,
      due_date: payload.dueDate,
      purpose: payload.purpose,
      note: payload.note,
      command_id: commandId
    }, actor);
  }
  if (operation.action === 'APPROVE') {
    result = approveBorrow_({
      borrow_id: payload.borrowId,
      expected_version: payload.expectedVersion,
      command_id: commandId
    }, actor);
  }
  if (operation.action === 'REJECT') {
    result = rejectBorrow_({
      borrow_id: payload.borrowId,
      expected_version: payload.expectedVersion,
      reason: payload.reason,
      command_id: commandId
    }, actor);
  }
  if (operation.action === 'CHECKOUT') {
    result = checkoutBorrow_({
      borrow_id: payload.borrowId,
      expected_version: payload.expectedVersion,
      command_id: commandId
    }, actor);
  }
  if (operation.action === 'REQUEST_RETURN') {
    result = requestReturn_({
      borrow_id: payload.borrowId,
      expected_version: payload.expectedVersion,
      note: payload.note,
      command_id: commandId
    }, actor);
  }
  if (operation.action === 'RETURN') {
    result = completeReturn_({
      borrow_id: payload.borrowId,
      expected_version: payload.expectedVersion,
      condition: payload.condition,
      disposition: payload.disposition,
      note: payload.note,
      items: payload.items,
      command_id: commandId
    }, actor);
  }
  if (operation.action === 'CREATE_USER') {
    result = createUser_(mergeObjects_(payload, { command_id: commandId }), actor);
  }
  if (operation.action === 'EDIT_USER') {
    result = updateUser_(mergeObjects_(payload.user, {
      user_id: payload.userId,
      edit_proof: issueUserEditProof_({ user_id: payload.userId, row_version: payload.expectedVersion }, actor),
      expected_version: payload.expectedVersion,
      command_id: commandId
    }), actor);
  }
  if (operation.action === 'REPAIR_USER_ID') {
    result = repairLegacyUser_(mergeObjects_(payload, { command_id: commandId, confirm: true }), actor);
  }
  if (operation.action === 'CREATE_CATEGORY') {
    result = createCategory_(mergeObjects_(payload, { command_id: commandId }), actor);
  }
  if (operation.action === 'EDIT_CATEGORY') {
    result = updateCategory_(mergeObjects_(payload.category, {
      category_id: payload.categoryId,
      expected_version: payload.expectedVersion,
      command_id: commandId
    }), actor);
  }
  if (operation.action === 'UPLOAD_ASSET_IMAGE') {
    result = reconcileImageOperationForAdmin_(commandId, actor);
  }
  if (operation.action === 'AUTO_PROVISION_USER') {
    result = reconcileAutoProvisionOperationForAdmin_(commandId, actor);
  }
  if (!result) {
    throw new AppError_('UNSUPPORTED_OPERATION',
      'ยังไม่รองรับการกู้คืน operation action: ' + operation.action, null, false);
  }
  return getOperationDetailForAdmin_(commandId, actor);
}

function abortOperationForAdmin_(input, actor) {
  input = input || {};
  var operationId = requireCommandId_(input.operation_id);
  var reason = stripSheetEscape_(requireText_(input.reason, 'reason', 'เหตุผลที่ยกเลิก', 500));
  return withAdminMutation_(actor, function (lockedActor) {
    var operation = findRecordById_(SHEETS.OPERATIONS, 'operation_id', operationId);
    assertApp_(operation, 'NOT_FOUND', 'ไม่พบ operation ที่ต้องการยกเลิก', null, false);
    if (operation.status === OPERATION_STATUS.ABORTED) {
      var priorAbort = operationResult_(operation);
      assertApp_(priorAbort && priorAbort.aborted === true && priorAbort.reason === reason,
        'STATE_CONFLICT', 'operation นี้ถูกยกเลิกด้วยเหตุผลอื่นแล้ว', null, false);
      return getOperationDetailForAdmin_(operationId, lockedActor);
    }
    assertApp_(operation.status === OPERATION_STATUS.STARTED,
      'STATE_CONFLICT', 'operation นี้ไม่ได้อยู่ในสถานะที่ยกเลิกได้', null, false);
    assertApp_(operation.action === 'UPLOAD_ASSET_IMAGE', 'UNSUPPORTED_OPERATION',
      'ยกเลิกได้เฉพาะ operation อัปโหลดภาพที่ยังไม่เปลี่ยนข้อมูลอุปกรณ์', null, false);
    var payload = operationPayload_(operation);
    var before = operationBeforeState_(operation);
    var current = findRecordById_(SHEETS.EQUIPMENT, 'asset_id', operation.entity_id);
    assertApp_(current && before && operationRecordMatchesSnapshot_(
      SHEETS.EQUIPMENT, current, before),
    'STATE_CONFLICT', 'อุปกรณ์ถูกแก้ไขโดย operation นี้แล้ว จึงต้องกู้คืนให้เสร็จแทนการยกเลิก', null, false);
    assertApp_(!findHistoryByOperationLocked_(operation.operation_id), 'STATE_CONFLICT',
      'operation มีประวัติการเปลี่ยนแปลงแล้ว จึงยกเลิกไม่ได้', null, false);
    var folder = null;
    var folderLookupUncertain = false;
    try {
      folder = getImageFolder_(payload.folderId || getRuntimeConfig_().DRIVE_FOLDER_ID);
    } catch (folderError) {
      folderLookupUncertain = true;
    }
    var filename = current.asset_id + '-' + operation.operation_id + '.' +
      IMAGE_MIME_TYPES[payload.mimeType];
    var files = folder ? listUntrashedImagesByName_(folder, filename) : [];
    var resourceLookupUncertain = false;
    if (operation.resource_id) {
      var recordedResource = inspectImageFileReference_(operation.resource_id);
      resourceLookupUncertain = recordedResource.state === 'UNKNOWN';
      if (recordedResource.file && !files.some(function (file) {
        return file.getId() === recordedResource.file.getId();
      })) files.push(recordedResource.file);
      if (resourceLookupUncertain && files.some(function (file) {
        return file.getId() === operation.resource_id;
      })) resourceLookupUncertain = false;
    }
    var seenFileIds = Object.create(null);
    files.forEach(function (file) {
      if (seenFileIds[file.getId()]) return;
      seenFileIds[file.getId()] = true;
      assertApp_(file.getName() === filename && imageFileMatches_(
        file, payload.digest, payload.mimeType, payload.byteLength),
      'STATE_CONFLICT', 'พบไฟล์ของ operation ที่ไม่ตรงกับหลักฐานเดิม จึงยกเลิกอัตโนมัติไม่ได้', null, false);
    });
    files.forEach(function (file) {
      if (!file.isTrashed()) file.setTrashed(true);
    });
    operation = abortOperationLocked_(operation, {
      aborted: true,
      action: operation.action,
      entity_id: operation.entity_id,
      reason: reason,
      aborted_by: lockedActor.email,
      orphan_cleanup_required: folderLookupUncertain || resourceLookupUncertain
    });
    return getOperationDetailForAdmin_(operationId, lockedActor);
  });
}

function reconcileImageOperationForAdmin_(operationId, actor) {
  return withAdminMutation_(actor, function (lockedActor) {
    var operation = findRecordById_(SHEETS.OPERATIONS, 'operation_id', operationId);
    assertApp_(operation && operation.status === OPERATION_STATUS.STARTED &&
      operation.action === 'UPLOAD_ASSET_IMAGE',
    'STATE_CONFLICT', 'operation อัปโหลดภาพไม่ได้อยู่ในสถานะที่กู้คืนได้', null, false);
    var payload = operationPayload_(operation);
    var before = operationBeforeState_(operation);
    var current = findRecordById_(SHEETS.EQUIPMENT, 'asset_id', operation.entity_id);
    assertApp_(current && before, 'STATE_CONFLICT', 'ไม่พบอุปกรณ์สำหรับกู้คืนภาพ', null, false);
    var atSource = equipmentImageSourceMatches_(current, before);
    var atProjection = equipmentImageProjectionMatches_(current, before, operation);
    assertApp_(atSource || atProjection, 'STATE_CONFLICT',
      'อุปกรณ์ถูกแก้ไขต่อจาก operation อัปโหลดภาพแล้ว', null, false);
    var persistedHistory = findHistoryByOperationLocked_(operation.operation_id);
    if (persistedHistory) {
      assertApp_(atProjection && operation.resource_id &&
        current.image_file_id === operation.resource_id,
      'STATE_CONFLICT', 'หลักฐานภาพที่บันทึกแล้วไม่ตรงกับ operation', null, false);
      ensureOperationHistoryLocked_(equipmentImageHistoryEntry_(
        before, current, operation, 'Uploaded equipment image'), lockedActor);
      var persistedResult = equipmentResultLocked_(current.asset_id);
      finalizeOperationLocked_(operation, current.asset_id, persistedResult);
      return persistedResult;
    }
    var filename = current.asset_id + '-' + operation.operation_id + '.' +
      IMAGE_MIME_TYPES[payload.mimeType];
    var file = operation.resource_id ? getImageFileIfPresent_(operation.resource_id) : null;
    if (file && !imageFileMatches_(
      file, payload.digest, payload.mimeType, payload.byteLength)) file = null;
    if (!file) {
      var folder = getImageFolder_(payload.folderId || getRuntimeConfig_().DRIVE_FOLDER_ID);
      file = findRecoverableImageByName_(
        folder, filename, payload.digest, payload.mimeType, payload.byteLength);
    }
    assertApp_(file, 'UPLOAD_RETRY_REQUIRED',
      'ไม่พบไฟล์เดิม กรุณาอัปโหลดไฟล์เดิมซ้ำด้วยคำสั่งเดิม', null, true);
    if (operation.resource_id !== file.getId()) {
      operation = replaceOperationResourceLocked_(operation, file.getId());
    }
    applyImageSharing_(file, payload.sharingMode);
    var imageUrl = buildDriveImageUrl_(file.getId(), getDriveResourceKey_(file));
    if (atSource || current.image_file_id !== file.getId() || current.image_url !== imageUrl) {
      current = updateRecordById_(SHEETS.EQUIPMENT, 'asset_id', current.asset_id, {
        image_file_id: file.getId(),
        image_url: imageUrl,
        updated_at: operation.started_at,
        updated_by: operation.actor_email,
        row_version: Number(before.row_version) + 1
      });
    }
    ensureOperationHistoryLocked_(equipmentImageHistoryEntry_(
      before, current, operation, 'Uploaded equipment image'), lockedActor);
    var result = equipmentResultLocked_(current.asset_id);
    finalizeOperationLocked_(operation, current.asset_id, result);
    return result;
  });
}

function reconcileAutoProvisionOperationForAdmin_(operationId, actor) {
  return withAdminMutation_(actor, function (lockedActor) {
    var operation = findRecordById_(SHEETS.OPERATIONS, 'operation_id', operationId);
    assertApp_(operation && operation.status === OPERATION_STATUS.STARTED &&
      operation.action === 'AUTO_PROVISION_USER',
    'STATE_CONFLICT', 'operation สมัครผู้ใช้ไม่ได้อยู่ในสถานะที่กู้คืนได้', null, false);
    var payload = operationPayload_(operation);
    assertAllowedUserDomain_(payload.email);
    var expectedUser = {
      user_id: operation.entity_id,
      email: payload.email,
      name: payload.name,
      department: '',
      role: USER_ROLE.USER,
      status: RECORD_STATUS.ACTIVE,
      last_login_at: operation.started_at,
      created_at: operation.started_at,
      created_by: operation.actor_email,
      updated_at: operation.started_at,
      updated_by: operation.actor_email,
      row_version: 1
    };
    var user = findRecordById_(SHEETS.USERS, 'user_id', operation.entity_id);
    if (!user) {
      assertUniqueUserEmailLocked_(payload.email, operation.entity_id);
      user = insertRecord_(SHEETS.USERS, expectedUser);
    } else {
      assertApp_(operationRecordMatchesExpected_(SHEETS.USERS, user, expectedUser),
        'STATE_CONFLICT', 'ข้อมูลผู้ใช้ไม่ตรงกับ operation สมัครใช้งานอัตโนมัติ', null, false);
    }
    ensureOperationHistoryLocked_({
      entityType: 'USER',
      entityId: user.user_id,
      action: 'AUTO_PROVISION_USER',
      oldStatus: '',
      newStatus: user.status,
      note: 'Auto-provisioned by configured policy',
      operationId: operation.operation_id
    }, lockedActor);
    var result = toClientValue_(user);
    finalizeOperationLocked_(operation, user.user_id, result);
    return result;
  });
}

function operationAdminDto_(operation) {
  var dto = selectClientFields_(operation, [
    'operation_id', 'action', 'entity_type', 'entity_id', 'asset_id', 'resource_id',
    'actor_user_id', 'actor_email', 'status', 'started_at', 'completed_at', 'updated_at'
  ]);
  dto.can_reconcile = operation.status === OPERATION_STATUS.STARTED;
  dto.can_abort = operation.status === OPERATION_STATUS.STARTED &&
    operation.action === 'UPLOAD_ASSET_IMAGE';
  return dto;
}
