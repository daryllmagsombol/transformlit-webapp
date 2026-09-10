import { test, expect, type Page } from '@playwright/test';

/**
 * Outcome of trying to open a FREE book:
 * - `no-candidates`: there is no FREE "Read" button at all (nothing to test) → skip.
 * - `did-not-open`: a FREE Read candidate existed but none reached `/books/<id>/read`
 *   (a genuinely READY book that fails to open) → fail, do not skip.
 * - `opened`: the reader route was reached.
 */
type OpenOutcome = 'no-candidates' | 'did-not-open' | 'opened';

/**
 * To run this for real, seed a READY FREE book first:
 *   1. Log in as admin, create a book with `accessLevel: FREE` (uploadBook),
 *      then attach a PDF with the uploadPdf mutation.
 *   2. Process the conversion until the book's `conversionStatus` is READY —
 *      run the worker (`pnpm --filter @transformlit/api worker:start`) or invoke
 *      ConversionRunner.runOnce() against the dev DB.
 *   3. Confirm the row has conversionStatus=READY, format=PDF, pageCount>=2.
 *
 * FREE books render a "Read" button; a FREE book that has not been converted yet
 * shows an info toast and stays on /books, so we try the next candidate. PREMIUM
 * books render "Buy" and are never targeted.
 */
async function openFirstReadyBook(page: Page): Promise<OpenOutcome> {
  const readButtons = page.getByRole('button', { name: /^read$/i });
  const count = await readButtons.count();
  if (count === 0) return 'no-candidates';

  for (let index = 0; index < count; index += 1) {
    await readButtons.nth(index).click();
    try {
      await page.waitForURL(/\/books\/[^/]+\/read/, { timeout: 3000 });
      return 'opened';
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

  return 'did-not-open';
}

test('open a book, turn pages, jump via URL', async ({ page }) => {
  await page.goto('/login');
  await page.getByLabel('Email Address').fill('admin@transformlit.com');
  await page.getByLabel('Password', { exact: true }).fill('Transformlit123!');
  await page.getByRole('button', { name: /log in/i }).click();
  await expect(page).toHaveURL(/.*\/feed/);

  await page.goto('/books');
  const outcome = await openFirstReadyBook(page);
  // Only skip when there is nothing to test; a FREE Read candidate that fails
  // to open is a real regression and must fail the suite.
  if (outcome === 'no-candidates') {
    test.skip(true, 'No READY free book seeded');
  }
  expect(outcome, 'READY free book found but the reader did not open').toBe('opened');

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
