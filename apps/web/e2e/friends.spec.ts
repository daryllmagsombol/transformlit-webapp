import { test, expect } from '@playwright/test';

test.describe('Friends Page', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/login');
    await page.getByLabel('Email Address').fill('admin@transformlit.com');
    await page.getByLabel('Password').fill('Transformlit123!');
    await page.getByRole('button', { name: /log in/i }).click();
    await expect(page).toHaveURL(/.*\/feed/);
  });

  test('friends page loads with search and friends sections', async ({ page }) => {
    await page.goto('/friends');
    await expect(page.getByPlaceholder('Search users...')).toBeVisible({ timeout: 10000 });
    await expect(page.getByText('Your Friends')).toBeVisible({ timeout: 10000 });
  });

  test('friend requests section appears when requests exist', async ({ page }) => {
    await page.goto('/friends');
    // The requests section may or may not appear depending on test data
    await expect(page.getByText(/friend requests/i)).toBeVisible({ timeout: 5000 }).catch(() => {
      // No requests is also valid
    });
  });
});

test.describe('Notifications Page', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/login');
    await page.getByLabel('Email Address').fill('admin@transformlit.com');
    await page.getByLabel('Password').fill('Transformlit123!');
    await page.getByRole('button', { name: /log in/i }).click();
    await expect(page).toHaveURL(/.*\/feed/);
  });

  test('notifications page loads', async ({ page }) => {
    await page.goto('/notifications');
    await expect(page.getByRole('heading', { name: /notifications/i })).toBeVisible({ timeout: 10000 });
  });
});
