import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  createFixture,
  createWorkerHarness,
  readGeneratedInventory,
  readGeneratedWorker,
  runBuildScript,
  type Fixture,
} from './test-utils/pwa-fixture';

describe('build-pwa-assets', () => {
  let fixture: Fixture;

  afterEach(() => {
    fixture?.cleanup();
  });

  function generate(first: Fixture): void {
    const result = runBuildScript(first);
    expect(result.stderr).toBe('');
    expect(result.status).toBe(0);
  }

  it('generates an inventory and release-identified worker from real build output', () => {
    fixture = createFixture({ buildId: 'build-a' });
    generate(fixture);

    const inventory = readGeneratedInventory(fixture);
    expect(inventory.buildId).toBe('build-a');
    expect(inventory.releaseId).toHaveLength(16);
    expect(inventory.assets).toContain('/offline');
    expect(inventory.assets).toContain('/manifest.webmanifest');
    expect(inventory.assets).toContain('/icons/pwa-192.png');
    expect(inventory.assets).toContain('/_next/static/chunks/runtime.js');
    expect(inventory.assets).toContain('/_next/static/chunks/app.css');
    expect(inventory.assets).toContain('/_next/static/media/display.woff2');

    const worker = readGeneratedWorker(fixture);
    expect(worker).toContain(inventory.releaseId);
    expect(worker).toContain(inventory.inventoryDigest);
  });

  it('changes the served worker identity for an asset-only release change', () => {
    fixture = createFixture({ buildId: 'build-a' });
    generate(fixture);
    const releaseA = readGeneratedInventory(fixture);
    const workerA = readGeneratedWorker(fixture);

    const releaseB = createFixture({ buildId: 'build-b' });
    generate(releaseB);

    const inventoryB = readGeneratedInventory(releaseB);
    expect(inventoryB.releaseId).not.toBe(releaseA.releaseId);
    expect(readGeneratedWorker(releaseB)).not.toBe(workerA);
    releaseB.cleanup();
  });

  it('changes worker-observed identity for a same-build asset-only change', () => {
    // Same Next build id, unchanged worker template; only the shell asset set
    // differs. The release id/digest must still diverge so a waiting worker is
    // produced. This is the exact A→B identity guarantee Task 14A relies on.
    fixture = createFixture({ buildId: 'build-a', fonts: ['display.woff2'] });
    generate(fixture);
    const releaseA = readGeneratedInventory(fixture);
    const workerA = readGeneratedWorker(fixture);

    const releaseB = createFixture({ buildId: 'build-a', fonts: ['display.woff2', 'body.woff2'] });
    generate(releaseB);

    const inventoryB = readGeneratedInventory(releaseB);
    expect(inventoryB.buildId).toBe(releaseA.buildId);
    expect(inventoryB.inventoryDigest).not.toBe(releaseA.inventoryDigest);
    expect(inventoryB.releaseId).not.toBe(releaseA.releaseId);
    expect(readGeneratedWorker(releaseB)).not.toBe(workerA);
    releaseB.cleanup();
  });

  it('fails when a discovered shell chunk is missing rather than guessing', () => {
    fixture = createFixture({ omitChunkFileFor: '/chunks/runtime.js' });
    const result = runBuildScript(fixture);
    expect(result.status).not.toBe(0);
    expect(result.stderr).toMatch(/missing from build output/i);
  });

  it('fails when the prerendered offline document is missing', () => {
    fixture = createFixture({ omitOfflineHtml: true });
    const result = runBuildScript(fixture);
    expect(result.status).not.toBe(0);
    expect(result.stderr).toMatch(/offline document is missing/i);
  });

  it('fails when a required public shell asset is missing', () => {
    fixture = createFixture({ omitPublicAsset: '/icons/pwa-192.png' });
    const result = runBuildScript(fixture);
    expect(result.status).not.toBe(0);
    expect(result.stderr).toMatch(/required public shell asset is missing/i);
  });

  it('preserves the previous worker and inventory when generation fails', () => {
    fixture = createFixture();
    generate(fixture);
    const previousWorker = readGeneratedWorker(fixture);
    const previousInventory = readGeneratedInventory(fixture);

    // Corrupt the discovered build output so the next generation must fail.
    writeFileSync(
      join(fixture.nextDir, 'server/app/offline.html'),
      '<html><head><script src="/_next/static/chunks/removed.js"></script></head></html>',
    );
    const result = runBuildScript(fixture);
    expect(result.status).not.toBe(0);

    expect(readGeneratedWorker(fixture)).toBe(previousWorker);
    expect(readGeneratedInventory(fixture).releaseId).toBe(previousInventory.releaseId);
  });

  it('records the allowlist exclusions in the generated inventory', () => {
    fixture = createFixture();
    generate(fixture);
    expect(readGeneratedInventory(fixture).excluded).toEqual(
      expect.arrayContaining(['/api/', '/auth/', '/graphql', '/_next/data/']),
    );
  });

  it('caches the shared local-reader chunks discovered from reader route manifests', () => {
    fixture = createFixture();
    generate(fixture);

    const assets = readGeneratedInventory(fixture).assets;
    // `/chunks/reader.js` is referenced only by the books/bible reader route
    // manifests, not the offline document. It must still be cached or a cold
    // offline hub cannot boot the shared reader views.
    expect(assets).toContain('/_next/static/chunks/reader.js');
    expect(assets).not.toContain('/api/graphql');
  });

  it('still generates when only the offline manifest is present', () => {
    fixture = createFixture({ omitLocalReaderManifests: true });
    generate(fixture);
    const assets = readGeneratedInventory(fixture).assets;
    expect(assets).toContain('/_next/static/chunks/runtime.js');
    expect(assets).not.toContain('/_next/static/chunks/reader.js');
  });

  it('installs only successful non-opaque allowlisted assets', async () => {
    fixture = createFixture();
    generate(fixture);
    const harness = createWorkerHarness(readGeneratedWorker(fixture));
    const inventory = readGeneratedInventory(fixture);
    const requested: string[] = [];
    harness.setNetwork((url) => {
      requested.push(url);
      if (url.endsWith('pwa-assets.json')) return { status: 200, body: JSON.stringify(inventory) };
      if (url.endsWith('/chunks/app.css')) return { status: 500, body: 'nope' };
      return { status: 200, body: 'asset' };
    });

    await expect(harness.install()).rejects.toThrow();

    const cacheName = `transformlit-shell-${inventory.releaseId}`;
    expect(await harness.cacheNames()).toEqual([]);
    expect(requested).toContain('/_next/static/chunks/app.css');
  });

  it('installs the shell and rejects a mixed-release inventory', async () => {
    fixture = createFixture();
    generate(fixture);
    const good = readGeneratedInventory(fixture);

    const passing = createWorkerHarness(readGeneratedWorker(fixture));
    passing.setNetwork((url) =>
      url.endsWith('pwa-assets.json') ? { status: 200, body: JSON.stringify(good) } : { status: 200, body: 'asset' },
    );
    await passing.install();
    const cacheName = `transformlit-shell-${good.releaseId}`;
    expect(await passing.cacheEntries(cacheName)).toContain('/offline');

    const mismatched = createWorkerHarness(readGeneratedWorker(fixture));
    mismatched.setNetwork((url) =>
      url.endsWith('pwa-assets.json')
        ? { status: 200, body: JSON.stringify({ ...good, releaseId: 'stale-release', inventoryDigest: 'different' }) }
        : { status: 200, body: 'asset' },
    );
    await expect(mismatched.install()).rejects.toThrow(/mixed-release/i);
  });

  it('never caches RSC or API requests and passes them to the network', async () => {
    fixture = createFixture();
    generate(fixture);
    const harness = createWorkerHarness(readGeneratedWorker(fixture));
    harness.setNetwork(() => ({ status: 200, body: 'network' }));

    const rsc = await harness.dispatch({ url: '/offline', headers: { accept: 'text/x-component' } });
    expect(rsc.handled).toBe(false);

    const routerPrefetch = await harness.dispatch({ url: '/feed', headers: { 'next-router-prefetch': '1' } });
    expect(routerPrefetch.handled).toBe(false);

    const rscQuery = await harness.dispatch({ url: '/offline?_rsc=abc' });
    expect(rscQuery.handled).toBe(false);

    const api = await harness.dispatch({ url: '/api/graphql', method: 'POST' });
    expect(api.handled).toBe(false);

    const graphql = await harness.dispatch({ url: '/graphql' });
    expect(graphql.handled).toBe(false);

    const auth = await harness.dispatch({ url: '/auth/refresh' });
    expect(auth.handled).toBe(false);
  });

  it('serves the cached offline document only for eligible navigations', async () => {
    fixture = createFixture();
    generate(fixture);
    const harness = createWorkerHarness(readGeneratedWorker(fixture));
    const inventory = readGeneratedInventory(fixture);
    harness.setNetwork((url) =>
      url.endsWith('pwa-assets.json') ? { status: 200, body: JSON.stringify(inventory) } : { status: 200, body: 'asset' },
    );
    await harness.install();

    // Online document navigation streams through the network.
    harness.setNetwork(() => ({ status: 200, body: 'live-document' }));
    const online = await harness.dispatch({ url: '/offline', mode: 'navigate' });
    expect(online).toMatchObject({ handled: true, body: 'live-document' });

    // Offline document navigation receives the cached shell, not an error.
    harness.setNetwork(() => 'offline');
    const offline = await harness.dispatch({ url: '/offline', mode: 'navigate' });
    expect(offline.handled).toBe(true);
    expect(offline.body).toBe('asset');

    // An offline RSC request is never answered with fallback HTML.
    const offlineRsc = await harness.dispatch({ url: '/offline?_rsc=abc', mode: 'navigate' });
    expect(offlineRsc.handled).toBe(false);
  });

  it('never writes private or non-allowlisted responses into the cache', async () => {
    fixture = createFixture();
    generate(fixture);
    const harness = createWorkerHarness(readGeneratedWorker(fixture));
    const inventory = readGeneratedInventory(fixture);
    harness.setNetwork((url) =>
      url.endsWith('pwa-assets.json') ? { status: 200, body: JSON.stringify(inventory) } : { status: 200, body: 'asset' },
    );
    await harness.install();

    await harness.dispatch({ url: '/api/graphql', method: 'POST' });
    await harness.dispatch({ url: '/auth/me' });
    await harness.dispatch({ url: '/_next/data/build/feed.json' });
    await harness.dispatch({ url: '/offline', headers: { accept: 'text/x-component' } });
    await harness.dispatch({ url: 'https://cdn.example.com/remote.js', mode: 'no-cors' });

    const entries = await harness.cacheEntries(`transformlit-shell-${inventory.releaseId}`);
    expect(entries).not.toContain('/api/graphql');
    expect(entries).not.toContain('/auth/me');
    expect(entries).not.toContain('/_next/data/build/feed.json');
    expect(entries.every((entry) => inventory.assets.includes(entry))).toBe(true);
  });

  it('refuses to cache a redirect or opaque asset during install', async () => {
    fixture = createFixture();
    generate(fixture);
    const inventory = readGeneratedInventory(fixture);

    const redirecting = createWorkerHarness(readGeneratedWorker(fixture));
    redirecting.setNetwork((url) => {
      if (url.endsWith('pwa-assets.json')) return { status: 200, body: JSON.stringify(inventory) };
      if (url.endsWith('/offline')) return { status: 200, body: '<html>', redirected: true };
      return { status: 200, body: 'asset' };
    });
    await expect(redirecting.install()).rejects.toThrow();

    const opaque = createWorkerHarness(readGeneratedWorker(fixture));
    opaque.setNetwork((url) => {
      if (url.endsWith('pwa-assets.json')) return { status: 200, body: JSON.stringify(inventory) };
      if (url.endsWith('/offline')) return { status: 200, body: '', type: 'opaque' };
      return { status: 200, body: 'asset' };
    });
    await expect(opaque.install()).rejects.toThrow();
  });

  it('only activates a waiting worker after an explicit message, then cleans old caches', async () => {
    fixture = createFixture();
    generate(fixture);
    const inventory = readGeneratedInventory(fixture);
    const harness = createWorkerHarness(readGeneratedWorker(fixture));
    harness.setNetwork((url) =>
      url.endsWith('pwa-assets.json') ? { status: 200, body: JSON.stringify(inventory) } : { status: 200, body: 'asset' },
    );
    await harness.install();

    expect(harness.skipWaitingCalls()).toBe(0);
    harness.message({ type: 'SKIP_WAITING' });
    expect(harness.skipWaitingCalls()).toBe(1);

    await harness.activate();
    expect(await harness.cacheNames()).toEqual([`transformlit-shell-${inventory.releaseId}`]);
  });

  describe('--verify', () => {
    it('accepts artifacts that match the current build output', () => {
      fixture = createFixture({ buildId: 'build-a' });
      generate(fixture);

      const result = runBuildScript(fixture, {}, ['--verify']);
      expect(result.status).toBe(0);
      expect(result.stderr).toBe('');
      expect(result.stdout).toMatch(/Verified pwa-assets\.json/);
    });

    it('rejects a stale inventory whose buildId does not match .next/BUILD_ID', () => {
      fixture = createFixture({ buildId: 'build-a' });
      generate(fixture);

      // A new `next build` changes BUILD_ID but a cached/stale public tree is
      // restored: the artifacts no longer describe the current build.
      writeFileSync(join(fixture.nextDir, 'BUILD_ID'), 'build-b');
      const result = runBuildScript(fixture, {}, ['--verify']);
      expect(result.status).not.toBe(0);
      expect(result.stderr).toMatch(/Stale PWA inventory/i);
    });

    it('rejects a worker whose embedded release does not match the inventory', () => {
      fixture = createFixture();
      generate(fixture);

      const inventory = readGeneratedInventory(fixture);
      const worker = readGeneratedWorker(fixture);
      const tamperedWorker = worker.replaceAll(inventory.inventoryDigest, '0'.repeat(inventory.inventoryDigest.length));
      writeFileSync(join(fixture.publicDir, 'sw.js'), tamperedWorker);

      const result = runBuildScript(fixture, {}, ['--verify']);
      expect(result.status).not.toBe(0);
      expect(result.stderr).toMatch(/does not match/i);
    });

    it('rejects a missing or empty worker artifact', () => {
      fixture = createFixture();
      generate(fixture);
      writeFileSync(join(fixture.publicDir, 'sw.js'), '');

      const result = runBuildScript(fixture, {}, ['--verify']);
      expect(result.status).not.toBe(0);
      expect(result.stderr).toMatch(/empty/i);
    });
  });
});
