function listEquipment_(query, user) {
  user = assertUserActor_(user);
  query = query || {};
  var pageQuery = normalizePageQuery_(
    query,
    ['asset_id', 'sku', 'name', 'brand', 'model', 'status', 'location', 'created_at'],
    'name',
    'asc'
  );
  var categories = categoryMap_();
  var records = listRecords_(SHEETS.EQUIPMENT).filter(function (record) {
    if (record.status === EQUIPMENT_STATUS.DELETED &&
      !(user.role === USER_ROLE.ADMIN && query.status === EQUIPMENT_STATUS.DELETED)) return false;
    return includesSearch_(record,
      ['asset_id', 'sku', 'name', 'brand', 'model', 'serial_number'], query.search) &&
      exactFilter_(record.category_id, query.categoryId) &&
      exactFilter_(record.status, query.status) &&
      exactFilter_(record.location, query.location) &&
      exactFilter_(record.department, query.department);
  });
  var result = paginateRecords_(
    sortRecords_(records, pageQuery.sortBy, pageQuery.sortDirection),
    pageQuery
  );
  result.items = result.items.map(function (record) {
    return equipmentDto_(record, categories, user.role === USER_ROLE.ADMIN);
  });
  result.facets = equipmentFacets_();
  return result;
}

function getEquipmentDetail_(assetId, user) {
  user = assertUserActor_(user);
  var normalizedId = requireAssetId_(assetId);
  var equipment = findRecordById_(SHEETS.EQUIPMENT, 'asset_id', normalizedId);
  assertApp_(equipment, 'NOT_FOUND', 'ไม่พบอุปกรณ์ที่ต้องการ', null, false);
  var isAdmin = user.role === USER_ROLE.ADMIN;
  assertApp_(equipment.status !== EQUIPMENT_STATUS.DELETED || isAdmin,
    'NOT_FOUND', 'อุปกรณ์นี้ถูกลบออกจากรายการแล้ว', null, false);
  var dto = equipmentDto_(equipment, categoryMap_(), isAdmin);
  if (isAdmin) dto.pending_operation = pendingEquipmentOperation_(equipment);
  dto.included_items = listActiveIncludedItems_(normalizedId).map(function (item) {
    return includedItemDto_(item, isAdmin);
  });
  return dto;
}

function pendingEquipmentOperation_(equipment) {
  var operation = listRecords_(SHEETS.OPERATIONS).find(function (record) {
    return record.asset_id === equipment.asset_id && record.status === OPERATION_STATUS.STARTED;
  });
  if (!operation) return null;
  var canAbort = false;
  if (operation.action === 'UPLOAD_ASSET_IMAGE') {
    try {
      canAbort = operationRecordMatchesSnapshot_(SHEETS.EQUIPMENT, equipment,
        operationBeforeState_(operation)) && !findHistoryByOperationLocked_(operation.operation_id);
    } catch (error) { canAbort = false; }
  }
  return { operation_id: operation.operation_id, action: operation.action,
    started_at: operation.started_at, can_abort: canAbort };
}

