const { test, expect } = require('@playwright/test');

test('user modal routes create independently of stale or injected IDs and keeps edit target immutable', async ({ page }) => {
  await openAuthenticated(page, '/?view=admin&role=admin', 'admin');
  await page.locator('#admin-users-tab').click();
  await page.locator('[data-action="edit-admin-user"]').first().click();
  const form = page.locator('#form-admin-user');
  await expect(form).toBeVisible();
  await expect(form.locator('[name="user_id"]')).toHaveCount(0);
  await page.evaluate(() => {
    const input = document.createElement('input');
    input.type = 'hidden'; input.name = 'user_id'; input.value = 'USR-999999';
    document.querySelector('#form-admin-user').append(input);
  });
  await form.locator('[name="name"]').fill('Edited user');
  await form.locator('[type="submit"]').click();
  await expect(form).toBeHidden();
  await page.locator('[data-action="add-user"]').click();
  await expect(form.locator('[data-user-id-display]')).toBeHidden();
  await form.locator('[name="email"]').fill('new@gmail.com');
  await form.locator('[name="name"]').fill('New Gmail user');
  await form.locator('[type="submit"]').click();
  await expect(form).toBeHidden();
  const calls = await page.evaluate(() => window.__CRS_TEST__.calls.filter(call =>
    ['adminCreateUser', 'adminUpdateUser'].includes(call.method)));
  expect(calls.map(call => call.method)).toEqual(['adminUpdateUser', 'adminCreateUser']);
  const update = calls[0].args.find(arg => arg && typeof arg === 'object' && arg.command_id);
  const create = calls[1].args.find(arg => arg && typeof arg === 'object' && arg.command_id);
  expect(update.user_id).toBe('USR-000001');
  expect(create).not.toHaveProperty('user_id');
  expect(create.email).toBe('new@gmail.com');
});

const ROUTE_SELECTORS = {
  dashboard: '#page-dashboard',
  equipment: '#page-equipment',
  'equipment-detail': '#page-equipment-detail',
  scan: '#page-scan',
  'my-borrow': '#page-my-borrow',
  admin: '#page-admin',
};

function routeUrl(route, extras = '') {
  const params = new URLSearchParams({ view: route, role: 'admin' });
  if (route === 'equipment-detail') params.set('id', 'AST-000001');
  if (extras) {
    new URLSearchParams(extras).forEach((value, key) => params.append(key, value));
  }
  return `/?${params.toString()}`;
}

async function waitForApplication(page, route) {
  await expect(page.locator('#app-splash')).toBeHidden();
  await expect(page.locator('#access-state')).toBeHidden();
  await expect(page.locator('#app-shell')).toBeVisible();
  await expect(page.locator(ROUTE_SELECTORS[route])).toBeVisible();
  await expect(page.locator('#global-loading')).toBeHidden();
}

function collectPageErrors(page) {
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  return errors;
}

async function signInWithServerOAuth(page) {
  await expect(page.locator('#access-state')).toBeVisible();
  const button = page.locator('#google-signin-button');
  await expect(button).toBeVisible();
  await expect(button).toBeEnabled();
  await button.click();
  await confirmOAuth(page);
}
async function confirmOAuth(page) {
  await expect(page.locator('#oauth-handoff-panel')).toBeVisible();
  await page.locator('#oauth-handoff-input').fill('confirm1_' + 'c'.repeat(43));
  await page.locator('#oauth-handoff-submit').click();
}

async function openAuthenticated(page, url, route) {
  await page.goto(url);
  await signInWithServerOAuth(page);
  await waitForApplication(page, route);
}

