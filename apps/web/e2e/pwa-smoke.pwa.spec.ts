import { test, expect } from './pwa-fixtures.js';

test('production application and API are served through the secure same-origin proxy', async ({ page, origin, loginAs, ids }) => {
  const response = await page.goto(origin);
  expect(response?.ok()).toBe(true);
  expect(page.url()).toBe(`${origin}/`);
  expect(ids.readableBookId).toBeTruthy();
  expect(await page.evaluate(() => globalThis.isSecureContext)).toBe(true);
  await loginAs(0);
  expect(await page.evaluate(() => document.cookie.includes('transformlit_refresh'))).toBe(false);

  const result = await page.evaluate(async () => {
    const response = await fetch('/api/graphql', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ query: '{ __typename }' }),
      credentials: 'include',
    });
    return { status: response.status, contentType: response.headers.get('content-type') };
  });
  expect(result.status).toBe(200);
  expect(result.contentType).toContain('application/json');
});
