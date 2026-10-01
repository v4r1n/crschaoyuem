var DASHBOARD_LIST_LIMIT_ = 8;
var DASHBOARD_DUE_SOON_DAYS_ = 7;

function getAdminDashboard_(actor) {
  assertAdminActor_(actor);
  var cacheKey = 'dashboard:admin:v1';
  var cacheEpoch = getCacheEpoch_();
  var cached = cacheGetJson_(cacheKey, cacheEpoch);
  if (cached) return cached;

  var equipment = listRecords_(SHEETS.EQUIPMENT).filter(function (record) {
    return record.status !== EQUIPMENT_STATUS.DELETED;
  });
  var borrows = listRecords_(SHEETS.BORROW);
  var history = listRecords_(SHEETS.HISTORY);
  var today = todayInTimezone_();
  var dueSoonThrough = addDashboardDays_(today, DASHBOARD_DUE_SOON_DAYS_);
  var metrics = {
    total: equipment.length,
    available: 0,
    borrowed: 0,
    pending: 0,
    overdue: 0,
    damaged: 0,
    maintenance: 0,
    lost: 0
  };

  equipment.forEach(function (record) {
    if (record.status === EQUIPMENT_STATUS.AVAILABLE) metrics.available += 1;
    if (record.status === EQUIPMENT_STATUS.BORROWED) metrics.borrowed += 1;
    if (record.status === EQUIPMENT_STATUS.PENDING) metrics.pending += 1;
    if (record.status === EQUIPMENT_STATUS.DAMAGED) metrics.damaged += 1;
    if (record.status === EQUIPMENT_STATUS.MAINTENANCE) metrics.maintenance += 1;
    if (record.status === EQUIPMENT_STATUS.LOST) metrics.lost += 1;
  });

  var borrowDtos = borrows.map(function (record) {
    return borrowDto_(record, today);
  });
  var overdue = borrowDtos.filter(function (record) {
    return record.is_overdue;
  }).sort(function (left, right) {
    return compareDashboardDueDates_(left, right);
  });
  metrics.overdue = overdue.length;

  var dueSoon = borrowDtos.filter(function (record) {
    return [BORROW_STATUS.CHECKED_OUT, BORROW_STATUS.RETURN_REQUESTED].indexOf(record.status) !== -1 &&
      record.due_date && compareDateOnly_(record.due_date, today) >= 0 &&
      compareDateOnly_(record.due_date, dueSoonThrough) <= 0;
  }).sort(function (left, right) {
    return compareDashboardDueDates_(left, right);
  });

  var result = {
    generated_at: nowIso_(),
    today: today,
    due_soon_through: dueSoonThrough,
    metrics: metrics,
    latest_activity: sortRecords_(history, 'timestamp', 'desc')
      .slice(0, DASHBOARD_LIST_LIMIT_)
      .map(toClientValue_),
    latest_borrows: sortRecords_(borrowDtos, 'requested_at', 'desc')
      .slice(0, DASHBOARD_LIST_LIMIT_),
    due_soon: dueSoon.slice(0, DASHBOARD_LIST_LIMIT_),
    overdue: overdue.slice(0, DASHBOARD_LIST_LIMIT_),
    most_borrowed: mostBorrowedAssets_(borrows).slice(0, DASHBOARD_LIST_LIMIT_)
  };
  cachePutJson_(cacheKey, result, null, cacheEpoch);
  return result;
}

