import type { Page } from '@playwright/test';

export async function mockCoreApis(page: Page) {
  await page.route('**/api/v1/questions**', async (route) => {
    await route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify({ page: 1, page_size: 30, total: 0, records: [] }),
    });
  });

  await page.route('**/api/v1/market/precious-metals**', async (route) => {
    await route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify({ updatedAt: '', records: [] }),
    });
  });

  await page.route('**/api/v1/market/ai-tech**', async (route) => {
    await route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify({ updatedAt: '', records: [] }),
    });
  });

  await page.route('**/api/v1/ai-dailies**', async (route) => {
    await route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify({ updatedAt: '', offset: 0, limit: 16, total: 0, hasMore: false, records: [] }),
    });
  });

  await page.route('**/api/v1/analysis/**', async (route) => {
    await route.fulfill({
      status: 422,
      contentType: 'application/json',
      body: JSON.stringify({ message: 'insufficient test data', code: 'INSUFFICIENT_TEST_DATA' }),
    });
  });

  await page.route('**/api/v1/agent/prompt', async (route) => {
    await route.fulfill({
      status: 500,
      contentType: 'application/json',
      body: JSON.stringify({ message: 'agent disabled in e2e mock' }),
    });
  });
}

export async function setSession(page: Page, isAdmin: boolean) {
  await page.addInitScript((admin) => {
    window.localStorage.setItem(
      'front_session',
      JSON.stringify({
        token: 'e2e-token',
        expiresAt: '2099-01-01T00:00:00Z',
        user: {
          id: admin ? 1 : 2,
          username: admin ? '13800138000' : '13900139000',
          nickname: admin ? '管理员' : '普通用户',
          age: 0,
          hobby: '',
          sign: '',
          avatar_path: '/public/images/userImgDefault.png',
          created_at: '2026-01-01T00:00:00Z',
          is_admin: admin,
        },
      }),
    );
  }, isAdmin);
}