function createEquipment_(input, actor) {
  input = input || {};
  var commandId = requireCommandId_(input.command_id);
  var normalized = normalizeEquipmentInput_(input, null);
  var includedItems = hasOwn_(input, 'included_items')
    ? normalizeIncludedItemsInput_(input.included_items)
    : [];
  return withAdminMutation_(actor, function (lockedActor) {
    var spec = operationSpec_(commandId, 'CREATE_ASSET', 'EQUIPMENT', '', {
      equipment: normalized,
      includedItems: includedItems
    }, lockedActor);
    var operation = findOperationLocked_(spec);
    if (!operation) {
      var legacy = findHistoryByOperationLocked_(commandId);
      if (legacy) {
        assertOperationMatch_(legacy, 'CREATE_ASSET', 'EQUIPMENT', '');
        return equipmentResultLocked_(legacy.entity_id);
      }
    }
    if (operation && operation.status === OPERATION_STATUS.COMPLETED) {
      return equipmentOperationResultWithLiveImage_(operation);
    }
    var assetId = operation && operation.entity_id;
    if (!operation) {
      assertActiveCategoryLocked_(normalized.category_id);
      assertUniqueSerialLocked_(normalized.serial_number, '');
      preflightIncludedItemsLocked_('', includedItems);
      operation = startOperationLocked_(spec, null);
    }
    if (!assetId) {
      assetId = nextIdLocked_('ASSET');
      operation = setOperationEntityLocked_(operation, assetId);
    }
    var record = findRecordById_(SHEETS.EQUIPMENT, 'asset_id', assetId);
    var timestamp = operation.started_at;
    var expectedRecord = mergeObjects_(normalized, {
      asset_id: assetId,
      quantity: 1,
      active_borrow_id: '',
      image_file_id: '',
      image_url: '',
      qr_url: buildAssetUrl_(assetId),
      created_at: timestamp,
      created_by: operation.actor_email,
      updated_at: timestamp,
      updated_by: operation.actor_email,
      row_version: 1
    });
    if (!record) {
      assertUniqueSerialLocked_(normalized.serial_number, assetId);
      record = expectedRecord;
      insertRecord_(SHEETS.EQUIPMENT, record);
    } else {
      assertApp_(operationRecordMatchesExpected_(SHEETS.EQUIPMENT, record, expectedRecord),
      'STATE_CONFLICT', 'ข้อมูลอุปกรณ์ของคำสั่งที่ค้างอยู่ไม่ตรงกับข้อมูลปัจจุบัน', null, false);
    }
    syncIncludedItemsLocked_(assetId, includedItems,
      { email: operation.actor_email }, operation.started_at);
    ensureOperationHistoryLocked_({
      entityType: 'EQUIPMENT',
      entityId: assetId,
      assetId: assetId,
      action: 'CREATE_ASSET',
      oldStatus: '',
      newStatus: record.status,
      note: record.note,
      changedFields: changedFields_(null, record, Object.keys(record)),
      operationId: commandId
    }, lockedActor);
    var result = equipmentResultLocked_(assetId);
    finalizeOperationLocked_(operation, assetId, result);
    return result;
  });
}