test('bootstrap fails closed and keeps the admin route role-gated', async ({ page }) => {
  const pageErrors = collectPageErrors(page);

  await openAuthenticated(page, '/?view=dashboard&role=admin', 'dashboard');
  await expect(page.locator('#dashboard-content')).toBeVisible();
  await expect(page.locator('[data-session-name]').first()).toHaveText('ผู้ดูแลทดสอบ');
  await expect(page.locator('[data-route="admin"]').first()).toBeVisible();

  await openAuthenticated(page, '/?view=admin&role=user', 'dashboard');
  await expect(page.locator('#page-admin')).toHaveCount(0);
  await expect(page.locator('[data-admin-only]:visible')).toHaveCount(0);

  await page.goto('/?view=dashboard&access=disabled');
  await signInWithServerOAuth(page);
  await expect(page.locator('#app-splash')).toBeHidden();
  await expect(page.locator('#app-shell')).toBeHidden();
  await expect(page.locator('#access-state')).toBeVisible();
  await expect(page.locator('[data-access-title]')).toContainText('บัญชี');
  await expect(page.locator('[data-access-message]')).toContainText('ปิดใช้งาน');
  await expect(page.locator('#access-state button:visible')).toHaveCount(1);
  await expect(page.locator('#google-signin-button')).toHaveText(/ลงชื่อเข้าใช้ด้วย Google/);
  await expect(page.locator('[data-action="retry-bootstrap"]')).toHaveCount(0);

  const bootstrapCallCount = () => page.evaluate(() =>
    window.__CRS_TEST__.calls.filter((call) => call.method === 'getAppBootstrap').length);
  expect(await bootstrapCallCount()).toBe(1);
  await page.locator('#google-signin-button').click();
  await confirmOAuth(page);
  await expect.poll(bootstrapCallCount).toBe(2);

  expect(pageErrors).toEqual([]);
});

test('server-side OAuth uses a protected code-flow popup and an opaque application session', async ({ page }) => {
  const pageErrors = collectPageErrors(page);
  const externalGoogleRequests = [];
  page.on('request', (request) => {
    if (request.url().startsWith('https://accounts.google.com/')) {
      externalGoogleRequests.push(request.url());
    }
  });

  await openAuthenticated(page, '/?view=dashboard&role=admin', 'dashboard');
  await page.locator('[data-route="equipment"]').first().click();
  await waitForApplication(page, 'equipment');

  const observed = await page.evaluate(() => ({
    calls: window.__CRS_TEST__.calls,
    oauth: window.__CRS_TEST__.oauth,
    localStorage: Object.entries(window.localStorage),
    sessionStorage: Object.entries(window.sessionStorage),
    cookie: document.cookie,
    location: window.location.href,
    markup: document.documentElement.outerHTML,
    hasGoogleAccountsApi: Boolean(window.google && window.google.accounts),
  }));

  expect(observed.oauth).toMatchObject({
    popupOpenCount: 1,
    beginCount: 1,
    completedCount: 1,
  });
  expect(observed.hasGoogleAccountsApi).toBe(false);
  expect(externalGoogleRequests).toEqual([]);

  const authorizationUrl = new URL(observed.oauth.popupUrls[0]);
  expect(`${authorizationUrl.origin}${authorizationUrl.pathname}`).toBe(
    'https://accounts.google.com/o/oauth2/v2/auth',
  );
  expect(authorizationUrl.searchParams.get('response_type')).toBe('code');
  expect(authorizationUrl.searchParams.get('redirect_uri')).toBe(
    'https://script.google.com/macros/s/test-pilot/exec',
  );
  expect(authorizationUrl.searchParams.get('scope').split(' ').sort()).toEqual(['email', 'openid']);
  expect(authorizationUrl.searchParams.get('state')).toBeTruthy();
  expect(authorizationUrl.searchParams.get('nonce')).toBeTruthy();
  expect(authorizationUrl.searchParams.get('code_challenge')).toMatch(/^[A-Za-z0-9_-]{43}$/);
  expect(authorizationUrl.searchParams.get('code_challenge_method')).toBe('S256');
  ['access_token', 'id_token', 'refresh_token', 'session_token'].forEach((name) => {
    expect(authorizationUrl.searchParams.has(name)).toBe(false);
  });

  const begin = observed.calls.find((call) => call.method === 'beginOAuthSignIn');
  const polls = observed.calls.filter((call) => call.method === 'completeOAuthSignIn');
  const businessCalls = observed.calls.filter((call) =>
    !['beginOAuthSignIn', 'completeOAuthSignIn', 'logoutSession'].includes(call.method));
  expect(begin.sessionToken).toBe('');
  expect(begin.args[0]).toEqual({
    pollTokenHash: expect.stringMatching(/^[A-Za-z0-9_-]{43}$/),
    sessionTokenHash: expect.stringMatching(/^[A-Za-z0-9_-]{43}$/),
  });
  expect(polls.length).toBeGreaterThanOrEqual(3);
  expect(polls.at(-1).args[2]).toBe('confirm1_' + 'c'.repeat(43));
  expect(polls.every((call) => call.sessionToken === '')).toBe(true);
  expect(polls.every((call) => /^flow1_[A-Za-z0-9_-]{43}$/.test(call.args[0]))).toBe(true);
  expect(polls.every((call) => /^poll1_[A-Za-z0-9_-]{43}$/.test(call.args[1]))).toBe(true);
  expect(businessCalls.length).toBeGreaterThanOrEqual(3);
  expect(businessCalls.every((call) => /^session1_[A-Za-z0-9_-]{43}$/.test(call.sessionToken))).toBe(true);
  expect(new Set(businessCalls.map((call) => call.sessionToken)).size).toBe(1);
  expect(observed.calls.every((call) => !Object.hasOwn(call, 'idToken'))).toBe(true);

  const pollToken = polls[0].args[1];
  const sessionToken = businessCalls[0].sessionToken;
  expect(observed.oauth.popupUrls[0]).not.toContain(pollToken);
  expect(observed.oauth.popupUrls[0]).not.toContain(sessionToken);
  expect(observed.location).not.toContain(pollToken);
  expect(observed.location).not.toContain(sessionToken);
  expect(observed.markup).not.toContain(pollToken);
  expect(observed.markup).not.toContain(sessionToken);
  expect(observed.localStorage).toEqual([['crs.equipment.view', 'cards']]);
  expect(JSON.stringify(observed.localStorage)).not.toContain(sessionToken);
  expect(JSON.stringify(observed.localStorage)).not.toContain(pollToken);
  expect(observed.sessionStorage).toEqual([]);
  expect(observed.cookie).toBe('');
  expect(pageErrors).toEqual([]);
});

