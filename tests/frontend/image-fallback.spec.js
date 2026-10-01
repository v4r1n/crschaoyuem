const { test, expect } = require('@playwright/test');

async function openAuthenticated(page, url) {
  await page.goto(url);
  await expect(page.locator('#google-signin-button')).toBeVisible();
  await page.locator('#google-signin-button').click();
  await expect(page.locator('#oauth-handoff-panel')).toBeVisible();
  await page.locator('[data-otp-digit]').first().evaluate((input) => {
    const transfer = new DataTransfer();
    transfer.setData('text/plain', '123456');
    input.dispatchEvent(new ClipboardEvent('paste', {
      bubbles: true,
      cancelable: true,
      clipboardData: transfer
    }));
  });
  await page.locator('#oauth-handoff-submit').click();
  await expect(page.locator('#app-shell')).toBeVisible();
}

async function navigate(page, view) {
  await page.evaluate((route) => window.CRS.navigate(route, { id: 'AST-000001' }), view);
}

test('imageAvailable=false hides a stale thumbnail URL in catalog, detail, and borrow', async ({ page }) => {
  await openAuthenticated(page, '/?view=equipment&role=admin&image=unavailable');
  await expect(page.locator('#equipment-card-list')).toBeVisible();
  await expect(page.locator('#equipment-card-list img[data-equipment-image]')).toHaveCount(0);
  await expect(page.locator('#equipment-card-list [data-equipment-image-fallback]').first()).toBeVisible();
  await page.locator('[data-action="set-equipment-view"][data-view-mode="table"]').click();
  await expect(page.locator('#table-body-equipment img[data-equipment-image]')).toHaveCount(0);
  await expect(page.locator('#table-body-equipment [data-equipment-image-fallback]').first()).toBeVisible();

  await navigate(page, 'equipment-detail');
  await expect(page.locator('#equipment-detail-content')).toBeVisible();
  await expect(page.locator('#equipment-detail-image')).toBeHidden();
  await expect(page.locator('#equipment-detail-image')).not.toHaveAttribute('src');
  await expect(page.locator('#equipment-detail-image-fallback')).toBeVisible();

  await navigate(page, 'borrow');
  await expect(page.locator('#borrow-page-content')).toBeVisible();
  await expect(page.locator('#borrow-equipment-image')).toBeHidden();
  await expect(page.locator('#borrow-equipment-image')).not.toHaveAttribute('src');
  await expect(page.locator('#borrow-equipment-image-fallback')).toBeVisible();
});

test('failed thumbnail requests fall back in catalog, detail, and borrow', async ({ page }) => {
  await page.route('https://drive.google.com/thumbnail**', (route) =>
    route.fulfill({ status: 404, contentType: 'text/plain', body: 'Missing image' }));
  await openAuthenticated(page, '/?view=equipment&role=admin&image=broken');
  const card = page.locator('#equipment-card-list article').first();
  await expect(card.locator('[data-equipment-image-fallback]')).toBeVisible();
  await expect(card.locator('img[data-equipment-image]')).toBeHidden();
  await page.locator('[data-action="set-equipment-view"][data-view-mode="table"]').click();
  const row = page.locator('#table-body-equipment tr').first();
  await expect(row.locator('[data-equipment-image-fallback]')).toBeVisible();
  await expect(row.locator('img[data-equipment-image]')).toBeHidden();

  await navigate(page, 'equipment-detail');
  await expect(page.locator('#equipment-detail-content')).toBeVisible();
  await expect(page.locator('#equipment-detail-image-fallback')).toBeVisible();
  await expect(page.locator('#equipment-detail-image')).toBeHidden();

  await navigate(page, 'borrow');
  await expect(page.locator('#borrow-page-content')).toBeVisible();
  await expect(page.locator('#borrow-equipment-image-fallback')).toBeVisible();
  await expect(page.locator('#borrow-equipment-image')).toBeHidden();
});

test('available thumbnails replace placeholders in catalog, detail, and borrow', async ({ page }) => {
  await page.route('https://drive.google.com/thumbnail**', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'image/svg+xml',
      body: '<svg xmlns="http://www.w3.org/2000/svg" width="2" height="2"><rect width="2" height="2"/></svg>'
    }));
  await openAuthenticated(page, '/?view=equipment&role=admin&image=available');
  const card = page.locator('#equipment-card-list article').first();
  await expect(card.locator('img[data-equipment-image]')).toBeVisible();
  await expect(card.locator('[data-equipment-image-fallback]')).toBeHidden();
  await page.locator('[data-action="set-equipment-view"][data-view-mode="table"]').click();
  const row = page.locator('#table-body-equipment tr').first();
  await expect(row.locator('img[data-equipment-image]')).toBeVisible();
  await expect(row.locator('[data-equipment-image-fallback]')).toBeHidden();

  await navigate(page, 'equipment-detail');
  await expect(page.locator('#equipment-detail-content')).toBeVisible();
  await expect(page.locator('#equipment-detail-image')).toBeVisible();
  await expect(page.locator('#equipment-detail-image-fallback')).toBeHidden();

  await navigate(page, 'borrow');
  await expect(page.locator('#borrow-page-content')).toBeVisible();
  await expect(page.locator('#borrow-equipment-image')).toBeVisible();
  await expect(page.locator('#borrow-equipment-image-fallback')).toBeHidden();
});
