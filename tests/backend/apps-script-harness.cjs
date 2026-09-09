'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const PROJECT_ROOT = path.resolve(__dirname, '..', '..');
const SOURCE_DIRECTORY = path.join(PROJECT_ROOT, 'src');

const GOOGLE_JWKS_URL = 'https://www.googleapis.com/oauth2/v3/certs';
const GOOGLE_OAUTH_TOKEN_URL = 'https://oauth2.googleapis.com/token';
const TEST_GOOGLE_KEY_ID = 'crs-test-google-key';
const TEST_GOOGLE_OAUTH_CLIENT_ID =
  '123456789012-crsequipmenttest.apps.googleusercontent.com';
const TEST_GOOGLE_OAUTH_CLIENT_SECRET = 'GOCSPX-test-client-secret-not-real';
const TEST_SCRIPT_ID = 'testScriptId_0123456789abcdefghijklmnop';
const PUBLIC_RPC_NAMES = Object.freeze([
  'adminAbortOperation',
  'adminApproveBorrow',
  'adminChangeEquipmentStatus',
  'adminCheckoutBorrow',
  'adminCompleteReturn',
  'adminCreateCategory',
  'adminCreateEquipment',
  'adminCreateUser',
  'adminGetDashboard',
  'adminGetOperationDetail',
  'adminListBorrowing',
  'adminListCategories',
  'adminListHistory',
  'adminListOperations',
  'adminListUsers',
  'adminReconcileOperation',
  'adminRejectBorrow',
  'adminRunIntegrityAudit',
  'adminUpdateCategory',
  'adminUpdateEquipment',
  'adminUpdateUser',
  'adminUploadEquipmentImage',
  'createBorrowRequest',
  'getAppBootstrap',
  'getBorrowDetail',
  'getDashboard',
  'getEquipmentDetail',
  'listCategories',
  'listEquipment',
  'listMyBorrowing',
  'listMyHistory',
  'requestReturn'
]);
const PUBLIC_RPC_SET = new Set(PUBLIC_RPC_NAMES);

const TEST_GOOGLE_KEY_PAIR = crypto.generateKeyPairSync('rsa', {
  modulusLength: 2048,
  publicExponent: 0x10001
});
const TEST_GOOGLE_PUBLIC_JWK = Object.freeze({
  ...TEST_GOOGLE_KEY_PAIR.publicKey.export({ format: 'jwk' }),
  alg: 'RS256',
  kid: TEST_GOOGLE_KEY_ID,
  use: 'sig'
});

const SOURCE_FILES = [
  'Constants.gs',
  'Schema.gs',
  'Errors.gs',
  'Config.gs',
  'Utils.gs',
  'Validation.gs',
  'ServiceUtils.gs',
  'DataStore.gs',
  'Migrations.gs',
  'HistoryService.gs',
  'OperationService.gs',
  'IdentityService.gs',
  'OAuthService.gs',
  'Code.gs',
  'Auth.gs',
  'CategoryService.gs',
  'EquipmentService.gs',
  'BorrowService.gs',
  'DashboardService.gs',
  'UserService.gs',
  'IntegrityService.gs',
  'Setup.gs',
  'Api.gs'
];

function cloneCell(value) {
  return value instanceof Date ? new Date(value.getTime()) : value;
}

function base64Url(value) {
  return Buffer.from(value).toString('base64url');
}

function sha256Base64Url(value) {
  return crypto.createHash('sha256').update(String(value), 'utf8').digest('base64url');
}

function browserSecret(prefix, counter) {
  return `${prefix}${sha256Base64Url(`browser-secret:${prefix}:${counter}`)}`;
}

function defaultHostedDomain(email) {
  const normalized = String(email || '').trim().toLowerCase();
  if (!normalized || normalized.endsWith('@gmail.com')) return undefined;
  return normalized.split('@')[1];
}

