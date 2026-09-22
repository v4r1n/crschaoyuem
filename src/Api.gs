function executeUserRpc_(sessionToken, handler) {
  return executeSafely_(function () {
    return handler(requireUser_(sessionToken));
  });
}

function executeAdminRpc_(sessionToken, handler) {
  return executeSafely_(function () {
    return handler(requireAdmin_(sessionToken));
  });
}

function getAppBootstrap(sessionToken) {
  return executeUserRpc_(sessionToken, function (user) {
    var config = getRuntimeConfig_();
    return {
      app: {
        name: config.APP_NAME,
        shortName: config.APP_SHORT_NAME,
        version: config.APP_VERSION,
        timezone: config.TIMEZONE,
        locale: config.LOCALE,
        webAppUrl: getWebAppBaseUrl_(),
        maxImageBytes: config.MAX_IMAGE_BYTES
      },
      session: getSessionDto_(user),
      enums: {
        equipmentStatus: cloneObject_(EQUIPMENT_STATUS),
        borrowStatus: cloneObject_(BORROW_STATUS),
        returnCondition: cloneObject_(RETURN_CONDITION),
        returnDisposition: cloneObject_(RETURN_DISPOSITION),
        userRole: cloneObject_(USER_ROLE),
        recordStatus: cloneObject_(RECORD_STATUS)
      },
      categories: activeCategoryDtos_()
    };
  });
}

function getDashboard(sessionToken) {
  return executeUserRpc_(sessionToken, function (user) {
    return user.role === USER_ROLE.ADMIN ? getAdminDashboard_(user) : getUserDashboard_(user);
  });
}

function listEquipment(sessionToken, query) {
  return executeUserRpc_(sessionToken, function (user) {
    return listEquipment_(query || {}, user);
  });
}

function getEquipmentDetail(sessionToken, assetId) {
  return executeUserRpc_(sessionToken, function (user) {
    return getEquipmentDetail_(assetId, user);
  });
}

function listCategories(sessionToken) {
  return executeUserRpc_(sessionToken, function () {
    return activeCategoryDtos_();
  });
}

function createBorrowRequest(sessionToken, input) {
  return executeUserRpc_(sessionToken, function (actor) {
    return createBorrowRequest_(input || {}, actor);
  });
}

function listMyBorrowing(sessionToken, query) {
  return executeUserRpc_(sessionToken, function (user) {
    return listMyBorrowing_(query || {}, user);
  });
}

function getBorrowDetail(sessionToken, borrowId) {
  return executeUserRpc_(sessionToken, function (user) {
    return getBorrowDetail_(borrowId, user);
  });
}

function requestReturn(sessionToken, input) {
  return executeUserRpc_(sessionToken, function (actor) {
    return requestReturn_(input || {}, actor);
  });
}

function listMyHistory(sessionToken, query) {
  return executeUserRpc_(sessionToken, function (user) {
    return listHistoryForUser_(query || {}, user);
  });
}

function adminGetDashboard(sessionToken) {
  return executeAdminRpc_(sessionToken, function (actor) {
    return getAdminDashboard_(actor);
  });
}

function adminListBorrowing(sessionToken, query) {
  return executeAdminRpc_(sessionToken, function (actor) {
    return listBorrowingForAdmin_(query || {}, actor);
  });
}

function adminApproveBorrow(sessionToken, input) {
  return executeAdminRpc_(sessionToken, function (actor) {
    return approveBorrow_(input || {}, actor);
  });
}

function adminRejectBorrow(sessionToken, input) {
  return executeAdminRpc_(sessionToken, function (actor) {
    return rejectBorrow_(input || {}, actor);
  });
}

function adminCheckoutBorrow(sessionToken, input) {
  return executeAdminRpc_(sessionToken, function (actor) {
    return checkoutBorrow_(input || {}, actor);
  });
}

function adminCompleteReturn(sessionToken, input) {
  return executeAdminRpc_(sessionToken, function (actor) {
    return completeReturn_(input || {}, actor);
  });
}

