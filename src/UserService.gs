function listUsersForAdmin_(query, actor) {
  assertAdminActor_(actor);
  query = query || {};
  var pageQuery = normalizePageQuery_(
    query,
    ['user_id', 'email', 'name', 'department', 'role', 'status', 'last_login_at', 'created_at', 'updated_at'],
    'name',
    'asc'
  );
  var records = listRecords_(SHEETS.USERS).filter(function (record) {
    return includesSearch_(record, ['user_id', 'email', 'name', 'department'], query.search) &&
      exactFilter_(record.role, query.role) &&
      exactFilter_(record.status, query.status) &&
      exactFilter_(record.department, query.department);
  });
  var result = paginateRecords_(
    sortRecords_(records, pageQuery.sortBy, pageQuery.sortDirection),
    pageQuery
  );
  result.facets = userFacets_(records);
  result.items = result.items.map(function (record) {
    return mergeObjects_(record, { edit_proof: issueUserEditProof_(record, actor) });
  });
  return result;
}

function createUser_(input, actor) {
  input = input || {};
  assertApp_(!Object.prototype.hasOwnProperty.call(input, 'user_id'),
    'VALIDATION_FAILED', 'User ID ถูกสร้างโดยระบบเท่านั้น', null, false);
  var commandId = requireCommandId_(input.command_id);
  var normalized = normalizeUserInput_(input);
  return withAdminMutation_(actor, function (lockedActor) {
    var spec = operationSpec_(commandId, 'CREATE_USER', 'USER', '', normalized, lockedActor);
    var operation = findOperationLocked_(spec);
    if (!operation) {
      var legacy = findHistoryByOperationLocked_(commandId);
      if (legacy) {
        assertOperationMatch_(legacy, 'CREATE_USER', 'USER', '');
        return userResultLocked_(legacy.entity_id);
      }
    }
    if (operation && operation.status === OPERATION_STATUS.COMPLETED) {
      return operationResult_(operation);
    }
    var userId = operation && operation.entity_id;
    if (!operation) {
      assertAllowedUserDomain_(normalized.email);
      assertUniqueUserEmailLocked_(normalized.email, '');
      operation = startOperationLocked_(spec, null);
    }
    if (!userId) {
      userId = nextIdLocked_('USER');
      operation = setOperationEntityLocked_(operation, userId);
    }
    var record = findRecordById_(SHEETS.USERS, 'user_id', userId);
    var timestamp = operation.started_at;
    var expectedRecord = mergeObjects_(normalized, {
      user_id: userId,
      last_login_at: '',
      created_at: timestamp,
      created_by: operation.actor_email,
      updated_at: timestamp,
      updated_by: operation.actor_email,
      row_version: 1
    });
    if (!record) {
      assertAllowedUserDomain_(normalized.email);
      assertUniqueUserEmailLocked_(normalized.email, userId);
      record = expectedRecord;
      insertRecord_(SHEETS.USERS, record);
    } else {
      assertApp_(operationRecordMatchesExpected_(SHEETS.USERS, record, expectedRecord),
      'STATE_CONFLICT', 'ข้อมูลผู้ใช้ของคำสั่งที่ค้างอยู่ไม่ตรงกับข้อมูลปัจจุบัน', null, false);
    }
    ensureOperationHistoryLocked_({
      entityType: 'USER',
      entityId: userId,
      action: 'CREATE_USER',
      oldStatus: '',
      newStatus: record.status,
      note: 'สร้างผู้ใช้ ' + stripSheetEscape_(record.email),
      changedFields: changedFields_(null, record, Object.keys(record)),
      operationId: commandId
    }, lockedActor);
    var result = userResultLocked_(userId);
    finalizeOperationLocked_(operation, userId, result);
    return result;
  });
}

