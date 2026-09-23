/**
 * Central deployment configuration.
 * Script Properties with the same names override these values.
 */
var CONFIG = Object.freeze({
  APP_NAME: 'CRS Yuem-Kuen System',
  APP_SHORT_NAME: 'CRS Yuem-Kuen',
  APP_VERSION: '0.2.0',
  SPREADSHEET_ID: '',
  DRIVE_FOLDER_ID: '',
  WEB_APP_URL: '',
  ADMIN_EMAILS: ['admin@example.com'],
  ALLOWED_DOMAINS: [],
  ALLOWED_DOMAIN: '',
  GOOGLE_OAUTH_CLIENT_ID: '',
  GOOGLE_OAUTH_CLIENT_SECRET: '',
  GOOGLE_OAUTH_REDIRECT_URI: '',
  AUTH_FLOW_TTL_SECONDS: 600,
  AUTH_SESSION_TTL_SECONDS: 21600,
  TIMEZONE: 'Asia/Bangkok',
  LOCALE: 'th_TH',
  AUTO_PROVISION_USERS: false,
  MAX_PAGE_SIZE: 100,
  DEFAULT_PAGE_SIZE: 24,
  CACHE_TTL_SECONDS: 120,
  LOCK_TIMEOUT_MS: 15000,
  MAX_IMAGE_BYTES: 4 * 1024 * 1024,
  IMAGE_SHARING: 'DOMAIN_WITH_LINK'
});

function getRuntimeConfig_() {
  var properties = PropertiesService.getScriptProperties().getProperties();
  var allowedDomains = parseAllowedDomains_(properties);
  var maxPageSize = parseIntegerProperty_(properties.MAX_PAGE_SIZE, CONFIG.MAX_PAGE_SIZE, 1, 100);
  var defaultPageSize = Math.min(
    parseIntegerProperty_(properties.DEFAULT_PAGE_SIZE, CONFIG.DEFAULT_PAGE_SIZE, 1, 100),
    maxPageSize
  );
  return {
    APP_NAME: valueOrDefault_(properties.APP_NAME, CONFIG.APP_NAME),
    APP_SHORT_NAME: valueOrDefault_(properties.APP_SHORT_NAME, CONFIG.APP_SHORT_NAME),
    APP_VERSION: valueOrDefault_(properties.APP_VERSION, CONFIG.APP_VERSION),
    SPREADSHEET_ID: valueOrDefault_(properties.SPREADSHEET_ID, CONFIG.SPREADSHEET_ID),
    DRIVE_FOLDER_ID: valueOrDefault_(properties.DRIVE_FOLDER_ID, CONFIG.DRIVE_FOLDER_ID),
    WEB_APP_URL: valueOrDefault_(properties.WEB_APP_URL, CONFIG.WEB_APP_URL),
    ADMIN_EMAILS: parseListProperty_(properties.ADMIN_EMAILS, CONFIG.ADMIN_EMAILS)
      .map(normalizeEmail_)
      .filter(Boolean),
    ALLOWED_DOMAINS: allowedDomains,
    ALLOWED_DOMAIN: normalizeDomain_(valueOrDefault_(properties.ALLOWED_DOMAIN, CONFIG.ALLOWED_DOMAIN)),
    GOOGLE_OAUTH_CLIENT_ID: valueOrDefault_(
      properties.GOOGLE_OAUTH_CLIENT_ID,
      CONFIG.GOOGLE_OAUTH_CLIENT_ID
    ),
    GOOGLE_OAUTH_CLIENT_SECRET: valueOrDefault_(
      properties.GOOGLE_OAUTH_CLIENT_SECRET,
      CONFIG.GOOGLE_OAUTH_CLIENT_SECRET
    ),
    GOOGLE_OAUTH_REDIRECT_URI: valueOrDefault_(properties.GOOGLE_OAUTH_REDIRECT_URI, CONFIG.GOOGLE_OAUTH_REDIRECT_URI),
    AUTH_FLOW_TTL_SECONDS: parseIntegerProperty_(
      properties.AUTH_FLOW_TTL_SECONDS,
      CONFIG.AUTH_FLOW_TTL_SECONDS,
      120,
      1800
    ),
    AUTH_SESSION_TTL_SECONDS: parseIntegerProperty_(
      properties.AUTH_SESSION_TTL_SECONDS,
      CONFIG.AUTH_SESSION_TTL_SECONDS,
      300,
      21600
    ),
    TIMEZONE: valueOrDefault_(properties.TIMEZONE, CONFIG.TIMEZONE),
    LOCALE: valueOrDefault_(properties.LOCALE, CONFIG.LOCALE),
    AUTO_PROVISION_USERS: parseBooleanProperty_(properties.AUTO_PROVISION_USERS, CONFIG.AUTO_PROVISION_USERS),
    MAX_PAGE_SIZE: maxPageSize,
    DEFAULT_PAGE_SIZE: defaultPageSize,
    CACHE_TTL_SECONDS: parseIntegerProperty_(properties.CACHE_TTL_SECONDS, CONFIG.CACHE_TTL_SECONDS, 30, 21600),
    LOCK_TIMEOUT_MS: parseIntegerProperty_(properties.LOCK_TIMEOUT_MS, CONFIG.LOCK_TIMEOUT_MS, 1000, 30000),
    MAX_IMAGE_BYTES: parseIntegerProperty_(properties.MAX_IMAGE_BYTES, CONFIG.MAX_IMAGE_BYTES, 1024, 10 * 1024 * 1024),
    IMAGE_SHARING: valueOrDefault_(properties.IMAGE_SHARING, CONFIG.IMAGE_SHARING).toUpperCase()
  };
}

