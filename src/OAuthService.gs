var GOOGLE_OAUTH_AUTHORIZATION_URL_ = 'https://accounts.google.com/o/oauth2/v2/auth';
var GOOGLE_OAUTH_TOKEN_URL_ = 'https://oauth2.googleapis.com/token';
var OAUTH_CACHE_PREFIX_ = 'crs-auth:v2:';
var OAUTH_SECRET_HASH_PATTERN_ = /^[A-Za-z0-9_-]{43}$/;
var OAUTH_FLOW_ID_PATTERN_ = /^flow1_[A-Za-z0-9_-]{43}$/;
var OAUTH_CALLBACK_KEY_PATTERN_ = /^callback1_[A-Za-z0-9_-]{43}$/;
var OAUTH_POLL_TOKEN_PATTERN_ = /^poll1_[A-Za-z0-9_-]{43}$/;
var OAUTH_SESSION_TOKEN_PATTERN_ = /^session1_[A-Za-z0-9_-]{43}$/;
var OAUTH_NONCE_PATTERN_ = /^nonce1_[A-Za-z0-9_-]{43}$/;
var OAUTH_PKCE_VERIFIER_PATTERN_ = /^pkce1_[A-Za-z0-9_-]{43}$/;

/**
 * Starts an OAuth authorization attempt without exposing protected data.
 * The browser keeps the raw poll/session secrets in memory and sends only
 * their SHA-256 hashes here.
 */
function beginOAuthSignIn(input) {
  return executeSafely_(function () {
    var request = input && typeof input === 'object' && !Array.isArray(input) ? input : {};
    var pollTokenHash = requireOAuthSecretHash_(request.pollTokenHash, 'pollTokenHash');
    var sessionTokenHash = requireOAuthSecretHash_(request.sessionTokenHash, 'sessionTokenHash');
    assertApp_(!secureStringEquals_(pollTokenHash, sessionTokenHash), 'VALIDATION_FAILED',
      'ข้อมูลเริ่มต้นการลงชื่อเข้าใช้ไม่ถูกต้อง กรุณาลองใหม่อีกครั้ง', null, false);

    var oauthConfig = getGoogleOAuthServerConfig_();
    var visitorBindingHash = currentVisitorBindingHash_();
    var nowSeconds = Math.floor(Date.now() / 1000);
    var expiresAt = nowSeconds + oauthConfig.flowTtlSeconds;
    var flowId = createOAuthRandomValue_('flow1_');
    var callbackKey = createOAuthRandomValue_('callback1_');
    var nonce = createOAuthRandomValue_('nonce1_');
    var codeVerifier = createOAuthRandomValue_('pkce1_');
    var codeChallenge = sha256Base64Url_(codeVerifier);
    var stateToken = callbackKey;

    var flowCacheKey = oauthFlowCacheKey_(flowId);
    var callbackCacheKey = oauthCallbackCacheKey_(callbackKey);
    var visitorIndexKey = oauthVisitorIndexCacheKey_(visitorBindingHash);
    var flowRecord = {
      version: 1,
      status: 'PENDING',
      visitorBindingHash: visitorBindingHash,
      pollTokenHash: pollTokenHash,
      sessionTokenHash: sessionTokenHash,
      callbackCacheKey: callbackCacheKey,
      clientId: oauthConfig.clientId,
      redirectUri: oauthConfig.redirectUri,
      createdAt: nowSeconds,
      expiresAt: expiresAt
    };
    var callbackRecord = {
      version: 1,
      flowCacheKey: flowCacheKey,
      visitorBindingHash: visitorBindingHash,
      nonce: nonce,
      codeVerifier: codeVerifier,
      createdAt: nowSeconds,
      expiresAt: expiresAt
    };

    withOAuthLock_(function () {
      var cache = getOAuthScriptCache_();
      removePreviousVisitorFlow_(cache, visitorIndexKey);
      try {
        cache.put(flowCacheKey, JSON.stringify(flowRecord), oauthConfig.flowTtlSeconds);
        cache.put(callbackCacheKey, JSON.stringify(callbackRecord), oauthConfig.flowTtlSeconds);
        cache.put(visitorIndexKey, JSON.stringify({
          version: 1,
          flowCacheKey: flowCacheKey,
          callbackCacheKey: callbackCacheKey,
          expiresAt: expiresAt
        }), oauthConfig.flowTtlSeconds);
      } catch (error) {
        removeOAuthCacheKeysBestEffort_(cache, [flowCacheKey, callbackCacheKey, visitorIndexKey]);
        throw new AppError_('AUTH_SERVICE_UNAVAILABLE',
          'ไม่สามารถเริ่มการลงชื่อเข้าใช้ได้ กรุณาลองใหม่อีกครั้ง', null, true);
      }
    });

    return {
      flowId: flowId,
      authorizationUrl: buildGoogleAuthorizationUrl_(oauthConfig, stateToken, nonce, codeChallenge),
      expiresAt: expiresAt
    };
  });
}

/**
 * Polls a flow using a browser-held secret. No Google or application token is
 * returned: the browser's independently generated session candidate becomes
 * usable only after the verified callback has activated its hash.
 */
