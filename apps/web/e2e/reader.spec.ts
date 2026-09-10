import { test, expect, type Page } from '@playwright/test';

/**
 * Opens the first FREE book that is actually READY. FREE books render a "Read"
 * button; a FREE book that has not been converted yet shows an info toast and
 * stays on /books, so we try the next candidate. PREMIUM books render "Buy"
 * and are never targeted.
 *
 * Returns false only when no READY free book could be opened, which is the one
 * case where the spec should skip.
 */
async function openFirstReadyBook(page: Page): Promise<boolean> {
  const readButtons = page.getByRole('button', { name: /^read$/i });
  const count = await readButtons.count();

  for (let index = 0; index < count; index += 1) {
    await readButtons.nth(index).click();
    try {
      await page.waitForURL(/\/books\/[^/]+\/read/, { timeout: 3000 });
      return true;
    } catch {
      // FREE but not converted yet: the reader does not open. Dismiss the
      // "still being prepared" toast so it cannot overlap the next button.
      await page
        .getByRole('button', { name: 'Dismiss' })
        .first()
        .click({ timeout: 1000 })
        .catch(() => undefined);
    }
  }

  return false;
}

test('open a book, turn pages, jump via URL', async ({ page }) => {
  await page.goto('/login');
  await page.getByLabel('Email Address').fill('admin@transformlit.com');
  await page.getByLabel('Password', { exact: true }).fill('Transformlit123!');
  await page.getByRole('button', { name: /log in/i }).click();
  await expect(page).toHaveURL(/.*\/feed/);

  await page.goto('/books');
  if (!(await openFirstReadyBook(page))) {
    test.skip(true, 'No READY free book seeded');
  }

  await expect(page).toHaveURL(/\/books\/[^/]+\/read/);
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
