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

test('equipment editor scrolls its fields with the mouse while header and actions stay visible', async ({ page }) => {
  await page.setViewportSize({ width: 1100, height: 650 });
  await openAuthenticated(page, '/?view=equipment&role=admin', 'equipment');
  await page.locator('[data-action="add-equipment"]').click();
  const modal = page.locator('#equipment-editor-modal');
  await expect(modal).toBeVisible();
  const body = modal.locator('.modal-body');
  const before = await body.evaluate((element) => ({
    clientHeight: element.clientHeight,
    scrollHeight: element.scrollHeight,
    overflowY: getComputedStyle(element).overflowY,
    scrollTop: element.scrollTop,
  }));
  expect(before.scrollHeight).toBeGreaterThan(before.clientHeight);
  expect(before.overflowY).toBe('auto');
  const box = await body.boundingBox();
  await page.mouse.move(box.x + box.width / 2, box.y + 32);
  await page.mouse.wheel(0, 700);
  await expect.poll(() => body.evaluate((element) => element.scrollTop)).toBeGreaterThan(before.scrollTop);
  await expect(modal.locator('.modal-header')).toBeInViewport();
  await expect(modal.locator('.modal-footer')).toBeInViewport();
});

const ROUTE_SELECTORS = {
  dashboard: '#page-dashboard',
  equipment: '#page-equipment',
  'equipment-detail': '#page-equipment-detail',
  scan: '#page-scan',
  'my-borrow': '#page-my-borrow',
  admin: '#page-admin',
  account: '#account-heading',
  settings: '#settings-heading',
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
  const toggle = page.locator('[data-action="theme-toggle"]:visible');
  await expect(root).toHaveAttribute('data-theme-preference', 'system');
  await expect(root).toHaveAttribute('data-bs-theme', 'dark');
  await expect(toggle).toBeVisible();
  await expect(toggle).toHaveAttribute('aria-label', /.+/);
  await expect(toggle).toHaveAttribute('title', /.+/);
  await expect(toggle.locator('[data-theme-icon]')).toHaveClass(/bi-circle-half/);
  await expect(page.locator('#toast-container')).toBeHidden();
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
  await expect(page.locator('.app-topbar #theme-toggle')).toBeVisible();
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
  await expect(page.locator('[data-app-name]')).toHaveCount(0);
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

  await secondPage.locator('#desktop-sidebar .account-summary').click();
  await secondPage.locator('[data-account-route="account"]').click();
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

test('equipment search, category, and status align on one desktop row', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await openAuthenticated(page, routeUrl('equipment'), 'equipment');

  const alignment = await page.locator('#form-equipment-filter').evaluate((form) => {
    const tops = (selectors) => selectors.map((selector) =>
      Math.round(form.querySelector(selector).getBoundingClientRect().top));
    return {
      labels: tops([
        'label[for="equipment-search"]',
        'label[for="equipment-category-filter"]',
        'label[for="equipment-status-filter"]',
      ]),
      controls: tops([
        '#equipment-search',
        '#equipment-category-filter',
        '#equipment-status-filter',
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
      await expect(page.locator('#page-title')).toBeVisible();
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

test('equipment and borrowing search controls match the history search height and four corner radii', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await openAuthenticated(page, '/?view=equipment&role=admin', 'equipment');

  const appearance = async (selector) => page.locator(selector).evaluate((input) => {
    const style = getComputedStyle(input);
    return {
      height: input.getBoundingClientRect().height,
      corners: [style.borderTopLeftRadius, style.borderTopRightRadius,
        style.borderBottomRightRadius, style.borderBottomLeftRadius],
    };
  });
  const equipment = await appearance('#equipment-search');
  await page.locator('#desktop-nav [data-route="my-borrow"]').click();
  await expect(page.locator('#page-my-borrow')).toBeVisible();
  const borrowing = await appearance('#my-borrow-search');
  await page.locator('#desktop-nav [data-route="history"]').click();
  await expect(page.locator('#my-borrow-history-pane')).toBeVisible();
  const history = await appearance('#my-history-search');

  for (const control of [equipment, borrowing]) {
    expect(control.height).toBe(history.height);
    expect(control.corners).toEqual(history.corners);
  }
});

test('sidebar account summary opens and closes a floating account menu without navigation or layout shift', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await openAuthenticated(page, '/?view=dashboard&role=admin', 'dashboard');
  const trigger = page.locator('#desktop-sidebar .account-summary');
  const before = await page.locator('#app-main').boundingBox();
  await trigger.click();
  await expect(page.locator('#account-menu-panel')).toBeVisible();
  await expect(trigger).toHaveAttribute('aria-expanded', 'true');
  await expect(page.locator('#page-dashboard')).toBeVisible();
  const after = await page.locator('#app-main').boundingBox();
  expect(after.x).toBe(before.x);
  expect(after.width).toBe(before.width);
  await trigger.click();
  await expect(page.locator('#account-menu-panel')).toBeHidden();
  await expect(trigger).toHaveAttribute('aria-expanded', 'false');
});

test('account and help submenus support Escape, outside click, hover persistence, and arrow navigation', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await openAuthenticated(page, '/?view=dashboard&role=admin', 'dashboard');
  const trigger = page.locator('#desktop-sidebar .account-summary');
  const main = page.locator('#account-menu-panel');
  const identity = page.locator('#account-identity-menu');
  const help = page.locator('#account-help-menu');
  await trigger.click();
  await page.locator('#account-menu-header').press('ArrowRight');
  await expect(identity).toBeVisible();
  await expect(identity).toContainText('admin@example.org');
  await expect(page.locator('#account-menu-header')).toHaveAttribute('aria-expanded', 'true');
  await page.keyboard.press('Escape');
  await expect(identity).toBeHidden();
  await expect(main).toBeVisible();
  await expect(page.locator('#account-menu-header')).toBeFocused();
  await page.keyboard.press('ArrowDown');
  await expect(page.locator('[data-account-route="account"]')).toBeFocused();
  await page.locator('#account-help-trigger').hover();
  await expect(help).toBeVisible();
  const helpBox = await help.boundingBox();
  await page.mouse.move(helpBox.x + 20, helpBox.y + 20);
  await expect(help).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(help).toBeHidden();
  await page.keyboard.press('Escape');
  await expect(main).toBeHidden();
  await trigger.click();
  await page.locator('#page-title').click();
  await expect(main).toBeHidden();
  await expect(identity).toBeHidden();
});

test('account submenus follow pointer hover and close when the pointer leaves their trigger and submenu', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await openAuthenticated(page, '/?view=dashboard&role=user', 'dashboard');
  await page.locator('#desktop-sidebar .account-summary').click();
  const identity = page.locator('#account-identity-menu');
  const help = page.locator('#account-help-menu');
  await page.locator('#account-menu-header').hover();
  await expect(identity).toBeVisible();
  await page.locator('#account-menu-header').click();
  await expect(identity).toBeVisible();
  await page.locator('[data-account-route="account"]').hover();
  await expect(identity).toBeVisible();
  await page.locator('#account-menu-header').click();
  await expect(identity).toBeVisible();
  await page.locator('#account-menu-header').click();
  await expect(identity).toBeHidden();
  await page.locator('[data-account-route="account"]').hover();
  await page.locator('#account-menu-header').hover();
  await expect(identity).toBeVisible();
  await page.locator('[data-account-route="account"]').hover();
  await expect(identity).toBeHidden();
  await page.locator('#account-help-trigger').hover();
  await expect(help).toBeVisible();
  await page.locator('[data-account-route="account"]').hover();
  await expect(help).toBeHidden();
  await page.locator('#account-help-trigger').click();
  await expect(help).toBeVisible();
});

test('account menu routes to the profile, shows admin actions only to admins, and uses existing logout', async ({ page }) => {
  await openAuthenticated(page, '/?view=dashboard&role=admin', 'dashboard');
  await page.locator('#desktop-sidebar .account-summary').click();
  await expect(page.locator('[data-account-route="admin"]')).toBeVisible();
  await page.locator('[data-account-route="account"]').click();
  await expect(page.locator('#account-heading')).toBeVisible();
  await expect(page.locator('#account-menu-panel')).toBeHidden();
  await page.locator('#desktop-sidebar .account-summary').click();
  await page.locator('[data-account-command="logout"]').click();
  await expect(page.locator('#access-state')).toBeVisible();
  const methods = await page.evaluate(() => window.__CRS_TEST__.calls.map((call) => call.method));
  expect(methods).toContain('logoutSession');
});

test('settings language picker searches, scrolls, persists, and translates help labels', async ({ page }) => {
  await openAuthenticated(page, '/?view=dashboard&role=user', 'dashboard');
  await page.locator('#desktop-sidebar .account-summary').click();
  await page.locator('[data-account-route="settings"]').click();
  await expect(page.locator('#settings-heading')).toHaveText('General');
  await expect(page.locator('.settings-language-copy')).toContainText('Language for the app UI');

  const trigger = page.locator('#language-trigger');
  await trigger.click();
  await expect(trigger).toHaveAttribute('aria-expanded', 'true');
  const list = page.locator('#language-list');
  const displayedLanguages = await list.locator('[data-language-code]').allTextContents();
  expect(displayedLanguages[0]).toBe('Auto detect');
  expect(displayedLanguages.slice(1)).toEqual(displayedLanguages.slice(1).sort((a, b) =>
    a.localeCompare(b, 'en', { sensitivity: 'base' })));
  const initialScroll = await list.evaluate((element) => ({
    height: element.clientHeight, content: element.scrollHeight
  }));
  expect(initialScroll.content).toBeGreaterThan(initialScroll.height);
  await list.hover();
  await page.mouse.wheel(0, 500);
  await expect.poll(() => list.evaluate((element) => element.scrollTop)).toBeGreaterThan(0);

  const search = page.locator('#language-search');
  await search.fill('English');
  await expect(list.locator('[data-language-code]')).toHaveCount(1);
  await list.locator('[data-language-code="en"]').click();
  await expect(trigger).toHaveText(/English/);
  await expect(page.locator('html')).toHaveAttribute('lang', 'en');
  await expect(page.locator('#account-shortcuts-title')).toHaveText('Keyboard Shortcuts');
  await expect(page.locator('[data-help-link="helpCenter"] [data-language-text]')).toHaveText('Help Center');
  await expect(page.locator('#account-help-trigger [data-language-text]')).toHaveText('Help');
  await expect(page.locator('#account-help-menu')).toHaveAttribute('aria-label', 'Help');
  await page.reload();
  await signInWithServerOAuth(page);
  await expect(page.locator('#language-trigger')).toHaveText(/English/);

  await page.locator('#language-trigger').click();
  await page.locator('#language-search').fill('Deutsch');
  await page.locator('[data-language-code="de"]').click();
  await expect(page.locator('.settings-language-note')).toBeVisible();
  await expect(page.locator('#account-shortcuts-title')).toHaveText('คีย์ลัด');
  await page.locator('#language-trigger').click();
  await page.locator('#language-search').fill('ไทย');
  await page.locator('[data-language-code="th"]').click();
  await expect(page.locator('.settings-language-note')).toBeHidden();
  await expect(page.locator('[data-help-link="helpCenter"] [data-language-text]')).toHaveText('ศูนย์ช่วยเหลือ');
  await page.locator('#language-trigger').click();
  await page.locator('#language-search').fill('Auto detect');
  await page.locator('[data-language-code="auto"]').click();
  const browserLanguage = await page.evaluate(() => navigator.language.split('-')[0].toLowerCase());
  await expect(page.locator('html')).toHaveAttribute('lang', browserLanguage === 'en' ? 'en' : 'th');
});

test('language picker closes by Escape or outside click and settings remains reachable on mobile', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 650 });
  await openAuthenticated(page, '/?view=account&role=user', 'account');
  await page.locator('#view-root [data-route="settings"]').click();
  await expect(page.locator('#settings-heading')).toBeVisible();
  await page.locator('#language-trigger').click();
  await expect(page.locator('#language-search')).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(page.locator('#language-dropdown')).toBeHidden();
  await expect(page.locator('#language-trigger')).toBeFocused();
  await page.locator('#language-trigger').click();
  await page.locator('#settings-heading').click();
  await expect(page.locator('#language-dropdown')).toBeHidden();
  await page.locator('#language-trigger').click();
  await page.setViewportSize({ width: 320, height: 650 });
  const dropdown = await page.locator('#language-dropdown').boundingBox();
  expect(dropdown.x).toBeGreaterThanOrEqual(0);
  expect(dropdown.x + dropdown.width).toBeLessThanOrEqual(320);
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(1);
});

