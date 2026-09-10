import { test, expect } from '@playwright/test';

test('open a book, turn pages, jump via URL', async ({ page }) => {
  await page.goto('/login');
  await page.getByLabel('Email Address').fill('admin@transformlit.com');
  await page.getByLabel('Password', { exact: true }).fill('Transformlit123!');
  await page.getByRole('button', { name: /log in/i }).click();
  await expect(page).toHaveURL(/.*\/feed/);

  await page.goto('/books');
  const readButton = page.getByTestId('read-btn').first();
  if ((await readButton.count()) === 0) test.skip(true, 'No ready book seeded');

  await readButton.click();
  await expect(page).toHaveURL(/\/books\/.+\/read/);
  await expect(page.getByTestId('page-frame')).toBeVisible();
  await expect(page.getByText(/Page \d+ of \d+/)).toBeVisible();

  const next = page.getByRole('button', { name: 'Next page' });
  if (await next.isEnabled()) {
    await next.click();
    await expect(page).toHaveURL(/page=2/);
  }

  // The reader must be deep-linkable.
  await page.reload();
  await expect(page.getByTestId('page-frame')).toBeVisible();
});
