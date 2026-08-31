import { test, expect } from '@playwright/test';

test('bible library → chapter → study sheet', async ({ page }) => {
  // inline login (same as e2e/auth.spec.ts)
  await page.goto('/login');
  await page.getByLabel('Email Address').fill('admin@transformlit.com');
  await page.getByLabel('Password', { exact: true }).fill('Transformlit123!');
  await page.getByRole('button', { name: /log in/i }).click();
  await expect(page).toHaveURL(/.*\/feed/);

  await page.goto('/bible');
  await expect(page.getByRole('heading', { name: 'Bible' })).toBeVisible();
  await page.getByRole('link', { name: /Genesis/ }).first().click();
  await expect(page.getByText('The Creation')).toBeVisible();
  await page.getByLabel('Verse 1', { exact: true }).click();
  await expect(page.getByRole('dialog')).toContainText('Genesis 1:1');
});
