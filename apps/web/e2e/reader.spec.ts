import { test, expect, type Page } from '@playwright/test';

/**
 * Outcome of trying to open a FREE book:
 * - `did-not-open`: a FREE "Read" candidate existed but none reached
 *   `/books/<id>/read` (a genuinely READY book that fails to open) → fail.
 * - `opened`: the reader route was reached.
 *
 * There is deliberately no "no-candidates" outcome here: whether a READY book
 * exists is decided from the API (`listFreeReadyBooks`), not from the presence
 * of a "Read" button. Seeded FREE books are PUBLISHED but file-less
 * (`conversionStatus = NOT_APPLICABLE`) and do render "Read" without navigating,
 * so counting buttons would wrongly fail on a default seeded DB.
 */
type OpenOutcome = 'did-not-open' | 'opened';

/** API origin, derived from the GraphQL URL the same way the web app does. */
const API_BASE = (process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3005/graphql').replace(
  /\/graphql$/,
  '',
);

interface ReadyBook {
  id: string;
  title: string;
}

/**
 * To run this for real, seed a READY FREE book first:
 *   1. Log in as admin, create a book with `accessLevel: FREE` (uploadBook),
 *      then attach a PDF with the uploadPdf mutation.
 *   2. Process the conversion until the book's `conversionStatus` is READY —
 *      run the worker (`pnpm --filter @transformlit/api worker:start`) or invoke
 *      ConversionRunner.runOnce() against the dev DB.
 *   3. Confirm the row has conversionStatus=READY, status=PUBLISHED, format=PDF,
 *      pageCount>=2.
 *
 * When no such book exists the suite skips (the default seed has none). A FREE +
 * PUBLISHED + READY book that still does not open is a real regression → fail.
 */
async function listFreeReadyBooks(page: Page): Promise<ReadyBook[]> {
  // Reuse the browser session's httpOnly refresh cookie (shared by page.request)
  // to mint a short-lived access token for a read-only GraphQL query.
  const refresh = await page.request.post(`${API_BASE}/auth/refresh`, { data: {} });
  if (!refresh.ok()) {
    throw new Error(`Could not refresh the reading session (HTTP ${refresh.status()})`);
  }
  const { accessToken } = (await refresh.json()) as { accessToken: string };

  const response = await page.request.post(`${API_BASE}/graphql`, {
    headers: { authorization: `Bearer ${accessToken}` },
    data: { query: '{ books { id title accessLevel status conversionStatus } }' },
  });
  if (!response.ok()) {
    throw new Error(`Could not list books via GraphQL (HTTP ${response.status()})`);
  }
  const body = (await response.json()) as {
    data?: {
      books?: Array<{
        id: string;
        title: string;
        accessLevel: string;
        status: string;
        conversionStatus: string;
      }>;
    };
    errors?: Array<{ message: string }>;
  };
  if (body.errors?.length) {
    throw new Error(`Could not list books: ${body.errors.map((e) => e.message).join('; ')}`);
  }

  return (body.data?.books ?? [])
    .filter(
      (book) =>
        book.accessLevel === 'FREE' &&
        book.status === 'PUBLISHED' &&
        book.conversionStatus === 'READY',
    )
    .map((book) => ({ id: book.id, title: book.title }));
}

/**
 * FREE books render a "Read" button; a FREE book that has not been converted yet
 * shows an info toast and stays on /books, so we try the next candidate. PREMIUM
 * books render "Buy" and are never targeted. The caller has already confirmed a
 * READY candidate exists, so exhausting every button is a failure.
 */
async function openFirstReadyBook(page: Page): Promise<OpenOutcome> {
  const readButtons = page.getByRole('button', { name: /^read$/i });
  const count = await readButtons.count();
  if (count === 0) return 'did-not-open';

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
  const candidates = await listFreeReadyBooks(page);
  // Only skip when the data has nothing to test. A FREE + PUBLISHED + READY book
  // that fails to open through its Read button is a real regression.
  test.skip(
    candidates.length === 0,
    'No FREE + PUBLISHED + READY book seeded — see the seed procedure in this file.',
  );

  const outcome = await openFirstReadyBook(page);
  const labels = candidates.map((book) => `${book.title} (${book.id})`).join(', ');
  expect(
    outcome,
    `FREE + READY book(s) exist but the reader did not open: ${labels}`,
  ).toBe('opened');

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
