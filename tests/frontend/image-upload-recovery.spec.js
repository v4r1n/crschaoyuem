const { test, expect } = require('@playwright/test');

test('a safely aborted image command is not reused by the next upload attempt', async ({ page }) => {
  await page.goto('/?view=equipment&role=admin');
  await page.waitForFunction(() => typeof window.CRS?.runMutation === 'function');
  const result = await page.evaluate(async () => {
    const originalApi = window.CRS.api;
    const commands = [];
    window.CRS.api = {
      ...originalApi,
      failedImageUpload: async (payload) => {
        commands.push(payload.command_id);
        throw new window.CRS.ClientApiError({
          code: 'DRIVE_SHARING_FAILED',
          message: 'Image sharing was rejected',
          retryable: false
        });
      }
    };
    try {
      for (let attempt = 0; attempt < 2; attempt += 1) {
        try {
          await window.CRS.runMutation('equipment:image:test:1', 'failedImageUpload', {
            asset_id: 'AST-000001', expected_version: 1
          });
        } catch (error) {
          if (error.code !== 'DRIVE_SHARING_FAILED') throw error;
        }
      }
      return commands;
    } finally {
      window.CRS.api = originalApi;
    }
  });
  expect(result).toHaveLength(2);
  expect(result[1]).not.toBe(result[0]);
});