function completeOAuthSignIn(flowId, pollToken, handoffCode, sessionToken) {
  return executeSafely_(function () {
    var normalizedFlowId = requireOAuthFlowId_(flowId);
    var normalizedPollToken = requireOAuthPollToken_(pollToken);
    var visitorBindingHash = currentVisitorBindingHash_();
    var pollTokenHash = sha256Base64Url_(normalizedPollToken);

    return withOAuthLock_(function () {
      var cache = getOAuthScriptCache_();
      var flowCacheKey = oauthFlowCacheKey_(normalizedFlowId);
      var flow = readOAuthFlowRecord_(cache, flowCacheKey);
      assertLiveOAuthFlow_(flow, visitorBindingHash, pollTokenHash);

      if (flow.status === 'PENDING' || flow.status === 'PROCESSING') {
        return { status: 'PENDING', expiresAt: flow.expiresAt };
      }

      if (flow.status === 'AWAITING_CONFIRMATION') {
        // Polling never discloses the callback proof or activates a session.
        if (!handoffCode) return { status: 'AWAITING_CONFIRMATION', expiresAt: flow.expiresAt };
        assertApp_(/^confirm1_[A-Za-z0-9_-]{43}$/.test(String(handoffCode)) &&
          secureStringEquals_(flow.handoffHash, sha256Base64Url_(handoffCode)) &&
          secureStringEquals_(flow.sessionTokenHash, sha256Base64Url_(requireOAuthSessionToken_(sessionToken))),
        'UNAUTHENTICATED', 'รหัสยืนยันไม่ถูกต้อง กรุณาตรวจรหัสจากหน้าต่าง Google', null, false);
        var user = requireUserForIdentity_({ email: flow.candidate.email });
        assertApp_(getRuntimeConfig_().ALLOWED_DOMAINS.indexOf(flow.candidate.email.split('@')[1]) !== -1,
          'FORBIDDEN', 'บัญชีนี้อยู่นอกโดเมนที่องค์กรอนุญาต', null, false);
        assertApp_(user.user_id === flow.candidate.userId &&
          flow.candidate.clientId === getRuntimeConfig_().GOOGLE_OAUTH_CLIENT_ID &&
          flow.candidate.expiresAt > Math.floor(Date.now() / 1000),
        'UNAUTHENTICATED', 'คำขอลงชื่อเข้าใช้หมดอายุหรือเปลี่ยนแปลงแล้ว', null, false);
        // Consume before activation. A cache failure can require a fresh login,
        // but must not permit the callback confirmation to activate twice.
        var candidate = flow.candidate;
        flow.status = 'CONSUMED';
        delete flow.candidate;
        delete flow.handoffHash;
        putOAuthCacheJson_(cache, flowCacheKey, flow,
          Math.max(1, flow.expiresAt - Math.floor(Date.now() / 1000)));
        putOAuthCacheJson_(cache, oauthSessionCacheKeyFromHash_(flow.sessionTokenHash), candidate,
          candidate.expiresAt - Math.floor(Date.now() / 1000));
        return { status: 'COMPLETE', expiresAt: candidate.expiresAt };
      }
      assertApp_(flow.status !== 'CONSUMED', 'UNAUTHENTICATED',
        'คำขอลงชื่อเข้าใช้นี้ถูกใช้แล้ว', null, false);
      flow.status = 'CONSUMED';
      putOAuthCacheJson_(cache, flowCacheKey, flow,
        Math.max(1, flow.expiresAt - Math.floor(Date.now() / 1000)));
      var failure = flow.error && typeof flow.error === 'object' ? flow.error : {};
      throw new AppError_(
        isSafeOAuthFailureCode_(failure.code) ? failure.code : 'UNAUTHENTICATED',
        normalizeWhitespace_(failure.message) || 'ลงชื่อเข้าใช้ไม่สำเร็จ กรุณาลองใหม่อีกครั้ง',
        null,
        failure.retryable === true
      );
    });
  });
}

function logoutSession(sessionToken) {
  return executeSafely_(function () {
    var session = requireApplicationSession_(sessionToken);
    var cache = getOAuthScriptCache_();
    try { cache.remove(oauthSessionCacheKeyFromHash_(session.sessionTokenHash)); }
    catch (error) {
      throw new AppError_('AUTH_SERVICE_UNAVAILABLE',
        'ไม่สามารถออกจากระบบได้ กรุณาลองใหม่อีกครั้ง', null, true);
    }
    return { signedOut: true };
  });
}

/**
 * Private implementation reached only through doGet callback routing.
 * Opaque state is looked up and consumed server-side, not decoded by Apps Script.
 */