function updateEquipment_(input, actor) {
  input = input || {};
  var assetId = requireAssetId_(input.asset_id);
  var commandId = requireCommandId_(input.command_id);
  var includedItems = hasOwn_(input, 'included_items')
    ? normalizeIncludedItemsInput_(input.included_items)
    : null;
  return withAdminMutation_(actor, function (lockedActor) {
    var current = findRecordById_(SHEETS.EQUIPMENT, 'asset_id', assetId);
    assertApp_(current, 'NOT_FOUND', 'ไม่พบอุปกรณ์ที่ต้องการแก้ไข', null, false);
    var normalized = normalizeEquipmentInput_(input, current);
    var operationEquipmentPayload = cloneObject_(normalized);
    delete operationEquipmentPayload.status;
    var spec = operationSpec_(commandId, 'EDIT_ASSET', 'EQUIPMENT', assetId, {
      assetId: assetId,
      expectedVersion: Number(input.expected_version),
      equipment: operationEquipmentPayload,
      includedItems: includedItems
    }, lockedActor);
    var operation = findOperationLocked_(spec);
    if (!operation) {
      var legacy = findHistoryByOperationLocked_(commandId);
      if (legacy) {
        assertOperationMatch_(legacy, 'EDIT_ASSET', 'EQUIPMENT', assetId);
        return equipmentResultLocked_(assetId);
      }
    }
    if (operation && operation.status === OPERATION_STATUS.COMPLETED) {
      return equipmentOperationResultWithLiveImage_(operation);
    }
    var expectedVersion = Number(input.expected_version);
    if (!operation) {
      assertEquipmentNotDeleted_(current);
      assertExpectedVersion_(current, expectedVersion);
      assertActiveCategoryLocked_(normalized.category_id);
      assertUniqueSerialLocked_(normalized.serial_number, assetId);
      if (includedItems) preflightIncludedItemsLocked_(assetId, includedItems);
      operation = startOperationLocked_(spec, current);
    }
    var before = operationBeforeState_(operation);
    var targetChanges = mergeObjects_(normalized, {
      qr_url: buildAssetUrl_(assetId),
      updated_at: operation.started_at,
      updated_by: operation.actor_email,
      row_version: Number(before.row_version) + 1
    });
    var atSource = operationRecordMatchesSnapshot_(SHEETS.EQUIPMENT, current, before);
    var atTarget = operationRecordMatchesChanges_(
      SHEETS.EQUIPMENT, current, before, targetChanges);
    assertApp_(atSource || atTarget, 'STATE_CONFLICT',
      'ข้อมูลอุปกรณ์ถูกแก้ไขต่อจากคำสั่งที่ค้างอยู่แล้ว', {
        currentVersion: Number(current.row_version)
      }, false);
    var updated = current;
    if (atSource) {
      assertUniqueSerialLocked_(normalized.serial_number, assetId);
      updated = updateRecordById_(SHEETS.EQUIPMENT, 'asset_id', assetId, targetChanges);
    }
    if (includedItems) syncIncludedItemsLocked_(assetId, includedItems,
      { email: operation.actor_email }, operation.started_at);
    ensureOperationHistoryLocked_({
      entityType: 'EQUIPMENT',
      entityId: assetId,
      assetId: assetId,
      action: 'EDIT_ASSET',
      oldStatus: before.status,
      newStatus: updated.status,
      note: updated.note,
      changedFields: changedFields_(before, updated,
        Object.keys(normalized).concat(['qr_url', 'updated_at', 'updated_by', 'row_version'])),
      operationId: commandId
    }, lockedActor);
    var result = equipmentResultLocked_(assetId);
    finalizeOperationLocked_(operation, assetId, result);
    return result;
  });
}

function changeEquipmentStatus_(input, actor) {
  return transitionEquipmentStatus_(input, actor, 'CHANGE_STATUS');
}

function deleteEquipment_(input, actor) {
  input = input || {};
  var assetId = requireAssetId_(input.asset_id);
  assertApp_(input.confirm === true && input.confirm_asset_id === assetId,
    'VALIDATION_FAILED', 'กรุณาพิมพ์รหัสอุปกรณ์และยืนยันการลบ', null, false);
  return transitionEquipmentStatus_(mergeObjects_(input, {
    status: EQUIPMENT_STATUS.DELETED, note: 'ลบอุปกรณ์ออกจากรายการ'
  }), actor, 'DELETE_ASSET');
}

function assertEquipmentNotDeleted_(equipment) {
  assertApp_(equipment.status !== EQUIPMENT_STATUS.DELETED, 'STATE_CONFLICT',
    'อุปกรณ์นี้ถูกลบแล้ว ไม่สามารถแก้ไขหรือใช้งานต่อได้', null, false);
}

