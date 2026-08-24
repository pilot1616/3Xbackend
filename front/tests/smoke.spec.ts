import { expect, test } from '@playwright/test';

import { mockCoreApis } from './helpers';

test.beforeEach(async ({ page }) => {
  await mockCoreApis(page);
});

for (const path of ['/', '/market', '/ai-daily', '/analysis', '/ai-chat', '/auth']) {
  test(`renders ${path}`, async ({ page }) => {
    await page.goto(path);
    await expect(page.locator('body')).toBeVisible();
    await expect(page.locator('#root')).not.toBeEmpty();
  });
}
