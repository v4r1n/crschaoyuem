'use strict';
const assert = require('node:assert/strict');
const test = require('node:test');
const { createAppsScriptHarness, GOOGLE_JWKS_URL, GOOGLE_OAUTH_TOKEN_URL, PUBLIC_RPC_NAMES, sha256Base64Url } = require('./apps-script-harness.cjs');
const { bootstrappedHarness, createUser, expectOk, expectError } = require('./test-helpers.cjs');
function harness(options = {}) {
  return bootstrappedHarness({ activeEmail: 'admin@yru.ac.th', ...options,
    properties: { ADMIN_EMAILS: 'admin@yru.ac.th', ALLOWED_DOMAINS: 'yru.ac.th,gmail.com',
      ALLOWED_DOMAIN: 'yru.ac.th', ...(options.properties || {}) } });
}
function login(h, email, options = {}) {
  const start = h.startOAuth();
  expectOk(start.response);
  return { start, ...h.finishOAuth(start, { email, ...options }) };
}
test('domain list takes precedence and legacy fallback remains single-domain', () => {
  const h = createAppsScriptHarness({ properties: { ALLOWED_DOMAINS: ' YRU.AC.TH,gmail.com,yru.ac.th ', ALLOWED_DOMAIN: 'legacy.example' } });
  assert.deepEqual(Array.from(h.invokeRaw('getRuntimeConfig_').ALLOWED_DOMAINS), ['yru.ac.th', 'gmail.com']);
  h.properties.deleteProperty('ALLOWED_DOMAINS');
  assert.deepEqual(Array.from(h.invokeRaw('getRuntimeConfig_').ALLOWED_DOMAINS), ['legacy.example']);
  h.properties.setProperty('ALLOWED_DOMAINS', '*.example.com');
  expectError(h.startOAuth().response, 'CONFIG_ERROR');
});
test('YRU and Gmail authenticate through code exchange to their own Users row', () => {
  const h = harness();
  for (const email of ['lecturer@yru.ac.th', 'borrower@gmail.com']) {
    createUser(h, { suffix: email.split('@')[0], email });
  }
  const sessions = [];
  for (const email of ['lecturer@yru.ac.th', 'borrower@gmail.com']) {
    const result = h.signInAs(email);
    expectOk(result.finish.pollResponse);
    sessions.push(h.state.sessionToken);
    const bootstrap = expectOk(h.invoke('getAppBootstrap'));
    assert.equal(bootstrap.session.email, email);
    assert.equal(bootstrap.session.role, 'USER');
    assert.equal(bootstrap.app.name, 'CRS Yuem-Kuen System');
    assert.equal(bootstrap.app.shortName, 'CRS Yuem-Kuen');
  }
  assert.notEqual(sessions[0], sessions[1]);
  expectError(h.invokeWithToken('getAppBootstrap', sessions[0]), 'UNAUTHENTICATED');
});
test('authorization URL and token POST use exact redirect, state, nonce and PKCE without leaking credentials', () => {
  const h = harness();
  const start = h.startOAuth();
  const p = start.authorizationUrl.searchParams;
  assert.equal(p.get('response_type'), 'code');
  assert.equal(p.get('scope'), 'openid email');
  assert.equal(p.get('code_challenge_method'), 'S256');
  assert.equal(p.get('code_challenge'), sha256Base64Url(start.stateRecord.arguments.oauthCodeVerifier));
  assert.equal(h.state.stateTokens.size, 0);
  assert.match(start.stateToken, /^callback1_[A-Za-z0-9_-]{43}$/);
  assert.match(p.get('redirect_uri'), /^https:\/\/script\.google\.com\/macros\/s\/[^/]+\/exec$/);
  for (const name of ['access_token', 'id_token', 'client_secret', 'session_token']) assert.equal(p.has(name), false);
  expectError(h.invokeWithToken('getDashboard', start.sessionToken), 'UNAUTHENTICATED');
  const result = h.finishOAuth(start);
  expectOk(result.pollResponse);
  const fetch = h.state.fetches.filter(x => x.url === GOOGLE_OAUTH_TOKEN_URL).at(-1);
  const body = new URLSearchParams(fetch.options.payload);
  assert.equal(fetch.options.method, 'post');
  assert.equal(fetch.options.followRedirects, false);
  assert.equal(body.get('redirect_uri'), p.get('redirect_uri'));
  assert.equal(body.get('code_verifier'), start.stateRecord.arguments.oauthCodeVerifier);
  assert.equal(body.get('grant_type'), 'authorization_code');
  const stored = JSON.stringify(Array.from(h.cache.values.entries()));
  for (const secret of [start.pollToken, start.sessionToken, h.state.idToken, h.properties.getProperty('GOOGLE_OAUTH_CLIENT_SECRET')]) {
    assert.equal(stored.includes(secret), false);
    assert.equal(result.callbackOutput.getContent().includes(secret), false);
  }
});
test('OAuth callback issues a six-digit OTP while cache retains only a flow-bound hash', () => {
  const h = harness(), start = h.startOAuth();
  const result = h.finishOAuth(start, { skipPoll: true });
  assert.match(result.handoffCode, /^\d{6}$/);
  assert.match(result.callbackOutput.getContent(), /id="oauth-handoff-copy"/);
  const flow = JSON.parse(h.cache.get(h.context.oauthFlowCacheKey_(start.flowId)));
  assert.equal(JSON.stringify(flow).includes(result.handoffCode), false);
  assert.match(flow.otpHash, /^[A-Za-z0-9_-]{43}$/);
  assert.equal(flow.handoffHash, undefined);
});
test('OAuth callback centers its confirmation UI and closes itself after copying the OTP', () => {
  const h = harness(), start = h.startOAuth();
  const html = h.finishOAuth(start, { skipPoll: true }).callbackOutput.getContent();
  assert.match(html, /body\{[^}]*display:grid[^}]*min-height:100vh[^}]*place-items:center/);
  assert.match(html, /main\{[^}]*text-align:center/);
  assert.match(html, /setTimeout\(function\(\)\{window\.close\(\);\},750\)/);
  assert.match(html, /คัดลอกรหัสแล้ว หน้าต่างนี้จะปิดอัตโนมัติ/);
});
test('invalid token signatures, issuer, audience, expiry and nonce fail during callback', () => {
  const invalid = [
    { claims: { iss: 'https://attacker.example' } },
    { claims: { aud: 'attacker-client' } },
    { claims: { azp: 'attacker-client' } },
    { claims: { exp: 1, iat: 0 } },
    { claims: { email_verified: false } },
    { claims: { nonce: 'wrong' } },
    { claims: { nonce: undefined } },
    { claims: { hd: 'wrong.example' } },
    { idToken: 'invalid.jwt.signature' },
    { tokenOptions: { header: { alg: 'none' } } },
    { tokenOptions: { header: { kid: 'unknown-key' } } }
  ];
  for (const options of invalid) {
    const h = harness();
    const result = login(h, 'admin@yru.ac.th', options);
    expectError(result.pollResponse, 'UNAUTHENTICATED');
    expectError(h.invokeWithToken('getDashboard', result.start.sessionToken), 'UNAUTHENTICATED');
  }
});
test('outside domain, missing Users row, inactive and unsupported role fail closed', () => {
  const h = harness();
  createUser(h, { suffix: 'inactive', email: 'inactive@gmail.com', status: 'INACTIVE' });
  for (const [email, code] of [['outside@other.example', 'FORBIDDEN'], ['missing@gmail.com', 'FORBIDDEN'], ['inactive@gmail.com', 'USER_DISABLED']]) {
    expectError(login(h, email).pollResponse, code);
  }
  h.replaceCell('Users', 'user_id', 'USR-000001', 'role', 'OWNER');
  expectError(login(h, 'admin@yru.ac.th').pollResponse, 'FORBIDDEN');
});
test('missing session fails on every business RPC and a Google JWT is not an app session', () => {
  const h = harness();
  for (const name of PUBLIC_RPC_NAMES) expectError(h.invokeWithToken(name, ''), 'UNAUTHENTICATED');
  expectError(h.invokeWithToken('getDashboard', h.state.idToken), 'UNAUTHENTICATED');
});
test('callback and poll are one-time and incorrect poll proof cannot redeem a flow', () => {
  const h = harness();
  const start = h.startOAuth();
  expectError(h.invokeRaw('completeOAuthSignIn', start.flowId, 'poll1_' + 'a'.repeat(43)), 'UNAUTHENTICATED');
  const result = h.finishOAuth(start);
  expectOk(result.pollResponse);
  expectError(h.invokeRaw('completeOAuthSignIn', start.flowId, start.pollToken), 'UNAUTHENTICATED');
  const count = h.state.fetches.length;
  assert.match(h.invokeRaw('googleOAuthCallback_', result.event).getContent(), /ไม่สำเร็จ/);
  assert.equal(h.state.fetches.length, count);
});
test('forged, invalid, duplicate and expired state callbacks never activate sessions', () => {
  for (const overrides of [
    {parameter:{state:'tampered'}}, {parameter:{state:'callback1_'+'a'.repeat(43)}},
    {parameters:{state:['one','two']}}, {parameters:{code:['one','two']}},
    {parameter:{error:'access_denied'}}
  ]) {
    const h=harness(), start=h.startOAuth();
    const result=h.finishOAuth(start,{eventOverrides:overrides,skipPoll:true});
    assert.match(result.callbackOutput.getContent(),/ไม่สำเร็จ/);
    expectError(h.invokeWithToken('getDashboard',start.sessionToken),'UNAUTHENTICATED');
  }
  const h=harness(), start=h.startOAuth(); h.advanceTime(601);
  assert.match(h.finishOAuth(start,{skipPoll:true}).callbackOutput.getContent(),/ไม่สำเร็จ/);
  expectError(h.invokeRaw('completeOAuthSignIn',start.flowId,start.pollToken),'UNAUTHENTICATED');
});
test('attacker-started/victim-redeemed flow does not yield a session through polling', () => {
  const h=harness(); h.setVisitorKey('attacker');
  const start=h.startOAuth();
  // Callback uses a DIFFERENT visitor context and may verify a victim identity.
  const result=h.finishOAuth(start,{visitorKey:'victim',skipPoll:true});
  assert.ok(result.handoffCode);
  h.setVisitorKey('attacker');
  const poll=expectOk(h.invokeRaw('completeOAuthSignIn',start.flowId,start.pollToken));
  assert.equal(poll.status,'AWAITING_CONFIRMATION');
  assert.equal(JSON.stringify(poll).includes(result.handoffCode),false);
  expectError(h.invokeWithToken('getDashboard',start.sessionToken),'UNAUTHENTICATED');
  expectError(h.invokeRaw('completeOAuthSignIn',start.flowId,start.pollToken,
    result.handoffCode === '000000' ? '000001' : '000000',start.sessionToken),'OTP_INVALID');
});
test('confirmation requires both callback code and original browser proofs and is one-time', () => {
  const h=harness(), start=h.startOAuth();
  const result=h.finishOAuth(start,{visitorKey:'different-callback-context',skipPoll:true});
  h.setVisitorKey(start.visitorKey);
  for(const [poll,session] of [['poll1_'+'x'.repeat(43),start.sessionToken],
    [start.pollToken,'session1_'+'x'.repeat(43)]]) {
    expectError(h.invokeRaw('completeOAuthSignIn',start.flowId,poll,result.handoffCode,session),'UNAUTHENTICATED');
  }
  expectOk(h.invokeRaw('completeOAuthSignIn',start.flowId,start.pollToken,result.handoffCode,start.sessionToken));
  expectError(h.invokeRaw('completeOAuthSignIn',start.flowId,start.pollToken,result.handoffCode,start.sessionToken),'UNAUTHENTICATED');
});
test('OTP allows limited correction, then locks the flow against brute force', () => {
  {
    const h = harness(), start = h.startOAuth(), result = h.finishOAuth(start, { skipPoll: true });
    const wrong = result.handoffCode === '000000' ? '000001' : '000000';
    for (let attempt = 1; attempt <= 4; attempt += 1) {
      expectError(h.invokeRaw('completeOAuthSignIn', start.flowId, start.pollToken,
        wrong, start.sessionToken), 'OTP_INVALID');
      const flow = JSON.parse(h.cache.get(h.context.oauthFlowCacheKey_(start.flowId)));
      assert.equal(flow.status, 'AWAITING_CONFIRMATION');
      assert.equal(flow.otpFailedAttempts, attempt);
    }
    expectOk(h.invokeRaw('completeOAuthSignIn', start.flowId, start.pollToken,
      result.handoffCode, start.sessionToken));
  }
  {
    const h = harness(), start = h.startOAuth(), result = h.finishOAuth(start, { skipPoll: true });
    const wrong = result.handoffCode === '999999' ? '999998' : '999999';
    for (let attempt = 0; attempt < 5; attempt += 1) {
      expectError(h.invokeRaw('completeOAuthSignIn', start.flowId, start.pollToken,
        wrong, start.sessionToken), attempt === 4 ? 'UNAUTHENTICATED' : 'OTP_INVALID');
    }
    expectError(h.invokeRaw('completeOAuthSignIn', start.flowId, start.pollToken,
      result.handoffCode, start.sessionToken), 'UNAUTHENTICATED');
    const flow = JSON.parse(h.cache.get(h.context.oauthFlowCacheKey_(start.flowId)));
    assert.equal(flow.status, 'CONSUMED');
    assert.equal(flow.otpHash, undefined);
    assert.equal(flow.candidate, undefined);
  }
});
test('wrong stored PKCE verifier is rejected by the token endpoint', () => {
  const h=harness(), start=h.startOAuth();
  const key=h.context.oauthCallbackCacheKey_(start.stateToken);
  const record=JSON.parse(h.cache.get(key));
  record.codeVerifier='pkce1_'+'x'.repeat(43);
  h.cache.put(key,JSON.stringify(record),600);
  expectError(h.finishOAuth(start).pollResponse,'UNAUTHENTICATED');
});
test('confirmation expires and current Users status is rechecked before session activation', () => {
  for(const action of ['expire','inactive']) {
    const h=harness(), start=h.startOAuth(), result=h.finishOAuth(start,{skipPoll:true});
    if(action==='expire')h.advanceTime(301);
    else h.replaceCell('Users','user_id','USR-000001','status','INACTIVE');
    expectError(h.invokeRaw('completeOAuthSignIn',start.flowId,start.pollToken,result.handoffCode,start.sessionToken),
      action==='expire'?'UNAUTHENTICATED':'USER_DISABLED');
    expectError(h.invokeWithToken('getDashboard',start.sessionToken),'UNAUTHENTICATED');
  }
});
test('token endpoint errors and consent denial do not activate the session', () => {
  for (const options of [{ tokenStatus: 400 }, { tokenBody: 'not-json' }, { tokenBody: {} }, { tokenFetchError: new Error('network') }, { oauthError: 'access_denied' }]) {
    const h = harness();
    const result = login(h, 'admin@yru.ac.th', options);
    assert.equal(result.pollResponse.ok, false);
    expectError(h.invokeWithToken('getDashboard', result.start.sessionToken), 'UNAUTHENTICATED');
  }
});
test('session expiry, eviction, logout, current user status and role are enforced', () => {
  for (const action of ['expiry', 'eviction', 'logout', 'inactive', 'role']) {
    const h = harness();
    const token = h.state.sessionToken;
    if (action === 'expiry') h.advanceTime(3601);
    if (action === 'eviction') h.cache.values.clear();
    if (action === 'logout') expectOk(h.invokeRaw('logoutSession', token));
    if (action === 'inactive') h.replaceCell('Users', 'user_id', 'USR-000001', 'status', 'INACTIVE');
    if (action === 'role') h.replaceCell('Users', 'user_id', 'USR-000001', 'role', 'USER');
    expectError(h.invokeWithToken('adminListUsers', token, {}), action === 'inactive' ? 'USER_DISABLED' : action === 'role' ? 'FORBIDDEN' : 'UNAUTHENTICATED');
  }
});
test('signed role claims and browser payload cannot elevate a USER to ADMIN', () => {
  const h = harness();
  createUser(h, { suffix: 'user', email: 'user@gmail.com' });
  const activeCalls = h.state.activeUserCalls;
  expectOk(login(h, 'user@gmail.com', { claims: { role: 'ADMIN', isAdmin: true } }).pollResponse);
  const count = h.records('Categories').length;
  expectError(h.invoke('adminCreateCategory', { role: 'ADMIN', actor_email: 'admin@yru.ac.th', command_id: 'escalation-test', category_name: 'Escalated', prefix: 'ESC' }), 'FORBIDDEN');
  assert.equal(h.records('Categories').length, count);
  assert.equal(h.state.activeUserCalls, activeCalls);
});
test('JWKS caching applies to callbacks, not business RPCs; failures deny new sign-ins', () => {
  const h = harness();
  login(h, 'admin@yru.ac.th');
  assert.equal(h.state.fetches.filter(x => x.url === GOOGLE_JWKS_URL).length, 1);
  const count = h.state.fetches.length;
  expectOk(h.invoke('getDashboard'));
  assert.equal(h.state.fetches.length, count);
  h.setJwks({ keys: [] }, 503);
  expectError(login(h, 'admin@yru.ac.th').pollResponse, 'AUTH_SERVICE_UNAVAILABLE');
});
test('unknown users remain unprovisioned even if a legacy property is changed after setup', () => {
  const h = harness();
  h.properties.setProperty('AUTO_PROVISION_USERS', 'true');
  const count = h.records('Users').length;
  expectError(login(h, 'missing@gmail.com').pollResponse, 'FORBIDDEN');
  assert.equal(h.records('Users').length, count);
});