function googleOAuthCallback_(event) {
  var claim = null;
  var handoffCode = '';
  try {
    var callbackKey = requireOAuthCallbackKey_(singleOAuthCallbackParameter_(event, 'state'));
    var code = optionalSingleOAuthCallbackParameter_(event, 'code');
    var oauthError = optionalSingleOAuthCallbackParameter_(event, 'error');
    claim = claimOAuthFlow_(callbackKey);
    assertApp_(Boolean(code) !== Boolean(oauthError), 'UNAUTHENTICATED',
      'ผลการลงชื่อเข้าใช้ไม่ถูกต้อง กรุณาลองใหม่อีกครั้ง', null, false);
    if (oauthError) {
      throw new AppError_('AUTH_CANCELLED',
        oauthError === 'access_denied'
          ? 'ยกเลิกการลงชื่อเข้าใช้แล้ว'
          : 'Google ไม่อนุญาตให้ลงชื่อเข้าใช้ กรุณาลองใหม่อีกครั้ง',
        null,
        oauthError !== 'access_denied');
    }

    var authorizationCode = requireOAuthAuthorizationCode_(code);
    var idToken = exchangeGoogleAuthorizationCode_(authorizationCode, claim.codeVerifier, claim.redirectUri);
    var identity = verifyGoogleIdToken_(idToken, claim.nonce);
    var user = requireUserForIdentity_(identity);
    handoffCode = finalizeOAuthFlowSuccess_(claim, identity, user);
  } catch (error) {
    if (claim) finalizeOAuthFlowFailureBestEffort_(claim, error);
    console.warn(JSON.stringify({
      event: 'GOOGLE_OAUTH_CALLBACK_REJECTED',
      code: error && error.name === 'AppError' ? error.code : 'INTERNAL'
    }));
  }
  return createOAuthCallbackOutput_(handoffCode);
}

function getGoogleOAuthServerConfig_() {
  var config = getRuntimeConfig_();
  var clientId = normalizeWhitespace_(config.GOOGLE_OAUTH_CLIENT_ID);
  var clientSecret = String(config.GOOGLE_OAUTH_CLIENT_SECRET || '').trim();
  assertApp_(isGoogleOAuthClientId_(clientId), 'CONFIG_ERROR',
    'กรุณาตั้งค่า GOOGLE_OAUTH_CLIENT_ID ให้ถูกต้องก่อนเปิดใช้งานระบบ', null, false);
  assertApp_(isGoogleOAuthClientSecret_(clientSecret), 'CONFIG_ERROR',
    'กรุณาตั้งค่า GOOGLE_OAUTH_CLIENT_SECRET ให้ถูกต้องก่อนเปิดใช้งานระบบ', null, false);
  assertApp_(Array.isArray(config.ALLOWED_DOMAINS) && config.ALLOWED_DOMAINS.length > 0 &&
    config.ALLOWED_DOMAINS.every(isSafeDomainValue_), 'CONFIG_ERROR',
  'กรุณาตั้งค่า ALLOWED_DOMAINS ก่อนเปิดใช้งานระบบ', null, false);
  var redirectUri = String(config.GOOGLE_OAUTH_REDIRECT_URI || '').trim();
  assertApp_(/^https:\/\/script\.google\.com\/macros\/s\/[A-Za-z0-9_-]+\/exec$/.test(redirectUri),
    'CONFIG_ERROR', 'กรุณาตั้ง GOOGLE_OAUTH_REDIRECT_URI เป็น exact Pilot /exec URL', null, false);
  return {
    clientId: clientId,
    clientSecret: clientSecret,
    redirectUri: redirectUri,
    flowTtlSeconds: config.AUTH_FLOW_TTL_SECONDS,
    sessionTtlSeconds: config.AUTH_SESSION_TTL_SECONDS
  };
}

function isGoogleOAuthClientSecret_(value) {
  var secret = String(value || '');
  return secret.length >= 16 && secret.length <= 512 && !/[\x00-\x20\x7f]/.test(secret);
}

function buildGoogleAuthorizationUrl_(oauthConfig, stateToken, nonce, codeChallenge) {
  return GOOGLE_OAUTH_AUTHORIZATION_URL_ + '?' + formUrlEncode_({
    access_type: 'online',
    client_id: oauthConfig.clientId,
    code_challenge: codeChallenge,
    code_challenge_method: 'S256',
    include_granted_scopes: 'false',
    nonce: nonce,
    prompt: 'select_account',
    redirect_uri: oauthConfig.redirectUri,
    response_type: 'code',
    scope: 'openid email',
    state: stateToken
  });
}