test('settings has its own sidebar, section navigation, appearance control, and a back-to-app action', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await openAuthenticated(page, '/?view=dashboard&role=user', 'dashboard');
  await page.locator('#desktop-sidebar .account-summary').click();
  await page.locator('[data-account-route="settings"]').click();
  await expect(page.locator('#app-shell')).toHaveClass(/is-settings-route/);
  await expect(page.locator('#desktop-sidebar')).toBeHidden();
  await expect(page.locator('#settings-sidebar')).toBeVisible();
  await expect(page.locator('[data-settings-section]')).toHaveCount(8);
  await expect(page.locator('[data-settings-section="general"]')).toHaveAttribute('aria-current', 'page');

  await page.locator('#settings-sidebar-toggle').click();
  await expect(page.locator('.settings-page')).toHaveClass(/is-sidebar-collapsed/);
  await page.locator('#settings-sidebar-toggle').click();
  await expect(page.locator('.settings-page')).not.toHaveClass(/is-sidebar-collapsed/);

  await page.locator('#settings-nav-search').fill('security');
  await expect(page.locator('[data-settings-section="general"]')).toBeHidden();
  await expect(page.locator('[data-settings-section="security"]')).toBeVisible();
  await page.locator('#settings-nav-search').fill('');
  await page.locator('[data-settings-section="appearance"]').click();
  await expect(page.locator('#settings-heading')).toHaveText('Appearance');
  await page.locator('[data-settings-theme="dark"]').click();
  await expect(page.locator('html')).toHaveAttribute('data-bs-theme', 'dark');
  await page.locator('[data-settings-section="keyboard"]').click();
  await expect(page.locator('#settings-heading')).toHaveText('Keyboard Shortcuts');
  await expect(page.locator('.settings-keyboard-card')).toBeVisible();
  await expect(page.locator('#account-shortcuts-overlay')).toBeHidden();
  await expect(page.locator('.settings-keyboard-card .account-shortcut-row')).toHaveCount(5);
  const inlineKey = page.locator('[data-settings-shortcut-key]');
  await inlineKey.click();
  await expect(inlineKey).toHaveText('Press Key sequence');
  await page.keyboard.press('Control+Shift+K');
  await expect(inlineKey).toHaveText('Ctrl + Shift + K');
  await page.locator('[data-settings-shortcut-enabled]').click();
  await expect(page.locator('[data-settings-shortcut-enabled]')).toHaveAttribute('aria-checked', 'false');
  await page.locator('[data-settings-shortcut-restore]').click();
  await expect(inlineKey).toHaveText('Ctrl + Shift + S');
  await expect(page.locator('[data-settings-shortcut-enabled]')).toHaveAttribute('aria-checked', 'true');
  await page.locator('#settings-back-to-app').click();
  await expect(page.locator('#page-dashboard')).toBeVisible();
  await expect(page.locator('#app-shell')).not.toHaveClass(/is-settings-route/);
  await expect(page.locator('#desktop-sidebar')).toBeVisible();
});

