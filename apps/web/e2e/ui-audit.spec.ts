import { test, expect, type Page } from '@playwright/test';
import * as fs from 'fs';
import * as path from 'path';

/**
 * Mobile / responsive UI audit.
 * - Navigates every route at a given viewport
 * - Runs programmatic layout checks (horizontal overflow, off-viewport elements,
 *   clipped text, undersized tap targets, console/page errors)
 * - Captures full-page screenshots (mobile test only)
 * - Writes structured JSON per test for reconciliation
 */

const OUT_DIR = path.join(__dirname, '..', 'test-results', 'ui-audit');

const ROUTES = {
  public: ['/', '/login', '/register'],
  auth: ['/feed', '/friends', '/groups', '/notifications', '/books', '/bible', '/chat', '/users'],
};

interface AuditResult {
  route: string;
  viewport: string;
  status: string;
  horizontalOverflowPx: number;
  overflowingElements: Array<Record<string, unknown>>;
  clippedText: Array<Record<string, unknown>>;
  smallTapTargets: Array<Record<string, unknown>>;
  consoleErrors: string[];
  pageErrors: string[];
  visitedDynamics: string[];
  skipDynamics: string[];
}

async function login(page: Page) {
  await page.goto('/login', { waitUntil: 'domcontentloaded' });
  await page.getByLabel('Email Address').fill('admin@transformlit.com');
  await page.getByLabel('Password', { exact: true }).fill('Transformlit123!');
  await page.getByRole('button', { name: /log in/i }).click();
  await page.waitForURL(/.*\/feed/, { timeout: 20000 });
}

const LAYOUT_CHECKS = () => {
  const vw = window.innerWidth;
  const docEl = document.documentElement;
  const out: {
    horizontalOverflowPx: number;
    overflowing: Array<Record<string, unknown>>;
    clipped: Array<Record<string, unknown>>;
    tapTargets: Array<Record<string, unknown>>;
  } = {
    horizontalOverflowPx: Math.max(0, docEl.scrollWidth - vw),
    overflowing: [],
    clipped: [],
    tapTargets: [],
  };

  const isVisible = (el: Element) => {
    const cs = getComputedStyle(el);
    if (cs.display === 'none' || cs.visibility === 'hidden' || +cs.opacity === 0) return false;
    const r = el.getBoundingClientRect();
    return r.width > 0 && r.height > 0;
  };

  const fullyClippedByAncestor = (el: Element) => {
    let n = el.parentElement;
    while (n) {
      const cs = getComputedStyle(n);
      const ov = cs.overflowX + cs.overflowY;
      if (/(hidden|auto|scroll|clip|contain)/.test(ov)) {
        const r = el.getBoundingClientRect();
        const pr = n.getBoundingClientRect();
        // Fully outside the clipping container horizontally => intentional scroll/clip
        if (r.right <= pr.left + 1 || r.left >= pr.right - 1) return true;
      }
      n = n.parentElement;
    }
    return false;
  };

  // 1. Elements extending outside the viewport
  const seen = new Set<string>();
  document.querySelectorAll('body *').forEach((el) => {
    if (!isVisible(el)) return;
    const r = el.getBoundingClientRect();
    const overRight = r.right - vw;
    const overLeft = -r.left;
    if (overRight > 2 || overLeft > 2) {
      if (fullyClippedByAncestor(el)) return;
      // collapse identical class signatures
      const sig = el.tagName + '.' + (el.className && typeof el.className === 'string' ? el.className.split(' ').slice(0,3).join('.') : '');
      if (seen.has(sig)) return;
      seen.add(sig);
      out.overflowing.push({
        tag: el.tagName.toLowerCase(),
        cls: typeof el.className === 'string' ? el.className.slice(0, 90) : '',
        text: (el.textContent || '').trim().slice(0, 60),
        left: Math.round(r.left),
        right: Math.round(r.right),
        width: Math.round(r.width),
        overflowRight: Math.round(overRight),
        overflowLeft: Math.round(overLeft),
        role: el.getAttribute('role') || '',
      });
      if (out.overflowing.length > 40) return;
    }
  });

  // 2. Text clipped / overflowing its own box
  const textSel = 'a, button, h1, h2, h3, h4, h5, h6, p, span, li, label, td, th, small, strong, em';
  const seenText = new Set<string>();
  document.querySelectorAll(textSel).forEach((el) => {
    if (!isVisible(el)) return;
    if (!el.textContent || !el.textContent.trim()) return;
    const cs = getComputedStyle(el);
    const overflowPx = el.scrollWidth - el.clientWidth;
    if (overflowPx > 3) {
      const sig = el.tagName + '.' + (el.className && typeof el.className === 'string' ? el.className.split(' ').slice(0,3).join('.') : '');
      if (seenText.has(sig)) return;
      seenText.add(sig);
      out.clipped.push({
        tag: el.tagName.toLowerCase(),
        cls: typeof el.className === 'string' ? el.className.slice(0, 90) : '',
        text: (el.textContent || '').trim().slice(0, 60),
        overflowPx: Math.round(overflowPx),
        textOverflow: cs.textOverflow,
        whiteSpace: cs.whiteSpace,
        width: Math.round(el.clientWidth),
      });
      if (out.clipped.length > 40) return;
    }
  });

  // 3. Undersized tap targets (WCAG 2.5.5 minimum 44px, flag < 40px)
  const seenTap = new Set<string>();
  document.querySelectorAll('a, button, [role="button"], input, select, textarea, [onclick]').forEach((el) => {
    if (!isVisible(el)) return;
    if ('disabled' in el && (el as HTMLButtonElement).disabled) return;
    const r = el.getBoundingClientRect();
    if (r.right < 0 || r.left > vw) return; // off-screen
    const sig = el.tagName + '.' + (el.className && typeof el.className === 'string' ? el.className.split(' ').slice(0,3).join('.') : '');
    if (seenTap.has(sig)) return;
    seenTap.add(sig);
    if (r.width < 40 || r.height < 40) {
      out.tapTargets.push({
        tag: el.tagName.toLowerCase(),
        cls: typeof el.className === 'string' ? el.className.slice(0, 90) : '',
        text: (el.textContent || '').trim().slice(0, 40),
        width: Math.round(r.width),
        height: Math.round(r.height),
        label: el.getAttribute('aria-label') || '',
      });
      if (out.tapTargets.length > 40) return;
    }
  });

  return out;
};