function exchangeGoogleAuthorizationCode_(authorizationCode, codeVerifier, redirectUri) {
  var oauthConfig = getGoogleOAuthServerConfig_();
  var response;
  try {
    response = UrlFetchApp.fetch(GOOGLE_OAUTH_TOKEN_URL_, {
      method: 'post',
      contentType: 'application/x-www-form-urlencoded',
      payload: formUrlEncode_({
        client_id: oauthConfig.clientId,
        client_secret: oauthConfig.clientSecret,
        code: authorizationCode,
        code_verifier: codeVerifier,
        grant_type: 'authorization_code',
        redirect_uri: redirectUri
      }),
      followRedirects: false,
      muteHttpExceptions: true,
      headers: { Accept: 'application/json' }
    });
  } catch (error) {
    throw new AppError_('AUTH_SERVICE_UNAVAILABLE',
      'ไม่สามารถตรวจสอบการลงชื่อเข้าใช้กับ Google ได้ กรุณาลองใหม่อีกครั้ง', null, true);
  }
  assertApp_(response && response.getResponseCode() === 200, 'UNAUTHENTICATED',
    'Google ปฏิเสธการลงชื่อเข้าใช้ กรุณาลองใหม่อีกครั้ง', null, false);
  var responseText = String(response.getContentText() || '');
  assertApp_(responseText.length > 0 && responseText.length <= 32768, 'UNAUTHENTICATED',
    'ผลการลงชื่อเข้าใช้จาก Google ไม่ถูกต้อง', null, false);
  var tokens;
  try { tokens = JSON.parse(responseText); }
  catch (error) {
    throw new AppError_('UNAUTHENTICATED',
      'ผลการลงชื่อเข้าใช้จาก Google ไม่ถูกต้อง', null, false);
  }
  assertApp_(tokens && typeof tokens === 'object' && !Array.isArray(tokens) &&
    typeof tokens.id_token === 'string' && tokens.id_token.length > 0 &&
    tokens.id_token.length <= 8192, 'UNAUTHENTICATED',
  'ผลการลงชื่อเข้าใช้จาก Google ไม่ถูกต้อง', null, false);
  if (tokens.token_type !== undefined) {
    assertApp_(String(tokens.token_type).toLowerCase() === 'bearer', 'UNAUTHENTICATED',
      'ผลการลงชื่อเข้าใช้จาก Google ไม่ถูกต้อง', null, false);
  }
  if (tokens.scope !== undefined) {
    var scopes = String(tokens.scope).split(/\s+/).filter(Boolean);
    assertApp_(scopes.indexOf('openid') !== -1 && (scopes.indexOf('email') !== -1 ||
      scopes.indexOf('https://www.googleapis.com/auth/userinfo.email') !== -1),
      'UNAUTHENTICATED', 'Google ไม่ได้อนุญาตข้อมูลบัญชีที่ระบบต้องใช้', null, false);
  }
  return tokens.id_token;
}

function claimOAuthFlow_(callbackKey) {
  return withOAuthLock_(function () {
    var cache = getOAuthScriptCache_();
    var callbackCacheKey = oauthCallbackCacheKey_(callbackKey);
    var callbackRecord = readOAuthCallbackRecord_(cache, callbackCacheKey);
    var nowSeconds = Math.floor(Date.now() / 1000);
    assertApp_(callbackRecord && callbackRecord.expiresAt > nowSeconds,
      'UNAUTHENTICATED', 'คำขอลงชื่อเข้าใช้หมดอายุหรือถูกใช้แล้ว กรุณาลองใหม่อีกครั้ง', null, false);
    var flow = readOAuthFlowRecord_(cache, callbackRecord.flowCacheKey);
    assertApp_(flow && flow.status === 'PENDING' && flow.expiresAt > nowSeconds && flow.redirectUri === getGoogleOAuthServerConfig_().redirectUri,
    'UNAUTHENTICATED', 'คำขอลงชื่อเข้าใช้หมดอายุหรือถูกใช้แล้ว กรุณาลองใหม่อีกครั้ง', null, false);
    var claimId = createOAuthRandomValue_('claim1_');
    flow.status = 'PROCESSING';
    flow.claimId = claimId;
    putOAuthCacheJson_(cache, callbackRecord.flowCacheKey, flow,
      Math.max(1, flow.expiresAt - nowSeconds));
    try { cache.remove(callbackCacheKey); }
    catch (error) { /* PROCESSING status still prevents callback replay. */ }
    return {
      flowCacheKey: callbackRecord.flowCacheKey,
      claimId: claimId,
      visitorBindingHash: flow.visitorBindingHash,
      nonce: callbackRecord.nonce,
      codeVerifier: callbackRecord.codeVerifier,
      redirectUri: flow.redirectUri,
      expiresAt: flow.expiresAt
    };
  });
}

function finalizeOAuthFlowSuccess_(claim, identity, user) {
  var oauthConfig = getGoogleOAuthServerConfig_();
  var nowSeconds = Math.floor(Date.now() / 1000);
  var sessionExpiresAt = Math.min(
    Number(identity.expiresAt),
    nowSeconds + oauthConfig.sessionTtlSeconds
  );
  assertApp_(Number.isInteger(sessionExpiresAt) && sessionExpiresAt > nowSeconds,
    'UNAUTHENTICATED', 'หลักฐานการลงชื่อเข้าใช้หมดอายุแล้ว กรุณาลองใหม่อีกครั้ง', null, false);

  return withOAuthLock_(function () {
    var cache = getOAuthScriptCache_();
    var flow = readOAuthFlowRecord_(cache, claim.flowCacheKey);
    assertClaimedOAuthFlow_(flow, claim);
    assertApp_(secureStringEquals_(flow.clientId, oauthConfig.clientId), 'UNAUTHENTICATED',
      'การตั้งค่า OAuth เปลี่ยนแปลงแล้ว กรุณาเริ่มลงชื่อเข้าใช้ใหม่', null, false);
    var sessionRecord = {
      version: 1,
      subject: identity.subject,
      email: normalizeEmail_(identity.email),
      userId: user.user_id,
      clientId: oauthConfig.clientId,
      visitorBindingHash: claim.visitorBindingHash,
      sessionTokenHash: flow.sessionTokenHash,
      issuedAt: nowSeconds,
      expiresAt: sessionExpiresAt
    };
    var handoffCode = createOAuthRandomValue_('confirm1_');
    flow.status = 'AWAITING_CONFIRMATION';
    flow.candidate = sessionRecord;
    flow.handoffHash = sha256Base64Url_(handoffCode);
    flow.sessionExpiresAt = sessionExpiresAt;
    delete flow.claimId;
    putOAuthCacheJson_(cache, claim.flowCacheKey, flow,
      Math.max(1, flow.expiresAt - nowSeconds));
    return handoffCode;
  });
}

