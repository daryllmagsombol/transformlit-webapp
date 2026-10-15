import { test, expect, Page } from '@playwright/test';

const ADMIN_EMAIL = 'admin@transformlit.com';
const ADMIN_PASSWORD = 'Transformlit123!';

async function login(page: Page, email: string, password: string) {
  await page.goto('/login');
  await page.getByLabel('Email Address').fill(email);
  await page.getByLabel('Password', { exact: true }).fill(password);
  await page.getByRole('button', { name: /log in/i }).click();
  await expect(page).toHaveURL(/.*\/feed/);
}

test.describe('Admin console role gate', () => {
  test('a newly registered MEMBER cannot reach /admin and is redirected to /feed', async ({
    page,
  }) => {
    const uniqueEmail = `member-${Date.now()}@example.com`;

    await page.goto('/register');
    await page.getByLabel('Full Name').fill('E2E Member User');
    await page.getByLabel('Email Address').fill(uniqueEmail);
    await page.getByLabel('Password', { exact: true }).fill('password123');
    await page.getByRole('button', { name: /sign up/i }).click();
    await expect(page).toHaveURL(/.*\/feed/);

    // A freshly registered user is a MEMBER; the admin route-group layout
    // (`useRequireRole(ADMIN, MODERATOR)`) must bounce them back to /feed.
    await page.goto('/admin');
    await expect(page).toHaveURL(/.*\/feed/);
    await expect(page.getByRole('heading', { name: 'Admin Console' })).toHaveCount(0);
  });

  test('an ADMIN can reach /admin and sees the console heading', async ({ page }) => {
    await login(page, ADMIN_EMAIL, ADMIN_PASSWORD);

    await page.goto('/admin');
    await expect(page).toHaveURL(/.*\/admin/);
    await expect(page.getByRole('heading', { name: 'Admin Console' })).toBeVisible();
  });
});
