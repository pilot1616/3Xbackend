import { expect, test } from '@playwright/test';

import { mockCoreApis } from './helpers';

test.beforeEach(async ({ page }) => {
  await mockCoreApis(page);
});

test('public market and daily pages do not expose sync controls', async ({ page }) => {
  await page.goto('/market');
  await expect(page.getByText('立即同步')).toHaveCount(0);
  await expect(page.getByText('补历史')).toHaveCount(0);
  await expect(page.getByText('后台定时更新')).toBeVisible();

  await page.goto('/ai-daily');
  await expect(page.getByText('立即同步')).toHaveCount(0);
  await expect(page.getByText('补拉归档')).toHaveCount(0);
  await expect(page.getByText('后台定时更新')).toBeVisible();
});
