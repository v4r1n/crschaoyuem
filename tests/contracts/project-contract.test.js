const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const ROOT = path.resolve(__dirname, '..', '..');
const SRC = path.join(ROOT, 'src');

function read(relativePath) {
  return fs.readFileSync(path.join(ROOT, relativePath), 'utf8');
}

function sourceFiles(extension) {
  return fs.readdirSync(SRC)
    .filter((file) => file.endsWith(extension))
    .sort();
}

function wrappedScript(file) {
  const match = fs.readFileSync(path.join(SRC, file), 'utf8')
    .match(/^\s*<script>\s*([\s\S]*?)\s*<\/script>\s*$/);
  assert.ok(match, `${file} must contain one script wrapper`);
  return match[1];
}

function loadServerContext() {
  const context = vm.createContext({
    console: { error() {}, log() {}, warn() {} },
    URL,
  });
  const combined = sourceFiles('.gs')
    .map((file) => fs.readFileSync(path.join(SRC, file), 'utf8'))
    .join('\n');
  new vm.Script(combined, { filename: 'combined.gs' }).runInContext(context);
  return context;
}

test('all server, browser, and manifest sources compile', () => {
  const serverFiles = sourceFiles('.gs');
  for (const file of serverFiles) {
    const source = fs.readFileSync(path.join(SRC, file), 'utf8');
    new vm.Script(source, { filename: file });
    assert.doesNotMatch(source,
      /\b(?:0[xX][\da-fA-F]+|0[bB][01]+|0[oO][0-7]+|\d+)n\b/,
      `${file} must avoid BigInt literal syntax rejected by the Apps Script parser`);
  }
  new vm.Script(
    serverFiles.map((file) => fs.readFileSync(path.join(SRC, file), 'utf8')).join('\n'),
    { filename: 'combined.gs' },
  );

  const browserFiles = sourceFiles('.html').filter((file) =>
    /^(scripts-|vendor-)/.test(file));
  for (const file of browserFiles) {
    new vm.Script(wrappedScript(file), { filename: file });
  }
  const manifest = JSON.parse(read('src/appsscript.json'));
  assert.deepEqual(manifest.oauthScopes, [
    'https://www.googleapis.com/auth/drive',
    'https://www.googleapis.com/auth/script.external_request',
    'https://www.googleapis.com/auth/spreadsheets',
    'https://www.googleapis.com/auth/userinfo.email',
  ]);
  assert.deepEqual(manifest.webapp, {
    access: 'ANYONE',
    executeAs: 'USER_DEPLOYING',
  });
  assert.equal(serverFiles.length, 26);
  assert.equal(browserFiles.length, 9);
});