test('polling without callback confirmation never opens the protected shell', async ({ page }) => {
  await page.goto('/?view=dashboard&role=admin');
  await page.locator('#google-signin-button').click();
  await expect(page.locator('#oauth-handoff-panel')).toBeVisible();
  await page.waitForTimeout(1600);
  await expect(page.locator('#app-shell')).toBeHidden();
  expect(await page.evaluate(() => window.__CRS_TEST__.calls.some(c => c.method === 'getAppBootstrap'))).toBe(false);
  await page.locator('#oauth-handoff-input').fill('wrong');
  await page.locator('#oauth-handoff-submit').click();
  await expect(page.locator('#app-shell')).toBeHidden();
  await confirmOAuth(page);
  await waitForApplication(page, 'dashboard');
});

test('a blocked OAuth popup fails closed before creating a server authorization flow', async ({ page }) => {
  const pageErrors = collectPageErrors(page);
  await page.goto('/?view=dashboard&role=admin&oauth=blocked');
  await page.locator('#google-signin-button').click();

  await expect(page.locator('#access-state')).toBeVisible();
  await expect(page.locator('#app-shell')).toBeHidden();
  await expect(page.locator('[data-access-message]')).toContainText('popup');
  await expect(page.locator('#google-signin-button')).toBeEnabled();

  const observed = await page.evaluate(() => ({
    oauth: window.__CRS_TEST__.oauth,
    calls: window.__CRS_TEST__.calls,
  }));
  expect(observed.oauth.popupOpenCount).toBe(1);
  expect(observed.oauth.beginCount).toBe(0);
  expect(observed.calls.some((call) => call.method === 'beginOAuthSignIn')).toBe(false);
  expect(pageErrors).toEqual([]);
});

