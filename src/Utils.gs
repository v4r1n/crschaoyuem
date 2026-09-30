function nowIso_() {
  return new Date().toISOString();
}

function normalizeWhitespace_(value) {
  return String(value === undefined || value === null ? '' : value).trim().replace(/\s+/g, ' ');
}

function normalizeEmail_(value) {
  return normalizeWhitespace_(value).toLowerCase();
}

function isSafeEmailValue_(value) {
  var email = normalizeEmail_(value);
  return email.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) &&
    !/^[=+\-@]/.test(email);
}

function normalizeDomain_(value) {
  return normalizeWhitespace_(value).replace(/^@/, '').toLowerCase();
}

function isSafeDomainValue_(value) {
  var domain = normalizeDomain_(value);
  return domain.length <= 253 &&
    /^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/.test(domain);
}

function normalizeSerial_(value) {
  return normalizeWhitespace_(value).toLowerCase();
}

function isEmailInDomain_(email, domain) {
  var normalizedDomain = normalizeDomain_(domain);
  if (!normalizedDomain) return false;
  var parts = normalizeEmail_(email).split('@');
  return parts.length === 2 && parts[1] === normalizedDomain;
}

function isEmailInAllowedDomains_(email, domains) {
  return Array.isArray(domains) && domains.length > 0 && domains.some(function (domain) {
    return isEmailInDomain_(email, domain);
  });
}

function sanitizeSheetText_(value) {
  var text = normalizeWhitespace_(value);
  return /^[=+\-@]/.test(text) ? "'" + text : text;
}

function sanitizeMultilineSheetText_(value) {
  var text = String(value === undefined || value === null ? '' : value).trim();
  return /^[=+\-@]/.test(text) ? "'" + text : text;
}

function stripSheetEscape_(value) {
  var text = String(value === undefined || value === null ? '' : value);
  return /^'[=+\-@]/.test(text) ? text.substring(1) : text;
}

function padNumber_(value, width) {
  var text = String(value);
  while (text.length < width) text = '0' + text;
  return text;
}

function parseDateOnly_(value, fieldName) {
  var text = String(value || '');
  var match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(text);
  assertApp_(match, 'VALIDATION_FAILED', 'รูปแบบวันที่ไม่ถูกต้อง', {
    fieldErrors: fieldError_(fieldName || 'date', 'กรุณาระบุวันที่ในรูปแบบ YYYY-MM-DD')
  });
  var year = Number(match[1]);
  var month = Number(match[2]);
  var day = Number(match[3]);
  var date = new Date(Date.UTC(year, month - 1, day));
  assertApp_(date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day,
    'VALIDATION_FAILED', 'วันที่ไม่ถูกต้อง', {
      fieldErrors: fieldError_(fieldName || 'date', 'วันที่นี้ไม่มีอยู่จริง')
    });
  return text;
}

function compareDateOnly_(left, right) {
  return String(left).localeCompare(String(right));
}

function todayInTimezone_(timezone) {
  return Utilities.formatDate(new Date(), timezone || getRuntimeConfig_().TIMEZONE, 'yyyy-MM-dd');
}

function isBorrowOverdue_(borrow, today) {
  var active = borrow && [BORROW_STATUS.CHECKED_OUT, BORROW_STATUS.RETURN_REQUESTED].indexOf(borrow.status) !== -1;
  return Boolean(active && borrow.due_date && compareDateOnly_(today, borrow.due_date) > 0);
}

function toSerializable_(value) {
  if (value instanceof Date) return value.toISOString();
  if (Array.isArray(value)) return value.map(toSerializable_);
  if (value && typeof value === 'object') {
    var output = {};
    Object.keys(value).forEach(function (key) { output[key] = toSerializable_(value[key]); });
    return output;
  }
  if (value === undefined) return null;
  return value;
}

function cloneObject_(value) {
  return JSON.parse(JSON.stringify(toSerializable_(value)));
}

function fieldError_(field, message) {
  var output = {};
  output[field] = message;
  return output;
}

function mergeObjects_(base, updates) {
  var result = {};
  Object.keys(base || {}).forEach(function (key) { result[key] = base[key]; });
  Object.keys(updates || {}).forEach(function (key) { result[key] = updates[key]; });
  return result;
}

function stableJson_(value) {
  if (value === undefined) return 'null';
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return '[' + value.map(stableJson_).join(',') + ']';
  return '{' + Object.keys(value).sort().map(function (key) {
    return JSON.stringify(key) + ':' + stableJson_(value[key]);
  }).join(',') + '}';
}

function getWebAppBaseUrl_() {
  var configuredRaw = getRuntimeConfig_().WEB_APP_URL;
  // WEB_APP_URL is the sole link source. The service URL only verifies that
  // the configured deployment is the one currently executing.
  var configured = normalizeWebAppExecUrl_(configuredRaw);
  if (!configured) return '';
  var detectedRaw = '';
  try { detectedRaw = ScriptApp.getService().getUrl() || ''; }
  catch (ignored) { detectedRaw = ''; }
  var detected = normalizeWebAppExecUrl_(detectedRaw);
  // A /dev URL cannot verify an /exec deployment; it is never a link base.
  return detected && configured !== detected ? '' : configured;
}

function normalizeWebAppExecUrl_(value) {
  var candidate = String(value || '').trim();
  // Google can insert a numbered account route in the browser/service URL.
  // Strip only that exact Google route; never persist it in a QR/share link.
  var match = /^https:\/\/script\.google\.com\/macros\/(?:u\/\d+\/)?s\/([A-Za-z0-9_-]+)\/exec\/?$/.exec(candidate);
  if (!match) {
    return '';
  }
  return 'https://script.google.com/macros/s/' + match[1] + '/exec';
}

function buildAssetUrl_(assetId) {
  var base = getWebAppBaseUrl_();
  return base ? base + '?view=equipment-detail&id=' + encodeURIComponent(assetId) : '';
}