function transitionEquipmentStatus_(input, actor, action) {
  input = input || {};
  var assetId = requireAssetId_(input.asset_id);
  var commandId = requireCommandId_(input.command_id);
  var allowed = [
    EQUIPMENT_STATUS.AVAILABLE,
    EQUIPMENT_STATUS.MAINTENANCE,
    EQUIPMENT_STATUS.DAMAGED,
    EQUIPMENT_STATUS.LOST,
    EQUIPMENT_STATUS.RETIRED
  ];
  if (action === 'DELETE_ASSET') allowed = [EQUIPMENT_STATUS.DELETED];
  var newStatus = requireEnum_(input.status, allowed, 'status', 'สถานะ');
  var note = optionalText_(input.note, 'note', 'หมายเหตุ', 2000, true);
  return withAdminMutation_(actor, function (lockedActor) {
    var current = findRecordById_(SHEETS.EQUIPMENT, 'asset_id', assetId);
    assertApp_(current, 'NOT_FOUND', 'ไม่พบอุปกรณ์ที่ต้องการ', null, false);
    var spec = operationSpec_(commandId, action, 'EQUIPMENT', assetId, {
      assetId: assetId,
      expectedVersion: Number(input.expected_version),
      status: newStatus,
      note: note
    }, lockedActor);
    var operation = findOperationLocked_(spec);
    if (!operation) {
      var legacy = findHistoryByOperationLocked_(commandId);
      if (legacy) {
        assertOperationMatch_(legacy, action, 'EQUIPMENT', assetId);
        return equipmentResultLocked_(assetId);
      }
    }
    if (operation && operation.status === OPERATION_STATUS.COMPLETED) {
      return equipmentOperationResultWithLiveImage_(operation);
    }
    assertApp_(!current.active_borrow_id && !findActiveBorrowForAssetLocked_(assetId),
      'STATE_CONFLICT', 'อุปกรณ์มีรายการยืมที่กำลังดำเนินการ จึงลบหรือเปลี่ยนสถานะโดยตรงไม่ได้', null, false);
    assertApp_(WORKFLOW_EQUIPMENT_STATUSES.indexOf(current.status) === -1,
      'STATE_CONFLICT', 'สถานะนี้ควบคุมโดยขั้นตอนยืม–คืน', null, false);
    var expectedVersion = Number(input.expected_version);
    if (!operation) {
      assertEquipmentNotDeleted_(current);
      assertExpectedVersion_(current, expectedVersion);
      assertApp_(current.status !== newStatus, 'STATE_CONFLICT',
        'อุปกรณ์อยู่ในสถานะนี้แล้ว', null, false);
      operation = startOperationLocked_(spec, current);
    }
    var before = operationBeforeState_(operation);
    var targetNote = action === 'DELETE_ASSET' ? before.note : (note || before.note);
    var targetChanges = {
      status: newStatus,
      note: targetNote,
      updated_at: operation.started_at,
      updated_by: operation.actor_email,
      row_version: Number(before.row_version) + 1
    };
    var atSource = operationRecordMatchesSnapshot_(SHEETS.EQUIPMENT, current, before);
    var atTarget = operationRecordMatchesChanges_(
      SHEETS.EQUIPMENT, current, before, targetChanges);
    assertApp_(atSource || atTarget, 'STATE_CONFLICT',
      'ข้อมูลอุปกรณ์ถูกแก้ไขต่อจากคำสั่งที่ค้างอยู่แล้ว', {
        currentVersion: Number(current.row_version)
      }, false);
    var updated = current;
    if (atSource) {
      updated = updateRecordById_(SHEETS.EQUIPMENT, 'asset_id', assetId, targetChanges);
    }
    ensureOperationHistoryLocked_({
      entityType: 'EQUIPMENT',
      entityId: assetId,
      assetId: assetId,
      action: action,
      oldStatus: before.status,
      newStatus: newStatus,
      note: note,
      changedFields: changedFields_(before, updated, ['status', 'note']),
      operationId: commandId
    }, lockedActor);
    var result = equipmentResultLocked_(assetId);
    finalizeOperationLocked_(operation, assetId, result);
    return result;
  });
}