test('settings sidebar works as a mobile drawer without overflowing the viewport', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 640 });
  await openAuthenticated(page, '/?view=settings&role=user', 'settings');
  await expect(page.locator('#settings-heading')).toHaveText('General');
  await expect(page.locator('#settings-sidebar')).toHaveAttribute('aria-hidden', 'true');
  await page.locator('#settings-mobile-toggle').click();
  await expect(page.locator('.settings-page')).toHaveClass(/is-mobile-sidebar-open/);
  await expect(page.locator('#settings-sidebar')).not.toHaveAttribute('aria-hidden');
  await expect(page.locator('#settings-sidebar')).toBeInViewport();
  await page.locator('[data-settings-section="notifications"]').click();
  await expect(page.locator('#settings-heading')).toHaveText('Notifications');
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(1);
  await page.locator('#settings-mobile-toggle').click();
  await page.keyboard.press('Escape');
  await expect(page.locator('.settings-page')).not.toHaveClass(/is-mobile-sidebar-open/);
  await expect(page.locator('#settings-sidebar')).toHaveAttribute('aria-hidden', 'true');
});

test('Help is Thai for Thai Auto detect and switches only when English is selected', async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'language', { configurable: true, get: () => 'th-TH' });
  });
  await openAuthenticated(page, '/?view=settings&role=user', 'settings');
  await expect(page.locator('html')).toHaveAttribute('lang', 'th');
  await expect(page.locator('#account-help-trigger [data-language-text]')).toHaveText('ช่วยเหลือ');
  await expect(page.locator('#account-help-menu [data-language-text="helpCenter"]')).toHaveText('ศูนย์ช่วยเหลือ');
  await page.locator('#language-trigger').click();
  await page.locator('[data-language-code="en"]').click();
  await expect(page.locator('#account-help-trigger [data-language-text]')).toHaveText('Help');
  await expect(page.locator('#account-help-menu [data-language-text="helpCenter"]')).toHaveText('Help Center');
  await page.locator('#language-trigger').click();
  await page.locator('[data-language-code="auto"]').click();
  await expect(page.locator('#account-help-trigger [data-language-text]')).toHaveText('ช่วยเหลือ');
});

