const { test, expect } = require('@playwright/test');

async function openAdmin(page) {
  await page.goto('/?view=admin&role=admin&imageIntegrity=issues');
  await expect(page.locator('#google-signin-button')).toBeVisible();
  await page.locator('#google-signin-button').click();
  await expect(page.locator('#oauth-handoff-panel')).toBeVisible();
  await page.locator('[data-otp-digit]').first().evaluate((input) => {
    const transfer = new DataTransfer();
    transfer.setData('text/plain', '123456');
    input.dispatchEvent(new ClipboardEvent('paste', {
      bubbles: true, cancelable: true, clipboardData: transfer
    }));
  });
  await page.locator('#oauth-handoff-submit').click();
  await expect(page.locator('#page-admin')).toBeVisible();
  await page.locator('#admin-system-tab').click();
  await expect(page.locator('#admin-system')).toBeVisible();
}

async function repairCalls(page) {
  return page.evaluate(() => window.__CRS_TEST__.calls.filter((call) =>
    call.method === 'adminRepairImageIntegrity'));
}

test('image integrity preview lists missing, orphan, and STARTED issues; repair waits for confirmation', async ({ page }) => {
  await openAdmin(page);
  await page.locator('#admin-preview-image-integrity').click();
  const result = page.locator('#admin-image-integrity-result');
  await expect(result).toBeVisible();
  await expect(result.locator('tbody tr')).toHaveCount(3);
  await expect(result).toContainText('ไฟล์หายหรือเข้าถึงไม่ได้');
  await expect(result).toContainText('ไฟล์กำพร้าในโฟลเดอร์ภาพ');
  await expect(result).toContainText('การอัปโหลดค้างอยู่');
  await expect(repairCalls(page)).resolves.toHaveLength(0);

  const orphanRepair = result.locator('[data-action="repair-image-integrity"][data-kind="ORPHAN_FILE"]');
  await orphanRepair.click();
  const confirm = page.locator('#confirm-modal');
  await expect(confirm).toBeVisible();
  await expect(repairCalls(page)).resolves.toHaveLength(0);
  await confirm.locator('[data-confirm-cancel]').click();
  await expect(confirm).toBeHidden();
  await expect(repairCalls(page)).resolves.toHaveLength(0);

  await orphanRepair.click();
  await expect(confirm).toBeVisible();
  await confirm.locator('[data-confirm-accept]').click();
  await expect.poll(async () => (await repairCalls(page)).length).toBe(1);
  const orphanCall = (await repairCalls(page))[0];
  expect(orphanCall.args[0]).toEqual({
    kind: 'ORPHAN_FILE', confirm: true, file_id: 'orphan-image-001'
  });
  await expect(result.locator('tbody tr')).toHaveCount(2);
  await expect(result.locator('[data-kind="ORPHAN_FILE"]')).toHaveCount(0);

  await result.locator('[data-action="repair-image-integrity"][data-kind="STARTED_UPLOAD"]').click();
  await expect(confirm).toBeVisible();
  await expect(repairCalls(page)).resolves.toHaveLength(1);
  await confirm.locator('[data-confirm-accept]').click();
  await expect.poll(async () => (await repairCalls(page)).length).toBe(2);
  const startedCall = (await repairCalls(page))[1];
  expect(startedCall.args[0]).toEqual({
    kind: 'STARTED_UPLOAD', confirm: true, operation_id: 'image-started-op-001'
  });
  await expect(result.locator('tbody tr')).toHaveCount(1);
  await expect(result.locator('[data-action="open-admin-asset"][data-asset-id="AST-000001"]'))
    .toBeVisible();
});
