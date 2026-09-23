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
  await pasteOtp(page, '123456');
  await page.locator('#oauth-handoff-submit').click();
}

async function pasteOtp(page, code) {
  await page.locator('[data-otp-digit]').first().evaluate((input, value) => {
    const transfer = new DataTransfer();
    transfer.setData('text/plain', value);
    input.dispatchEvent(new ClipboardEvent('paste', {
      bubbles: true,
      cancelable: true,
      clipboardData: transfer
    }));
  }, code);
}

async function openAuthenticated(page, url, route) {
  await page.goto(url);
  await signInWithServerOAuth(page);
  await waitForApplication(page, route);
}

test('six-field OTP supports numeric entry, backward deletion, paste, and accessible labels', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 700 });
  await page.goto('/?view=dashboard&role=admin');
  await expect(page.locator('#access-state')).toBeVisible();
  await page.locator('#google-signin-button').click();
  await expect(page.locator('#oauth-handoff-panel')).toBeVisible();

  const digits = page.locator('[data-otp-digit]');
  await expect(digits).toHaveCount(6);
  for (let index = 0; index < 6; index += 1) {
    await expect(digits.nth(index)).toHaveAttribute('inputmode', 'numeric');
    await expect(digits.nth(index)).toHaveAttribute('maxlength', '1');
    await expect(digits.nth(index)).toHaveAttribute('aria-label', new RegExp(`${index + 1}.*6`));
  }

  await digits.nth(0).fill('1');
  await expect(digits.nth(1)).toBeFocused();
  await digits.nth(1).fill('2');
  await digits.nth(2).press('Backspace');
  await expect(digits.nth(1)).toBeFocused();
  await expect(digits.nth(1)).toHaveValue('');

  await digits.nth(0).evaluate((input) => {
    const transfer = new DataTransfer();
    transfer.setData('text/plain', '123456');
    input.dispatchEvent(new ClipboardEvent('paste', { bubbles: true, cancelable: true, clipboardData: transfer }));
  });
  expect(await digits.evaluateAll((inputs) => inputs.map((input) => input.value)))
    .toEqual(['1', '2', '3', '4', '5', '6']);
  await expect(digits.nth(5)).toBeFocused();
  const otpLayout = await page.locator('#oauth-handoff-inputs').evaluate((node) => ({
    left: node.getBoundingClientRect().left,
    right: node.getBoundingClientRect().right,
    viewport: document.documentElement.clientWidth
  }));
  expect(otpLayout.left).toBeGreaterThanOrEqual(0);
  expect(otpLayout.right).toBeLessThanOrEqual(otpLayout.viewport);
  await digits.nth(5).press('Enter');
  await waitForApplication(page, 'dashboard');
});

test('theme follows the system by default, persists all three states, and is keyboard accessible', async ({ page }) => {
  await page.emulateMedia({ colorScheme: 'dark' });
  await page.goto('/?view=dashboard');

  const root = page.locator('html');
  const toggle = page.locator('#theme-toggle');
  await expect(root).toHaveAttribute('data-theme-preference', 'system');
  await expect(root).toHaveAttribute('data-bs-theme', 'dark');
  await expect(toggle).toBeVisible();
  await expect(toggle).toHaveAttribute('aria-label', /.+/);
  await expect(toggle).toHaveAttribute('title', /.+/);
  await expect(toggle.locator('[data-theme-icon]')).toHaveClass(/bi-circle-half/);
  expect(await page.evaluate(() => localStorage.getItem('crs-theme'))).toBeNull();

  await toggle.focus();
  await page.keyboard.press('Enter');
  await expect(root).toHaveAttribute('data-theme-preference', 'light');
  await expect(root).toHaveAttribute('data-bs-theme', 'light');
  await expect(toggle.locator('[data-theme-icon]')).toHaveClass(/bi-sun-fill/);
  expect(await page.evaluate(() => localStorage.getItem('crs-theme'))).toBe('light');

  await page.reload();
  await expect(root).toHaveAttribute('data-theme-preference', 'light');
  await expect(root).toHaveAttribute('data-bs-theme', 'light');

  await toggle.focus();
  await page.keyboard.press('Space');
  await expect(root).toHaveAttribute('data-theme-preference', 'dark');
  await expect(toggle.locator('[data-theme-icon]')).toHaveClass(/bi-moon-stars-fill/);
  expect(await page.evaluate(() => localStorage.getItem('crs-theme'))).toBe('dark');

  await toggle.click();
  await expect(root).toHaveAttribute('data-theme-preference', 'system');
  await expect(root).toHaveAttribute('data-bs-theme', 'dark');
  expect(await page.evaluate(() => localStorage.getItem('crs-theme'))).toBe('system');

  await page.emulateMedia({ colorScheme: 'light' });
  await expect(root).toHaveAttribute('data-bs-theme', 'light');
});

