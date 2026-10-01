import { test, expect } from '@playwright/test';

test('public offline entry serves install metadata without authenticated content', async ({ page }) => {
  const response = await page.goto('/offline');

  expect(response?.ok()).toBe(true);
  expect(response?.headers()['content-security-policy']).toContain("worker-src 'self'");
  await expect(page.getByRole('heading', { name: 'A little room to read offline' })).toBeVisible();
  await expect(page.getByRole('status')).toBeVisible();
  await expect(page.getByText(/save reading for offline use once that capability is available/i)).toBeVisible();

  const metadata = await page.evaluate(async () => {
    const manifestResponse = await fetch('/manifest.webmanifest');
    const manifest = await manifestResponse.json();
    return {
      manifestStatus: manifestResponse.status,
      name: manifest.name,
      startUrl: manifest.start_url,
      scope: manifest.scope,
      display: manifest.display,
      icons: manifest.icons,
      appleIcon: document.querySelector('link[rel="apple-touch-icon"]')?.getAttribute('href'),
      bodyText: document.body.innerText,
    };
  });

  expect(metadata.manifestStatus).toBe(200);
  expect(metadata.name).toBe('Transform Lit');
  expect(metadata.startUrl).toBe('/offline');
  expect(metadata.scope).toBe('/');
  expect(metadata.display).toBe('standalone');
  expect(metadata.icons).toEqual(expect.arrayContaining([
    expect.objectContaining({ src: '/icons/pwa-192.png', sizes: '192x192' }),
    expect.objectContaining({ src: '/icons/pwa-512.png', sizes: '512x512' }),
    expect.objectContaining({ src: '/icons/pwa-maskable-512.png', sizes: '512x512', purpose: 'maskable' }),
  ]));
  expect(metadata.appleIcon).toBe('/icons/apple-touch-icon.png');
  expect(metadata.bodyText).not.toMatch(/saved for you|hello,|your bookshelf/i);

  const serviceWorkerResponse = await page.request.get('/sw.js');
  expect(serviceWorkerResponse.status()).toBe(404);
  expect(serviceWorkerResponse.headers()['cache-control']).toContain('no-cache');
  expect(serviceWorkerResponse.headers()['service-worker-allowed']).toBe('/');
});

test('install guidance remains available when native install prompting is not offered', async ({ page }) => {
  await page.goto('/offline');
  await expect(page.getByText(/use your browser menu to add this page to your home screen/i)).toBeVisible();
});