function updateUser_(input, actor) {
  input = input || {};
  var userId = requireUserRecordId_(input.user_id);
  assertApp_(userId === input.user_id, 'VALIDATION_FAILED', 'User ID ต้องตรงกับ record เดิม', null, false);
  var commandId = requireCommandId_(input.command_id);
  var normalized = normalizeUserInput_(input);
  verifyUserEditProof_(input, actor);
  return withAdminMutation_(actor, function (lockedActor) {
    assertUniqueUserIdsLocked_();
    var current = findRecordById_(SHEETS.USERS, 'user_id', userId);
    assertApp_(current, 'NOT_FOUND', 'ไม่พบผู้ใช้ที่ต้องการแก้ไข', null, false);
    assertApp_(
      current.user_id !== lockedActor.user_id ||
        normalizeEmail_(normalized.email) === normalizeEmail_(current.email),
      'VALIDATION_FAILED', 'ไม่สามารถเปลี่ยนอีเมลของบัญชีที่กำลังใช้งาน', {
        fieldErrors: fieldError_('email',
          'ให้ผู้ดูแลระบบคนอื่นเป็นผู้เปลี่ยนอีเมลของบัญชีนี้')
      }, false
    );
    var spec = operationSpec_(commandId, 'EDIT_USER', 'USER', userId, {
      userId: userId,
      expectedVersion: Number(input.expected_version),
      user: normalized
    }, lockedActor);
    var operation = findOperationLocked_(spec);
    if (!operation) {
      var legacy = findHistoryByOperationLocked_(commandId);
      if (legacy) {
        assertOperationMatch_(legacy, 'EDIT_USER', 'USER', userId);
        return userResultLocked_(userId);
      }
    }
    if (operation && operation.status === OPERATION_STATUS.COMPLETED) {
      return operationResult_(operation);
    }
    var expectedVersion = Number(input.expected_version);
    if (!operation) {
      assertExpectedVersion_(current, expectedVersion);
      assertAllowedUserDomain_(normalized.email);
      assertUniqueUserEmailLocked_(normalized.email, userId);
      assertLastActiveAdminPreservedLocked_(current, normalized);
      operation = startOperationLocked_(spec, current);
    }
    var before = operationBeforeState_(operation);
    var targetChanges = mergeObjects_(normalized, {
      updated_at: operation.started_at,
      updated_by: operation.actor_email,
      row_version: Number(before.row_version) + 1
    });
    var atSource = operationRecordMatchesSnapshot_(SHEETS.USERS, current, before);
    var atTarget = operationRecordMatchesChanges_(SHEETS.USERS, current, before, targetChanges);
    assertApp_(atSource || atTarget, 'STATE_CONFLICT',
      'ข้อมูลผู้ใช้ถูกแก้ไขต่อจากคำสั่งที่ค้างอยู่แล้ว', {
        currentVersion: Number(current.row_version)
      }, false);
    var updated = current;
    if (atSource) {
      assertAllowedUserDomain_(normalized.email);
      assertUniqueUserEmailLocked_(normalized.email, userId);
      assertLastActiveAdminPreservedLocked_(current, normalized);
      updated = updateRecordById_(SHEETS.USERS, 'user_id', userId, targetChanges);
    }
    ensureOperationHistoryLocked_({
      entityType: 'USER',
      entityId: userId,
      action: 'EDIT_USER',
      oldStatus: before.status,
      newStatus: updated.status,
      note: 'แก้ไขผู้ใช้ ' + stripSheetEscape_(updated.email),
      changedFields: changedFields_(before, updated,
        Object.keys(normalized).concat(['updated_at', 'updated_by', 'row_version'])),
      operationId: commandId
    }, lockedActor);
    var result = toClientValue_(updated);
    finalizeOperationLocked_(operation, userId, result);
    return result;
  });
}

function normalizeUserInput_(input) {
  return {
    email: requireEmail_(input.email, 'email'),
    name: requireText_(input.name, 'name', 'ชื่อผู้ใช้', 200),
    department: optionalText_(input.department, 'department', 'หน่วยงาน', 150, false),
    role: requireEnum_(input.role, [USER_ROLE.USER, USER_ROLE.ADMIN], 'role', 'สิทธิ์ผู้ใช้'),
    status: requireEnum_(input.status || RECORD_STATUS.ACTIVE,
      [RECORD_STATUS.ACTIVE, RECORD_STATUS.INACTIVE], 'status', 'สถานะ')
  };
}

