import { test, expect } from './pwa-fixtures.js';

test('production application and API are served through the secure same-origin proxy', async ({ page, origin }) => {
  const response = await page.goto(origin);
  expect(response?.ok()).toBe(true);
  expect(page.url()).toBe(`${origin}/`);
  expect(await page.evaluate(() => globalThis.isSecureContext)).toBe(true);

  const graphQLResponse = await page.request.post(`${origin}/api/graphql`, {
    data: { query: '{ __typename }' },
    headers: { 'content-type': 'application/json' },
  });
  expect(graphQLResponse.status()).toBe(200);
  expect(graphQLResponse.headers()['content-type']).toContain('application/json');
});
