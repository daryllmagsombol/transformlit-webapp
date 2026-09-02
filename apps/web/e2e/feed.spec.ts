import { test, expect } from '@playwright/test';

test.describe('Feed', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/login');
    await page.getByLabel('Email Address').fill('admin@transformlit.com');
    await page.getByLabel('Password', { exact: true }).fill('Transformlit123!');
    await page.getByRole('button', { name: /log in/i }).click();
    await expect(page).toHaveURL(/.*\/feed/);
  });

  test('feed page loads with announcements', async ({ page }) => {
    await page.goto('/feed');
    await expect(page.getByRole('heading', { name: /announcements/i })).toBeVisible({ timeout: 10000 });
    await expect(page.getByText('Welcome to Transformlit!')).toBeVisible({ timeout: 10000 });
  });

  test('verse of the day displays', async ({ page }) => {
    await page.goto('/feed');
    await expect(page.getByText(/verse of the day/i)).toBeVisible({ timeout: 15000 });
  });
});
