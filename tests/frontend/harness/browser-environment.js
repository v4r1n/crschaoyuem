(function (global) {
  'use strict';

  var controls = new URLSearchParams(global.location.search);
  var role = String(controls.get('role') || 'admin').toLowerCase() === 'user' ? 'USER' : 'ADMIN';
  var failures = [];
  controls.getAll('fail').forEach(function (entry) {
    String(entry || '').split(',').forEach(function (method) {
      method = method.trim();
      if (method) failures.push(method);
    });
  });
  var expireOnce = String(controls.get('expire') || '').trim();
  var expiredMethods = Object.create(null);
  var flows = Object.create(null);
  var activeSessionHashes = Object.create(null);

  var state = {
    calls: [],
    history: [],
    clipboard: '',
    sequence: 0,
    oauth: {
      popupOpenCount: 0,
      popupUrls: [],
      beginCount: 0,
      pollCount: 0,
      completedCount: 0,
      logoutCount: 0
    }
  };
  global.__CRS_TEST__ = state;

  function clone(value) {
    if (value === undefined) return null;
    try { return JSON.parse(JSON.stringify(value)); }
    catch (error) { return String(value); }
  }

  function apiError(code, message, fieldErrors, retryable) {
    return {
      __apiError: true,
      code: code,
      message: message,
      fieldErrors: fieldErrors || null,
      retryable: retryable !== false
    };
  }

  function base64Url(bytes) {
    var binary = '';
    new Uint8Array(bytes).forEach(function (byte) {
      binary += String.fromCharCode(byte);
    });
    return global.btoa(binary)
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=+$/, '');
  }

  async function sha256Base64Url(value) {
    var encoded = new global.TextEncoder().encode(String(value || ''));
    return base64Url(await global.crypto.subtle.digest('SHA-256', encoded));
  }

  function fixedOpaqueSuffix(label, sequence) {
    return (String(label || '') + String(sequence || '') + 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789_-')
      .replace(/[^A-Za-z0-9_-]/g, '')
      .slice(0, 43)
      .padEnd(43, 'A');
  }

  var categories = [
    { category_id: 'CAT-001', category_name: 'คอมพิวเตอร์', prefix: 'COM', status: 'ACTIVE', sort_order: 1 },
    { category_id: 'CAT-002', category_name: 'ภาพและเสียง', prefix: 'AV', status: 'ACTIVE', sort_order: 2 }
  ];

  var equipment = [
    {
      asset_id: 'AST-000001',
      sku: 'IT-NB-DELL-5440',
      name: 'Notebook Dell Latitude 5440',
      category_id: 'CAT-001',
      category_name: 'คอมพิวเตอร์',
      brand: 'Dell',
      model: 'Latitude 5440',
      serial_number: 'DL5440-001',
      specification: 'Intel Core i7\nRAM 16 GB\nSSD 512 GB',
      description: 'โน้ตบุ๊กส่วนกลางสำหรับประชุมและทำงานนอกสถานที่',
      quantity: 1,
      purchase_date: '2026-01-15',
      purchase_price: 42900,
      department: 'ฝ่ายเทคโนโลยีสารสนเทศ',
      location: 'ห้องอุปกรณ์ ชั้น 3',
      status: 'AVAILABLE',
      image_url: '',
      qr_url: 'https://script.google.com/macros/s/crs-test/exec?view=equipment-detail&id=AST-000001',
      note: 'กรุณาคืนพร้อมกระเป๋าและอะแดปเตอร์',
      row_version: 3,
      updated_at: '2026-08-28T09:15:00.000Z',
      included_items: [
        { item_id: 'ITM-000001', item_name: 'อะแดปเตอร์', quantity: 1, is_required: true, sort_order: 1, note: '' },
        { item_id: 'ITM-000002', item_name: 'กระเป๋า', quantity: 1, is_required: true, sort_order: 2, note: '' }
      ],
      can_borrow: true
    },
    {
      asset_id: 'AST-000002',
      sku: 'AV-CAM-SONY-A6400',
      name: 'กล้อง Sony A6400',
      category_id: 'CAT-002',
      category_name: 'ภาพและเสียง',
      brand: 'Sony',
      model: 'A6400',
      serial_number: 'SN-A6400-002',
      specification: 'APS-C 24.2 MP',
      description: 'กล้องสำหรับบันทึกกิจกรรมองค์กร',
      quantity: 1,
      purchase_date: '2025-11-20',
      purchase_price: 35900,
      department: 'ฝ่ายสื่อสารองค์กร',
      location: 'สตูดิโอ ชั้น 2',
      status: 'MAINTENANCE',
      image_url: '',
      qr_url: 'https://script.google.com/macros/s/crs-test/exec?view=equipment-detail&id=AST-000002',
      note: 'อยู่ระหว่างตรวจเช็กเซนเซอร์',
      row_version: 5,
      updated_at: '2026-08-27T04:20:00.000Z',
      included_items: [
        { item_id: 'ITM-000003', item_name: 'แบตเตอรี่', quantity: 2, is_required: true, sort_order: 1, note: '' }
      ],
      can_borrow: false
    }
  ];

  var borrowing = [
    {
      borrow_id: 'BR-000001',
      user_id: 'USR-000001',
      user_email: 'user@example.org',
      user_name: 'ผู้ใช้ทดสอบ',
      user_department: 'ฝ่ายปฏิบัติการ',
      asset_id: 'AST-000001',
      asset_name: 'Notebook Dell Latitude 5440',
      asset_sku: 'IT-NB-DELL-5440',
      borrow_date: '2026-08-28',
      due_date: '2026-09-02',
      purpose: 'ประชุมโครงการนอกสถานที่',
      status: 'PENDING_APPROVAL',
      effective_status: 'PENDING_APPROVAL',
      is_overdue: false,
      requested_at: '2026-08-28T03:15:00.000Z',
      note: '',
      row_version: 1
    },
    {
      borrow_id: 'BR-000002',
      user_id: 'USR-000001',
      user_email: 'user@example.org',
      user_name: 'ผู้ใช้ทดสอบ',
      user_department: 'ฝ่ายปฏิบัติการ',
      asset_id: 'AST-000002',
      asset_name: 'กล้อง Sony A6400',
      asset_sku: 'AV-CAM-SONY-A6400',
      borrow_date: '2026-08-20',
      due_date: '2026-08-25',
      purpose: 'บันทึกภาพกิจกรรม',
      status: 'CHECKED_OUT',
      effective_status: 'OVERDUE',
      is_overdue: true,
      requested_at: '2026-08-19T08:00:00.000Z',
      checkout_at: '2026-08-20T02:00:00.000Z',
      note: '',
      row_version: 4
    }
  ];

  function session() {
    return role === 'ADMIN'
      ? {
          user_id: 'USR-000099',
          email: 'admin@example.org',
          name: 'ผู้ดูแลทดสอบ',
          department: 'ฝ่ายเทคโนโลยีสารสนเทศ',
          role: 'ADMIN',
          isAdmin: true
        }
      : {
          user_id: 'USR-000001',
          email: 'user@example.org',
          name: 'ผู้ใช้ทดสอบ',
          department: 'ฝ่ายปฏิบัติการ',
          role: 'USER',
          isAdmin: false
        };
  }

  function bootstrapData() {
    return {
      app: {
        name: 'CRS Yuem-Kuen System',
        shortName: 'CRS Yuem-Kuen',
        version: '1.0.0-test',
        timezone: 'Asia/Bangkok',
        locale: 'th-TH',
        webAppUrl: controls.get('qr') === 'unset'
          ? ''
          : 'https://script.google.com/macros/s/crs-test/exec',
        maxImageBytes: 5 * 1024 * 1024,
        defaultPageSize: 12
      },
      session: session(),
      enums: {
        equipmentStatus: {
          AVAILABLE: 'AVAILABLE', PENDING: 'PENDING', RESERVED: 'RESERVED',
          BORROWED: 'BORROWED', RETURNING: 'RETURNING', MAINTENANCE: 'MAINTENANCE',
          DAMAGED: 'DAMAGED', LOST: 'LOST', RETIRED: 'RETIRED'
        },
        borrowStatus: {
          PENDING_APPROVAL: 'PENDING_APPROVAL', APPROVED: 'APPROVED', REJECTED: 'REJECTED',
          CHECKED_OUT: 'CHECKED_OUT', RETURN_REQUESTED: 'RETURN_REQUESTED', RETURNED: 'RETURNED',
          CANCELLED: 'CANCELLED'
        },
        returnCondition: {
          NORMAL: 'NORMAL', COSMETIC_DAMAGE: 'COSMETIC_DAMAGE', DAMAGED: 'DAMAGED',
          MISSING_ITEMS: 'MISSING_ITEMS', LOST: 'LOST'
        },
        returnDisposition: {
          AVAILABLE: 'AVAILABLE', MAINTENANCE: 'MAINTENANCE', DAMAGED: 'DAMAGED', LOST: 'LOST'
        },
        userRole: { USER: 'USER', ADMIN: 'ADMIN' },
        recordStatus: { ACTIVE: 'ACTIVE', INACTIVE: 'INACTIVE' }
      },
      categories: clone(categories)
    };
  }

  function pageResult(items, pageSize) {
    var safeItems = clone(items || []);
    return {
      items: safeItems,
      page: 1,
      pageSize: pageSize || 20,
      total: safeItems.length,
      totalPages: 1
    };
  }

  function dashboardData() {
    var admin = role === 'ADMIN';
    return {
      generated_at: '2026-08-28T10:30:00.000Z',
      due_soon_through: '2026-09-04',
      metrics: admin
        ? { total: 2, available: 1, borrowed: 1, pending: 1, overdue: 1, maintenance: 1, damaged: 0, lost: 0 }
        : { total_requests: 2, active: 2, pending: 1, approved: 0, checked_out: 1, return_requested: 0, overdue: 1 },
      latest_borrows: clone(borrowing),
      recent_borrows: clone(borrowing),
      due_soon: clone([borrowing[0]]),
      overdue: clone([borrowing[1]]),
      most_borrowed: [
        { asset_id: 'AST-000001', asset_name: 'Notebook Dell Latitude 5440', borrow_count: 8 }
      ],
      recent_history: [
        {
          log_id: 'LOG-000001', entity_type: 'BORROW', entity_id: 'BR-000001',
          borrow_id: 'BR-000001', asset_id: 'AST-000001', action: 'BORROW_REQUEST',
          note: 'ส่งคำขอยืม', timestamp: '2026-08-28T03:15:00.000Z'
        }
      ]
    };
  }

  function equipmentList(query) {
    query = query || {};
    var search = String(query.search || '').trim().toLowerCase();
    var items = equipment.filter(function (record) {
      var searchable = [record.asset_id, record.sku, record.name, record.brand, record.model, record.serial_number]
        .join(' ').toLowerCase();
      return (!search || searchable.indexOf(search) !== -1) &&
        (!query.categoryId || record.category_id === query.categoryId) &&
        (!query.status || record.status === query.status) &&
        (!query.location || record.location === query.location) &&
        (!query.department || record.department === query.department);
    });
    var result = pageResult(items, Number(query.pageSize || 12));
    result.facets = {
      categories: clone(categories),
      statuses: ['AVAILABLE', 'PENDING', 'RESERVED', 'BORROWED', 'RETURNING', 'MAINTENANCE', 'DAMAGED', 'LOST', 'RETIRED'],
      locations: equipment.map(function (record) { return record.location; }),
      departments: equipment.map(function (record) { return record.department; })
    };
    return result;
  }

  function findEquipment(assetId) {
    var result = equipment.find(function (record) { return record.asset_id === String(assetId || '').toUpperCase(); });
    return result ? clone(result) : apiError('NOT_FOUND', 'ไม่พบอุปกรณ์ที่ต้องการ', null, false);
  }

  function filteredBorrowing(query) {
    query = query || {};
    var search = String(query.search || '').trim().toLowerCase();
    var assetId = String(query.assetId || query.asset_id || '').trim().toUpperCase();
    var status = String(query.status || '').trim().toUpperCase();
    var items = borrowing.filter(function (record) {
      var effective = record.effective_status || record.status;
      var searchable = [record.borrow_id, record.user_name, record.user_email, record.asset_id, record.asset_name]
        .join(' ').toLowerCase();
      return (!search || searchable.indexOf(search) !== -1) &&
        (!assetId || record.asset_id === assetId) &&
        (!status || effective === status || record.status === status);
    });
    return pageResult(items, Number(query.pageSize || 20));
  }

  function endpoints(method, args) {
    var input = args && args[0];
    if (method === 'getAppBootstrap') {
      if (controls.get('access') === 'disabled') {
        return apiError('USER_DISABLED', 'บัญชีนี้ถูกปิดใช้งาน กรุณาติดต่อผู้ดูแลระบบ', null, false);
      }
      if (controls.get('access') === 'unauthenticated') {
        return apiError('UNAUTHENTICATED', 'ไม่พบบัญชี Google Workspace ที่เข้าใช้งาน', null, false);
      }
      return bootstrapData();
    }
    if (method === 'getDashboard' || method === 'adminGetDashboard') return dashboardData();
    if (method === 'listEquipment') return equipmentList(input);
    if (method === 'getEquipmentDetail') return findEquipment(input);
    if (method === 'listCategories') return clone(categories);
    if (method === 'createBorrowRequest') {
      return Object.assign(clone(borrowing[0]), {
        command_id: input && input.command_id,
        purpose: input && input.purpose,
        note: input && input.note,
        borrow_date: input && input.borrow_date,
        due_date: input && input.due_date
      });
    }
    if (method === 'listMyBorrowing') return filteredBorrowing(input);
    if (method === 'listMyHistory') {
      return pageResult([
        {
          log_id: 'LOG-000001', entity_type: 'BORROW', entity_id: 'BR-000001',
          borrow_id: 'BR-000001', asset_id: 'AST-000001', action: 'BORROW_REQUEST',
          old_status: '', new_status: 'PENDING_APPROVAL', changed_by: 'user@example.org',
          note: 'ส่งคำขอยืม', timestamp: '2026-08-28T03:15:00.000Z'
        }
      ], 20);
    }
    if (method === 'getBorrowDetail') {
      var detail = borrowing.find(function (record) { return record.borrow_id === input; }) || borrowing[0];
      detail = clone(detail);
      detail.items = detail.status === 'CHECKED_OUT' ? [
        {
          borrow_item_id: 'BIT-000001', borrow_id: detail.borrow_id,
          item_id: 'ITM-000003', item_name: 'แบตเตอรี่', expected_quantity: 2,
          is_required: true, returned_quantity: '', is_complete: '', condition: '', note: ''
        }
      ] : [];
      return detail;
    }
    if (method === 'requestReturn') {
      return Object.assign(clone(borrowing[1]), { status: 'RETURN_REQUESTED', effective_status: 'RETURN_REQUESTED' });
    }
    if (method === 'adminListBorrowing') return filteredBorrowing(input);
    if (method === 'adminListUsers') {
      return pageResult([
        { user_id: 'USR-000001', email: 'user@example.org', name: 'ผู้ใช้ทดสอบ', department: 'ฝ่ายปฏิบัติการ', role: 'USER', status: 'ACTIVE', row_version: 1 },
        { user_id: 'USR-000099', email: 'admin@example.org', name: 'ผู้ดูแลทดสอบ', department: 'ฝ่ายเทคโนโลยีสารสนเทศ', role: 'ADMIN', status: 'ACTIVE', row_version: 2 }
      ], 20);
    }
    if (method === 'adminListCategories') return pageResult(categories, 20);
    if (method === 'adminListHistory') return endpoints('listMyHistory', args);
    if (method === 'adminListOperations') return pageResult([], 20);
    if (method === 'adminRunIntegrityAudit') {
      return {
        generated_at: '2026-08-28T10:30:00.000Z',
        passed: true,
        summary: { total_issues: 0, errors: 0, warnings: 0, returned_issues: 0, truncated: false },
        issues: []
      };
    }
    if (method === 'adminGetOperationDetail') {
      return apiError('NOT_FOUND', 'ไม่พบ Operation ที่ต้องการ', null, false);
    }
    if (method === 'adminApproveBorrow') return Object.assign(clone(borrowing[0]), { status: 'APPROVED', row_version: 2 });
    if (method === 'adminRejectBorrow') return Object.assign(clone(borrowing[0]), { status: 'REJECTED', row_version: 2 });
    if (method === 'adminCheckoutBorrow') return Object.assign(clone(borrowing[0]), { status: 'CHECKED_OUT', row_version: 3 });
    if (method === 'adminCompleteReturn') return Object.assign(clone(borrowing[1]), { status: 'RETURNED', row_version: 5 });
    if (method === 'adminCreateEquipment' || method === 'adminUpdateEquipment' ||
        method === 'adminChangeEquipmentStatus' || method === 'adminUploadEquipmentImage') {
      return findEquipment(input && input.asset_id || 'AST-000001');
    }
    if (method === 'adminCreateUser' || method === 'adminUpdateUser') {
      return Object.assign({ user_id: 'USR-000003', row_version: 1 }, clone(input || {}));
    }
    if (method === 'adminCreateCategory' || method === 'adminUpdateCategory') {
      return Object.assign({ category_id: 'CAT-003', row_version: 1 }, clone(input || {}));
    }
    if (method === 'adminReconcileOperation' || method === 'adminAbortOperation') {
      return { operation_id: input && input.operation_id, status: method === 'adminAbortOperation' ? 'ABORTED' : 'COMPLETED' };
    }
    return apiError('TEST_ENDPOINT_MISSING', 'ชุดทดสอบยังไม่มีข้อมูลจำลองสำหรับ ' + method, null, false);
  }

  function responseFor(method, args) {
    state.sequence += 1;
    var requestId = 'test-request-' + String(state.sequence).padStart(4, '0');
    if (method === expireOnce && !expiredMethods[method]) {
      expiredMethods[method] = true;
      return {
        ok: false,
        error: {
          code: 'UNAUTHENTICATED',
          message: 'เซสชันหมดอายุ กรุณาลงชื่อเข้าใช้อีกครั้ง',
          fieldErrors: null,
          retryable: false
        },
        meta: { requestId: requestId }
      };
    }
    if (failures.indexOf(method) !== -1) {
      return {
        ok: false,
        error: {
          code: 'TEST_FAILURE',
          message: 'จำลองข้อผิดพลาดจาก ' + method,
          fieldErrors: null,
          retryable: true
        },
        meta: { requestId: requestId }
      };
    }
    var data = endpoints(method, args);
    if (data && data.__apiError) {
      return {
        ok: false,
        error: {
          code: data.code,
          message: data.message,
          fieldErrors: data.fieldErrors,
          retryable: data.retryable
        },
        meta: { requestId: requestId }
      };
    }
    return { ok: true, data: data, meta: { requestId: requestId } };
  }

  function authEnvelope(data) {
    state.sequence += 1;
    return {
      ok: true,
      data: data,
      meta: { requestId: 'test-request-' + String(state.sequence).padStart(4, '0') }
    };
  }

  function authErrorEnvelope(code, message) {
    state.sequence += 1;
    return {
      ok: false,
      error: {
        code: code,
        message: message,
        fieldErrors: null,
        retryable: false
      },
      meta: { requestId: 'test-request-' + String(state.sequence).padStart(4, '0') }
    };
  }

  function beginOAuthResponse(rawArgs) {
    var input = rawArgs && rawArgs[0];
    if (!input || !/^[A-Za-z0-9_-]{43}$/.test(String(input.pollTokenHash || '')) ||
      !/^[A-Za-z0-9_-]{43}$/.test(String(input.sessionTokenHash || ''))) {
      return authErrorEnvelope('VALIDATION_ERROR', 'Invalid OAuth binding hashes');
    }
    state.oauth.beginCount += 1;
    var flowId = 'flow1_' + fixedOpaqueSuffix('test-flow-', state.oauth.beginCount);
    var stateToken = 'callback1_' + fixedOpaqueSuffix('state-', state.oauth.beginCount);
    var nonce = 'nonce1_' + fixedOpaqueSuffix('nonce-', state.oauth.beginCount);
    var challenge = fixedOpaqueSuffix('challenge-', state.oauth.beginCount);
    var redirectUri = 'https://script.google.com/macros/s/test-pilot/exec';
    var authorization = new URL('https://accounts.google.com/o/oauth2/v2/auth');
    authorization.searchParams.set('client_id', '123456789012-crsequipmenttest.apps.googleusercontent.com');
    authorization.searchParams.set('redirect_uri', redirectUri);
    authorization.searchParams.set('response_type', 'code');
    authorization.searchParams.set('scope', 'openid email');
    authorization.searchParams.set('state', stateToken);
    authorization.searchParams.set('nonce', nonce);
    authorization.searchParams.set('code_challenge', challenge);
    authorization.searchParams.set('code_challenge_method', 'S256');
    authorization.searchParams.set('prompt', 'select_account');
    flows[flowId] = {
      pollTokenHash: String(input.pollTokenHash),
      sessionTokenHash: String(input.sessionTokenHash),
      polls: 0,
      completed: false,
      expiresAt: Math.floor(Date.now() / 1000) + 600
    };
    return authEnvelope({
      flowId: flowId,
      authorizationUrl: authorization.toString(),
      expiresAt: flows[flowId].expiresAt
    });
  }

  async function completeOAuthResponse(rawArgs) {
    var flowId = String(rawArgs && rawArgs[0] || '');
    var pollToken = String(rawArgs && rawArgs[1] || '');
    var flow = flows[flowId];
    state.oauth.pollCount += 1;
    if (!flow || flow.completed || await sha256Base64Url(pollToken) !== flow.pollTokenHash) {
      return authErrorEnvelope('UNAUTHENTICATED', 'Invalid or already consumed OAuth flow');
    }
    flow.polls += 1;
    if (flow.polls === 1 || controls.get('oauth') === 'pending') {
      return authEnvelope({ status: 'PENDING' });
    }
    if (controls.get('oauth') === 'denied') {
      return authErrorEnvelope('FORBIDDEN', 'Google authorization was denied');
    }
    if (!rawArgs[2]) return authEnvelope({status:'AWAITING_CONFIRMATION'});
    if (await sha256Base64Url(String(rawArgs[3] || '')) !== flow.sessionTokenHash)
      return authErrorEnvelope('UNAUTHENTICATED','Wrong confirmation proof');
    if (rawArgs[2] !== '123456')
      return authErrorEnvelope('OTP_INVALID','Wrong confirmation code');
    flow.completed = true;
    activeSessionHashes[flow.sessionTokenHash] = {
      flowId: flowId,
      createdAt: Date.now()
    };
    state.oauth.completedCount += 1;
    return authEnvelope({ status: 'COMPLETE' });
  }

  async function responseForInvocation(method, rawArgs) {
    if (failures.indexOf(method) !== -1) return responseFor(method, rawArgs);
    if (method === 'beginOAuthSignIn') return beginOAuthResponse(rawArgs);
    if (method === 'completeOAuthSignIn') return completeOAuthResponse(rawArgs);

    var sessionToken = String(rawArgs && rawArgs[0] || '');
    var sessionHash = sessionToken ? await sha256Base64Url(sessionToken) : '';
    if (method === 'logoutSession') {
      if (sessionHash) delete activeSessionHashes[sessionHash];
      state.oauth.logoutCount += 1;
      return authEnvelope({ loggedOut: true });
    }
    if (!/^session1_[A-Za-z0-9_-]{43}$/.test(sessionToken) || !activeSessionHashes[sessionHash]) {
      return authErrorEnvelope('UNAUTHENTICATED', 'Missing or invalid application session');
    }
    if (method === expireOnce && !expiredMethods[method]) {
      delete activeSessionHashes[sessionHash];
    }
    return responseFor(method, rawArgs.slice(1));
  }

  function makeRunner() {
    var successHandler = function () {};
    var failureHandler = function () {};
    var runner;
    runner = new Proxy({}, {
      get: function (unusedTarget, property) {
        if (property === 'withSuccessHandler') {
          return function (handler) { successHandler = handler; return runner; };
        }
        if (property === 'withFailureHandler') {
          return function (handler) { failureHandler = handler; return runner; };
        }
        if (property === 'then') return undefined;
        return function () {
          var method = String(property);
          var rawArgs = Array.prototype.slice.call(arguments);
          var isBusinessRpc = method !== 'beginOAuthSignIn' &&
            method !== 'completeOAuthSignIn' && method !== 'logoutSession';
          var sessionToken = isBusinessRpc || method === 'logoutSession'
            ? String(rawArgs[0] || '')
            : '';
          var args = isBusinessRpc ? rawArgs.slice(1) :
            (method === 'logoutSession' ? [] : rawArgs);
          state.calls.push({
            method: method,
            sessionToken: sessionToken,
            args: clone(args),
            at: Date.now()
          });
          var delay = Math.max(0, Math.min(1000, Number(controls.get('delay') || 0)));
          global.setTimeout(function () {
            if (String(controls.get('transport') || '') === method) {
              failureHandler(new Error('Simulated google.script.run transport failure'));
              return;
            }
            Promise.resolve(responseForInvocation(method, rawArgs))
              .then(successHandler)
              .catch(failureHandler);
          }, delay);
        };
      }
    });
    return runner;
  }

  function locationData() {
    var parameter = {};
    var parameters = {};
    new URLSearchParams(global.location.search).forEach(function (value, key) {
      if (!parameters[key]) parameters[key] = [];
      parameters[key].push(value);
      parameter[key] = value;
    });
    return { hash: global.location.hash.replace(/^#/, ''), parameter: parameter, parameters: parameters };
  }

  var harnessControlKeys = ['role', 'access', 'fail', 'expire', 'transport', 'delay', 'qr', 'oauth'];
  function writeHistory(kind, historyState, parameters, title) {
    var rawParameters = clone(parameters || {});
    state.history.push({ kind: kind, state: clone(historyState || {}), parameters: rawParameters, title: title || '' });
    var next = new URLSearchParams();
    harnessControlKeys.forEach(function (key) {
      controls.getAll(key).forEach(function (value) { next.append(key, value); });
    });
    Object.keys(parameters || {}).forEach(function (key) {
      var value = parameters[key];
      if (value !== null && value !== undefined) next.set(key, String(value));
    });
    var nextUrl = global.location.pathname + (next.toString() ? '?' + next.toString() : '');
    global.history[kind === 'replace' ? 'replaceState' : 'pushState'](historyState || {}, title || '', nextUrl);
  }

  var historyChangeHandler = null;
  var script = {
    url: {
      getLocation: function (callback) {
        global.setTimeout(function () { callback(locationData()); }, 0);
      }
    },
    history: {
      push: function (historyState, parameters, title) {
        writeHistory('push', historyState, parameters, title);
      },
      replace: function (historyState, parameters, title) {
        writeHistory('replace', historyState, parameters, title);
      },
      setChangeHandler: function (handler) {
        historyChangeHandler = handler;
        state.historyChangeHandlerRegistered = typeof handler === 'function';
      }
    }
  };
  Object.defineProperty(script, 'run', { configurable: false, enumerable: true, get: makeRunner });

  function createOAuthPopup() {
    var popup = {
      closed: false,
      currentUrl: '',
      document: {
        title: '',
        body: { textContent: '' }
      },
      location: {
        replace: function (url) {
          popup.currentUrl = String(url || '');
          state.oauth.popupUrls.push(popup.currentUrl);
          if (controls.get('oauth') === 'cancelled') {
            global.setTimeout(function () { popup.closed = true; }, 50);
          }
        }
      },
      close: function () {
        popup.closed = true;
      }
    };
    return popup;
  }

  global.open = function (url, name, features) {
    state.oauth.popupOpenCount += 1;
    state.oauth.lastPopupName = String(name || '');
    state.oauth.lastPopupFeatures = String(features || '');
    if (controls.get('oauth') === 'blocked') return null;
    var popup = createOAuthPopup();
    state.oauth.lastPopup = popup;
    if (url) popup.location.replace(url);
    return popup;
  };

  global.google = { script: script };

  state.simulateHistoryChange = function (route, parameters) {
    if (historyChangeHandler) {
      historyChangeHandler({ state: { route: route }, location: { parameter: parameters || {}, hash: route } });
    }
  };

  try {
    Object.defineProperty(global.navigator, 'clipboard', {
      configurable: true,
      value: {
        writeText: function (value) {
          state.clipboard = String(value || '');
          return Promise.resolve();
        }
      }
    });
  } catch (error) {
    /* The fallback document.execCommand path remains available. */
  }
  document.execCommand = function (command) { return command === 'copy'; };
})(window);