test('account switch returns to existing Google sign-in and retains user role restrictions', async ({ page }) => {
  await openAuthenticated(page, '/?view=dashboard&role=user', 'dashboard');
  await page.locator('#desktop-sidebar .account-summary').click();
  await expect(page.locator('[data-account-route="admin"]')).toBeHidden();
  await page.locator('#account-menu-header').click();
  await page.locator('[data-account-command="switch"]').click();
  await expect(page.locator('#access-state')).toBeVisible();
  await page.locator('#google-signin-button').click();
  await expect(page.locator('#oauth-handoff-panel')).toBeVisible();
  const methods = await page.evaluate(() => window.__CRS_TEST__.calls.map((call) => call.method));
  expect(methods.filter((method) => method === 'logoutSession')).toHaveLength(1);
  expect(methods.filter((method) => method === 'beginOAuthSignIn')).toHaveLength(2);
});

test('collapsed desktop account popover follows its trigger and mobile keeps the account route', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await openAuthenticated(page, '/?view=dashboard&role=user', 'dashboard');
  await page.locator('#desktop-sidebar-toggle').click();
  await expect(page.locator('#app-shell')).toHaveClass(/is-sidebar-collapsed/);
  const desktopTrigger = page.locator('#desktop-sidebar .account-summary');
  await desktopTrigger.click();
  const desktopTriggerBox = await desktopTrigger.boundingBox();
  const desktopPanelBox = await page.locator('#account-menu-panel').boundingBox();
  expect(Math.abs(desktopPanelBox.x - desktopTriggerBox.x)).toBeLessThanOrEqual(10);
  expect(desktopPanelBox.y + desktopPanelBox.height).toBeLessThanOrEqual(desktopTriggerBox.y);
  await page.locator('#account-menu-header').click();
  await expect(page.locator('#account-identity-menu')).toHaveAttribute('data-side', 'right');
  await page.keyboard.press('Escape');
  await page.keyboard.press('Escape');

  await page.setViewportSize({ width: 360, height: 640 });
  await expect(page.locator('#topbar-account')).toHaveCount(0);
  await expect(page.locator('.account-summary')).toHaveCount(1);
  await page.locator('#mobile-nav [data-route="account"]').click();
  await expect(page.locator('#account-heading')).toBeVisible();
});

