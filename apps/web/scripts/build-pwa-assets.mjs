/**
 * Generates the static-only PWA shell inventory and the released `/sw.js`.
 *
 * Runs after `next build` (see the web package `build` script). It discovers the
 * real Next output rather than guessing filenames:
 * - Release/build id from `.next/BUILD_ID`.
 * - Prerendered `/offline` document from `.next/server/app/offline.html`.
 * - The `/offline` client chunk set from the client-reference manifest.
 * - Reference-hinted stylesheet/font assets from the generated offline HTML.
 *
 * Writes are atomic (temp file + rename) and happen only after the inventory is
 * fully serialized, so a failure leaves the previously served worker intact.
 */
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
// PWA_WEB_ROOT lets tests run the generator against an isolated fixture tree.
const webRoot = process.env.PWA_WEB_ROOT ? resolve(process.env.PWA_WEB_ROOT) : resolve(scriptDirectory, '..');
const nextDirectory = join(webRoot, '.next');
const publicDirectory = join(webRoot, 'public');

const OFFLINE_ROUTE = '/offline';
const INVENTORY_FILENAME = 'pwa-assets.json';
const WORKER_FILENAME = 'sw.js';
const TEMPLATE_FILENAME = join(scriptDirectory, 'sw-template.js');
const BUILD_MARKER = '/*__PWA_BUILD__*/';

// Shell documents served by Next at runtime. The `/offline` document is
// verified on disk; the manifest is a generated route with no public file.
const ROUTE_ASSETS = [OFFLINE_ROUTE, '/manifest.webmanifest'];

// Public files that must exist in `public/` and ship with the image.
const REQUIRED_PUBLIC_ASSETS = [
  '/icons/pwa-192.png',
  '/icons/pwa-512.png',
  '/icons/pwa-maskable-512.png',
  '/icons/apple-touch-icon.png',
];

function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

function buildReleaseId(buildId, inventoryDigest) {
  return sha256(`${buildId}\n${inventoryDigest}`).slice(0, 16);
}

/** Reads the exact `/_next/static/*` chunk URLs from the built `/offline` HTML. */
function staticRefsFromHtml(html) {
  const refs = new Set();
  const pattern = /(?:src|href)="(\/_next\/static\/[^"]+)"/g;
  let match = pattern.exec(html);
  while (match) {
    refs.add(match[1]);
    match = pattern.exec(html);
  }
  return refs;
}

/**
 * Reads the page's client component chunk list from the generated client
 * reference manifest (`globalThis.__RSC_MANIFEST[...] = {...}`).
 */
function clientChunksFromManifest(manifestPath) {
  const source = readFileSync(manifestPath, 'utf8');
  const marker = 'globalThis.__RSC_MANIFEST[';
  const markerIndex = source.indexOf(marker);
  if (markerIndex === -1) return [];
  const equalsIndex = source.indexOf('=', markerIndex);
  let body = source.slice(equalsIndex + 1).trim();
  if (body.endsWith(';')) body = body.slice(0, -1);
  const parsed = JSON.parse(body);
  const chunks = new Set();
  const visit = (node) => {
    if (!node || typeof node !== 'object') return;
    for (const key of Object.keys(node)) {
      const value = node[key];
      if (key === 'chunks' && Array.isArray(value)) {
        for (const chunk of value) chunks.add(chunk);
      } else {
        visit(value);
      }
    }
  };
  visit(parsed);
  return [...chunks];
}

function toStaticPath(chunkUrl) {
  // `/_next/static/...` maps directly onto `.next/static/...`.
  return chunkUrl.replace(/^\/_next\//, '');
}

function assertStaticAssetExists(chunkUrl) {
  const path = join(nextDirectory, toStaticPath(chunkUrl));
  if (!existsSync(path)) throw new Error(`Discovered shell chunk is missing from build output: ${chunkUrl}`);
  return chunkUrl;
}

function assertPublicAssetExists(assetUrl) {
  const path = join(publicDirectory, assetUrl.replace(/^\//, ''));
  if (!existsSync(path)) throw new Error(`Required public shell asset is missing: ${assetUrl}`);
  return assetUrl;
}

function readOfflineDocument() {
  const offlineHtml = join(nextDirectory, 'server/app/offline.html');
  if (!existsSync(offlineHtml)) throw new Error('Prerendered /offline document is missing; refusing to guess the shell');
  return readFileSync(offlineHtml, 'utf8');
}

function collectShellAssets(buildId) {
  const offlineHtml = readOfflineDocument();
  const clientChunks = clientChunksFromManifest(
    join(nextDirectory, 'server/app/offline/page_client-reference-manifest.js'),
  );

  const staticUrls = new Set([
    ...staticRefsFromHtml(offlineHtml),
    // The RSC manifest also lists server-only SSR chunks; only public
    // `/_next/static/...` URLs are real browser-fetchable shell assets.
    ...clientChunks.filter((chunk) => chunk.startsWith('/_next/static/')),
  ]);
  const staticAssets = [...staticUrls].map(assertStaticAssetExists).sort();
  const publicAssets = REQUIRED_PUBLIC_ASSETS.map(assertPublicAssetExists).sort();

  const assets = [...ROUTE_ASSETS, ...publicAssets, ...staticAssets];
  return { buildId, assets };
}

function buildInventory(buildId) {
  const { assets } = collectShellAssets(buildId);
  const inventory = {
    releaseId: '',
    buildId,
    generatedWith: { route: OFFLINE_ROUTE },
    assets,
    excluded: ['/api/', '/auth/', '/graphql', '/_next/data/', 'RSC/Next data requests', 'non-GET', 'cross-origin'],
  };
  const digest = sha256(JSON.stringify({ buildId, assets }));
  inventory.releaseId = buildReleaseId(buildId, digest);
  inventory.inventoryDigest = digest;
  return inventory;
}

function renderWorker(inventory) {
  const template = readFileSync(TEMPLATE_FILENAME, 'utf8');
  const payload = JSON.stringify({
    releaseId: inventory.releaseId,
    inventoryDigest: inventory.inventoryDigest,
    assets: inventory.assets,
  });
  const placeholder = `${BUILD_MARKER} null`;
  if (!template.includes(placeholder)) throw new Error('Worker template is missing the build placeholder');
  // Keep the marker comment in the released bytes so Task 14A can diff identity.
  return template.replace(placeholder, `${BUILD_MARKER} ${payload}`);
}

function writeAtomic(filePath, contents) {
  const temporaryPath = `${filePath}.tmp-${process.pid}`;
  writeFileSync(temporaryPath, contents);
  renameSync(temporaryPath, filePath);
}

function main() {
  const buildId = readFileSync(join(nextDirectory, 'BUILD_ID'), 'utf8').trim();
  if (!buildId) throw new Error('Next build id is empty');

  const inventory = buildInventory(buildId);
  const worker = renderWorker(inventory);

  mkdirSync(publicDirectory, { recursive: true });
  writeAtomic(join(publicDirectory, INVENTORY_FILENAME), `${JSON.stringify(inventory, null, 2)}\n`);
  writeAtomic(join(publicDirectory, WORKER_FILENAME), worker);

  process.stdout.write(
    `Generated ${INVENTORY_FILENAME} (${inventory.assets.length} assets, release ${inventory.releaseId}) and ${WORKER_FILENAME}\n`,
  );
}

main();