function normalizeEquipmentInput_(input, current) {
  var operationalStatuses = [
    EQUIPMENT_STATUS.AVAILABLE,
    EQUIPMENT_STATUS.MAINTENANCE,
    EQUIPMENT_STATUS.DAMAGED,
    EQUIPMENT_STATUS.LOST,
    EQUIPMENT_STATUS.RETIRED
  ];
  var status = current
    ? current.status
    : requireEnum_(input.status || EQUIPMENT_STATUS.AVAILABLE, operationalStatuses, 'status', 'สถานะ');
  return {
    sku: requireText_(input.sku, 'sku', 'SKU', 100).toUpperCase(),
    name: requireText_(input.name, 'name', 'ชื่ออุปกรณ์', 200),
    category_id: requireText_(input.category_id, 'category_id', 'หมวดหมู่', 30),
    brand: optionalText_(input.brand, 'brand', 'ยี่ห้อ', 100, false),
    model: optionalText_(input.model, 'model', 'รุ่น', 100, false),
    serial_number: optionalText_(input.serial_number, 'serial_number', 'Serial Number', 150, false),
    specification: optionalText_(input.specification, 'specification', 'Specification', 5000, true),
    description: optionalText_(input.description, 'description', 'รายละเอียด', 5000, true),
    quantity: 1,
    purchase_date: input.purchase_date ? parseDateOnly_(input.purchase_date, 'purchase_date') : '',
    purchase_price: optionalMoney_(input.purchase_price, 'purchase_price'),
    department: requireText_(input.department, 'department', 'หน่วยงานเจ้าของ', 150),
    location: requireText_(input.location, 'location', 'สถานที่จัดเก็บ', 200),
    status: status,
    note: optionalText_(input.note, 'note', 'หมายเหตุ', 2000, true)
  };
}

function normalizeIncludedItemsInput_(items) {
  assertApp_(Array.isArray(items), 'VALIDATION_FAILED', 'รูปแบบอุปกรณ์ประกอบไม่ถูกต้อง', null, false);
  assertApp_(items.length <= 100, 'VALIDATION_FAILED', 'อุปกรณ์ประกอบมากเกินกำหนด', null, false);
  var names = Object.create(null);
  var itemIds = Object.create(null);
  return items.map(function (item, index) {
    item = item || {};
    var name = requireText_(item.item_name, 'included_items.' + index + '.item_name', 'ชื่ออุปกรณ์ประกอบ', 150);
    var normalizedName = stripSheetEscape_(name).toLowerCase();
    assertApp_(!names[normalizedName], 'VALIDATION_FAILED', 'ชื่ออุปกรณ์ประกอบซ้ำ: ' + stripSheetEscape_(name), null, false);
    names[normalizedName] = true;
    var itemId = normalizeWhitespace_(item.item_id);
    assertApp_(!itemId || !itemIds[itemId], 'VALIDATION_FAILED',
      'พบอุปกรณ์ประกอบรหัสซ้ำ: ' + itemId, {
        fieldErrors: fieldError_('included_items.' + index + '.item_id', 'รหัสอุปกรณ์ประกอบซ้ำ')
      }, false);
    if (itemId) itemIds[itemId] = true;
    return {
      item_id: itemId,
      item_name: name,
      quantity: requirePositiveInteger_(item.quantity || 1, 'included_items.' + index + '.quantity', 'จำนวน', 1, 100),
      is_required: item.is_required === false ? false : true,
      sort_order: Number.isSafeInteger(Number(item.sort_order)) ? Number(item.sort_order) : index + 1,
      note: optionalText_(item.note, 'included_items.' + index + '.note', 'หมายเหตุ', 500, true)
    };
  });
}