test('sidebar header keeps an SVG-ready brand and reveals its toggle on collapsed hover or focus', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await openAuthenticated(page, '/?view=dashboard&role=user', 'dashboard');
  const header = page.locator('#desktop-sidebar .sidebar-header');
  const brand = header.locator('.brand-mark');
  const brandLink = header.locator('.brand-link');
  const toggle = page.locator('#desktop-sidebar-toggle');
  await expect(header.locator('#desktop-sidebar-toggle')).toHaveCount(1);
  await expect(header.locator('[data-app-short-name], [data-app-name]')).toHaveCount(0);
  await expect(page.locator('.app-topbar #desktop-sidebar-toggle')).toHaveCount(0);

  await brand.evaluate((element) => {
    element.innerHTML = '<svg viewBox="0 0 44 44" aria-hidden="true"><circle cx="22" cy="22" r="18"/></svg>';
  });
  const svg = brand.locator('svg');
  await expect(svg).toBeVisible();
  const brandBox = await brand.boundingBox();
  const svgBox = await svg.boundingBox();
  expect(svgBox.width).toBe(brandBox.width);
  expect(svgBox.height).toBe(brandBox.height);

  await toggle.click();
  await expect(page.locator('#app-shell')).toHaveClass(/is-sidebar-collapsed/);
  await expect(brandLink).toHaveCSS('opacity', '1');
  await expect(toggle).toHaveCSS('opacity', '0');
  await expect(brandLink).toHaveAttribute('tabindex', '-1');
  const collapsedBrandBox = await brand.boundingBox();
  await page.mouse.move(collapsedBrandBox.x + collapsedBrandBox.width / 2,
    collapsedBrandBox.y + collapsedBrandBox.height / 2);
  await expect(brandLink).toHaveCSS('opacity', '0');
  await expect(toggle).toHaveCSS('opacity', '1');
  await expect(toggle).toHaveAttribute('title', "Toggle sidebar 'Ctrl + Shift + S'");
  await toggle.click();
  await expect(page.locator('#app-shell')).not.toHaveClass(/is-sidebar-collapsed/);
  await expect(brandLink).toHaveAttribute('tabindex', '0');

  await toggle.click();
  await page.mouse.move(600, 200);
  await expect(brandLink).toHaveCSS('opacity', '1');
  await page.locator('#desktop-nav .sidebar-link').first().focus();
  await page.keyboard.press('Shift+Tab');
  await expect(toggle).toBeFocused();
  await expect(toggle).toHaveCSS('opacity', '1');
});

