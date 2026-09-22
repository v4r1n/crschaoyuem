var HTML_PARTIALS_ = Object.freeze([
  'styles',
  'components',
  'dashboard',
  'equipment',
  'equipment-detail',
  'scan',
  'borrow',
  'my-borrow',
  'admin',
  'scripts-api',
  'scripts-core',
  'scripts-dashboard',
  'scripts-equipment',
  'scripts-qr',
  'scripts-borrow',
  'scripts-admin',
  'vendor-qrcode-generator',
  'vendor-html5-qrcode'
]);

var CLIENT_ROUTES_ = Object.freeze([
  'dashboard',
  'equipment',
  'equipment-detail',
  'borrow',
  'my-borrow',
  'history',
  'admin',
  'scan',
  'account'
]);

/**
 * Serves one HTML-service shell. Authorization remains in guarded RPC methods;
 * query parameters are reduced to an allowlisted route and generated Asset ID.
 */
function doGet(event) {
  var callbackParams = event && event.parameter || {};
  var callbackLists = event && event.parameters || {};
  if (['code', 'error', 'state'].some(function (key) {
    return Object.prototype.hasOwnProperty.call(callbackParams, key) ||
      Object.prototype.hasOwnProperty.call(callbackLists, key);
  })) return googleOAuthCallback_(event);
  var navigation = resolveInitialNavigation_(event);
  var template = HtmlService.createTemplateFromFile('index');
  template.initialView = navigation.view;
  template.initialAssetId = navigation.assetId;

  return template.evaluate()
    .setTitle(getPublicAppTitle_())
    .addMetaTag('viewport', 'width=device-width, initial-scale=1, viewport-fit=cover')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.DEFAULT);
}

/**
 * Includes only source-controlled partials. The allowlist makes force-printing
 * static HTML safe and prevents a template from selecting arbitrary files.
 */
function include_(fileName) {
  var normalizedName = String(fileName || '').trim();
  if (HTML_PARTIALS_.indexOf(normalizedName) === -1) {
    throw new Error('HTML partial is not allowlisted: ' + normalizedName);
  }
  return HtmlService.createHtmlOutputFromFile(normalizedName).getContent();
}

function resolveInitialNavigation_(event) {
  var parameters = event && event.parameter ? event.parameter : {};
  var requestedView = normalizeClientRoute_(parameters.view || parameters.route);
  var assetId = normalizePublicAssetId_(parameters.id || parameters.asset_id);

  if (!requestedView && assetId) requestedView = 'equipment-detail';
  if (requestedView === 'equipment-detail' && !assetId) requestedView = 'equipment';

  return {
    view: requestedView || 'dashboard',
    assetId: assetId
  };
}

function normalizeClientRoute_(value) {
  var route = String(value || '').trim().toLowerCase();
  return CLIENT_ROUTES_.indexOf(route) === -1 ? '' : route;
}

function normalizePublicAssetId_(value) {
  var assetId = String(value || '').trim().toUpperCase();
  return /^AST-\d{6}$/.test(assetId) ? assetId : '';
}

function getPublicAppTitle_() {
  var configuredTitle = String(getRuntimeConfig_().APP_NAME || '').trim();
  return configuredTitle || 'CRS Yuem-Kuen System';
}