function finalizeOAuthFlowFailureBestEffort_(claim, error) {
  try {
    withOAuthLock_(function () {
      var cache = getOAuthScriptCache_();
      var flow = readOAuthFlowRecord_(cache, claim.flowCacheKey);
      if (!flow || flow.status !== 'PROCESSING' ||
        !secureStringEquals_(flow.claimId, claim.claimId)) return;
      var failure = publicOAuthFailure_(error);
      flow.status = 'DENIED';
      flow.error = failure;
      delete flow.claimId;
      var nowSeconds = Math.floor(Date.now() / 1000);
      putOAuthCacheJson_(cache, claim.flowCacheKey, flow,
        Math.max(1, flow.expiresAt - nowSeconds));
    });
  } catch (ignored) {
    // The callback page remains generic; a cache failure simply expires closed.
  }
}

function requireApplicationSession_(sessionToken) {
  var normalizedToken = requireOAuthSessionToken_(sessionToken);
  var sessionTokenHash = sha256Base64Url_(normalizedToken);
  var cache = getOAuthScriptCache_();
  var session = readOAuthSessionRecord_(cache, oauthSessionCacheKeyFromHash_(sessionTokenHash));
  var nowSeconds = Math.floor(Date.now() / 1000);
  assertApp_(session && session.expiresAt > nowSeconds &&
    secureStringEquals_(session.sessionTokenHash, sessionTokenHash),
  'UNAUTHENTICATED', 'session หมดอายุหรือไม่ถูกต้อง กรุณาลงชื่อเข้าใช้อีกครั้ง', null, false);
  var visitorBindingHash = currentVisitorBindingHash_();
  assertApp_(secureStringEquals_(session.visitorBindingHash, visitorBindingHash),
    'UNAUTHENTICATED', 'session นี้ไม่ใช่ของบริบทผู้ใช้ปัจจุบัน กรุณาลงชื่อเข้าใช้อีกครั้ง', null, false);

  var config = getRuntimeConfig_();
  var clientId = normalizeWhitespace_(config.GOOGLE_OAUTH_CLIENT_ID);
  assertApp_(isGoogleOAuthClientId_(clientId) &&
    secureStringEquals_(session.clientId, clientId), 'UNAUTHENTICATED',
  'การตั้งค่าการลงชื่อเข้าใช้เปลี่ยนแปลงแล้ว กรุณาลงชื่อเข้าใช้อีกครั้ง', null, false);
  assertApp_(typeof session.subject === 'string' && session.subject.length > 0 &&
    session.subject.length <= 255 && isSafeEmailValue_(session.email) &&
    /^USR-\d{6}$/.test(session.userId), 'UNAUTHENTICATED',
  'ข้อมูล session ไม่ถูกต้อง กรุณาลงชื่อเข้าใช้อีกครั้ง', null, false);
  var domain = normalizeEmail_(session.email).split('@')[1] || '';
  assertApp_(Array.isArray(config.ALLOWED_DOMAINS) &&
    config.ALLOWED_DOMAINS.indexOf(domain) !== -1, 'FORBIDDEN',
  'บัญชีนี้อยู่นอกโดเมนที่องค์กรอนุญาต', null, false);
  return session;
}

function currentVisitorBindingHash_() {
  var temporaryKey = '';
  try { temporaryKey = String(Session.getTemporaryActiveUserKey() || ''); }
  catch (error) { temporaryKey = ''; }
  assertApp_(temporaryKey.length > 0 && temporaryKey.length <= 512 &&
    !/[\x00-\x1f\x7f]/.test(temporaryKey), 'UNAUTHENTICATED',
  'ไม่สามารถผูก session กับผู้ใช้ Google ปัจจุบันได้ กรุณาเปิด Web app ใหม่', null, false);
  return sha256Base64Url_(temporaryKey);
}

function assertLiveOAuthFlow_(flow, visitorBindingHash, pollTokenHash) {
  var nowSeconds = Math.floor(Date.now() / 1000);
  assertApp_(flow && flow.expiresAt > nowSeconds, 'UNAUTHENTICATED',
    'คำขอลงชื่อเข้าใช้หมดอายุแล้ว กรุณาเริ่มใหม่', null, false);
  assertApp_(secureStringEquals_(flow.visitorBindingHash, visitorBindingHash) &&
    secureStringEquals_(flow.pollTokenHash, pollTokenHash), 'UNAUTHENTICATED',
  'ไม่สามารถยืนยันคำขอลงชื่อเข้าใช้นี้ได้', null, false);
  assertApp_(['PENDING', 'PROCESSING', 'AWAITING_CONFIRMATION', 'DENIED', 'CONSUMED'].indexOf(flow.status) !== -1,
    'UNAUTHENTICATED', 'สถานะคำขอลงชื่อเข้าใช้ไม่ถูกต้อง', null, false);
}