test('account submenu flips left near the viewport edge and trigger supports Space', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await openAuthenticated(page, '/?view=dashboard&role=user', 'dashboard');
  const trigger = page.locator('#desktop-sidebar .account-summary');
  await trigger.evaluate((element) => {
    element.style.position = 'fixed';
    element.style.left = '1060px';
    element.style.top = '700px';
    element.style.width = '200px';
    element.style.zIndex = '1200';
  });
  await trigger.focus();
  await page.keyboard.press('Space');
  await expect(page.locator('#account-menu-panel')).toBeVisible();
  await page.locator('#account-menu-header').press('ArrowRight');
  await expect(page.locator('#account-identity-menu')).toHaveAttribute('data-side', 'left');
  const mainBox = await page.locator('#account-menu-panel').boundingBox();
  const submenuBox = await page.locator('#account-identity-menu').boundingBox();
  expect(submenuBox.x + submenuBox.width).toBeLessThan(mainBox.x);
});

test('help links remain disabled until configured, then open safely in a new tab', async ({ page }) => {
  await page.addInitScript(() => {
    window.CRS_HELP_LINKS = { helpCenter: 'https://example.org/help', terms: 'javascript:alert(1)' };
  });
  await openAuthenticated(page, '/?view=dashboard&role=user', 'dashboard');
  await page.locator('#desktop-sidebar .account-summary').click();
  await page.locator('#account-help-trigger').click();
  await expect(page.locator('[data-help-link="helpCenter"]')).toHaveAttribute('href', 'https://example.org/help');
  await expect(page.locator('[data-help-link="helpCenter"]')).toHaveAttribute('target', '_blank');
  await expect(page.locator('[data-help-link="helpCenter"]')).toHaveAttribute('rel', 'noopener noreferrer');
  await expect(page.locator('[data-help-link="terms"]')).toHaveAttribute('aria-disabled', 'true');
  await expect(page.locator('[data-help-link="terms"]')).not.toHaveAttribute('href');
  await expect(page.locator('[data-help-link="releaseNotes"]')).toHaveAttribute('aria-disabled', 'true');
});