function syncIncludedItemsLocked_(assetId, items, actor, operationTimestamp) {
  var existing = listRecords_(SHEETS.INCLUDED_ITEMS).filter(function (record) {
    return record.asset_id === assetId;
  });
  var byId = Object.create(null);
  var byName = Object.create(null);
  existing.forEach(function (record) {
    byId[record.item_id] = record;
    var key = normalizeWhitespace_(stripSheetEscape_(record.item_name)).toLowerCase();
    if (!byName[key] || record.status === RECORD_STATUS.ACTIVE) byName[key] = record;
  });
  var retained = Object.create(null);
  var timestamp = operationTimestamp || nowIso_();
  var updates = [];
  var newItems = [];
  items.forEach(function (item) {
    var itemNameKey = normalizeWhitespace_(stripSheetEscape_(item.item_name)).toLowerCase();
    var current = item.item_id ? byId[item.item_id] : byName[itemNameKey];
    if (current && !retained[current.item_id]) {
      retained[current.item_id] = true;
      updates.push({
        id: current.item_id,
        changes: {
          item_name: item.item_name,
          quantity: item.quantity,
          is_required: item.is_required,
          status: RECORD_STATUS.ACTIVE,
          sort_order: item.sort_order,
          note: item.note,
          updated_at: timestamp,
          updated_by: actor.email
        }
      });
      return;
    }
    assertApp_(!item.item_id, 'VALIDATION_FAILED',
      'ไม่พบอุปกรณ์ประกอบ ' + item.item_id, null, false);
    newItems.push(item);
  });
  existing.forEach(function (record) {
    if (record.status === RECORD_STATUS.ACTIVE && !retained[record.item_id]) {
      updates.push({
        id: record.item_id,
        changes: {
          status: RECORD_STATUS.INACTIVE,
          updated_at: timestamp,
          updated_by: actor.email
        }
      });
    }
  });
  updateRecordsById_(SHEETS.INCLUDED_ITEMS, 'item_id', updates);
  var itemIds = nextIdsLocked_('ITEM', newItems.length);
  insertRecords_(SHEETS.INCLUDED_ITEMS, newItems.map(function (item, index) {
    return {
      item_id: itemIds[index],
      asset_id: assetId,
      item_name: item.item_name,
      quantity: item.quantity,
      is_required: item.is_required,
      status: RECORD_STATUS.ACTIVE,
      sort_order: item.sort_order,
      note: item.note,
      created_at: timestamp,
      created_by: actor.email,
      updated_at: timestamp,
      updated_by: actor.email
    };
  }));
}

function preflightIncludedItemsLocked_(assetId, items) {
  if (!assetId) {
    var suppliedId = items.some(function (item) { return Boolean(item.item_id); });
    assertApp_(!suppliedId, 'VALIDATION_FAILED',
      'รายการอุปกรณ์ใหม่ต้องไม่ระบุ item_id เอง', {
        fieldErrors: fieldError_('included_items', 'กรุณาลบรหัสอุปกรณ์ประกอบที่กำหนดเอง')
      }, false);
    return;
  }
  var validIds = Object.create(null);
  listRecords_(SHEETS.INCLUDED_ITEMS).forEach(function (record) {
    if (record.asset_id === assetId) validIds[record.item_id] = true;
  });
  items.forEach(function (item, index) {
    assertApp_(!item.item_id || validIds[item.item_id], 'VALIDATION_FAILED',
      'ไม่พบอุปกรณ์ประกอบ ' + item.item_id + ' ในอุปกรณ์รายการนี้', {
        fieldErrors: fieldError_('included_items.' + index + '.item_id',
          'รหัสอุปกรณ์ประกอบไม่อยู่ในอุปกรณ์รายการนี้')
      }, false);
  });
}

function assertActiveCategoryLocked_(categoryId) {
  var category = findRecordById_(SHEETS.CATEGORIES, 'category_id', categoryId);
  assertApp_(category && category.status === RECORD_STATUS.ACTIVE,
    'VALIDATION_FAILED', 'หมวดหมู่ไม่ถูกต้องหรือปิดใช้งานแล้ว', {
      fieldErrors: fieldError_('category_id', 'กรุณาเลือกหมวดหมู่ที่เปิดใช้งาน')
    }, false);
  return category;
}

function assertUniqueSerialLocked_(serialNumber, exceptAssetId) {
  var normalized = normalizeSerial_(serialNumber);
  if (!normalized) return;
  var duplicate = listRecords_(SHEETS.EQUIPMENT).some(function (record) {
    return record.asset_id !== exceptAssetId && normalizeSerial_(record.serial_number) === normalized;
  });
  assertApp_(!duplicate, 'DUPLICATE_SERIAL', 'Serial Number นี้มีอยู่ในระบบแล้ว', {
    fieldErrors: fieldError_('serial_number', 'Serial Number ต้องไม่ซ้ำ')
  }, false);
}

function listActiveIncludedItems_(assetId) {
  return listRecords_(SHEETS.INCLUDED_ITEMS).filter(function (record) {
    return record.asset_id === assetId && record.status === RECORD_STATUS.ACTIVE;
  }).sort(function (left, right) {
    return Number(left.sort_order || 0) - Number(right.sort_order || 0);
  });
}