function assertClaimedOAuthFlow_(flow, claim) {
  var nowSeconds = Math.floor(Date.now() / 1000);
  assertApp_(flow && flow.status === 'PROCESSING' && flow.expiresAt > nowSeconds &&
    secureStringEquals_(flow.claimId, claim.claimId) &&
    secureStringEquals_(flow.visitorBindingHash, claim.visitorBindingHash),
  'UNAUTHENTICATED', 'คำขอลงชื่อเข้าใช้หมดอายุหรือถูกใช้แล้ว กรุณาลองใหม่อีกครั้ง', null, false);
}

function readOAuthFlowRecord_(cache, key) {
  var record = readOAuthCacheJson_(cache, key);
  if (!record || record.version !== 1 ||
    ['PENDING', 'PROCESSING', 'AWAITING_CONFIRMATION', 'DENIED', 'CONSUMED'].indexOf(record.status) === -1 ||
    !OAUTH_SECRET_HASH_PATTERN_.test(String(record.visitorBindingHash || '')) ||
    !OAUTH_SECRET_HASH_PATTERN_.test(String(record.pollTokenHash || '')) ||
    !OAUTH_SECRET_HASH_PATTERN_.test(String(record.sessionTokenHash || '')) ||
    typeof record.callbackCacheKey !== 'string' ||
    record.callbackCacheKey.indexOf(OAUTH_CACHE_PREFIX_ + 'callback:') !== 0 ||
    !isGoogleOAuthClientId_(record.clientId) ||
    !Number.isInteger(record.createdAt) || !Number.isInteger(record.expiresAt) ||
    record.expiresAt <= record.createdAt) return null;
  if (record.status === 'PROCESSING' &&
    !/^claim1_[A-Za-z0-9_-]{43}$/.test(String(record.claimId || ''))) return null;
  if (record.status === 'AWAITING_CONFIRMATION' &&
    (!Number.isInteger(record.sessionExpiresAt) || record.sessionExpiresAt <= record.createdAt)) return null;
  if (record.status === 'DENIED' &&
    (!record.error || typeof record.error !== 'object' || Array.isArray(record.error))) return null;
  return record;
}

function readOAuthCallbackRecord_(cache, key) {
  var record = readOAuthCacheJson_(cache, key);
  if (!record || record.version !== 1 ||
    typeof record.flowCacheKey !== 'string' ||
    record.flowCacheKey.indexOf(OAUTH_CACHE_PREFIX_ + 'flow:') !== 0 ||
    !OAUTH_SECRET_HASH_PATTERN_.test(String(record.visitorBindingHash || '')) ||
    !OAUTH_NONCE_PATTERN_.test(String(record.nonce || '')) ||
    !OAUTH_PKCE_VERIFIER_PATTERN_.test(String(record.codeVerifier || '')) ||
    !Number.isInteger(record.createdAt) || !Number.isInteger(record.expiresAt) ||
    record.expiresAt <= record.createdAt) return null;
  return record;
}

function readOAuthSessionRecord_(cache, key) {
  var record = readOAuthCacheJson_(cache, key);
  if (!record || record.version !== 1 ||
    !OAUTH_SECRET_HASH_PATTERN_.test(String(record.visitorBindingHash || '')) ||
    !OAUTH_SECRET_HASH_PATTERN_.test(String(record.sessionTokenHash || '')) ||
    !Number.isInteger(record.issuedAt) || !Number.isInteger(record.expiresAt) ||
    record.expiresAt <= record.issuedAt) return null;
  return record;
}

function readOAuthCacheJson_(cache, key) {
  var serialized;
  try { serialized = cache.get(key); }
  catch (error) {
    throw new AppError_('AUTH_SERVICE_UNAVAILABLE',
      'ไม่สามารถตรวจสอบ session ได้ กรุณาลองใหม่อีกครั้ง', null, true);
  }
  if (!serialized) return null;
  try {
    var parsed = JSON.parse(serialized);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : null;
  } catch (error) {
    try { cache.remove(key); }
    catch (ignored) { /* Invalid cache data remains unusable. */ }
    return null;
  }
}

function putOAuthCacheJson_(cache, key, value, ttlSeconds) {
  try { cache.put(key, JSON.stringify(value), ttlSeconds); }
  catch (error) {
    throw new AppError_('AUTH_SERVICE_UNAVAILABLE',
      'ไม่สามารถบันทึกสถานะการลงชื่อเข้าใช้ได้ กรุณาลองใหม่อีกครั้ง', null, true);
  }
}

function getOAuthScriptCache_() {
  try { return CacheService.getScriptCache(); }
  catch (error) {
    throw new AppError_('AUTH_SERVICE_UNAVAILABLE',
      'ระบบ session ไม่พร้อมใช้งาน กรุณาลองใหม่อีกครั้ง', null, true);
  }
}

