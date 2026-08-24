import { expect, test } from '@playwright/test';

import { mockCoreApis, setSession } from './helpers';

test('anonymous users must log in before admin sync', async ({ page }) => {
  await mockCoreApis(page);
  await page.goto('/admin/sync');
  await expect(page.getByText('请先登录')).toBeVisible();
});

test('regular users cannot access admin sync', async ({ page }) => {
  await setSession(page, false);
  await mockCoreApis(page);
  await page.goto('/admin/sync');
  await expect(page.getByText('没有管理员权限')).toBeVisible();
});

test('admins can see sync console actions', async ({ page }) => {
  await setSession(page, true);
  await mockCoreApis(page);
  await page.goto('/admin/sync');
  await expect(page.getByText('后台同步控制台')).toBeVisible();
  await expect(page.getByText('同步完整历史')).toBeVisible();
  await expect(page.getByText('同步最新贵金属')).toBeVisible();
});