function categoryMap_() {
  var cacheEpoch = getCacheEpoch_();
  var cached = cacheGetJson_('category-map', cacheEpoch);
  if (cached) return cached;
  var result = Object.create(null);
  listRecords_(SHEETS.CATEGORIES).forEach(function (record) {
    result[record.category_id] = {
      category_id: record.category_id,
      category_name: stripSheetEscape_(record.category_name),
      prefix: stripSheetEscape_(record.prefix),
      status: record.status
    };
  });
  cachePutJson_('category-map', result, null, cacheEpoch);
  return result;
}

function equipmentDto_(record, categories, includeAdminFields) {
  var userFields = [
    'asset_id', 'sku', 'name', 'category_id', 'brand', 'model', 'serial_number',
    'specification', 'description', 'quantity', 'department', 'location', 'status',
    'image_url', 'qr_url', 'note', 'row_version'
  ];
  var dto = includeAdminFields ? toClientValue_(record) : selectClientFields_(record, userFields);
  var imageState = equipmentImageState_(record.image_file_id);
  dto.imageAvailable = imageState.imageAvailable;
  dto.image_url = imageState.image_url;
  dto.category_name = categories && categories[record.category_id]
    ? categories[record.category_id].category_name
    : '';
  // Stored qr_url is only a cache and may contain an old account-routed URL.
  // Never expose it as a fallback when canonical link generation is unavailable.
  dto.qr_url = buildAssetUrl_(record.asset_id);
  dto.can_borrow = record.status === EQUIPMENT_STATUS.AVAILABLE && !record.active_borrow_id;
  return dto;
}

function equipmentOperationResultWithLiveImage_(operation) {
  var result = operationResult_(operation);
  return result ? mergeObjects_(result, equipmentImageState_(result.image_file_id)) : result;
}

function equipmentResultLocked_(assetId) {
  var equipment = findRecordById_(SHEETS.EQUIPMENT, 'asset_id', assetId);
  assertApp_(equipment, 'NOT_FOUND', 'ไม่พบอุปกรณ์ที่ต้องการ', null, false);
  var result = equipmentDto_(equipment, categoryMap_(), true);
  result.included_items = listActiveIncludedItems_(assetId).map(function (item) {
    return includedItemDto_(item, true);
  });
  return result;
}

function includedItemDto_(record, includeAdminFields) {
  return includeAdminFields ? toClientValue_(record) : selectClientFields_(record, [
    'item_id', 'item_name', 'quantity', 'is_required', 'sort_order', 'note'
  ]);
}

function equipmentFacets_() {
  var cacheEpoch = getCacheEpoch_();
  var cached = cacheGetJson_('equipment-facets', cacheEpoch);
  if (cached) return cached;
  var categories = categoryMap_();
  var locations = Object.create(null);
  var departments = Object.create(null);
  listRecords_(SHEETS.EQUIPMENT).forEach(function (record) {
    if (record.status === EQUIPMENT_STATUS.DELETED) return;
    if (record.location) locations[stripSheetEscape_(record.location)] = true;
    if (record.department) departments[stripSheetEscape_(record.department)] = true;
  });
  var result = {
    categories: Object.keys(categories).map(function (key) { return categories[key]; })
      .filter(function (category) { return category.status === RECORD_STATUS.ACTIVE; })
      .sort(function (left, right) { return left.category_name.localeCompare(right.category_name, 'th'); }),
    statuses: Object.keys(EQUIPMENT_STATUS).map(function (key) { return EQUIPMENT_STATUS[key]; }),
    locations: Object.keys(locations).sort(function (left, right) { return left.localeCompare(right, 'th'); }),
    departments: Object.keys(departments).sort(function (left, right) { return left.localeCompare(right, 'th'); })
  };
  cachePutJson_('equipment-facets', result, null, cacheEpoch);
  return result;
}
