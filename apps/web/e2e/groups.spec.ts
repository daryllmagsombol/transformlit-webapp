import { test, expect } from '@playwright/test';

test.describe('Groups', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/login');
    await page.getByLabel('Email Address').fill('admin@transformlit.com');
    await page.getByLabel('Password', { exact: true }).fill('Transformlit123!');
    await page.getByRole('button', { name: /log in/i }).click();
    await expect(page).toHaveURL(/.*\/feed/);
  });

  test('browse groups page', async ({ page }) => {
    await page.goto('/groups');
    await expect(page.getByRole('heading', { name: /your reading circles/i })).toBeVisible();
    await expect(page.getByRole('heading', { name: /active groups/i })).toBeVisible();
    await expect(page.getByRole('heading', { name: /discover groups/i })).toBeVisible();
  });

  test('view group cards on groups page', async ({ page }) => {
    await page.goto('/groups');
    const openCircleButtons = page.getByRole('button', { name: /open circle/i });
    await expect(openCircleButtons.first()).toBeVisible({ timeout: 10000 });
  });
});