test('dark theme covers login, navigation, admin forms, tables, modal, alerts, and badges', async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('crs-theme', 'dark'));
  await openAuthenticated(page, '/?view=admin&role=admin', 'admin');
  await page.locator('#admin-users-tab').click();
  await page.locator('[data-action="add-user"]').click();
  await page.evaluate(() => {
    const fixture = document.createElement('div');
    fixture.innerHTML = '<div class="alert alert-warning">Theme alert</div>' +
      '<div class="dropdown-menu show"><button class="dropdown-item">Theme menu</button></div>' +
      '<div class="surface-card"><h2>Theme heading</h2><label class="form-label">Theme label</label>' +
      '<span class="text-body-secondary">Theme muted</span><a href="#">Theme link</a>' +
      '<button class="btn btn-primary">Theme button</button>' +
      '<span class="status-badge status-active">Active</span></div>' +
      '<div class="table-card">Theme table</div>';
    document.body.append(fixture);
  });

  const themed = await page.evaluate(() => {
    const selectors = [
      'body', '.app-topbar', '.app-sidebar', '.surface-card', '.form-control',
      '.table-card', '.modal-content', '.status-badge', '.alert', '.dropdown-menu'
    ];
    const values = {};
    selectors.forEach((selector) => {
      const node = document.querySelector(selector);
      if (!node) return;
      const style = getComputedStyle(node);
      values[selector] = { background: style.backgroundColor, color: style.color };
    });
    const rootStyle = getComputedStyle(document.documentElement);
    const token = (name) => rootStyle.getPropertyValue(name).trim();
    const rgb = (hex) => [1, 3, 5].map((index) => parseInt(hex.slice(index, index + 2), 16));
    const luminance = (hex) => {
      const channels = rgb(hex).map((value) => {
        const channel = value / 255;
        return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
      });
      return channels[0] * 0.2126 + channels[1] * 0.7152 + channels[2] * 0.0722;
    };
    const contrast = (foreground, background) => {
      const values = [luminance(foreground), luminance(background)].sort((a, b) => b - a);
      return (values[0] + 0.05) / (values[1] + 0.05);
    };
    return {
      values,
      canvas: token('--crs-canvas'),
      surface: token('--crs-surface'),
      contrast: {
        body: contrast(token('--crs-ink'), token('--crs-canvas')),
        card: contrast(token('--crs-ink'), token('--crs-surface')),
        heading: contrast(token('--crs-heading'), token('--crs-surface')),
        label: contrast(token('--crs-label'), token('--crs-surface')),
        muted: contrast(token('--crs-muted'), token('--crs-surface')),
        link: contrast(token('--crs-link'), token('--crs-surface')),
        primaryButton: contrast(token('--crs-on-brand'), token('--crs-action')),
        primaryButtonHover: contrast(token('--crs-on-brand'), token('--crs-action-hover')),
        success: contrast(token('--crs-success'), token('--crs-success-bg')),
        warning: contrast(token('--crs-warning'), token('--crs-warning-bg')),
        danger: contrast(token('--crs-danger'), token('--crs-danger-bg')),
        info: contrast(token('--crs-info'), token('--crs-info-bg'))
      }
    };
  });

  await expect(page.locator('html')).toHaveAttribute('data-bs-theme', 'dark');
  await expect(page.locator('#theme-toggle')).toBeVisible();
  await expect(page.locator('#modal-admin-user')).toBeVisible();
  expect(themed.canvas).toBe('#0b1220');
  expect(themed.surface).toBe('#111827');
  expect(Object.keys(themed.values)).toEqual(expect.arrayContaining([
    'body', '.app-topbar', '.app-sidebar', '.surface-card', '.form-control',
    '.table-card', '.modal-content', '.status-badge', '.alert', '.dropdown-menu'
  ]));
  for (const [pair, ratio] of Object.entries(themed.contrast)) {
    expect(ratio, `${pair} dark-theme contrast must meet WCAG AA`).toBeGreaterThanOrEqual(4.5);
  }
});