async function runAudit(page: Page, route: string, label: string, viewport: string, capture: boolean): Promise<AuditResult> {
  const result: AuditResult = {
    route,
    viewport,
    status: 'ok',
    horizontalOverflowPx: 0,
    overflowingElements: [],
    clippedText: [],
    smallTapTargets: [],
    consoleErrors: [],
    pageErrors: [],
    visitedDynamics: [],
    skipDynamics: [],
  };

  const consoleErrors: string[] = [];
  const pageErrors: string[] = [];
  const onConsole = (msg: { type: () => string; text: () => string }) => {
    if (msg.type() === 'error') consoleErrors.push(msg.text().slice(0, 300));
  };
  const onPageError = (err: Error) => pageErrors.push(String(err).slice(0, 300));
  page.on('console', onConsole);
  page.on('pageerror', onPageError);

  try {
    await page.goto(route, { waitUntil: 'domcontentloaded', timeout: 20000 });
    await page.waitForLoadState('networkidle', { timeout: 8000 }).catch(() => {});
    await page.waitForTimeout(1000);

    const checks = (await page.evaluate(LAYOUT_CHECKS)) as {
      horizontalOverflowPx: number;
      overflowing: Array<Record<string, unknown>>;
      clipped: Array<Record<string, unknown>>;
      tapTargets: Array<Record<string, unknown>>;
    };
    result.horizontalOverflowPx = checks.horizontalOverflowPx;
    result.overflowingElements = checks.overflowing;
    result.clippedText = checks.clipped;
    result.smallTapTargets = checks.tapTargets;

    // Follow one dynamic link when the page offers it (books/user/bible detail)
    const dynamicRoutes: Array<[string, RegExp]> = [
      ['/books', /^\/books\//],
      ['/users', /^\/users\//],
      ['/bible', /^\/bible\//],
    ];
    for (const [from, pat] of dynamicRoutes) {
      if (route === from) {
        const href = await page
          .evaluate((p) => {
            const a = [...document.querySelectorAll<HTMLAnchorElement>('a[href]')].find((x) => p.test(x.getAttribute('href') || ''));
            return a ? a.getAttribute('href') : null;
          }, pat)
          .catch(() => null);
        if (href) {
          await page.goto(href, { waitUntil: 'domcontentloaded', timeout: 15000 }).catch(() => {});
          await page.waitForTimeout(900);
          result.visitedDynamics.push(href);
        } else {
          result.skipDynamics.push(from);
        }
      }
    }

    if (capture) {
      const safe = route === '/' ? 'home' : route.replace(/^\//, '').replace(/\//g, '-');
      await page.screenshot({ path: path.join(OUT_DIR, `${label}-${safe}.png`), fullPage: true });
    }
  } catch (e) {
    result.status = `error: ${String(e).slice(0, 200)}`;
  } finally {
    page.off('console', onConsole);
    page.off('pageerror', onPageError);
  }

  result.consoleErrors = consoleErrors;
  result.pageErrors = pageErrors;
  return result;
}

test('UI audit — mobile 390x844 (screenshots)', async ({ page }) => {
  test.setTimeout(420000);
  await page.setViewportSize({ width: 390, height: 844 });
  await login(page);

  const results: AuditResult[] = [];
  for (const route of [...ROUTES.public, ...ROUTES.auth]) {
    results.push(await runAudit(page, route, 'm390', '390x844', true));
  }

  const home = await page.evaluate(() => location.href);
  expect(home).toBeTruthy();
  fs.mkdirSync(OUT_DIR, { recursive: true });
  fs.writeFileSync(path.join(OUT_DIR, 'results-390.json'), JSON.stringify(results, null, 2));
});

test('UI audit — small 320x568 (checks only)', async ({ page }) => {
  test.setTimeout(420000);
  await page.setViewportSize({ width: 320, height: 568 });
  await login(page);

  const results: AuditResult[] = [];
  for (const route of [...ROUTES.public, ...ROUTES.auth]) {
    results.push(await runAudit(page, route, 's320', '320x568', false));
  }
  fs.mkdirSync(OUT_DIR, { recursive: true });
  fs.writeFileSync(path.join(OUT_DIR, 'results-320.json'), JSON.stringify(results, null, 2));
});

test('UI audit — desktop 1280x800 (checks only)', async ({ page }) => {
  test.setTimeout(420000);
  await page.setViewportSize({ width: 1280, height: 800 });
  await login(page);

  const results: AuditResult[] = [];
  for (const route of [...ROUTES.public, ...ROUTES.auth]) {
    results.push(await runAudit(page, route, 'd1280', '1280x800', false));
  }
  fs.mkdirSync(OUT_DIR, { recursive: true });
  fs.writeFileSync(path.join(OUT_DIR, 'results-1280.json'), JSON.stringify(results, null, 2));
});