function signGoogleIdToken(email, overrides = {}, options = {}) {
  const nowSeconds = Math.floor((options.nowMs === undefined ? Date.now() : options.nowMs) / 1000);
  const normalizedEmail = String(email || '').trim().toLowerCase();
  const payload = {
    iss: 'https://accounts.google.com',
    aud: TEST_GOOGLE_OAUTH_CLIENT_ID,
    sub: crypto.createHash('sha256').update(normalizedEmail || 'missing').digest('hex').slice(0, 21),
    email: normalizedEmail,
    email_verified: true,
    hd: defaultHostedDomain(normalizedEmail),
    iat: nowSeconds - 30,
    exp: nowSeconds + 3600,
    ...overrides
  };
  Object.keys(payload).forEach((key) => {
    if (payload[key] === undefined) delete payload[key];
  });
  const header = {
    alg: 'RS256',
    kid: TEST_GOOGLE_KEY_ID,
    typ: 'JWT',
    ...(options.header || {})
  };
  const encodedHeader = base64Url(JSON.stringify(header));
  const encodedPayload = base64Url(JSON.stringify(payload));
  const signingInput = `${encodedHeader}.${encodedPayload}`;
  const signature = crypto.sign(
    'RSA-SHA256',
    Buffer.from(signingInput, 'ascii'),
    options.privateKey || TEST_GOOGLE_KEY_PAIR.privateKey
  );
  return `${signingInput}.${base64Url(signature)}`;
}

class MemoryRange {
  constructor(sheet, row, column, rowCount, columnCount) {
    this.sheet = sheet;
    this.row = row;
    this.column = column;
    this.rowCount = rowCount;
    this.columnCount = columnCount;
    if (![row, column, rowCount, columnCount].every(Number.isSafeInteger) ||
      row < 1 || column < 1 || rowCount < 1 || columnCount < 1) {
      throw new RangeError('Invalid in-memory Sheet range');
    }
  }

  getValues() {
    const result = [];
    for (let rowOffset = 0; rowOffset < this.rowCount; rowOffset += 1) {
      const row = [];
      for (let columnOffset = 0; columnOffset < this.columnCount; columnOffset += 1) {
        row.push(cloneCell(this.sheet.getCell_(
          this.row + rowOffset,
          this.column + columnOffset
        )));
      }
      result.push(row);
    }
    return result;
  }

  getFormulas() {
    return this.getValues().map((row) => row.map((value) =>
      typeof value === 'string' && value.startsWith('=') ? value : ''
    ));
  }

  setValues(values) {
    if (!Array.isArray(values) || values.length !== this.rowCount ||
      values.some((row) => !Array.isArray(row) || row.length !== this.columnCount)) {
      throw new RangeError('setValues dimensions do not match range');
    }
    values.forEach((row, rowOffset) => {
      row.forEach((value, columnOffset) => {
        this.sheet.setCell_(
          this.row + rowOffset,
          this.column + columnOffset,
          cloneCell(value)
        );
      });
    });
    return this;
  }

  setBackground() { return this; }
  setFontColor() { return this; }
  setFontWeight() { return this; }
  setWrap() { return this; }
  setNumberFormat() { return this; }
}

class MemoryProtection {
  constructor() {
    this.description = '';
    this.warningOnly = false;
  }

  getDescription() { return this.description; }
  setDescription(value) { this.description = String(value); return this; }
  setWarningOnly(value) { this.warningOnly = Boolean(value); return this; }
}

class MemorySheet {
  constructor(name) {
    this.name = name;
    this.data = [];
    this.maxRows = 1000;
    this.maxColumns = 26;
    this.protections = [];
  }

  getName() { return this.name; }

  getCell_(row, column) {
    const storedRow = this.data[row - 1];
    return storedRow && storedRow[column - 1] !== undefined
      ? storedRow[column - 1]
      : '';
  }

  setCell_(row, column, value) {
    while (this.data.length < row) this.data.push([]);
    while (this.data[row - 1].length < column) this.data[row - 1].push('');
    this.data[row - 1][column - 1] = value === undefined || value === null ? '' : value;
    this.maxRows = Math.max(this.maxRows, row);
    this.maxColumns = Math.max(this.maxColumns, column);
  }

  getLastRow() {
    for (let row = this.data.length; row > 0; row -= 1) {
      if (this.data[row - 1].some((value) => value !== '' && value !== null)) return row;
    }
    return 0;
  }

  getLastColumn() {
    let maximum = 0;
    this.data.forEach((row) => {
      for (let column = row.length; column > 0; column -= 1) {
        if (row[column - 1] !== '' && row[column - 1] !== null) {
          maximum = Math.max(maximum, column);
          break;
        }
      }
    });
    return maximum;
  }