test('an expired application session requires a fresh OAuth flow before restoring the shell', async ({ page }) => {
  const pageErrors = collectPageErrors(page);
  await page.goto('/?view=dashboard&role=admin&expire=getDashboard');
  await signInWithServerOAuth(page);

  await expect(page.locator('#access-state')).toBeVisible();
  await expect(page.locator('#app-shell')).toBeHidden();
  await page.locator('#google-signin-button').click();
  await confirmOAuth(page);
  await waitForApplication(page, 'dashboard');

  const observed = await page.evaluate(() => ({
    oauth: window.__CRS_TEST__.oauth,
    calls: window.__CRS_TEST__.calls,
  }));
  expect(observed.oauth.beginCount).toBe(2);
  expect(observed.oauth.completedCount).toBe(2);
  const calls = observed.calls;
  expect(calls.filter((call) => call.method === 'getAppBootstrap')).toHaveLength(2);
  expect(calls.filter((call) => call.method === 'getDashboard')).toHaveLength(2);
  const sessionTokens = calls
    .filter((call) => call.method === 'getDashboard')
    .map((call) => call.sessionToken);
  expect(new Set(sessionTokens).size).toBe(2);
  expect(pageErrors).toEqual([]);
});

test('equipment detail renders QR, downloads a sticker, copies its URL, and hands off exact Asset ID', async ({ page }) => {
  const pageErrors = collectPageErrors(page);
  await openAuthenticated(page, routeUrl('equipment-detail'), 'equipment-detail');

  await expect(page.locator('#equipment-detail-content')).toBeVisible();
  await expect(page.locator('#equipment-detail-title')).toHaveText('Notebook Dell Latitude 5440');
  await expect(page.locator('#equipment-detail-asset-id')).toHaveText('AST-000001');
  await expect(page.locator('#equipment-qr-content canvas')).toBeVisible();

  const downloadPromise = page.waitForEvent('download');
  await page.locator('[data-action="download-qr"]').click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toBe('CRS-AST-000001-sticker.png');
  await expect(page.locator('.toast.show')).toContainText('ดาวน์โหลดสติกเกอร์ QR');

  await page.locator('[data-action="copy-equipment-link"]').click();
  await expect.poll(() => page.evaluate(() => window.__CRS_TEST__.clipboard)).toBe(
    'https://script.google.com/macros/s/crs-test/exec?view=equipment-detail&id=AST-000001',
  );

  await page.locator('[data-action="manage-asset-borrowing"]').click();
  await waitForApplication(page, 'admin');
  await expect(page.locator('#admin-borrow-results-summary')).toContainText('AST-000001');
  await expect.poll(() => page.evaluate(() => {
    const call = window.__CRS_TEST__.calls.find((entry) => entry.method === 'adminListBorrowing');
    return call && call.args[0] && call.args[0].assetId;
  })).toBe('AST-000001');

  expect(pageErrors).toEqual([]);
});

test('scanner provides local file validation and a safe manual Asset ID fallback', async ({ page }) => {
  const pageErrors = collectPageErrors(page);
  await page.setViewportSize({ width: 320, height: 740 });
  await openAuthenticated(page, routeUrl('scan'), 'scan');

  const input = page.locator('#scan-image-input');
  await expect(page.locator('#scan-image-label')).toBeVisible();
  await expect(input).toHaveAttribute('accept', /image\/png/);
  await expect(input).toHaveAttribute('capture', 'environment');
  await input.setInputFiles({ name: 'not-an-image.txt', mimeType: 'text/plain', buffer: Buffer.from('not an image') });
  await expect(page.locator('#scan-error')).toBeVisible();
  await expect(page.locator('#scan-error')).toContainText('PNG, JPEG หรือ WebP');

  await page.locator('#asset-id-entry').fill('AST-123');
  await page.locator('#asset-id-entry-form button[type="submit"]').click();
  await expect(page.locator('#scan-error')).toContainText('AST-000001');

  await page.locator('#asset-id-entry').fill('ast-000001');
  await page.locator('#asset-id-entry-form button[type="submit"]').click();
  await waitForApplication(page, 'equipment-detail');
  await expect(page.locator('#equipment-detail-asset-id')).toHaveText('AST-000001');

  expect(pageErrors).toEqual([]);
});