test('bootstrap fails closed and keeps the admin route role-gated', async ({ page }) => {
  const pageErrors = collectPageErrors(page);

  await openAuthenticated(page, '/?view=dashboard&role=admin', 'dashboard');
  await expect(page.locator('#dashboard-content')).toBeVisible();
  await expect(page.locator('[data-app-short-name]').first()).toHaveText('CRS Yuem-Kuen');
  await expect(page.locator('[data-app-name]').first()).toHaveText('CRS Yuem-Kuen System');
  await expect(page).toHaveTitle('หน้าหลัก · CRS Yuem-Kuen System');
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
  await expect(page.locator('#access-state [data-app-short-name]')).toHaveText('CRS Yuem-Kuen');
  await expect(page.locator('[data-access-title]')).toContainText('บัญชี');
  await expect(page.locator('[data-access-message]')).toContainText('ปิดใช้งาน');
  await expect(page.locator('#access-state button:visible')).toHaveCount(1);
  await expect(page.locator('#google-signin-button')).toHaveText(/ลงชื่อเข้าใช้ด้วย Google/);
  await expect(page.locator('[data-action="retry-bootstrap"]')).toHaveCount(0);

  const bootstrapCallCount = () => page.evaluate(() =>
    window.__CRS_TEST__.calls.filter((call) => call.method === 'getAppBootstrap').length);
  expect(await bootstrapCallCount()).toBe(2);
  await page.locator('#google-signin-button').click();
  await confirmOAuth(page);
  await expect.poll(bootstrapCallCount).toBe(3);

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
  expect(polls.at(-1).args[2]).toBe('123456');
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
  expect(observed.sessionStorage).toEqual([
    ['crs.auth.session.v1', expect.stringContaining(sessionToken)],
  ]);
  expect(JSON.stringify(observed.sessionStorage)).not.toContain(pollToken);
  expect(observed.cookie).toBe('');
  expect(pageErrors).toEqual([]);
});

test('invalid restored session fails closed, clears storage, and shows login without opening OAuth', async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem('crs.auth.session.v1', JSON.stringify({
      version: 1,
      token: `session1_${'A'.repeat(43)}`,
      expiresAt: Math.floor(Date.now() / 1000) + 3600,
    }));
  });
  await page.goto('/?view=dashboard&role=user');

  await expect(page.locator('#access-state')).toBeVisible();
  await expect(page.locator('[data-access-title]')).toHaveText('ลงชื่อเข้าใช้ด้วย Google');
  await expect(page.locator('#google-signin-button')).toBeEnabled();
  expect(await page.evaluate(() => localStorage.getItem('crs.auth.session.v1'))).toBeNull();
  expect(await page.evaluate(() => window.__CRS_TEST__.oauth.beginCount)).toBe(0);
});

test('opt-in session persistence restores across links and synchronizes logout across tabs', async ({ page, context }) => {
  await page.goto('/?view=dashboard&role=user');
  const remember = page.locator('#remember-session');
  await expect(remember).toBeVisible();
  await expect(remember).not.toBeChecked();
  await remember.check();
  await signInWithServerOAuth(page);
  await waitForApplication(page, 'dashboard');

  const stored = await page.evaluate(() => ({
    persistent: localStorage.getItem('crs.auth.session.v1'),
    transient: sessionStorage.getItem('crs.auth.session.v1'),
    preference: localStorage.getItem('crs.auth.remember.v1'),
  }));
  expect(stored.persistent).toBeTruthy();
  expect(stored.transient).toBeNull();
  expect(stored.preference).toBe('true');
  const record = JSON.parse(stored.persistent);
  expect(record).toEqual({
    version: 1,
    token: expect.stringMatching(/^session1_[A-Za-z0-9_-]{43}$/),
    expiresAt: expect.any(Number),
  });

  const secondPage = await context.newPage();
  await secondPage.goto('/?view=my-borrow&role=user&restore=valid');
  await waitForApplication(secondPage, 'my-borrow');
  const restored = await secondPage.evaluate(() => ({
    beginCount: window.__CRS_TEST__.oauth.beginCount,
    bootstrapTokens: window.__CRS_TEST__.calls
      .filter((call) => call.method === 'getAppBootstrap')
      .map((call) => call.sessionToken),
  }));
  expect(restored.beginCount).toBe(0);
  expect(restored.bootstrapTokens).toEqual([record.token]);

  await secondPage.locator('a[href="?view=account"]:visible').first().click();
  await secondPage.locator('[data-action="sign-out"]:visible').click();
  await expect(secondPage.locator('#access-state')).toBeVisible();
  await expect(page.locator('#access-state')).toBeVisible();
  await expect(secondPage.locator('#remember-session')).toBeChecked();
  expect(await secondPage.evaluate(() => localStorage.getItem('crs.auth.session.v1'))).toBeNull();
  await secondPage.close();
});