function adminCreateEquipment(sessionToken, input) {
  return executeAdminRpc_(sessionToken, function (actor) {
    return createEquipment_(input || {}, actor);
  });
}

function adminUpdateEquipment(sessionToken, input) {
  return executeAdminRpc_(sessionToken, function (actor) {
    return updateEquipment_(input || {}, actor);
  });
}

function adminChangeEquipmentStatus(sessionToken, input) {
  return executeAdminRpc_(sessionToken, function (actor) {
    return changeEquipmentStatus_(input || {}, actor);
  });
}

function adminUploadEquipmentImage(sessionToken, input) {
  return executeAdminRpc_(sessionToken, function (actor) {
    return uploadEquipmentImage_(input || {}, actor);
  });
}

function adminListUsers(sessionToken, query) {
  return executeAdminRpc_(sessionToken, function (actor) {
    return listUsersForAdmin_(query || {}, actor);
  });
}

function adminAuditLegacyUsers(sessionToken) {
  return executeAdminRpc_(sessionToken, function (actor) {
    return withAdminMutation_(actor, function () { return auditLegacyUsersLocked_(); });
  });
}

function adminRepairLegacyUser(sessionToken, input) {
  return executeAdminRpc_(sessionToken, function (actor) {
    return repairLegacyUser_(input || {}, actor);
  });
}

function adminCreateUser(sessionToken, input) {
  return executeAdminRpc_(sessionToken, function (actor) {
    return createUser_(input || {}, actor);
  });
}

function adminUpdateUser(sessionToken, input) {
  return executeAdminRpc_(sessionToken, function (actor) {
    return updateUser_(input || {}, actor);
  });
}

function adminListCategories(sessionToken, query) {
  return executeAdminRpc_(sessionToken, function (actor) {
    return listCategoriesForAdmin_(query || {}, actor);
  });
}

function adminCreateCategory(sessionToken, input) {
  return executeAdminRpc_(sessionToken, function (actor) {
    return createCategory_(input || {}, actor);
  });
}

function adminUpdateCategory(sessionToken, input) {
  return executeAdminRpc_(sessionToken, function (actor) {
    return updateCategory_(input || {}, actor);
  });
}

function adminListHistory(sessionToken, query) {
  return executeAdminRpc_(sessionToken, function (actor) {
    return listHistoryForAdmin_(query || {}, actor);
  });
}

function adminRunIntegrityAudit(sessionToken) {
  return executeAdminRpc_(sessionToken, function (actor) {
    return runIntegrityAudit_(actor);
  });
}

function adminListOperations(sessionToken, query) {
  return executeAdminRpc_(sessionToken, function (actor) {
    return listOperationsForAdmin_(query || {}, actor);
  });
}

function adminGetOperationDetail(sessionToken, operationId) {
  return executeAdminRpc_(sessionToken, function (actor) {
    return getOperationDetailForAdmin_(operationId, actor);
  });
}

function adminReconcileOperation(sessionToken, operationId) {
  return executeAdminRpc_(sessionToken, function (actor) {
    return reconcileOperationForAdmin_(operationId, actor);
  });
}

function adminAbortOperation(sessionToken, input) {
  return executeAdminRpc_(sessionToken, function (actor) {
    return abortOperationForAdmin_(input || {}, actor);
  });
}

function activeCategoryDtos_() {
  return listRecords_(SHEETS.CATEGORIES).filter(function (category) {
    return category.status === RECORD_STATUS.ACTIVE;
  }).sort(function (left, right) {
    var orderDifference = Number(left.sort_order || 0) - Number(right.sort_order || 0);
    return orderDifference || stripSheetEscape_(left.category_name)
      .localeCompare(stripSheetEscape_(right.category_name), 'th');
  }).map(function (category) {
    return selectClientFields_(category,
      ['category_id', 'category_name', 'prefix', 'sort_order', 'status']);
  });
}