function getUserDashboard_(user) {
  var sessionUser = assertUserActor_(user);
  var cacheKey = 'dashboard:user:' + sessionUser.user_id + ':v1';
  var cacheEpoch = getCacheEpoch_();
  var cached = cacheGetJson_(cacheKey, cacheEpoch);
  if (cached) return cached;

  var today = todayInTimezone_();
  var dueSoonThrough = addDashboardDays_(today, DASHBOARD_DUE_SOON_DAYS_);
  var records = listRecords_(SHEETS.BORROW).filter(function (record) {
    return record.user_id === sessionUser.user_id;
  }).map(function (record) {
    return borrowDto_(record, today);
  });
  var active = records.filter(function (record) {
    return ACTIVE_BORROW_STATUSES.indexOf(record.status) !== -1;
  });
  var overdue = active.filter(function (record) {
    return record.is_overdue;
  }).sort(compareDashboardDueDates_);
  var dueSoon = active.filter(function (record) {
    return [BORROW_STATUS.CHECKED_OUT, BORROW_STATUS.RETURN_REQUESTED].indexOf(record.status) !== -1 &&
      record.due_date && compareDateOnly_(record.due_date, today) >= 0 &&
      compareDateOnly_(record.due_date, dueSoonThrough) <= 0;
  }).sort(compareDashboardDueDates_);

  var result = {
    generated_at: nowIso_(),
    today: today,
    due_soon_through: dueSoonThrough,
    metrics: {
      total_requests: records.length,
      active: active.length,
      pending: countDashboardStatus_(active, BORROW_STATUS.PENDING_APPROVAL),
      approved: countDashboardStatus_(active, BORROW_STATUS.APPROVED),
      checked_out: countDashboardStatus_(active, BORROW_STATUS.CHECKED_OUT),
      return_requested: countDashboardStatus_(active, BORROW_STATUS.RETURN_REQUESTED),
      overdue: overdue.length
    },
    recent_borrows: sortRecords_(records, 'requested_at', 'desc')
      .slice(0, DASHBOARD_LIST_LIMIT_),
    due_soon: dueSoon.slice(0, DASHBOARD_LIST_LIMIT_),
    overdue: overdue.slice(0, DASHBOARD_LIST_LIMIT_)
  };
  cachePutJson_(cacheKey, result, null, cacheEpoch);
  return result;
}

function mostBorrowedAssets_(borrows) {
  var byAsset = Object.create(null);
  borrows.forEach(function (record) {
    if (!record.checkout_at) return;
    var assetId = normalizeWhitespace_(record.asset_id);
    if (!assetId) return;
    if (!byAsset[assetId]) {
      byAsset[assetId] = {
        asset_id: assetId,
        asset_name: stripSheetEscape_(record.asset_name),
        asset_sku: stripSheetEscape_(record.asset_sku),
        borrow_count: 0,
        last_checkout_at: ''
      };
    }
    byAsset[assetId].borrow_count += 1;
    if (String(record.checkout_at) > String(byAsset[assetId].last_checkout_at)) {
      byAsset[assetId].last_checkout_at = record.checkout_at;
      byAsset[assetId].asset_name = stripSheetEscape_(record.asset_name);
      byAsset[assetId].asset_sku = stripSheetEscape_(record.asset_sku);
    }
  });
  return Object.keys(byAsset).map(function (assetId) {
    return byAsset[assetId];
  }).sort(function (left, right) {
    if (right.borrow_count !== left.borrow_count) return right.borrow_count - left.borrow_count;
    var recent = String(right.last_checkout_at).localeCompare(String(left.last_checkout_at));
    if (recent) return recent;
    return left.asset_id.localeCompare(right.asset_id);
  });
}

function countDashboardStatus_(records, status) {
  return records.filter(function (record) { return record.status === status; }).length;
}

function compareDashboardDueDates_(left, right) {
  var byDueDate = String(left.due_date || '').localeCompare(String(right.due_date || ''));
  if (byDueDate) return byDueDate;
  return String(left.borrow_id || '').localeCompare(String(right.borrow_id || ''));
}

function addDashboardDays_(dateOnly, days) {
  var match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(dateOnly || ''));
  assertApp_(match, 'DATA_INTEGRITY_ERROR', 'วันที่ระบบไม่ถูกต้อง', null, false);
  var date = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
  date.setUTCDate(date.getUTCDate() + Number(days || 0));
  return Utilities.formatDate(date, 'UTC', 'yyyy-MM-dd');
}