test('theme boot is flash-safe and component colors are centralized as design tokens', () => {
  const index = read('src/index.html');
  const bootPosition = index.indexOf("localStorage.getItem('crs-theme')");
  const stylesheetPosition = index.indexOf('bootstrap.min.css');
  assert.ok(bootPosition > 0 && bootPosition < stylesheetPosition,
    'theme preference must be applied before stylesheets can render');
  assert.match(index, /stored === 'light' \|\| stored === 'dark' \|\| stored === 'system'/);
  assert.match(index, /prefers-color-scheme: dark/);
  assert.match(index, /data-action="theme-toggle"/);
  assert.match(index, /aria-label=/);
  assert.match(index, /<header class="app-topbar">[\s\S]*?id="theme-toggle"/,
    'authenticated theme toggle must be contained by the app topbar');

  const controller = read('src/scripts-core.html');
  assert.match(controller, /const THEME_ORDER = \['system', 'light', 'dark'\]/);
  assert.match(controller, /localStorage\.setItem\(THEME_STORAGE_KEY, selected\)/);
  assert.match(controller, /addEventListener\('change', followSystemTheme\)/);

  const styles = read('src/styles.html');
  assert.match(styles, /\[data-bs-theme="dark"\]\s*\{/);
  assert.match(styles, /\.theme-toggle\s*\{/);
  assert.match(styles, /\.toast-container:empty\s*\{[\s\S]*?display:\s*none/,
    'empty toast container must not create an overlay at the viewport edge');
  for (const token of ['heading', 'label', 'link', 'muted', 'danger', 'warning', 'success', 'info']) {
    assert.match(styles, new RegExp(`--crs-${token}:`), `${token} color must be a design token`);
  }
  assert.match(styles, /\.text-body-secondary/);
  assert.match(styles, /\.btn-outline-secondary/);
  assert.match(styles, /\.alert-secondary/);
  assert.match(styles, /--crs-auth-guidance:\s*#f3f7fb/);
  assert.match(styles, /--crs-auth-label:\s*#ffffff/);
  assert.match(index, /class="oauth-handoff-guidance"/);
  assert.match(index, /class="oauth-handoff-label"/);
  const firstComponentRule = styles.search(/^  \*,\r?$/m);
  assert.ok(firstComponentRule > 0, 'component rule boundary must remain discoverable');
  const componentRules = styles.slice(firstComponentRule);
  assert.doesNotMatch(componentRules, /#[\da-f]{3,8}|rgba?\(/i,
    'component rules must consume design tokens instead of declaring colors inline');
});

test('deployment runbook covers every runtime file, config key, and requested step', () => {
  const guide = read('docs/DEPLOYMENT.md');
  const runtimeFiles = fs.readdirSync(SRC)
    .filter((file) => /\.(?:gs|html|json)$/.test(file))
    .sort();
  assert.equal(runtimeFiles.length, 46);
  for (const file of runtimeFiles) {
    const escapedFile = file.replaceAll('.', '\\.');
    assert.match(guide, new RegExp(`\\b${escapedFile}\\b`),
      `${file} must be named in the deployment inventory`);
  }

  const configBlock = read('src/Config.gs')
    .match(/var CONFIG = Object\.freeze\(\{([\s\S]*?)\n\}\);/);
  assert.ok(configBlock, 'central CONFIG block must remain discoverable');
  const configKeys = [...configBlock[1].matchAll(/^\s{2}([A-Z][A-Z0-9_]+):/gm)]
    .map((match) => match[1]);
  for (const key of configKeys) {
    assert.match(guide, new RegExp(`\\b${key}\\b`),
      `${key} must be documented for the deployer`);
  }

  const steps = [...guide.matchAll(/^## (\d+)\./gm)]
    .map((match) => Number(match[1]));
  assert.deepEqual(steps, Array.from({ length: 11 }, (_, index) => index + 1));
  assert.match(read('src/Setup.gs'), /event:\s*'SETUP_COMPLETED'/);
});

test('server exposes only the guarded RPCs and deliberate Apps Script entry points', () => {
  const expected = [
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
    'adminAuditLegacyUsers',
    'adminRepairLegacyUser',
    'adminUploadEquipmentImage',
    'acknowledgeOAuthOtpCopy',
    'beginOAuthSignIn',
    'completeOAuthSignIn',
    'createBorrowRequest',
    'doGet',
    'getAppBootstrap',
    'getBorrowDetail',
    'getDashboard',
    'getEquipmentDetail',
    'listCategories',
    'listEquipment',
    'listMyBorrowing',
    'listMyHistory',
    'logoutSession',
    'requestReturn',
  ];
  const actual = [];
  for (const file of sourceFiles('.gs')) {
    const source = fs.readFileSync(path.join(SRC, file), 'utf8');
    for (const match of source.matchAll(/^function\s+([A-Za-z_$][\w$]*)\s*\(/gm)) {
      if (!match[1].endsWith('_')) actual.push(match[1]);
    }
  }
  assert.deepEqual(actual.sort(), expected.sort());

  const api = read('src/Api.gs');
  const declarations = [...api.matchAll(
    /^function\s+([A-Za-z_$][\w$]*)\s*\(([^)]*)\)/gm,
  )];
  declarations.forEach((declaration, index) => {
    const name = declaration[1];
    if (name.endsWith('_')) return;
    const parameters = declaration[2].split(',').map((parameter) => parameter.trim()).filter(Boolean);
    assert.equal(parameters[0], 'sessionToken', `${name} must receive its application session first`);
    const end = declarations[index + 1] ? declarations[index + 1].index : api.length;
    const body = api.slice(declaration.index, end);
    const executor = name.startsWith('admin') ? 'executeAdminRpc_' : 'executeUserRpc_';
    assert.match(body, new RegExp(`return ${executor}\\s*\\(\\s*sessionToken\\s*,`),
      `${name} must use its session-verified role executor`);
  });
  assert.match(api,
    /function executeUserRpc_\s*\(sessionToken, handler\)[\s\S]*?executeSafely_\s*\([\s\S]*?requireUser_\s*\(sessionToken\)/);
  assert.match(api,
    /function executeAdminRpc_\s*\(sessionToken, handler\)[\s\S]*?executeSafely_\s*\([\s\S]*?requireAdmin_\s*\(sessionToken\)/);
  assert.match(read('src/Auth.gs'),
    /function requireUser_\s*\(sessionToken\)[\s\S]*?requireApplicationSession_\s*\(sessionToken\)/);
  const allServerSource = sourceFiles('.gs').map((file) =>
    fs.readFileSync(path.join(SRC, file), 'utf8')).join('\n');
  assert.doesNotMatch(allServerSource, /Session\.getEffectiveUser\s*\(/);
  assert.doesNotMatch(
    ['src/Api.gs', 'src/Auth.gs', 'src/IdentityService.gs'].map(read).join('\n'),
    /Session\.getActiveUser\s*\(/,
    'visitor identity must never come from the deployer Session user',
  );
  assert.match(read('src/Setup.gs'), /^function setupSystem_\s*\(/m,
    'editor-only setup must be private from google.script.run');
  assert.doesNotMatch(read('src/Setup.gs'), /^function setupSystem\s*\(/m);
  assert.match(read('src/Config.gs'), /GOOGLE_OAUTH_CLIENT_ID:\s*''/,
    'the OAuth client ID must be supplied through Script Properties');
  assert.match(read('src/Config.gs'), /GOOGLE_OAUTH_CLIENT_SECRET:\s*''/,
    'the OAuth client secret must be supplied through Script Properties');
});

test('include and route registries exactly match their source consumers', () => {
  const context = loadServerContext();
  const allowlisted = Array.from(context.HTML_PARTIALS_).sort();
  const included = [...read('src/index.html').matchAll(/include_\('([^']+)'\)/g)]
    .map((match) => match[1])
    .sort();
  assert.deepEqual(included, allowlisted);
  for (const partial of allowlisted) {
    assert.ok(fs.existsSync(path.join(SRC, `${partial}.html`)), `${partial}.html must exist`);
  }

  const registrations = sourceFiles('.html')
    .filter((file) => file.startsWith('scripts-'))
    .flatMap((file) => [...fs.readFileSync(path.join(SRC, file), 'utf8')
      .matchAll(/CRS\.registerRoute\('([^']+)'/g)])
    .map((match) => match[1])
    .sort();
  assert.deepEqual(registrations, Array.from(context.CLIENT_ROUTES_).sort());
});

test('fixed-width ID allocation fails atomically at sequence exhaustion', () => {
  const context = loadServerContext();
  let nextValue = 999999;
  let existing = Object.create(null);
  const updates = [];
  context.findRecordByField_ = () => ({ next_value: nextValue });
  context.getFieldValueSet_ = () => existing;
  context.updateRecordById_ = (...args) => {
    updates.push(args);
    return args[3];
  };
  context.nowIso_ = () => '2026-08-28T00:00:00.000Z';

  assert.deepEqual(Array.from(context.nextIdsLocked_('ASSET', 1)), ['AST-999999']);
  assert.equal(updates.at(-1)[3].next_value, 1000000);

  updates.length = 0;
  nextValue = 1000000;
  assert.throws(
    () => context.nextIdsLocked_('ASSET', 1),
    (error) => error && error.code === 'ID_EXHAUSTED' && error.retryable === false,
  );
  assert.equal(updates.length, 0);

  nextValue = 999999;
  assert.throws(
    () => context.nextIdsLocked_('ASSET', 2),
    (error) => error && error.code === 'ID_EXHAUSTED',
  );
  assert.equal(updates.length, 0);

  existing = { 'AST-999999': true };
  assert.throws(
    () => context.nextIdsLocked_('ASSET', 1),
    (error) => error && error.code === 'ID_EXHAUSTED',
  );
  assert.equal(updates.length, 0);

  existing = Object.create(null);
  nextValue = 999;
  assert.deepEqual(Array.from(context.nextIdsLocked_('CATEGORY', 1)), ['CAT-999']);
  nextValue = 1000;
  assert.throws(
    () => context.nextIdsLocked_('CATEGORY', 1),
    (error) => error && error.code === 'ID_EXHAUSTED',
  );
});

test('record validators reject over-width identifiers', () => {
  const context = loadServerContext();
  assert.equal(context.requireUserRecordId_('usr-000001'), 'USR-000001');
  assert.equal(context.requireCategoryRecordId_('cat-001'), 'CAT-001');
  assert.throws(() => context.requireUserRecordId_('USR-1000000'),
    (error) => error && error.code === 'VALIDATION_FAILED');
  assert.throws(() => context.requireCategoryRecordId_('CAT-1000'),
    (error) => error && error.code === 'VALIDATION_FAILED');
  assert.doesNotMatch(read('src/BorrowService.gs'), /BIT-\\d\{6,\}/);
});

test('server QR base accepts only the current canonical Apps Script exec URL', () => {
  const context = loadServerContext();
  const base = 'https://script.google.com/macros/s/AKfycbDeployment_123/exec';
  const other = 'https://script.google.com/macros/s/AKfycbOther_456/exec';
  let configured = '';
  let detected = base;
  context.getRuntimeConfig_ = () => ({ WEB_APP_URL: configured });
  context.ScriptApp = { getService: () => ({ getUrl: () => detected }) };

  assert.equal(context.getWebAppBaseUrl_(), base);
  assert.equal(context.buildAssetUrl_('AST-000001'),
    `${base}?view=equipment-detail&id=AST-000001`);
  detected = `${base}/`;
  assert.equal(context.getWebAppBaseUrl_(), base);

  configured = base;
  detected = base;
  assert.equal(context.getWebAppBaseUrl_(), base);
  detected = `${base.replace('/exec', '/dev')}`;
  assert.equal(context.getWebAppBaseUrl_(), base,
    'a /dev execution must keep the configured production /exec base');
  detected = other;
  assert.equal(context.getWebAppBaseUrl_(), '',
    'a configured deployment must match the detected deployment');

  detected = base;
  const invalid = [
    base.replace('/exec', '/dev'),
    'https://example.com/macros/s/AKfycbDeployment_123/exec',
    'https://script.googleusercontent.com/macros/s/AKfycbDeployment_123/exec',
    'https://user@script.google.com/macros/s/AKfycbDeployment_123/exec',
    'https://script.google.com:443/macros/s/AKfycbDeployment_123/exec',
    `${base}?view=equipment`,
    `${base}#fragment`,
    `${base}/extra`,
  ];
  for (const value of invalid) {
    configured = value;
    assert.equal(context.getWebAppBaseUrl_(), '', value);
  }
});

test('Drive sharing failures keep a stable application error code', () => {
  const context = loadServerContext();
  context.DriveApp = {
    Access: {
      DOMAIN_WITH_LINK: 'DOMAIN_WITH_LINK',
      ANYONE_WITH_LINK: 'ANYONE_WITH_LINK',
    },
    Permission: { VIEW: 'VIEW' },
  };
  const denied = {
    setSharing() { throw new Error('Sharing is disabled by organization policy'); },
  };
  assert.throws(
    () => context.applyImageSharing_(denied, 'DOMAIN_WITH_LINK'),
    (error) => error && error.code === 'DRIVE_SHARING_FAILED' && error.retryable === true,
  );

  let sharingAccess = '';
  let sharingPermission = '';
  const accepted = {
    setSharing(access, permission) {
      sharingAccess = access;
      sharingPermission = permission;
    },
    getSharingAccess: () => sharingAccess,
    getSharingPermission: () => sharingPermission,
  };
  assert.doesNotThrow(() => context.applyImageSharing_(accepted, 'DOMAIN_WITH_LINK'));
  assert.equal(sharingAccess, 'DOMAIN_WITH_LINK');
  assert.equal(sharingPermission, 'VIEW');
});

test('QR parser accepts only an exact asset ID or canonical same-app URL', () => {
  const base = 'https://script.google.com/macros/s/DEPLOYMENT/exec';
  const window = {
    URL,
    console: { error() {} },
    setTimeout,
    CRS: {
      state: { bootstrap: { app: { webAppUrl: base } } },
      registerRoute() {},
    },
  };
  window.window = window;
  new vm.Script(wrappedScript('scripts-qr.html'), { filename: 'scripts-qr.html' })
    .runInNewContext({ window, URL, setTimeout });
  const parse = window.CRS.qr.parseScannedAsset;
  const valid = [
    'AST-000001',
    ' ast-000001 ',
    `${base}?id=AST-000001`,
    `${base}?view=equipment-detail&id=AST-000001`,
    `${base}?asset_id=AST-000001`,
  ];
  for (const payload of valid) {
    assert.equal(parse(payload).assetId, 'AST-000001', payload);
  }

  const hostile = [
    '',
    'AST-00001',
    'AST-1000000',
    `http://script.google.com/macros/s/DEPLOYMENT/exec?id=AST-000001`,
    `https://example.com/macros/s/DEPLOYMENT/exec?id=AST-000001`,
    `https://user@script.google.com/macros/s/DEPLOYMENT/exec?id=AST-000001`,
    `${base}/?id=AST-000001`,
    `${base}#`,
    `${base}#fragment`,
    `${base}?view=equipment&id=AST-000001`,
    `${base}?view=equipment-detail&view=equipment-detail&id=AST-000001`,
    `${base}?id=AST-000001&id=AST-000002`,
    `${base}?id=AST-000001&asset_id=AST-000001`,
    `${base}?asset_id=AST-000001&asset_id=AST-000002`,
    `${base}?foo=1&id=AST-000001`,
    `${base}?constructor=1&id=AST-000001`,
    `${base}?__proto__=1&id=AST-000001`,
    `${base}?toString=1&id=AST-000001`,
    `${base}?hasOwnProperty=1&id=AST-000001`,
    `${base}?valueOf=1&id=AST-000001`,
    `${base}?view=&id=AST-000001`,
    `${base}?view=equipment-detail`,
  ];
  for (const payload of hostile) assert.equal(parse(payload), null, payload);
});

test('project-authored markup keeps the QR scanner passive and HTML safe', () => {
  const authored = sourceFiles('.html')
    .filter((file) => !file.startsWith('vendor-'))
    .map((file) => fs.readFileSync(path.join(SRC, file), 'utf8'))
    .join('\n');
  assert.doesNotMatch(authored, /navigator\.mediaDevices|getUserMedia|getCameras/);
  assert.doesNotMatch(authored, /\son[a-z]+\s*=/i);
  assert.doesNotMatch(authored, /javascript\s*:/i);
  assert.match(read('src/scripts-qr.html'), /\.scanFile\s*\(/);
});

test('login access card exposes only Google sign-in and has no retry handler', () => {
  const index = read('src/index.html');
  const core = read('src/scripts-core.html');
  const accessCard = index.match(/<section[\s\S]*?id="access-state"[\s\S]*?<\/section>/);
  assert.ok(accessCard, 'access-state section must exist');
  assert.equal((accessCard[0].match(/<button\b/g) || []).length, 2,
    'access card contains Google sign-in plus the hidden OAuth confirmation button');
  assert.match(accessCard[0], /data-action="google-signin"/);
  assert.doesNotMatch(accessCard[0], /retry-bootstrap|ลองอีกครั้ง/);
  assert.doesNotMatch(core, /retry-bootstrap/);
});

test('canonical CRS Yuem-Kuen branding is consistent across runtime and manifests', () => {
  const config = read('src/Config.gs');
  const api = read('src/Api.gs');
  const index = read('src/index.html');
  const admin = read('src/admin.html');
  const qr = read('src/scripts-qr.html');
  const packageManifest = JSON.parse(read('package.json'));
  const packageLock = JSON.parse(read('package-lock.json'));
  const brandingSurface = [config, api, index, admin, qr, read('README.md'),
    read('docs/DEPLOYMENT.md')].join('\n');

  assert.match(config, /APP_NAME:\s*'CRS Yuem-Kuen System'/);
  assert.match(config, /APP_SHORT_NAME:\s*'CRS Yuem-Kuen'/);
  assert.match(api, /shortName:\s*config\.APP_SHORT_NAME/);
  assert.match(index, /data-app-short-name>CRS Yuem-Kuen</);
  assert.match(index, /data-app-name>CRS Yuem-Kuen System</);
  assert.match(admin, /CRS Yuem-Kuen System/);
  assert.match(qr, /fillText\('CRS Yuem-Kuen'/);
  assert.equal(packageManifest.name, 'crs-yuem-kuen-system');
  assert.equal(packageLock.name, 'crs-yuem-kuen-system');
  assert.doesNotMatch(brandingSurface,
    /CRS (?:Equipment Borrowing System|Equipment|Chao-Yuem|Yuam-Kuen)|Equipment Center/);
});

test('server-side OAuth/OIDC uses a protected callback and bounded opaque application session', () => {
  const index = read('src/index.html');
  const api = read('src/scripts-api.html');
  const oauth = read('src/OAuthService.gs');
  const serverIdentity = read('src/IdentityService.gs');
  const authoredRuntime = [
    ...sourceFiles('.gs').map((file) => read(`src/${file}`)),
    ...sourceFiles('.html')
      .filter((file) => !file.startsWith('vendor-'))
      .map((file) => read(`src/${file}`)),
  ].join('\n');

  assert.doesNotMatch(index, /accounts\.google\.com\/gsi\/client|data-google-oauth-client-id/i,
    'HTML Service must not depend on the GIS JavaScript origin');
  assert.doesNotMatch(read('src/Code.gs'), /googleOAuthClientId|GOOGLE_OAUTH_CLIENT_ID/,
    'the OAuth client ID must not be rendered into the HTML-service iframe');
  assert.doesNotMatch(api, /google\.accounts|identityApi|idToken/i);
  assert.match(api, /serverRpc\s*\(\s*['"]beginOAuthSignIn['"]/);
  assert.match(api, /serverRpc\s*\(\s*['"]completeOAuthSignIn['"]/);
  assert.match(api, /\[sessionToken\]\.concat\s*\(\s*args\s*\|\|\s*\[\]\s*\)/,
    'the browser API adapter must prepend an application session to every business RPC');
  assert.match(api, /AUTH_SESSION_STORAGE_KEY\s*=\s*['"]crs\.auth\.session\.v1['"]/);
  assert.match(api, /AUTH_REMEMBER_STORAGE_KEY\s*=\s*['"]crs\.auth\.remember\.v1['"]/);
  assert.match(api, /AUTH_SESSION_TOKEN_PATTERN\s*=\s*\/\^session1_/);
  assert.match(api, /global\.localStorage/);
  assert.match(api, /global\.sessionStorage/);
  assert.doesNotMatch(api, /document\.cookie/,
    'the application session must not be copied into browser cookies');
  assert.doesNotMatch(api, /(?:localStorage|sessionStorage)[\s\S]{0,160}(?:idToken|accessToken|refreshToken)/,
    'Google credentials must never be persisted in browser storage');
  assert.doesNotMatch(authoredRuntime,
    /[0-9]{6,}-[A-Za-z0-9_-]+\.apps\.googleusercontent\.com/,
    'a concrete Google OAuth client ID must never be committed to runtime source');
  assert.doesNotMatch(authoredRuntime, /getUserProperties\s*\(|UserProperties/,
    'execute-as-deployer authentication must not use shared UserProperties');

  assert.doesNotMatch(oauth, /newStateToken|withMethod|usercallback/);
  assert.match(oauth, /GOOGLE_OAUTH_REDIRECT_URI/);
  assert.match(oauth, /computeHmacSha256Signature/);
  assert.match(oauth, /OAUTH_OTP_PATTERN_\s*=\s*\/\^\\d\{6\}\$\//);
  assert.match(oauth, /OAUTH_OTP_TTL_SECONDS_\s*=\s*300/);
  assert.match(oauth, /OAUTH_OTP_MAX_ATTEMPTS_\s*=\s*5/);
  assert.match(oauth, /function hashOAuthOtp_/);
  assert.doesNotMatch(oauth, /Math\.random\s*\(/,
    'OAuth OTP and flow secrets must never use Math.random');
  assert.doesNotMatch(authoredRuntime, /confirm1_[A-Za-z0-9_-]*/,
    'legacy long confirmation codes must not remain in runtime source');
  assert.equal((index.match(/data-otp-digit/g) || []).length, 6);
  assert.match(index, /inputmode="numeric"/);
  assert.match(api, /ClipboardEvent|clipboardData/);
  assert.match(read('src/Code.gs'), /return googleOAuthCallback_\(event\)/);
  assert.match(oauth, /response_type:\s*['"]code['"]/);
  assert.match(oauth, /code_challenge_method:\s*['"]S256['"]/);
  assert.match(oauth, /scope:\s*['"]openid email['"]/);
  assert.match(oauth, /https:\/\/oauth2\.googleapis\.com\/token/);
  assert.match(oauth, /client_secret:\s*oauthConfig\.clientSecret/);
  assert.match(oauth, /code_verifier:\s*codeVerifier/);
  assert.match(oauth, /verifyGoogleIdToken_\s*\(\s*idToken\s*,\s*claim\.nonce\s*\)/);
  assert.match(oauth, /CacheService\.getScriptCache\s*\(\)/);
  assert.doesNotMatch(oauth, /Session\.(?:getTemporaryActiveUserKey|getActiveUser|getEffectiveUser)\s*\(/,
    'anonymous visitor identity and session binding must not depend on Apps Script user context');
  assert.match(oauth, /function oauthSessionProofHash_/,
    'flow and application-session ownership must use a domain-separated browser-held proof hash');
  assert.match(oauth, /flow\.pollTokenHash, pollTokenHash/,
    'polling must still require its independent browser-held proof');
  assert.match(oauth, /function requireApplicationSession_\s*\(sessionToken\)/);
  assert.doesNotMatch(oauth, /(?:access_token|id_token|refresh_token|session_token)\s*:/,
    'authorization URLs must not carry tokens');

  assert.match(serverIdentity,
    /https:\/\/www\.googleapis\.com\/oauth2\/v3\/certs/);
  assert.match(serverIdentity, /header\.alg\s*===\s*'RS256'/);
  assert.match(serverIdentity, /claims\.iss\s*===\s*'accounts\.google\.com'/);
  assert.match(serverIdentity, /claims\.aud/);
  assert.match(serverIdentity, /claims\.exp\s*>\s*nowSeconds/);
  assert.match(serverIdentity, /claims\.nonce/);
  assert.match(serverIdentity, /claims\.email_verified\s*===\s*true/);
  assert.match(serverIdentity, /normalizeDomain_\(claims\.hd\)/);
  assert.doesNotMatch(serverIdentity, /tokeninfo/i,
    'production verification must validate the signed JWT rather than call tokeninfo');
});