test('non-remembered session survives same-tab navigation only in session storage', async ({ page }) => {
  await page.goto('/?view=dashboard&role=user');
  await expect(page.locator('#remember-session')).not.toBeChecked();
  await signInWithServerOAuth(page);
  await waitForApplication(page, 'dashboard');

  const stored = await page.evaluate(() => ({
    persistent: localStorage.getItem('crs.auth.session.v1'),
    transient: sessionStorage.getItem('crs.auth.session.v1'),
  }));
  expect(stored.persistent).toBeNull();
  expect(JSON.parse(stored.transient).token).toMatch(/^session1_[A-Za-z0-9_-]{43}$/);

  await page.goto('/?view=my-borrow&role=user&restore=valid');
  await waitForApplication(page, 'my-borrow');
  expect(await page.evaluate(() => window.__CRS_TEST__.oauth.beginCount)).toBe(0);
});

test('polling without callback confirmation never opens the protected shell', async ({ page }) => {
  await page.goto('/?view=dashboard&role=admin');
  await page.locator('#google-signin-button').click();
  await expect(page.locator('#oauth-handoff-panel')).toBeVisible();
  await page.waitForTimeout(1600);
  await expect(page.locator('#app-shell')).toBeHidden();
  expect(await page.evaluate(() => window.__CRS_TEST__.calls.some(c => c.method === 'getAppBootstrap'))).toBe(false);
  await pasteOtp(page, '000000');
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

test('admin borrowing filters align labels and controls on one desktop row', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await openAuthenticated(page, routeUrl('admin'), 'admin');

  const alignment = await page.locator('#form-admin-borrow-filter').evaluate((form) => {
    const tops = (selectors) => selectors.map((selector) =>
      Math.round(form.querySelector(selector).getBoundingClientRect().top));
    return {
      labels: tops([
        'label[for="admin-borrow-search"]',
        'label[for="admin-borrow-status"]',
        'label[for="admin-borrow-sort"]',
      ]),
      controls: tops([
        '#admin-borrow-search',
        '#admin-borrow-status',
        '#admin-borrow-sort',
        'button[type="submit"]',
      ]),
    };
  });

  expect(Math.max(...alignment.labels) - Math.min(...alignment.labels)).toBeLessThanOrEqual(1);
  expect(Math.max(...alignment.controls) - Math.min(...alignment.controls)).toBeLessThanOrEqual(1);
});

test('my borrowing filters align labels and controls on one desktop row', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await openAuthenticated(page, routeUrl('my-borrow'), 'my-borrow');

  const alignment = await page.locator('#form-my-borrow-filter').evaluate((form) => {
    const tops = (selectors) => selectors.map((selector) =>
      Math.round(form.querySelector(selector).getBoundingClientRect().top));
    return {
      labels: tops([
        'label[for="my-borrow-search"]',
        'label[for="my-borrow-status-filter"]',
        'label[for="my-borrow-sort-direction"]',
      ]),
      controls: tops([
        '#my-borrow-search',
        '#my-borrow-status-filter',
        '#my-borrow-sort-direction',
        'button[type="submit"]',
      ]),
    };
  });

  expect(Math.max(...alignment.labels) - Math.min(...alignment.labels)).toBeLessThanOrEqual(1);
  expect(Math.max(...alignment.controls) - Math.min(...alignment.controls)).toBeLessThanOrEqual(1);
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