function issueUserEditProof_(record, actor) {
  var proof = createOAuthRandomValue_('useredit1_');
  CacheService.getScriptCache().put('crs-user-edit:' + sha256Base64Url_(proof), JSON.stringify({
    actor: actor.user_id, userId: record.user_id, version: Number(record.row_version),
    expiresAt: Date.now() + 3600000
  }), 3600);
  return proof;
}

function verifyUserEditProof_(input, actor) {
  var proof = String(input.edit_proof || '');
  assertApp_(/^useredit1_[A-Za-z0-9_-]{43}$/.test(proof), 'STATE_CONFLICT',
    'กรุณาเปิดรายการผู้ใช้ใหม่ก่อนแก้ไข', null, false);
  var stored = CacheService.getScriptCache().get('crs-user-edit:' + sha256Base64Url_(proof));
  var binding = stored ? JSON.parse(stored) : null;
  assertApp_(binding && binding.actor === actor.user_id && binding.userId === input.user_id &&
    binding.version === Number(input.expected_version) && binding.expiresAt > Date.now(),
    'STATE_CONFLICT', 'User ID หรือ edit proof ไม่ตรงกับ record เดิม กรุณาโหลดใหม่', null, false);
}

function requireUserRecordId_(value) {
  var userId = normalizeWhitespace_(value).toUpperCase();
  assertApp_(/^USR-\d{6}$/.test(userId), 'VALIDATION_FAILED', 'User ID ไม่ถูกต้อง', {
    fieldErrors: fieldError_('user_id', 'User ID ต้องอยู่ในรูปแบบ USR-000001')
  }, false);
  return userId;
}

function assertAllowedUserDomain_(email) {
  var domains = getRuntimeConfig_().ALLOWED_DOMAINS || [];
  assertApp_(domains.length, 'CONFIG_ERROR',
    'กรุณาตั้งค่า ALLOWED_DOMAINS ก่อนจัดการผู้ใช้', null, false);
  var allowed = domains.some(function (domain) {
    return isEmailInDomain_(email, domain);
  });
  assertApp_(allowed, 'VALIDATION_FAILED',
    'อีเมลอยู่นอกโดเมน Google ที่อนุญาต', {
      fieldErrors: fieldError_('email',
        'กรุณาใช้อีเมลในโดเมนที่อนุญาต: ' + domains.map(function (domain) {
          return '@' + domain;
        }).join(', '))
    }, false);
}

function assertUniqueUserEmailLocked_(email, exceptUserId) {
  var normalized = normalizeEmail_(email);
  var records = listRecords_(SHEETS.USERS);
  var excluded = exceptUserId ? records.filter(function (record) {
    return record.user_id === exceptUserId;
  }) : [];
  assertApp_(excluded.length <= 1, 'STATE_CONFLICT', 'User ID ซ้ำ ต้องตรวจข้อมูลก่อนแก้ไข', null, false);
  var duplicate = records.some(function (record) {
    return (!excluded.length || record.__rowNumber !== excluded[0].__rowNumber) &&
      normalizeEmail_(stripSheetEscape_(record.email)) === normalized;
  });
  assertApp_(!duplicate, 'DUPLICATE_EMAIL', 'อีเมลนี้มีอยู่ในระบบแล้ว', {
    fieldErrors: fieldError_('email', 'อีเมลผู้ใช้ต้องไม่ซ้ำ')
  }, false);
}

function assertUniqueUserIdsLocked_() {
  var seen = Object.create(null);
  listRecords_(SHEETS.USERS).forEach(function (record) {
    if (!record.user_id) return;
    assertApp_(!seen[record.user_id], 'STATE_CONFLICT', 'User ID ซ้ำ ต้องตรวจข้อมูลก่อนแก้ไข', null, false);
    seen[record.user_id] = true;
  });
}