function withOAuthLock_(callback) {
  var lock;
  try { lock = LockService.getScriptLock(); }
  catch (error) { lock = null; }
  assertApp_(lock && lock.tryLock(getRuntimeConfig_().LOCK_TIMEOUT_MS), 'LOCK_TIMEOUT',
    'ระบบกำลังประมวลผลการลงชื่อเข้าใช้อื่น กรุณาลองใหม่อีกครั้ง', null, true);
  try { return callback(); }
  finally { lock.releaseLock(); }
}

function removePreviousVisitorFlow_(cache, visitorIndexKey) {
  var previous = readOAuthCacheJson_(cache, visitorIndexKey);
  if (!previous) return;
  removeOAuthCacheKeysBestEffort_(cache, [
    previous.flowCacheKey,
    previous.callbackCacheKey,
    visitorIndexKey
  ]);
}

function removeOAuthCacheKeysBestEffort_(cache, keys) {
  var safeKeys = (keys || []).filter(function (key) {
    return typeof key === 'string' && key.indexOf(OAUTH_CACHE_PREFIX_) === 0;
  });
  try { cache.removeAll(safeKeys); }
  catch (error) {
    safeKeys.forEach(function (key) {
      try { cache.remove(key); }
      catch (ignored) { /* Entries expire closed. */ }
    });
  }
}

function publicOAuthFailure_(error) {
  if (error && error.name === 'AppError' && isSafeOAuthFailureCode_(error.code)) {
    return {
      code: error.code,
      message: error.message,
      retryable: error.retryable === true
    };
  }
  return {
    code: 'INTERNAL',
    message: 'ลงชื่อเข้าใช้ไม่สำเร็จ กรุณาลองใหม่อีกครั้ง',
    retryable: true
  };
}

function isSafeOAuthFailureCode_(code) {
  return [
    'AUTH_CANCELLED',
    'AUTH_SERVICE_UNAVAILABLE',
    'CONFIG_ERROR',
    'FORBIDDEN',
    'INTERNAL',
    'LOCK_TIMEOUT',
    'UNAUTHENTICATED',
    'USER_DISABLED'
  ].indexOf(String(code || '')) !== -1;
}

function singleOAuthCallbackParameter_(event, name) {
  var value = optionalSingleOAuthCallbackParameter_(event, name);
  assertApp_(value, 'UNAUTHENTICATED',
    'ข้อมูล callback การลงชื่อเข้าใช้ไม่ครบถ้วน', null, false);
  return value;
}

function optionalSingleOAuthCallbackParameter_(event, name) {
  var request = event && typeof event === 'object' ? event : {};
  var parameters = request.parameters && typeof request.parameters === 'object'
    ? request.parameters
    : {};
  if (hasOwn_(parameters, name)) {
    var values = parameters[name];
    values = Array.isArray(values) ? values : [values];
    assertApp_(values.length === 1, 'UNAUTHENTICATED',
      'พบ callback parameter ซ้ำ กรุณาเริ่มลงชื่อเข้าใช้ใหม่', null, false);
  }
  var value = request.parameter && hasOwn_(request.parameter, name)
    ? String(request.parameter[name] || '').trim()
    : '';
  assertApp_(value.length <= 8192, 'UNAUTHENTICATED',
    'callback parameter ยาวเกินกำหนด', null, false);
  return value;
}

function requireOAuthAuthorizationCode_(value) {
  var code = String(value || '').trim();
  assertApp_(code.length >= 8 && code.length <= 4096 && !/[\x00-\x20\x7f]/.test(code),
    'UNAUTHENTICATED', 'Authorization code จาก Google ไม่ถูกต้อง', null, false);
  return code;
}

function requireOAuthSecretHash_(value, fieldName) {
  var hash = String(value || '').trim();
  assertApp_(OAUTH_SECRET_HASH_PATTERN_.test(hash), 'VALIDATION_FAILED',
    'ข้อมูลเริ่มต้นการลงชื่อเข้าใช้ไม่ถูกต้อง', {
      fieldErrors: fieldError_(fieldName, 'ค่าป้องกันการลงชื่อเข้าใช้ไม่ถูกต้อง')
    }, false);
  return hash;
}

function requireOAuthFlowId_(value) {
  var flowId = String(value || '').trim();
  assertApp_(OAUTH_FLOW_ID_PATTERN_.test(flowId), 'UNAUTHENTICATED',
    'คำขอลงชื่อเข้าใช้ไม่ถูกต้อง', null, false);
  return flowId;
}

function requireOAuthCallbackKey_(value) {
  var callbackKey = String(value || '').trim();
  assertApp_(OAUTH_CALLBACK_KEY_PATTERN_.test(callbackKey), 'UNAUTHENTICATED',
    'ข้อมูล state ของการลงชื่อเข้าใช้ไม่ถูกต้อง', null, false);
  return callbackKey;
}

function requireOAuthPollToken_(value) {
  var token = String(value || '').trim();
  assertApp_(OAUTH_POLL_TOKEN_PATTERN_.test(token), 'UNAUTHENTICATED',
    'ค่าป้องกันการตรวจสอบผลลงชื่อเข้าใช้ไม่ถูกต้อง', null, false);
  return token;
}

