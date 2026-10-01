const { test, expect } = require('@playwright/test');

async function openAuthenticated(page, url) {
  await page.goto(url);
  await page.locator('#google-signin-button').click();
  await expect(page.locator('#oauth-handoff-panel')).toBeVisible();
  const digits = page.locator('[data-otp-digit]');
  for (let i = 0; i < 6; i++) await digits.nth(i).fill(String(i + 1));
  await page.locator('#oauth-handoff-submit').click();
  await expect(page.locator('#app-shell')).toBeVisible();
}

async function pendingUpload(page, late = false) {
  await openAuthenticated(page, '/?view=equipment-detail&id=AST-000001&role=admin');
  await expect(page.locator('#equipment-detail-content')).toBeVisible();
  await page.evaluate((late) => {
    const api = { ...window.CRS.api };
    window.CRS.api = api;
    const detail = api.getEquipmentDetail;
    let pending = !late;
    window.__equipmentCalls = [];
    api.getEquipmentDetail = async (id) => ({ ...await detail(id), pending_operation: pending ? {
      operation_id: 'old-image-upload-001', action: 'UPLOAD_ASSET_IMAGE', can_abort: true
    } : null });
    api.adminAbortOperation = async (input) => {
      window.__equipmentCalls.push({ action: 'abort', input });
      pending = false;
      return { status: 'ABORTED' };
    };
    for (const method of ['adminUploadEquipmentImage', 'adminUpdateEquipment']) {
      api[method] = async (input) => {
        window.__equipmentCalls.push({ action: method, input });
        if (late && window.__equipmentCalls.length === 1) {
          pending = true;
          throw new window.CRS.ClientApiError({ code: 'OPERATION_PENDING', message: 'มีงานค้าง', retryable: true });
        }
        if (pending) throw new Error('Upload must be cancelled first');
        return { ...await detail(input.asset_id), ...input };
      };
    }
  }, late);
}

test('pending image upload can be cancelled from its form, preserving the selected replacement', async ({ page }) => {
  await pendingUpload(page);
  await page.locator('[data-action="upload-image"]').click();
  const form = page.locator('#equipment-image-form');
  await expect(form.locator('[data-pending-operation]')).toBeVisible();
  await expect(form.locator('[data-submit]')).toBeDisabled();
  await form.locator('#equipment-image-file').setInputFiles({ name: 'new.gif', mimeType: 'image/gif',
    buffer: Buffer.from('R0lGODlhAQABAAD/ACwAAAAAAQABAAACAUwAOw==', 'base64') });
  await expect(form.locator('[data-cancel-pending-upload]')).toBeDisabled();
  expect(await page.evaluate(() => window.__equipmentCalls)).toHaveLength(0);
  await form.locator('[data-confirm-abort]').check();
  await form.locator('[data-cancel-pending-upload]').click();
  await expect(form.locator('[data-pending-operation]')).toHaveCount(0);
  await expect(form.locator('[data-submit]')).toBeEnabled();
  await form.locator('[data-submit]').click();
  await expect(page.locator('#equipment-image-modal')).toBeHidden();
  const calls = await page.evaluate(() => window.__equipmentCalls);
  expect(calls.map(x => x.action)).toEqual(['abort', 'adminUploadEquipmentImage']);
  expect(calls[0].input.operation_id).toBe('old-image-upload-001');
});

test('an edit blocked by an older upload keeps unsaved input through cancellation and retry', async ({ page }) => {
  await pendingUpload(page, true);
  await page.locator('[data-action="edit-equipment"]').click();
  const form = page.locator('#equipment-editor-form');
  await form.locator('[name="name"]').fill('ชื่ออุปกรณ์ที่แก้ไข');
  await form.locator('[data-submit]').click();
  await expect(form.locator('[data-pending-operation]')).toBeVisible();
  await form.locator('[data-confirm-abort]').check();
  await form.locator('[data-cancel-pending-upload]').click();
  await expect(form.locator('[name="name"]')).toHaveValue('ชื่ออุปกรณ์ที่แก้ไข');
  await form.locator('[data-submit]').click();
  await expect(page.locator('#equipment-editor-modal')).toBeHidden();
  const calls = await page.evaluate(() => window.__equipmentCalls);
  expect(calls.map(x => x.action)).toEqual(['adminUpdateEquipment', 'abort', 'adminUpdateEquipment']);
  expect(calls[2].input.name).toBe('ชื่ออุปกรณ์ที่แก้ไข');
});

test('delete requires the exact asset ID and cancellation makes no mutation', async ({ page }) => {
  await openAuthenticated(page, '/?view=equipment-detail&id=AST-000001&role=admin');
  await expect(page.locator('#equipment-detail-content')).toBeVisible();
  await page.evaluate(() => {
    window.__deleteCalls = [];
    window.CRS.api = { ...window.CRS.api, adminDeleteEquipment: async (input) => {
      window.__deleteCalls.push(input);
      return { asset_id: input.asset_id, status: 'DELETED' };
    } };
  });
  await page.locator('[data-action="delete-equipment"]').click();
  const form = page.locator('#equipment-delete-form');
  await expect(form.locator('[data-submit]')).toBeDisabled();
  await form.locator('[name="confirm_asset_id"]').fill('AST-999999');
  await expect(form.locator('[data-submit]')).toBeDisabled();
  await form.getByRole('button', { name: 'ยกเลิก', exact: true }).click();
  expect(await page.evaluate(() => window.__deleteCalls)).toHaveLength(0);
  await page.locator('[data-action="delete-equipment"]').click();
  await form.locator('[name="confirm_asset_id"]').fill('AST-000001');
  const expectedVersion = Number(await form.locator('[name="expected_version"]').inputValue());
  await form.locator('[data-submit]').click();
  await expect(page.locator('#page-equipment')).toBeVisible();
  const calls = await page.evaluate(() => window.__deleteCalls);
  expect(calls).toHaveLength(1);
  expect(calls[0]).toMatchObject({ asset_id: 'AST-000001', confirm_asset_id: 'AST-000001', confirm: true, expected_version: expectedVersion });
});

test('ordinary users have no delete controls', async ({ page }) => {
  await openAuthenticated(page, '/?view=equipment&role=user');
  await expect(page.locator('#equipment-results')).toBeVisible();
  await expect(page.locator('[data-action="delete-equipment"]:visible')).toHaveCount(0);
});