function assertLastActiveAdminPreservedLocked_(current, target) {
  var removesActiveAdmin = current.role === USER_ROLE.ADMIN &&
    current.status === RECORD_STATUS.ACTIVE &&
    (target.role !== USER_ROLE.ADMIN || target.status !== RECORD_STATUS.ACTIVE);
  if (!removesActiveAdmin) return;
  var anotherActiveAdmin = listRecords_(SHEETS.USERS).some(function (record) {
    return record.user_id !== current.user_id &&
      record.role === USER_ROLE.ADMIN &&
      record.status === RECORD_STATUS.ACTIVE;
  });
  assertApp_(anotherActiveAdmin, 'LAST_ACTIVE_ADMIN',
    'ไม่สามารถลดสิทธิ์หรือปิดใช้งานผู้ดูแลระบบคนสุดท้ายได้', null, false);
}

function userResultLocked_(userId) {
  var user = findRecordById_(SHEETS.USERS, 'user_id', userId);
  assertApp_(user, 'NOT_FOUND', 'ไม่พบผู้ใช้ที่ต้องการ', null, false);
  return toClientValue_(user);
}

function userFacets_(records) {
  var departments = Object.create(null);
  records.forEach(function (record) {
    if (record.department) departments[stripSheetEscape_(record.department)] = true;
  });
  return {
    roles: [USER_ROLE.USER, USER_ROLE.ADMIN],
    statuses: [RECORD_STATUS.ACTIVE, RECORD_STATUS.INACTIVE],
    departments: Object.keys(departments).sort(function (left, right) {
      return left.localeCompare(right, 'th');
    })
  };
}

// Conservative migration: never rewrite historical references or audit hashes.
function legacyUserBlockersLocked_(record, ignoredOperationId) {
  var reasons = [];
  var email = normalizeEmail_(stripSheetEscape_(record.email));
  var oldId = String(record.user_id || '');
  var known = Object.keys(SHEETS).map(function (key) { return SHEETS[key]; });
  if (Object.keys(record).some(function (field) {
    return typeof record[field] === 'string' && /^=/.test(record[field]);
  })) reasons.push('FORMULA_LITERAL_REQUIRES_REVIEW');
  getSpreadsheet_().getSheets().forEach(function (sheet) {
    if (known.indexOf(sheet.getName()) === -1) reasons.push('UNKNOWN_SHEET:' + sheet.getName());
  });
  var users = listRecords_(SHEETS.USERS);
  if (!email || users.filter(function (row) {
    return normalizeEmail_(stripSheetEscape_(row.email)) === email;
  }).length !== 1) reasons.push('DUPLICATE_OR_EMPTY_EMAIL');
  if (users.filter(function (row) { return String(row.user_id || '') === oldId; }).length !== 1) {
    reasons.push('AMBIGUOUS_USER_ID');
  }
  try { normalizeUserInput_(record); assertAllowedUserDomain_(email); }
  catch (error) { reasons.push('INVALID_USER_FIELDS'); }
  if (!Number.isSafeInteger(Number(record.row_version)) || Number(record.row_version) < 1) {
    reasons.push('INVALID_ROW_VERSION');
  }
  known.forEach(function (name) {
    var table = readTable_(name);
    if (table.sheet.getRange(1, 1, Math.max(table.lastRow, 1), table.headers.length)
      .getFormulas().some(function (row) { return row.some(function (cell) { return !!cell; }); })) {
      reasons.push('FORMULAS_REQUIRE_REVIEW:' + name);
    }
    table.records.forEach(function (row) {
      if (name === SHEETS.USERS && row.__rowNumber === record.__rowNumber) return;
      if (ignoredOperationId && (name === SHEETS.OPERATIONS || name === SHEETS.HISTORY) &&
        row.operation_id === ignoredOperationId) return;
      var content = stableJson_(row).toLowerCase();
      if ((oldId && content.indexOf(oldId.toLowerCase()) !== -1) ||
        (email && content.indexOf(email) !== -1)) reasons.push('REFERENCE:' + name + ':' + row.__rowNumber);
      // A blank historic actor/borrower cannot safely be attributed to a blank-ID user.
      if (!oldId && (name === SHEETS.BORROW || name === SHEETS.HISTORY || name === SHEETS.OPERATIONS)) {
        reasons.push('BLANK_ID_AUDIT_AMBIGUITY:' + name);
      }
    });
  });
  return reasons.filter(function (reason, index) { return reasons.indexOf(reason) === index; });
}