function requireOAuthSessionToken_(value) {
  var token = String(value || '').trim();
  assertApp_(OAUTH_SESSION_TOKEN_PATTERN_.test(token), 'UNAUTHENTICATED',
    'กรุณาลงชื่อเข้าใช้ด้วยบัญชี Google ที่ได้รับอนุญาต', null, false);
  return token;
}

function requireOAuthNonce_(value) {
  var nonce = String(value || '').trim();
  assertApp_(OAUTH_NONCE_PATTERN_.test(nonce), 'UNAUTHENTICATED',
    'OIDC nonce ไม่ถูกต้อง', null, false);
  return nonce;
}

function requireOAuthPkceVerifier_(value) {
  var verifier = String(value || '').trim();
  assertApp_(OAUTH_PKCE_VERIFIER_PATTERN_.test(verifier) &&
    verifier.length >= 43 && verifier.length <= 128, 'UNAUTHENTICATED',
  'PKCE verifier ไม่ถูกต้อง', null, false);
  return verifier;
}

function oauthFlowCacheKey_(flowId) {
  return OAUTH_CACHE_PREFIX_ + 'flow:' + sha256Base64Url_(flowId);
}

function oauthCallbackCacheKey_(callbackKey) {
  return OAUTH_CACHE_PREFIX_ + 'callback:' + sha256Base64Url_(callbackKey);
}

function oauthSessionCacheKeyFromHash_(sessionTokenHash) {
  return OAUTH_CACHE_PREFIX_ + 'session:' + sessionTokenHash;
}

function oauthVisitorIndexCacheKey_(visitorBindingHash) {
  return OAUTH_CACHE_PREFIX_ + 'visitor:' + visitorBindingHash;
}

function createOAuthRandomValue_(prefix) {
  var material = [
    Utilities.getUuid(),
    Utilities.getUuid(),
    Utilities.getUuid(),
    Utilities.getUuid(),
    String(Date.now())
  ].join('|');
  // Keyed PRF: UUID/time supply uniqueness, the server-only OAuth client
  // secret supplies unpredictability (do not rely on UUID as a CSPRNG).
  var digest = Utilities.computeHmacSha256Signature(
    'crs-oauth-v2|' + prefix + '|' + material,
    getGoogleOAuthServerConfig_().clientSecret,
    Utilities.Charset.UTF_8);
  return prefix + Utilities.base64EncodeWebSafe(digest).replace(/=+$/, '');
}

function sha256Base64Url_(value) {
  var digest = Utilities.computeDigest(
    Utilities.DigestAlgorithm.SHA_256,
    String(value),
    Utilities.Charset.UTF_8
  );
  return Utilities.base64EncodeWebSafe(digest).replace(/=+$/, '');
}

function secureStringEquals_(left, right) {
  var leftText = String(left === undefined || left === null ? '' : left);
  var rightText = String(right === undefined || right === null ? '' : right);
  var difference = leftText.length ^ rightText.length;
  var length = Math.max(leftText.length, rightText.length);
  for (var index = 0; index < length; index += 1) {
    difference |= (leftText.charCodeAt(index % Math.max(leftText.length, 1)) || 0) ^
      (rightText.charCodeAt(index % Math.max(rightText.length, 1)) || 0);
  }
  return difference === 0;
}

function formUrlEncode_(values) {
  return Object.keys(values || {}).sort().map(function (key) {
    return encodeURIComponent(key) + '=' + encodeURIComponent(String(values[key]));
  }).join('&');
}

function createOAuthCallbackOutput_(handoffCode) {
  var valid = /^confirm1_[A-Za-z0-9_-]{43}$/.test(String(handoffCode || ''));
  var title = valid ? 'ยืนยันการลงชื่อเข้าใช้' : 'ลงชื่อเข้าใช้ไม่สำเร็จ';
  var message = valid
    ? 'คัดลอกรหัสด้านล่างกลับไปวางในแท็บ CRS ที่คุณเริ่มลงชื่อเข้าใช้ด้วยตนเองเท่านั้น ห้ามส่งรหัสให้ผู้อื่น หากมีคนส่งลิงก์ให้คุณลงชื่อเข้าใช้ ให้ปิดหน้านี้'
    : 'คำขอไม่ถูกต้อง หมดอายุ หรือถูกใช้แล้ว กรุณากลับไปเริ่มลงชื่อเข้าใช้ใหม่';
  var html = '<!doctype html><html lang="th"><head><meta charset="utf-8">' +
    '<meta name="viewport" content="width=device-width,initial-scale=1">' +
    '<meta name="referrer" content="no-referrer"><meta name="robots" content="noindex,nofollow">' +
    '<title>' + title + '</title></head><body><main><h1>' + title +
    '</h1><p>' + message + '</p>' +
    (valid ? '<label>รหัสยืนยัน <input id="oauth-handoff-code" readonly size="56" value="' +
      handoffCode + '"></label><p>รหัสใช้ได้ครั้งเดียวและหมดอายุอัตโนมัติ</p>' : '') +
    '</main></body></html>';
  return HtmlService.createHtmlOutput(html).setTitle(title);
}
