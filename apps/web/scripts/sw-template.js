/*
 * Transform Lit static shell service worker.
 *
 * This file is the committed source template. The postbuild script
 * `scripts/build-pwa-assets.mjs` replaces the `PWA_BUILD` placeholder below with
 * a release-identified inventory payload and writes the released bytes to
 * `public/sw.js`. The generated files are git-ignored.
 *
 * Scope: cache only the non-personalized public shell. Never cache GraphQL,
 * auth, protected/session/page/API responses, downloads, personalized HTML,
 * RSC/Next data requests, redirects, or opaque responses.
 */
const PWA_BUILD = /*__PWA_BUILD__*/ null;

const CACHE_PREFIX = 'transformlit-shell-';
const RELEASE_CACHE = `${CACHE_PREFIX}${PWA_BUILD.releaseId}`;
const INVENTORY_URL = '/pwa-assets.json';
const OFFLINE_URL = '/offline';
const SHELL_ASSETS = PWA_BUILD.assets;

const PRIVATE_PATH_PREFIXES = ['/api/', '/auth/', '/graphql', '/_next/data/'];
const RSC_HEADER_NAMES = [
  'rsc',
  'next-router-state-tree',
  'next-router-prefetch',
  'next-router-segment-prefetch',
  'x-nextjs-data',
];

function requestUrl(request) {
  return new URL(request.url);
}

function hasRscIndicators(request) {
  const accept = request.headers.get('accept') || '';
  if (accept.includes('text/x-component')) return true;
  if (RSC_HEADER_NAMES.some((name) => request.headers.get(name) !== null)) return true;
  return requestUrl(request).searchParams.has('_rsc');
}

function isPrivateOrApi(url) {
  return PRIVATE_PATH_PREFIXES.some((prefix) => url.pathname.startsWith(prefix));
}

function isEligibleDocumentNavigation(request) {
  return request.mode === 'navigate' && !hasRscIndicators(request);
}

function isAllowlistedShellAsset(url) {
  if (url.origin !== self.location.origin) return false;
  return SHELL_ASSETS.includes(url.pathname);
}

async function verifyAssetInventory() {
  const response = await fetch(new Request(INVENTORY_URL, { credentials: 'omit', cache: 'no-store' }));
  if (!response.ok || response.redirected) {
    throw new Error('Unable to verify the shell asset inventory');
  }
  const inventory = await response.json();
  const matches =
    inventory && inventory.releaseId === PWA_BUILD.releaseId && inventory.inventoryDigest === PWA_BUILD.inventoryDigest;
  if (!matches) {
    throw new Error('Refusing a mixed-release shell installation');
  }
}

async function precacheShell(cache) {
  for (const asset of SHELL_ASSETS) {
    const response = await fetch(new Request(asset, { credentials: 'omit' }));
    if (!response.ok || response.type === 'opaque' || response.redirected) {
      throw new Error(`Refusing to cache an unapproved shell asset: ${asset}`);
    }
    await cache.put(asset, response);
  }
}

async function installRelease() {
  await verifyAssetInventory();
  const cache = await caches.open(RELEASE_CACHE);
  try {
    await precacheShell(cache);
  } catch (error) {
    // A partial release must never be published; drop it so install fails cleanly.
    await caches.delete(RELEASE_CACHE);
    throw error;
  }
}

async function activateRelease() {
  const keys = await caches.keys();
  await Promise.all(
    keys
      .filter((key) => key.startsWith(CACHE_PREFIX) && key !== RELEASE_CACHE)
      .map((key) => caches.delete(key)),
  );
  await self.clients.claim();
}

async function respondWithDocumentFallback(request) {
  try {
    return await fetch(request);
  } catch {
    const cache = await caches.open(RELEASE_CACHE);
    const fallback = await cache.match(OFFLINE_URL);
    if (!fallback) throw new Error('Offline shell is not available');
    return fallback;
  }
}

async function respondWithShellAsset(url) {
  try {
    const cache = await caches.open(RELEASE_CACHE);
    const cached = await cache.match(url.pathname);
    if (cached) return cached;
    return await fetch(url.pathname, { credentials: 'omit' });
  } catch {
    const cache = await caches.open(RELEASE_CACHE);
    const fallback = await cache.match(OFFLINE_URL);
    if (!fallback) throw new Error('Offline shell is not available');
    return fallback;
  }
}

self.addEventListener('install', (event) => {
  event.waitUntil(installRelease());
});

self.addEventListener('activate', (event) => {
  event.waitUntil(activateRelease());
});

self.addEventListener('message', (event) => {
  const message = event.data ?? {};
  if (message.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') return;

  const url = requestUrl(request);
  if (url.origin !== self.location.origin) return;

  // RSC/Next data/API/private responses are never cached and never receive the
  // document fallback; they pass straight through to the network.
  if (hasRscIndicators(request) || isPrivateOrApi(url)) return;

  if (isEligibleDocumentNavigation(request)) {
    event.respondWith(respondWithDocumentFallback(request));
    return;
  }

  if (isAllowlistedShellAsset(url)) {
    event.respondWith(respondWithShellAsset(url));
  }
});
