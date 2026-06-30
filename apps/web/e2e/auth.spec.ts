import { test, expect } from '@playwright/test';

test.describe('Authentication', () => {
  test('register new user and redirect to feed', async ({ page }) => {
    const uniqueEmail = `test-${Date.now()}@example.com`;

    await page.goto('/register');
    await page.getByLabel('Full Name').fill('E2E Test User');
    await page.getByLabel('Email Address').fill(uniqueEmail);
    await page.getByLabel('Password').fill('password123');
    await page.getByRole('button', { name: /sign up/i }).click();

    await expect(page).toHaveURL(/.*\/feed/);
  });

  test('login with existing user and redirect to feed', async ({ page }) => {
    await page.goto('/login');
    await page.getByLabel('Email Address').fill('admin@transformlit.com');
    await page.getByLabel('Password').fill('Transformlit123!');
    await page.getByRole('button', { name: /log in/i }).click();

    await expect(page).toHaveURL(/.*\/feed/);
  });

  test('login with invalid credentials shows error', async ({ page }) => {
    await page.goto('/login');
    await page.getByLabel('Email Address').fill('nonexistent@example.com');
    await page.getByLabel('Password').fill('wrongpassword');
    await page.getByRole('button', { name: /log in/i }).click();

    await expect(page.getByText(/invalid|error|credentials/i)).toBeVisible();
  });

  test('logout redirects to login', async ({ page }) => {
    await page.goto('/login');
    await page.getByLabel('Email Address').fill('admin@transformlit.com');
    await page.getByLabel('Password').fill('Transformlit123!');
    await page.getByRole('button', { name: /log in/i }).click();
    await expect(page).toHaveURL(/.*\/feed/);

    await page.evaluate(() => localStorage.clear());
    await page.goto('/feed');

    await expect(page).toHaveURL(/.*\/login/);
  });
});
