import { test, expect, type Page } from '@playwright/test';

async function login(page: Page) {
  await page.goto('/login');
  await page.getByLabel('Email Address').fill('admin@transformlit.com');
  await page.getByLabel('Password', { exact: true }).fill('Transformlit123!');
  await page.getByRole('button', { name: /log in/i }).click();
  await expect(page).toHaveURL(/.*\/feed/);
}

/** The server writes day keys in UTC+8; mirror it so "today" matches the heatmap cell. */
function todayDayKey(): string {
  const shifted = new Date(Date.now() + 8 * 60 * 60 * 1000);
  const year = shifted.getUTCFullYear();
  const month = String(shifted.getUTCMonth() + 1).padStart(2, '0');
  const day = String(shifted.getUTCDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

test.describe('Progress page and sidebar widget', () => {
  test.beforeEach(async ({ page }) => {
    await login(page);
  });

  test('set a goal on /progress and confirm the sidebar widget reflects it', async ({ page }) => {
    await page.goto('/progress');
    await expect(page.getByRole('heading', { name: /keep the streak alive/i })).toBeVisible();

    await page.getByRole('button', { name: 'Days' }).click();
    await page.getByLabel('Goal target').fill('24');
    await page.getByRole('button', { name: /save goal/i }).click();

    await expect(page.getByText('Goal saved.')).toBeVisible();
    // The page header summarizes the saved goal once the query refreshes.
    await expect(page.getByText(/24-day goal/i)).toBeVisible({ timeout: 10000 });

    // The sidebar widget reads the same myProgress query and shows "N/24".
    const widget = page.getByRole('complementary').getByText('Your Progress');
    await expect(widget).toBeVisible();
    const widgetCard = page.locator('div').filter({ has: widget }).last();
    await expect(widgetCard.getByText(/\/24/)).toBeVisible({ timeout: 10000 });
  });

  test('heatmap renders a cell for today', async ({ page }) => {
    await page.goto('/progress');
    await expect(page.getByRole('heading', { name: /activity calendar/i })).toBeVisible();

    // Ensure there is at least one activity for today before asserting the cell.
    await page.getByRole('button', { name: /log today's reading/i }).click();

    const todayCell = page.locator(`[data-testid="heatmap-cell"][data-day-key="${todayDayKey()}"]`);
    await expect(todayCell).toBeVisible({ timeout: 15000 });
  });
});