  getMaxRows() { return this.maxRows; }
  getMaxColumns() { return this.maxColumns; }

  getRange(row, column, rowCount = 1, columnCount = 1) {
    return new MemoryRange(this, row, column, rowCount, columnCount);
  }

  insertRowsAfter(afterPosition, howMany) {
    if (!Number.isSafeInteger(afterPosition) || !Number.isSafeInteger(howMany) || howMany < 1) {
      throw new RangeError('Invalid insertRowsAfter arguments');
    }
    this.maxRows = Math.max(this.maxRows, afterPosition) + howMany;
    return this;
  }

  insertColumnsAfter(afterPosition, howMany) {
    if (!Number.isSafeInteger(afterPosition) || !Number.isSafeInteger(howMany) || howMany < 1) {
      throw new RangeError('Invalid insertColumnsAfter arguments');
    }
    this.maxColumns = Math.max(this.maxColumns, afterPosition) + howMany;
    return this;
  }

  setFrozenRows() { return this; }
  setRowHeight() { return this; }
  setColumnWidth() { return this; }
  getProtections() { return this.protections.slice(); }

  protect() {
    const protection = new MemoryProtection();
    this.protections.push(protection);
    return protection;
  }
}

class MemorySpreadsheet {
  constructor(id = 'test-spreadsheet') {
    this.id = id;
    this.sheets = new Map();
    this.timezone = '';
    this.locale = '';
  }

  getId() { return this.id; }
  getSheetByName(name) { return this.sheets.get(String(name)) || null; }

  insertSheet(name) {
    const normalized = String(name);
    if (this.sheets.has(normalized)) throw new Error(`Duplicate sheet: ${normalized}`);
    const sheet = new MemorySheet(normalized);
    this.sheets.set(normalized, sheet);
    return sheet;
  }

  setSpreadsheetTimeZone(value) { this.timezone = String(value); return this; }
  setSpreadsheetLocale(value) { this.locale = String(value); return this; }
}

class MemoryProperties {
  constructor(initial = {}) {
    this.values = Object.create(null);
    Object.entries(initial).forEach(([key, value]) => {
      this.values[key] = String(value);
    });
  }

  getProperty(key) {
    return Object.prototype.hasOwnProperty.call(this.values, key) ? this.values[key] : null;
  }

  getProperties() { return { ...this.values }; }

  setProperty(key, value) {
    this.values[String(key)] = String(value);
    return this;
  }

  setProperties(values, deleteAllOthers = false) {
    if (deleteAllOthers) this.values = Object.create(null);
    Object.entries(values || {}).forEach(([key, value]) => this.setProperty(key, value));
    return this;
  }

  deleteProperty(key) { delete this.values[String(key)]; return this; }
}

class MemoryCache {
  constructor(now) {
    this.now = now;
    this.values = new Map();
    this.expirations = new Map();
  }

  get(key) {
    const normalized = String(key);
    const expiresAt = this.expirations.get(normalized);
    if (expiresAt !== undefined && expiresAt <= this.now()) {
      this.remove(normalized);
      return null;
    }
    return this.values.has(normalized) ? this.values.get(normalized) : null;
  }

  put(key, value, expirationInSeconds) {
    if (expirationInSeconds !== undefined &&
      (!Number.isFinite(Number(expirationInSeconds)) || Number(expirationInSeconds) < 1)) {
      throw new RangeError('Invalid cache expiration');
    }
    const normalized = String(key);
    this.values.set(normalized, String(value));
    if (expirationInSeconds === undefined) this.expirations.delete(normalized);
    else this.expirations.set(normalized, this.now() + (Number(expirationInSeconds) * 1000));
  }

  remove(key) {
    const normalized = String(key);
    this.values.delete(normalized);
    this.expirations.delete(normalized);
  }

  removeAll(keys) { (keys || []).forEach((key) => this.remove(key)); }

  clear() {
    this.values.clear();
    this.expirations.clear();
  }
}

class MemoryScriptLock {
  constructor() {
    this.held = false;
    this.failNext = false;
    this.acquireCount = 0;
    this.releaseCount = 0;
  }

  tryLock() {
    if (this.failNext) {
      this.failNext = false;
      return false;
    }
    if (this.held) return false;
    this.held = true;
    this.acquireCount += 1;
    return true;
  }