test('admin borrowing action requires its explicit modal and sends the current version', async ({ page }) => {
  const pageErrors = collectPageErrors(page);
  await page.setViewportSize({ width: 1440, height: 1000 });
  await openAuthenticated(page, routeUrl('admin'), 'admin');
  await expect(page.locator('#table-body-admin-borrow')).toContainText('BR-000001');

  await page.locator('[data-borrow-action="approve"][data-borrow-id="BR-000001"]').click();
  const modal = page.locator('#modal-admin-approve');
  await expect(modal).toBeVisible();
  await expect(modal).toHaveAttribute('aria-labelledby', 'admin-approve-title');
  await expect(modal.locator('#admin-approve-summary')).toContainText('AST-000001');
  await modal.locator('[data-action="submit-admin-approve"]').click();
  await expect(modal).toBeHidden();

  await expect.poll(() => page.evaluate(() => {
    const call = window.__CRS_TEST__.calls.find((entry) => entry.method === 'adminApproveBorrow');
    return call && call.args[0];
  })).toMatchObject({ borrow_id: 'BR-000001', expected_version: 1 });
  await expect(page.locator('.toast.show')).toContainText('อนุมัติคำขอ');

  expect(pageErrors).toEqual([]);
});

test('dashboard, catalog, detail, scanner, borrowing, and admin remain contained at 320/768/1440px', async ({ page }) => {
  test.setTimeout(60_000);
  const pageErrors = collectPageErrors(page);
  const viewports = [
    { width: 320, height: 740 },
    { width: 768, height: 900 },
    { width: 1440, height: 1000 },
  ];
  const routes = ['dashboard', 'equipment', 'equipment-detail', 'scan', 'my-borrow', 'admin'];

  for (const viewport of viewports) {
    await page.setViewportSize(viewport);
    for (const route of routes) {
      await openAuthenticated(page, routeUrl(route), route);
      const layout = await page.evaluate(() => ({
        viewport: document.documentElement.clientWidth,
        document: document.documentElement.scrollWidth,
        main: document.querySelector('#app-main').scrollWidth,
        mainClient: document.querySelector('#app-main').clientWidth,
        offenders: Array.from(document.querySelectorAll('body *')).map((element) => {
          const rect = element.getBoundingClientRect();
          return {
            node: `${element.tagName.toLowerCase()}#${element.id}.${element.className}`,
            left: Math.round(rect.left),
            right: Math.round(rect.right),
            width: Math.round(rect.width),
          };
        }).filter((entry) => entry.left < -1 || entry.right > window.innerWidth + 1)
          .sort((left, right) => right.right - left.right).slice(0, 8),
      }));
      expect(layout.document,
        `${route} at ${viewport.width}px overflows the document: ${JSON.stringify(layout.offenders)}`)
        .toBeLessThanOrEqual(layout.viewport + 1);
      expect(layout.main, `${route} at ${viewport.width}px overflows the main region`).toBeLessThanOrEqual(layout.mainClient + 1);
      await expect(page.locator(`${ROUTE_SELECTORS[route]} h1`).first()).toBeVisible();
    }

    if (viewport.width < 992) {
      await expect(page.locator('#mobile-nav')).toBeVisible();
      await expect(page.locator('#desktop-sidebar')).toBeHidden();
    } else {
      await expect(page.locator('#mobile-nav')).toBeHidden();
      await expect(page.locator('#desktop-sidebar')).toBeVisible();
    }
  }

  await page.setViewportSize({ width: 320, height: 740 });
  await openAuthenticated(page, routeUrl('admin'), 'admin');
  const tabDimensions = await page.locator('.admin-tabs-scroll').evaluate((element) => ({
    clientWidth: element.clientWidth,
    scrollWidth: element.scrollWidth,
    overflowX: getComputedStyle(element).overflowX,
  }));
  expect(tabDimensions.scrollWidth).toBeGreaterThan(tabDimensions.clientWidth);
  expect(['auto', 'scroll']).toContain(tabDimensions.overflowX);

  expect(pageErrors).toEqual([]);
});

test('RPC failures surface Thai feedback without leaving a loading state', async ({ page }) => {
  const pageErrors = collectPageErrors(page);
  await openAuthenticated(page, '/?view=equipment&role=admin&fail=listEquipment', 'equipment');
  await expect(page.locator('#equipment-loading')).toBeHidden();
  await expect(page.locator('#equipment-error')).toBeVisible();
  await expect(page.locator('#equipment-error')).toContainText('จำลองข้อผิดพลาด');
  await expect(page.locator('#view-root')).toHaveAttribute('aria-busy', 'false');
  expect(pageErrors).toEqual([]);
});