function parseAllowedDomains_(properties) {
  var modernValue = properties && properties.ALLOWED_DOMAINS;
  var rawDomains;
  if (modernValue !== undefined && modernValue !== null && String(modernValue).trim() !== '') {
    rawDomains = parseListProperty_(modernValue, []);
  } else {
    var legacyValue = valueOrDefault_(
      properties && properties.ALLOWED_DOMAIN,
      CONFIG.ALLOWED_DOMAIN
    );
    rawDomains = legacyValue ? [legacyValue] : CONFIG.ALLOWED_DOMAINS.slice();
  }
  var seen = Object.create(null);
  return rawDomains.map(normalizeDomain_).filter(function (domain) {
    if (!domain || seen[domain]) return false;
    seen[domain] = true;
    return true;
  });
}

function valueOrDefault_(value, fallback) {
  return value === undefined || value === null || String(value).trim() === '' ? fallback : String(value).trim();
}

function parseListProperty_(value, fallback) {
  if (value === undefined || value === null || String(value).trim() === '') {
    return fallback.slice();
  }
  return String(value).split(',').map(function (item) { return item.trim(); }).filter(Boolean);
}

function parseBooleanProperty_(value, fallback) {
  if (value === undefined || value === null || String(value).trim() === '') return Boolean(fallback);
  return ['true', '1', 'yes', 'on'].indexOf(String(value).trim().toLowerCase()) !== -1;
}

function parseIntegerProperty_(value, fallback, minimum, maximum) {
  var parsed = Number(value === undefined || value === null || value === '' ? fallback : value);
  if (!Number.isInteger(parsed) || parsed < minimum || parsed > maximum) return fallback;
  return parsed;
}

function normalizeImageSharingMode_(sharingMode) {
  var mode = normalizeWhitespace_(sharingMode || 'DOMAIN_WITH_LINK').toUpperCase();
  assertApp_(['DOMAIN_WITH_LINK', 'ANYONE_WITH_LINK'].indexOf(mode) !== -1,
    'CONFIG_ERROR', 'ค่า IMAGE_SHARING ไม่ถูกต้อง', null, false);
  return mode;
}