test('account menu text and states meet AA contrast in light and dark themes', async ({ page }) => {
  await openAuthenticated(page, '/?view=dashboard&role=user', 'dashboard');
  await page.locator('#desktop-sidebar .account-summary').click();
  for (const theme of ['light', 'dark']) {
    await page.evaluate((value) => { document.documentElement.dataset.bsTheme = value; }, theme);
    const ratios = await page.evaluate(() => {
      function luminance(rgb) {
        const channels = rgb.match(/[\d.]+/g).slice(0, 3).map((value) => {
          const channel = Number(value) / 255;
          return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
        });
        return channels[0] * 0.2126 + channels[1] * 0.7152 + channels[2] * 0.0722;
      }
      function contrast(first, second) {
        const values = [luminance(first), luminance(second)].sort((a, b) => b - a);
        return (values[0] + 0.05) / (values[1] + 0.05);
      }
      const panel = document.getElementById('account-menu-panel');
      const item = panel.querySelector('[data-account-route="account"]');
      const secondary = panel.querySelector('[data-session-role]');
      const utility = panel.querySelector('[data-account-command="logout"]');
      const background = getComputedStyle(panel).backgroundColor;
      return [item, secondary, utility].map((element) => contrast(getComputedStyle(element).color, background));
    });
    for (const ratio of ratios) expect(ratio).toBeGreaterThanOrEqual(4.5);
  }
});

test('shortcut key buttons capture input, rebind only the app action, and keep the dialog aligned', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await openAuthenticated(page, '/?view=dashboard&role=user', 'dashboard');
  await page.locator('#desktop-sidebar .account-summary').click();
  await page.locator('#account-help-trigger').click();
  await page.locator('[data-account-command="shortcuts"]').click();

  const dialog = page.locator('.account-shortcuts-dialog');
  const titleBox = await page.locator('#account-shortcuts-title').boundingBox();
  const dialogBox = await dialog.boundingBox();
  const restoreBox = await page.locator('[data-account-shortcuts-restore]').boundingBox();
  expect(Math.abs(titleBox.x + titleBox.width / 2 - (dialogBox.x + dialogBox.width / 2))).toBeLessThan(1);
  expect(restoreBox.x + restoreBox.width).toBeGreaterThan(dialogBox.x + dialogBox.width - 35);
  await expect(dialog.locator('kbd')).toHaveCount(0);
  await expect(dialog.locator('[data-shortcut-key]')).toHaveCount(5);

  const fixedKey = page.locator('[data-shortcut-key="tab"]');
  await expect(fixedKey).toHaveText('Tab');
  for (const key of ['tab', 'shift-tab', 'enter', 'escape']) {
    await expect(page.locator(`[data-shortcut-key="${key}"]`)).toBeDisabled();
  }
  await expect(page.locator('#account-shortcut-status')).not.toContainText('Press Key sequence');

  const appKey = page.locator('[data-shortcut-key="sidebar"]');
  await appKey.click();
  await expect(appKey).toHaveText('Press Key sequence');
  await page.keyboard.press('Control+Shift+K');
  await expect(appKey).toHaveText('Ctrl + Shift + K');
  await expect(page.locator('#desktop-sidebar-toggle')).toHaveAttribute('title', "Toggle sidebar 'Ctrl + Shift + K'");
  await page.keyboard.press('Escape');
  await expect(page.locator('#account-shortcuts-overlay')).toBeHidden();
  await page.keyboard.press('Control+Shift+S');
  await expect(page.locator('#app-shell')).not.toHaveClass(/is-sidebar-collapsed/);
  await page.keyboard.press('Control+Shift+K');
  await expect(page.locator('#app-shell')).toHaveClass(/is-sidebar-collapsed/);

  await page.locator('[data-account-command="shortcuts"]').click();
  await expect(appKey).toHaveText('Ctrl + Shift + K');
  await page.locator('[data-account-shortcuts-restore]').click();
  await expect(appKey).toHaveText('Ctrl + Shift + S');
  await expect(page.locator('#sidebar-shortcut-enabled')).toHaveAttribute('aria-checked', 'true');
  await page.keyboard.press('Escape');
  await page.keyboard.press('Control+Shift+S');
  await expect(page.locator('#app-shell')).not.toHaveClass(/is-sidebar-collapsed/);
});