function auditLegacyUsersLocked_() {
  return { candidates: listRecords_(SHEETS.USERS).filter(function (record) {
    return !/^USR-\d{6}$/.test(String(record.user_id || ''));
  }).map(function (record) {
    var blockers = legacyUserBlockersLocked_(record, '');
    return { row: record.__rowNumber, old_user_id: record.user_id,
      email: stripSheetEscape_(record.email), fingerprint: hashOperationPayload_(record),
      repairable: blockers.length === 0, blockers: blockers };
  }) };
}

function repairLegacyUser_(input, actor) {
  assertApp_(input.confirm === true && Number.isSafeInteger(input.row) && input.row >= 2 &&
    typeof input.fingerprint === 'string', 'VALIDATION_FAILED', 'ต้องยืนยันผล audit ก่อน repair', null, false);
  assertApp_(!Object.prototype.hasOwnProperty.call(input, 'user_id'), 'VALIDATION_FAILED',
    'ระบบเป็นผู้สร้าง User ID เท่านั้น', null, false);
  return withAdminMutation_(actor, function (lockedActor) {
    var spec = operationSpec_(requireCommandId_(input.command_id), 'REPAIR_USER_ID', 'USER', '',
      { row: input.row, fingerprint: input.fingerprint }, lockedActor);
    var operation = findOperationLocked_(spec);
    if (operation && operation.status === OPERATION_STATUS.COMPLETED) return operationResult_(operation);
    var table = readTable_(SHEETS.USERS);
    var current = table.records.filter(function (row) { return row.__rowNumber === input.row; })[0];
    assertApp_(current, 'NOT_FOUND', 'ไม่พบ legacy row', null, false);
    if (!operation) {
      assertApp_(hashOperationPayload_(current) === input.fingerprint &&
        !/^USR-\d{6}$/.test(String(current.user_id || '')), 'STATE_CONFLICT', 'ข้อมูลเปลี่ยน กรุณา audit ใหม่', null, false);
      var blockers = legacyUserBlockersLocked_(current, '');
      assertApp_(!blockers.length, 'MIGRATION_BLOCKED', 'ไม่สามารถรักษา referential/audit integrity ได้',
        { blockers: blockers }, false);
      operation = startOperationLocked_(spec, current);
    }
    var before = operationBeforeState_(operation);
    if (!operation.entity_id) operation = setOperationEntityLocked_(operation, nextIdLocked_('USER'));
    var target = mergeObjects_(before, { user_id: operation.entity_id,
      row_version: Number(before.row_version) + 1, updated_at: operation.started_at, updated_by: operation.actor_email });
    var atSource = hashOperationPayload_(current) === hashOperationPayload_(before);
    var atTarget = hashOperationPayload_(current) === hashOperationPayload_(target);
    assertApp_(atSource || atTarget, 'STATE_CONFLICT', 'Legacy row เปลี่ยนหลังเริ่ม repair', null, false);
    if (atSource) {
      var remaining = legacyUserBlockersLocked_(current, operation.operation_id);
      assertApp_(!remaining.length, 'MIGRATION_BLOCKED', 'พบ reference ใหม่ ต้องตรวจสอบก่อน',
        { blockers: remaining }, false);
      assertApp_(!findRecordById_(SHEETS.USERS, 'user_id', target.user_id), 'STATE_CONFLICT', 'User ID ชนกัน', null, false);
      // One exact row write; formulas anywhere in the schema were rejected above.
      table.sheet.getRange(input.row, 1, 1, table.headers.length).setValues([
        table.headers.map(function (header) { return target[header]; })
      ]);
    }
    ensureOperationHistoryLocked_({ entityType: 'USER', entityId: target.user_id, action: 'REPAIR_USER_ID',
      oldStatus: before.status, newStatus: target.status, note: 'Safe legacy User ID repair',
      changedFields: changedFields_(before, target, ['user_id', 'row_version', 'updated_at', 'updated_by']),
      operationId: operation.operation_id }, lockedActor);
    var result = toClientValue_(target);
    finalizeOperationLocked_(operation, target.user_id, result);
    return result;
  });
}