  releaseLock() {
    if (!this.held) throw new Error('Script lock released without ownership');
    this.held = false;
    this.releaseCount += 1;
  }
}

function dateOnlyInTimezone(date, timezone) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).formatToParts(date).reduce((result, part) => {
    result[part.type] = part.value;
    return result;
  }, {});
  return `${parts.year}-${parts.month}-${parts.day}`;
}

function makeUtilities(state) {
  function decodeBase64(value, webSafe) {
    let encoded = String(value || '');
    if (webSafe) encoded = encoded.replace(/-/g, '+').replace(/_/g, '/');
    while (encoded.length % 4) encoded += '=';
    return Array.from(Buffer.from(encoded, 'base64'));
  }

  return {
    DigestAlgorithm: { SHA_256: 'SHA_256' },
    Charset: { UTF_8: 'UTF_8' },
    getUuid() {
      state.uuidCounter += 1;
      return `00000000-0000-4000-8000-${String(state.uuidCounter).padStart(12, '0')}`;
    },
    computeHmacSha256Signature(value, key) { return Array.from(crypto.createHmac('sha256', key).update(value).digest()); },
    computeDigest(algorithm, value) {
      if (algorithm !== 'SHA_256') throw new Error(`Unsupported digest: ${algorithm}`);
      const bytes = typeof value === 'string' ? Buffer.from(value, 'utf8') : Buffer.from(value);
      return Array.from(crypto.createHash('sha256').update(bytes).digest());
    },
    base64EncodeWebSafe(value) {
      return Buffer.from(value).toString('base64').replace(/\+/g, '-').replace(/\//g, '_');
    },
    base64Encode(value) {
      return Buffer.from(value).toString('base64');
    },
    base64Decode(value) {
      return decodeBase64(value, false);
    },
    base64DecodeWebSafe(value) {
      return decodeBase64(value, true);
    },
    formatDate(date, timezone, pattern) {
      if (pattern !== 'yyyy-MM-dd') throw new Error(`Unsupported date pattern: ${pattern}`);
      return dateOnlyInTimezone(date, timezone);
    },
    newBlob(bytes, mimeType, name) {
      const buffer = Buffer.from(bytes || []);
      return {
        getBytes: () => Array.from(buffer),
        getContentType: () => mimeType,
        getDataAsString: () => buffer.toString('utf8'),
        getName: () => name
      };
    }
  };
}

function makeHttpResponse(statusCode, body, headers = {}) {
  const text = typeof body === 'string' ? body : JSON.stringify(body);
  const normalizedHeaders = { ...headers };
  return {
    getResponseCode: () => Number(statusCode),
    getContentText: () => text,
    getHeaders: () => ({ ...normalizedHeaders }),
    getAllHeaders: () => ({ ...normalizedHeaders })
  };
}

function loadSources(context) {
  SOURCE_FILES.forEach((fileName) => {
    const absolutePath = path.join(SOURCE_DIRECTORY, fileName);
    const source = fs.readFileSync(absolutePath, 'utf8');
    vm.runInContext(source, context, { filename: absolutePath });
  });
}

function createAppsScriptHarness(options = {}) {
  const state = {
    activeEmail: options.activeEmail === undefined ? 'admin@example.com' : String(options.activeEmail),
    visitorKey: options.visitorKey || 'test-visitor:initial',
    webAppUrl: options.webAppUrl || 'https://script.google.com/macros/s/test-deployment/exec',
    scriptId: options.scriptId || TEST_SCRIPT_ID,
    nowMs: options.nowMs === undefined ? Date.now() : Number(options.nowMs),
    uuidCounter: 0,
    browserSecretCounter: 0,
    authorizationCodeCounter: 0,
    stateTokenCounter: 0,
    flushCount: 0,
    fetches: [],
    jwks: options.jwks || { keys: [{ ...TEST_GOOGLE_PUBLIC_JWK }] },
    jwksStatus: options.jwksStatus || 200,
    jwksHeaders: options.jwksHeaders || { 'Cache-Control': 'public, max-age=3600' },
    fetchError: null,
    idToken: '',
    sessionToken: '',
    identityEmail: options.activeEmail === undefined ? 'admin@example.com' : String(options.activeEmail),
    defaultTokenClaims: { ...(options.tokenClaims || {}) },
    defaultTokenOptions: { ...(options.tokenOptions || {}) },
    stateTokens: new Map(),
    tokenExchanges: new Map(),
    activeUserCalls: 0,
    temporaryUserKeyCalls: 0
  };
  state.idToken = Object.prototype.hasOwnProperty.call(options, 'idToken')
    ? String(options.idToken || '')
    : signGoogleIdToken(state.identityEmail, state.defaultTokenClaims, {
      ...state.defaultTokenOptions,
      nowMs: state.nowMs
    });
  const spreadsheet = new MemorySpreadsheet(options.spreadsheetId);
  const properties = new MemoryProperties({
    ALLOWED_DOMAINS: 'example.com',
    ALLOWED_DOMAIN: 'example.com',
    ADMIN_EMAILS: 'admin@example.com',
    AUTO_PROVISION_USERS: 'false',
    GOOGLE_OAUTH_CLIENT_ID: TEST_GOOGLE_OAUTH_CLIENT_ID,
    GOOGLE_OAUTH_CLIENT_SECRET: TEST_GOOGLE_OAUTH_CLIENT_SECRET,
    GOOGLE_OAUTH_REDIRECT_URI: state.webAppUrl,
    WEB_APP_URL: state.webAppUrl,
    ...(options.properties || {})
  });
  const cache = new MemoryCache(() => state.nowMs);
  const scriptLock = new MemoryScriptLock();
  const quietConsole = options.console || {
    log() {},
    info() {},
    warn() {},
    error() {}
  };

  class HarnessDate extends Date {
    constructor(...args) {
      super(...(args.length ? args : [state.nowMs]));
    }

    static now() { return state.nowMs; }
  }

  function makeStateTokenBuilder() {
    const record = {
      method: '',
      arguments: Object.create(null),
      timeoutSeconds: 0
    };
    return {
      withMethod(method) {
        record.method = String(method || '');
        return this;
      },
      withArgument(name, value) {
        record.arguments[String(name)] = String(value);
        return this;
      },
      withTimeout(seconds) {
        record.timeoutSeconds = Number(seconds);
        return this;
      },
      createToken() {
        state.stateTokenCounter += 1;
        const token = `test_state_${sha256Base64Url(
          `${state.stateTokenCounter}|${state.nowMs}|${JSON.stringify(record)}`
        )}`;
        state.stateTokens.set(token, {
          method: record.method,
          arguments: { ...record.arguments },
          timeoutSeconds: record.timeoutSeconds,
          createdAt: state.nowMs
        });
        return token;
      }
    };
  }

  function tokenEndpointResponse(fetchOptions) {
    const payload = new URLSearchParams(String(fetchOptions && fetchOptions.payload || ''));
    const code = payload.get('code') || '';
    const exchange = state.tokenExchanges.get(code);
    if (!exchange) return makeHttpResponse(400, { error: 'invalid_grant' });
    if (exchange.fetchError) throw exchange.fetchError;
    if (exchange.expectedCodeVerifier &&
      payload.get('code_verifier') !== exchange.expectedCodeVerifier) {
      return makeHttpResponse(400, { error: 'invalid_grant' });
    }
    if (exchange.expectedRedirectUri &&
      payload.get('redirect_uri') !== exchange.expectedRedirectUri) {
      return makeHttpResponse(400, { error: 'redirect_uri_mismatch' });
    }
    return makeHttpResponse(exchange.statusCode, exchange.body, exchange.headers);
  }

  const sandbox = {
    Buffer,
    Date: HarnessDate,
    console: quietConsole,
    Session: {
      getActiveUser() {
        state.activeUserCalls += 1;
        return { getEmail: () => state.activeEmail };
      },
      getTemporaryActiveUserKey() {
        state.temporaryUserKeyCalls += 1;
        return state.visitorKey;
      }
    },
    SpreadsheetApp: {
      ProtectionType: { SHEET: 'SHEET' },
      getActiveSpreadsheet: () => spreadsheet,
      openById(id) {
        if (String(id) !== spreadsheet.getId()) throw new Error('Spreadsheet not found');
        return spreadsheet;
      },
      flush() { state.flushCount += 1; }
    },
    LockService: { getScriptLock: () => scriptLock },
    PropertiesService: { getScriptProperties: () => properties },
    CacheService: { getScriptCache: () => cache },
    ScriptApp: {
      getService: () => ({ getUrl: () => state.webAppUrl }),
      getScriptId: () => state.scriptId,
      newStateToken: () => makeStateTokenBuilder()
    },
    HtmlService: {
      createHtmlOutput(content) {
        let title = '';
        return {
          getContent: () => String(content || ''),
          getTitle: () => title,
          setTitle(value) { title = String(value || ''); return this; }
        };
      }
    },
    Utilities: makeUtilities(state),
    UrlFetchApp: {
      fetch(url, fetchOptions) {
        const normalizedUrl = String(url || '');
        state.fetches.push({ url: normalizedUrl, options: { ...(fetchOptions || {}) } });
        if (state.fetchError) {
          const error = state.fetchError;
          state.fetchError = null;
          throw error;
        }
        if (normalizedUrl === GOOGLE_OAUTH_TOKEN_URL) {
          return tokenEndpointResponse(fetchOptions || {});
        }
        if (normalizedUrl === GOOGLE_JWKS_URL) {
          return makeHttpResponse(state.jwksStatus, state.jwks, state.jwksHeaders);
        }
        throw new Error(`Unexpected UrlFetchApp URL: ${normalizedUrl}`);
      }
    },
    DriveApp: {
      Access: { DOMAIN_WITH_LINK: 'DOMAIN_WITH_LINK', ANYONE_WITH_LINK: 'ANYONE_WITH_LINK' },
      Permission: { VIEW: 'VIEW' },
      getFolderById() { throw new Error('Drive is not available in backend unit tests'); },
      getFileById() { throw new Error('Drive is not available in backend unit tests'); }
    }
  };
  sandbox.globalThis = sandbox;
  const context = vm.createContext(sandbox, { name: 'apps-script-backend-test' });
  loadSources(context);

  function issueIdToken(email, claims = {}, tokenOptions = {}) {
    return signGoogleIdToken(email, claims, {
      nowMs: state.nowMs,
      ...tokenOptions
    });
  }

  function setIdToken(idToken) {
    state.idToken = String(idToken || '');
    return state.idToken;
  }

  function nextBrowserSecret(prefix) {
    state.browserSecretCounter += 1;
    return browserSecret(prefix, state.browserSecretCounter);
  }

  function startOAuth(startOptions = {}) {
    if (Object.prototype.hasOwnProperty.call(startOptions, 'visitorKey')) {
      state.visitorKey = String(startOptions.visitorKey || '');
    }
    const pollToken = startOptions.pollToken || nextBrowserSecret('poll1_');
    const sessionToken = startOptions.sessionToken || nextBrowserSecret('session1_');
    const input = Object.prototype.hasOwnProperty.call(startOptions, 'input')
      ? startOptions.input
      : {
        pollTokenHash: startOptions.pollTokenHash || sha256Base64Url(pollToken),
        sessionTokenHash: startOptions.sessionTokenHash || sha256Base64Url(sessionToken)
      };
    const response = invokeRaw('beginOAuthSignIn', input);
    const result = {
      response,
      pollToken,
      sessionToken,
      input,
      visitorKey: state.visitorKey
    };
    if (!response || response.ok !== true) return result;
    const data = response.data;
    const authorizationUrl = new URL(String(data.authorizationUrl));
    const stateToken = authorizationUrl.searchParams.get('state');
    return {
      ...result,
      flowId: data.flowId,
      expiresAt: data.expiresAt,
      authorizationUrl,
      stateToken,
      stateRecord: { arguments: { oauthCodeVerifier: context.readOAuthCallbackRecord_(cache, context.oauthCallbackCacheKey_(stateToken)).codeVerifier } }
    };
  }

  function callbackEvent(start, values = {}, eventOverrides = {}) {
    const stateArguments = start && start.stateRecord
      ? { ...start.stateRecord.arguments }
      : {};
    const parameter = { state: start.stateToken, ...values, ...(eventOverrides.parameter || {}) };
    const parameters = Object.fromEntries(Object.entries(parameter).map(([name, value]) =>
      [name, [String(value)]])
    );
    Object.entries(eventOverrides.parameters || {}).forEach(([name, value]) => {
      parameters[name] = Array.isArray(value) ? value.map(String) : [String(value)];
    });
    return { parameter, parameters };
  }

  function finishOAuth(start, finishOptions = {}) {
    if (!start || !start.response || start.response.ok !== true) {
      throw new TypeError('A successful startOAuth result is required');
    }
    if (Object.prototype.hasOwnProperty.call(finishOptions, 'visitorKey')) {
      state.visitorKey = String(finishOptions.visitorKey || '');
    }
    const callbackValues = {};
    let code = '';
    if (Object.prototype.hasOwnProperty.call(finishOptions, 'oauthError')) {
      callbackValues.error = String(finishOptions.oauthError || 'access_denied');
    } else {
      state.authorizationCodeCounter += 1;
      code = finishOptions.code || `test-authorization-code-${state.authorizationCodeCounter}`;
      callbackValues.code = code;
      const email = finishOptions.email === undefined
        ? state.identityEmail
        : String(finishOptions.email || '');
      const claims = {
        nonce: start.authorizationUrl.searchParams.get('nonce'),
        ...(finishOptions.claims || {})
      };
      state.idToken = Object.prototype.hasOwnProperty.call(finishOptions, 'idToken')
        ? String(finishOptions.idToken || '')
        : issueIdToken(email, claims, finishOptions.tokenOptions || {});
      const defaultBody = {
        access_token: 'test-access-token-not-retained',
        expires_in: 3600,
        id_token: state.idToken,
        scope: 'openid email',
        token_type: 'Bearer'
      };
      state.tokenExchanges.set(code, {
        statusCode: finishOptions.tokenStatus === undefined
          ? 200
          : Number(finishOptions.tokenStatus),
        body: Object.prototype.hasOwnProperty.call(finishOptions, 'tokenBody')
          ? finishOptions.tokenBody
          : defaultBody,
        headers: finishOptions.tokenHeaders || {},
        fetchError: finishOptions.tokenFetchError || null,
        expectedCodeVerifier: start.stateRecord &&
          start.stateRecord.arguments.oauthCodeVerifier,
        expectedRedirectUri: start.authorizationUrl.searchParams.get('redirect_uri')
      });
    }
    const event = finishOptions.event || callbackEvent(
      start,
      callbackValues,
      finishOptions.eventOverrides || {}
    );
    const callbackOutput = invokeRaw('doGet', event);
    const handoffCode = callbackOutput.getContent().match(/confirm1_[A-Za-z0-9_-]{43}/)?.[0] || '';
    const pollResponse = finishOptions.skipPoll
      ? null
      : invokeRaw('completeOAuthSignIn',
        finishOptions.flowId || start.flowId,
        finishOptions.pollToken || start.pollToken, handoffCode, start.sessionToken);
    if (pollResponse && pollResponse.ok === true &&
      pollResponse.data && pollResponse.data.status === 'COMPLETE') {
      state.sessionToken = start.sessionToken;
    }
    return { callbackOutput, pollResponse, event, code, handoffCode };
  }

  function signInAs(email, claims = {}, tokenOptions = {}, authOptions = {}) {
    state.identityEmail = String(email || '');
    state.sessionToken = '';
    if (Object.prototype.hasOwnProperty.call(authOptions, 'visitorKey')) {
      state.visitorKey = String(authOptions.visitorKey || '');
    } else {
      state.visitorKey = `test-visitor:${state.identityEmail || 'anonymous'}`;
    }
    const start = startOAuth(authOptions.start || {});
    if (!start.response || start.response.ok !== true) return { start, finish: null };
    const finish = finishOAuth(start, {
      email: state.identityEmail,
      claims,
      tokenOptions,
      ...(authOptions.finish || {})
    });
    return { start, finish };
  }

  function setTokenIdentity(email, claims = {}, tokenOptions = {}) {
    return signInAs(email, claims, tokenOptions);
  }

  function setActiveEmail(email, claims = {}, tokenOptions = {}) {
    state.activeEmail = String(email || '');
    return setTokenIdentity(state.activeEmail, claims, tokenOptions);
  }

  function setVisitorKey(value) {
    state.visitorKey = String(value || '');
    return state.visitorKey;
  }

  function setSessionToken(value) {
    state.sessionToken = String(value || '');
    return state.sessionToken;
  }

  function advanceTime(seconds) {
    state.nowMs += Number(seconds) * 1000;
    return state.nowMs;
  }

  function setJwks(jwks, statusCode = 200, headers) {
    state.jwks = jwks || { keys: [] };
    state.jwksStatus = Number(statusCode);
    if (headers) state.jwksHeaders = { ...headers };
    cache.remove('google-identity-jwks:v1');
  }

  function failNextFetch(error) {
    state.fetchError = error instanceof Error ? error : new Error(String(error || 'JWKS fetch failed'));
  }

  function invokeRaw(name, ...args) {
    if (typeof context[name] !== 'function') throw new TypeError(`Unknown GAS function: ${name}`);
    return context[name](...args);
  }

  function invokeWithToken(name, sessionToken, ...args) {
    if (!PUBLIC_RPC_SET.has(name)) {
      throw new TypeError(`Not a public RPC: ${name}`);
    }
    return invokeRaw(name, sessionToken, ...args);
  }

  function invoke(name, ...args) {
    return PUBLIC_RPC_SET.has(name)
      ? invokeWithToken(name, state.sessionToken, ...args)
      : invokeRaw(name, ...args);
  }

  function setup() {
    const result = invokeRaw('setupSystem_');
    if (!result || !result.ok) {
      const error = new Error(result && result.error ? result.error.message : 'setupSystem_ failed');
      error.result = result;
      throw error;
    }
    if (options.autoAuthenticate !== false) {
      const authenticated = signInAs(
        state.identityEmail,
        state.defaultTokenClaims,
        state.defaultTokenOptions,
        { visitorKey: state.visitorKey }
      );
      if (!authenticated.finish || !authenticated.finish.pollResponse ||
        authenticated.finish.pollResponse.ok !== true) {
        const response = authenticated.finish
          ? authenticated.finish.pollResponse
          : authenticated.start.response;
        const error = new Error(response && response.error
          ? response.error.message
          : 'Initial OAuth sign-in failed');
        error.result = response;
        throw error;
      }
    }
    return result.data;
  }

  function records(sheetName) {
    return Array.from(invoke('listRecords_', sheetName), (record) => ({ ...record }));
  }

  function find(sheetName, idField, id) {
    const record = invoke('findRecordById_', sheetName, idField, id);
    return record ? { ...record } : null;
  }

  function replaceCell(sheetName, idField, id, fieldName, value) {
    const sheet = spreadsheet.getSheetByName(sheetName);
    if (!sheet) throw new Error(`Unknown sheet: ${sheetName}`);
    const headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
    const idIndex = headers.indexOf(idField);
    const fieldIndex = headers.indexOf(fieldName);
    if (idIndex < 0 || fieldIndex < 0) throw new Error(`Unknown field: ${fieldName}`);
    for (let row = 2; row <= sheet.getLastRow(); row += 1) {
      if (String(sheet.getRange(row, idIndex + 1).getValues()[0][0]) === String(id)) {
        sheet.getRange(row, fieldIndex + 1).setValues([[value]]);
        return;
      }
    }
    throw new Error(`Record not found: ${id}`);
  }

  function plain(value) {
    return value === undefined ? undefined : JSON.parse(JSON.stringify(value));
  }

  return {
    context,
    state,
    spreadsheet,
    properties,
    cache,
    scriptLock,
    advanceTime,
    callbackEvent,
    finishOAuth,
    signInAs,
    startOAuth,
    setActiveEmail,
    setTokenIdentity,
    setIdToken,
    setSessionToken,
    setVisitorKey,
    issueIdToken,
    setJwks,
    failNextFetch,
    invoke,
    invokeRaw,
    invokeWithToken,
    setup,
    records,
    find,
    replaceCell,
    plain
  };
}

module.exports = {
  GOOGLE_JWKS_URL,
  GOOGLE_OAUTH_TOKEN_URL,
  PROJECT_ROOT,
  PUBLIC_RPC_NAMES,
  SOURCE_FILES,
  TEST_GOOGLE_KEY_ID,
  TEST_GOOGLE_OAUTH_CLIENT_ID,
  TEST_GOOGLE_OAUTH_CLIENT_SECRET,
  TEST_GOOGLE_PUBLIC_JWK,
  TEST_SCRIPT_ID,
  sha256Base64Url,
  signGoogleIdToken,
  createAppsScriptHarness
};
