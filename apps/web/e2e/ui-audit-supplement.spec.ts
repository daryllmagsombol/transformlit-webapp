import { test, expect } from '@playwright/test';
import * as fs from 'fs';
import * as path from 'path';

const OUT_DIR = path.join(__dirname, '..', 'test-results', 'ui-audit');

// Logged-out captures of public pages (home was previously captured while
// authenticated, which redirected to /feed).
test('public pages logged-out 390x844 (screenshots)', async ({ page }) => {
  test.setTimeout(120000);
  await page.setViewportSize({ width: 390, height: 844 });

  const out: Array<{ route: string; status: string }> = [];

  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await page.waitForLoadState('networkidle', { timeout: 8000 }).catch(() => {});
  await page.waitForTimeout(800);
  await page.screenshot({ path: path.join(OUT_DIR, 'pub-home.png'), fullPage: true });
  out.push({ route: '/', status: 'ok' });

  await page.goto('/register', { waitUntil: 'domcontentloaded' });
  await page.waitForLoadState('networkidle', { timeout: 8000 }).catch(() => {});
  await page.waitForTimeout(800);
  await page.screenshot({ path: path.join(OUT_DIR, 'pub-register.png'), fullPage: true });
  out.push({ route: '/register', status: 'ok' });

  fs.mkdirSync(OUT_DIR, { recursive: true });
  fs.writeFileSync(path.join(OUT_DIR, 'results-public.json'), JSON.stringify(out, null, 2));
});

// Precise bottom-nav geometry at 390px: item boxes + label overflow.
test('bottom nav geometry 390x844', async ({ page }) => {
  test.setTimeout(120000);
  await page.setViewportSize({ width: 390, height: 844 });

  await page.goto('/login', { waitUntil: 'domcontentloaded' });
  await page.getByLabel('Email Address').fill('admin@transformlit.com');
  await page.getByLabel('Password', { exact: true }).fill('Transformlit123!');
  await page.getByRole('button', { name: /log in/i }).click();
  await page.waitForURL(/.*\/feed/, { timeout: 20000 });
  await page.waitForTimeout(800);

  const geometry = await page.evaluate(() => {
    const nav = document.querySelector('nav[aria-label="Mobile navigation"]');
    if (!nav) return { found: false };
    const items = [...nav.querySelectorAll('a')].map((a) => {
      const r = a.getBoundingClientRect();
      const label = a.querySelector('span:last-child');
      const lr = label?.getBoundingClientRect();
      return {
        label: (a.textContent || '').trim(),
        left: Math.round(r.left),
        right: Math.round(r.right),
        width: Math.round(r.width),
        labelLeft: lr ? Math.round(lr.left) : null,
        labelRight: lr ? Math.round(lr.right) : null,
        labelText: label?.textContent ?? '',
      };
    });
    const nr = nav.getBoundingClientRect();
    return { found: true, navLeft: Math.round(nr.left), navRight: Math.round(nr.right), viewport: window.innerWidth, items };
  });

  fs.mkdirSync(OUT_DIR, { recursive: true });
  fs.writeFileSync(path.join(OUT_DIR, 'bottom-nav.json'), JSON.stringify(geometry, null, 2));
  expect(geometry.found).toBe(true);
});