test('keyboard shortcuts dialog traps focus, closes accessibly, and restores sidebar shortcut', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await openAuthenticated(page, '/?view=dashboard&role=user', 'dashboard');
  await page.locator('#desktop-sidebar .account-summary').click();
  await page.locator('#account-help-trigger').click();
  const shortcutItem = page.locator('[data-account-command="shortcuts"]');
  await shortcutItem.click();
  const overlay = page.locator('#account-shortcuts-overlay');
  await expect(overlay).toBeVisible();
  await expect(page.locator('#account-shortcuts-title')).toBeVisible();
  await expect(page.locator('[data-account-shortcuts-close]')).toBeFocused();
  await expect(page.locator('body')).toHaveCSS('overflow', 'hidden');
  await page.keyboard.press('Shift+Tab');
  await expect(page.locator('[data-account-shortcuts-restore]')).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(page.locator('[data-account-shortcuts-close]')).toBeFocused();
  await page.locator('#sidebar-shortcut-enabled').click();
  await expect(page.locator('#sidebar-shortcut-enabled')).toHaveAttribute('role', 'switch');
  await expect(page.locator('#sidebar-shortcut-enabled')).toHaveAttribute('aria-checked', 'false');
  await page.keyboard.press('Escape');
  await expect(overlay).toBeHidden();
  await page.keyboard.press('Control+Shift+S');
  await expect(page.locator('#app-shell')).not.toHaveClass(/is-sidebar-collapsed/);
  await shortcutItem.click();
  await page.locator('[data-account-shortcuts-restore]').click();
  await expect(page.locator('#sidebar-shortcut-enabled')).toHaveAttribute('aria-checked', 'true');
  await page.keyboard.press('Escape');
  await expect(overlay).toBeHidden();
  await expect(shortcutItem).toBeFocused();
  await expect(page.locator('body')).not.toHaveCSS('overflow', 'hidden');

  await shortcutItem.click();
  await page.mouse.click(2, 2);
  await expect(overlay).toBeHidden();
  await page.keyboard.press('Escape');
  await page.keyboard.press('Escape');
  await page.locator('#desktop-sidebar .account-summary').click();
  await page.locator('#account-help-trigger').click();
  await page.locator('[data-account-command="shortcuts"]').click();
  await page.setViewportSize({ width: 360, height: 320 });
  const bounds = await page.locator('.account-shortcuts-dialog').boundingBox();
  expect(bounds.x).toBeGreaterThanOrEqual(0);
  expect(bounds.x + bounds.width).toBeLessThanOrEqual(360);
  expect(bounds.y).toBeGreaterThanOrEqual(0);
  expect(bounds.y + bounds.height).toBeLessThanOrEqual(320);
  const body = page.locator('.account-shortcuts-body');
  const scrollState = await body.evaluate((element) => {
    const before = element.scrollTop;
    element.scrollTop = element.scrollHeight;
    return { before, after: element.scrollTop, scrollHeight: element.scrollHeight, clientHeight: element.clientHeight };
  });
  expect(scrollState.scrollHeight).toBeGreaterThan(scrollState.clientHeight);
  expect(scrollState.after).toBeGreaterThan(scrollState.before);
  await expect(page.locator('[data-account-shortcuts-restore]')).toBeInViewport();
  await page.setViewportSize({ width: 320, height: 320 });
  await page.locator('[data-shortcut-key="sidebar"]').click();
  await expect(page.locator('[data-shortcut-key="sidebar"]')).toHaveText('Press Key sequence');
  const horizontalOverflow = await body.evaluate((element) => element.scrollWidth - element.clientWidth);
  expect(horizontalOverflow).toBeLessThanOrEqual(1);
});
