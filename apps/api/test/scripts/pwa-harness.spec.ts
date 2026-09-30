import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { execFileSync } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { request as httpsRequest } from 'node:https';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { WebSocket, WebSocketServer } from 'ws';
import { createPwaProxy, stripApiPrefix } from './pwa-proxy.js';
import { assertOwnedMetadata, assertPortAvailable, assertSupervisorNonce, assertSupervisorSocketIdentity, cleanupOwnedResources, cleanupAfterStartupFailure, assertOwnedArtifactPath, waitForHarnessReady, waitForSupervisorExit } from './pwa-process.js';
import { assertTask1AOwnedDatabaseUrl } from './pwa-db.js';
import { createPwaFixturePlan, createPwaFramePayload } from '../helpers/pwa-fixtures.js';

describe('PWA harness safety contract', () => {
  it('strips /api while preserving path and query', () => {
    assert.equal(stripApiPrefix('/api/books?page=2'), '/books?page=2');
    assert.equal(stripApiPrefix('/api'), '/');
    assert.equal(stripApiPrefix('/api?health=1'), '/?health=1');
    assert.equal(stripApiPrefix('/other'), null);
  });

  it('accepts Task 1A owned localhost URL and rejects a modified URL', () => {
    const container = { getConnectionUri: () => 'postgresql://test:test@localhost:49152/testdb' };
    assert.equal(assertTask1AOwnedDatabaseUrl(container.getConnectionUri(), container as never), container.getConnectionUri());
    assert.throws(() => assertTask1AOwnedDatabaseUrl('postgresql://test:test@localhost:49153/testdb', container as never), /owned/i);
  });

  it('rejects metadata without this harness ownership marker', () => {
    assert.throws(() => assertOwnedMetadata({ owner: 'not-pwa', id: 'x' }), /ownership/i);
    assert.throws(() => assertOwnedMetadata({ owner: 'transformlit-pwa', id: '' }), /ownership/i);
    assert.doesNotThrow(() => assertOwnedMetadata({ owner: 'transformlit-pwa', id: '11111111-1111-4111-8111-111111111111', ports: [], containers: [], images: [], pids: [], artifacts: [], databaseUrl: 'postgresql://pwa:secret@127.0.0.1:49152/testdb' }));
    assert.throws(() => assertOwnedMetadata({ owner: 'transformlit-pwa', id: '11111111-1111-4111-8111-111111111111', ports: [], containers: ['unowned'], images: [], pids: [], artifacts: [], databaseUrl: 'postgresql://pwa:secret@127.0.0.1:49152/testdb' }), /ownership/i);
    assert.doesNotThrow(() => assertOwnedMetadata({ owner: 'transformlit-pwa', id: '11111111-1111-4111-8111-111111111111', ports: [], containers: [], images: [], pids: [], artifacts: [], databaseUrl: 'postgresql://test:test@localhost:49152/testdb' }));
  });

  it('authenticates supervisor control requests with the invocation nonce', () => {
    assert.doesNotThrow(() => assertSupervisorNonce('a'.repeat(64), 'a'.repeat(64)));
    assert.throws(() => assertSupervisorNonce('b'.repeat(64), 'a'.repeat(64)), /nonce mismatch/i);
  });

  it('refuses to unlink a supervisor socket when the recorded process identity was reused', () => {
    const identity = { dev: 1, ino: 2, uid: 501 };
    assert.doesNotThrow(() => assertSupervisorSocketIdentity({ ...identity, isSocket: true }, identity));
    assert.throws(() => assertSupervisorSocketIdentity({ dev: 1, ino: 3, uid: 501, isSocket: true }, identity), /identity mismatch/i);
    assert.throws(() => assertSupervisorSocketIdentity({ ...identity, isSocket: false }, identity), /identity mismatch/i);
  });

  it('refuses occupied loopback ports', async () => {
    const server = createServer();
    server.listen(0, '127.0.0.1');
    await once(server, 'listening');
    const port = (server.address() as import('node:net').AddressInfo).port;
    try { await assert.rejects(assertPortAvailable(port), /occupied/i); }
    finally { await new Promise<void>((resolve) => server.close(() => resolve())); }
  });

  it('never removes an unrelated matching container when owner labels mismatch or inspect fails', async () => {
    const removals: string[] = [];
    const mismatch = {
      inspect: async (id: string) => ({ id, labels: { 'transformlit.owner': 'other-owner' } }),
      remove: async (id: string) => { removals.push(id); },
    };
    await assert.rejects(cleanupOwnedResources(['unrelated-prefix-id'], 'owner-1', mismatch), /owned/i);
    const inspectionFailure = {
      inspect: async (id: string) => {
        if (id === 'verified-owned') return { id, labels: { 'transformlit.owner': 'owner-1' } };
        throw new Error('daemon unavailable');
      },
      remove: async (id: string) => { removals.push(id); },
    };
    await assert.rejects(cleanupOwnedResources(['verified-owned', 'unknown-id'], 'owner-1', inspectionFailure), /daemon unavailable/);
    await cleanupOwnedResources(['confirmed-gone'], 'owner-1', {
      inspect: async () => { throw Object.assign(new Error('missing'), { code: 'NOT_FOUND' }); },
      remove: async (id) => { removals.push(id); },
    });
    assert.deepEqual(removals, []);
  });

  it('accepts only artifact paths within the exact owner directory and refuses failed readiness', async () => {
    assert.equal(assertOwnedArtifactPath('/repo/.pwa-harness', 'owner-1', '/repo/.pwa-harness/owner-1/tls.pem'), '/repo/.pwa-harness/owner-1/tls.pem');
    assert.throws(() => assertOwnedArtifactPath('/repo/.pwa-harness', 'owner-1', '/repo/.pwa-harness/owner-10/secret'), /owner directory/i);
    await assert.rejects(waitForHarnessReady({ api: async () => true, web: async () => false, proxy: async () => true }, 1), /web.*not ready/i);
  });

  it('retries transient readiness connection failures until services are ready', async () => {
    let apiAttempts = 0;
    await waitForHarnessReady({
      api: async () => { apiAttempts += 1; if (apiAttempts === 1) throw new Error('connection refused'); return true; },
      web: async () => true,
      proxy: async () => true,
    }, 2, 1);
    assert.equal(apiAttempts, 2);
  });

  it('makes repeated owned shutdown requests idempotent after resources are gone', async () => {
    const present = new Set(['owned-id']);
    const runtime = {
      inspect: async (id: string) => {
        if (!present.has(id)) throw Object.assign(new Error('missing'), { code: 'NOT_FOUND' });
        return { id, labels: { 'transformlit.owner': 'owner-1' } };
      },
      remove: async (id: string) => { present.delete(id); },
    };
    await cleanupOwnedResources(['owned-id'], 'owner-1', runtime);
    await cleanupOwnedResources(['owned-id'], 'owner-1', runtime);
    assert.equal(present.size, 0);
  });

  it('waits for supervisor exit and preserves failed metadata when interrupted cleanup cannot be verified', async () => {
    let checks = 0;
    await waitForSupervisorExit(async () => { checks += 1; return checks === 1; }, 2, 1);
    assert.equal(checks, 2);
    let failedOwnerRecorded = false;
    const cleaned = await cleanupAfterStartupFailure(async () => { throw new Error('inspect interrupted startup failed'); }, async () => { failedOwnerRecorded = true; });
    assert.equal(cleaned, false);
    assert.equal(failedOwnerRecorded, true);
  });

  it('describes two accounts and version/publication fixture setup without database access', () => {
    const plan = createPwaFixturePlan('owner-test');
    assert.equal(plan.accounts.length, 2);
    assert.equal(plan.credentials.length, 2);
    assert.ok(plan.credentials.every(({ password }) => password.length >= 32));
    assert.ok(plan.books.readable.pages.length > 1);
    assert.equal(plan.books.restricted.restricted, true);
    assert.deepEqual(plan.books.readable.contentVersions, [1, 2]);
    assert.equal(plan.books.publicationChangeDuringDownload.hook, 'pwa-harness.ts publish-v2');
    assert.notDeepEqual(createPwaFramePayload(1), createPwaFramePayload(2));
  });

  it('keeps private harness state out of Docker contexts and uses pinned TLS profile configuration', () => {
    const dockerignore = readFileSync('../../.dockerignore', 'utf8');
    const playwrightConfig = readFileSync('../../apps/web/playwright.pwa.config.ts', 'utf8');
    const playwrightFixture = readFileSync('../../apps/web/e2e/pwa-fixtures.ts', 'utf8');
    const smoke = readFileSync('../../apps/web/e2e/pwa-smoke.pwa.spec.ts', 'utf8');
    assert.match(dockerignore, /^\/\.pwa-harness\/$/m);
    assert.match(playwrightFixture, /launchPersistentContext/);
    assert.match(playwrightFixture, /ignore-certificate-errors-spki-list/);
    assert.doesNotMatch(playwrightFixture, /--ignore-certificate-errors(?!-spki-list)/);
    assert.doesNotMatch(playwrightFixture, /--user-data-dir/);
    assert.match(smoke, /globalThis\.isSecureContext/);
    assert.match(smoke, /page\.evaluate\(async \(\) =>/);
    const harness = readFileSync('test/scripts/pwa-harness.ts', 'utf8');
    const disposableDb = readFileSync('test/helpers/pwa-disposable-db.ts', 'utf8');
    const fixtureSeeder = readFileSync('test/helpers/pwa-fixtures.ts', 'utf8');
    const webFixtures = readFileSync('../../apps/web/e2e/pwa-fixtures.ts', 'utf8');
    assert.match(harness, /JWT_SECRET=\$\{jwtSecret\}/);
    assert.match(harness, /randomBytes\(48\)/);
    assert.match(disposableDb, /withLabels\(\{ 'transformlit\.owner': ownerId \}\)/);
    assert.match(harness, /transformlit\.owner=\$\{id\}/);
    assert.match(harness, /mode: 0o600/);
    assert.match(fixtureSeeder, /argon2\.hash/);
    assert.match(fixtureSeeder, /new LocalStorageAdapter\(storageDir\)/);
    assert.match(fixtureSeeder, /conversionStatus: 'READY'/);
    assert.match(fixtureSeeder, /publishPwaVersion2/);
    assert.match(webFixtures, /PWA_FIXTURE_CREDENTIALS/);
    assert.match(webFixtures, /\/api\/auth\/login/);
    assert.match(webFixtures, /\/api\/auth\/refresh/);
    assert.match(harness, /127\.0\.0\.1:3000\/login/);
    assert.doesNotMatch(harness, /127\.0\.0\.1:3000\/offline/);
    assert.ok(harness.indexOf("['build', '-f', 'apps/api/Dockerfile'") < harness.indexOf('randomBytes(48)'));
    assert.match(harness, /child\.once\('exit'/);
    assert.match(harness, /Supervisor exited during startup/);
  });
});

describe('same-origin HTTPS proxy', () => {
  it('streams API responses without fallback, preserving status, MIME, CSP, cookies and WS upgrades', async () => {
    const temp = await mkdtemp(join(tmpdir(), 'pwa-proxy-test-'));
    const keyPath = join(temp, 'key.pem');
    const certPath = join(temp, 'cert.pem');
    execFileSync('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-days', '1', '-keyout', keyPath, '-out', certPath, '-subj', '/CN=localhost', '-addext', 'subjectAltName=DNS:localhost']);
    let upstreamWebSocketPath = '';
    const api = createServer((request, response) => {
      if (request.url === '/stream') {
        response.writeHead(206, { 'content-type': 'application/octet-stream', 'content-security-policy': "default-src 'none'", 'set-cookie': 'session=secret; Secure; HttpOnly; SameSite=Strict' });
        response.write('first');
        setTimeout(() => response.end('second'), 30);
        return;
      }
      response.writeHead(404, { 'content-type': 'application/json' }).end('{"error":"missing"}');
    });
    const web = createServer((_request, response) => response.end('<html>web-shell</html>'));
    const wss = new WebSocketServer({ noServer: true });
    wss.on('connection', (socket) => socket.send('graphql-ws')); 
    api.on('upgrade', (request, socket, head) => {
      upstreamWebSocketPath = request.url ?? '';
      wss.handleUpgrade(request, socket, head, (client) => wss.emit('connection', client, request));
    });
    api.listen(0, '127.0.0.1');
    web.listen(0, '127.0.0.1');
    await Promise.all([once(api, 'listening'), once(web, 'listening')]);
    const proxy = createPwaProxy({ keyPath, certPath, apiPort: (api.address() as import('node:net').AddressInfo).port, webPort: (web.address() as import('node:net').AddressInfo).port });
    proxy.listen(0, '127.0.0.1');
    await once(proxy, 'listening');
    const proxyPort = (proxy.address() as import('node:net').AddressInfo).port;
    try {
      const response = await new Promise<{ status: number; headers: import('node:http').IncomingHttpHeaders; body: string; chunks: string[] }>((resolve, reject) => {
        const request = httpsRequest({ hostname: 'localhost', port: proxyPort, path: '/api/stream', ca: awaitRead(certPath) }, (result) => {
          const chunks: Buffer[] = [];
          result.on('data', (chunk: Buffer) => chunks.push(chunk));
          result.on('end', () => resolve({ status: result.statusCode ?? 0, headers: result.headers, body: Buffer.concat(chunks).toString(), chunks: chunks.map((chunk) => chunk.toString()) }));
        });
        request.on('error', reject);
        request.end();
      });
      assert.equal(response.status, 206);
      assert.equal(response.body, 'firstsecond');
      assert.deepEqual(response.chunks, ['first', 'second']);
      assert.equal(response.headers['content-type'], 'application/octet-stream');
      assert.equal(response.headers['content-security-policy'], "default-src 'none'");
      assert.equal(response.headers['set-cookie']?.[0], 'session=secret; Secure; HttpOnly; SameSite=Strict');
      assert.equal(response.headers['cache-control'], 'no-store');

      const missing = await new Promise<{ status: number; body: string }>((resolve, reject) => {
        const request = httpsRequest({ hostname: 'localhost', port: proxyPort, path: '/api/not-found', ca: awaitRead(certPath) }, (result) => {
          const chunks: Buffer[] = [];
          result.on('data', (chunk: Buffer) => chunks.push(chunk));
          result.on('end', () => resolve({ status: result.statusCode ?? 0, body: Buffer.concat(chunks).toString() }));
        });
        request.on('error', reject);
        request.end();
      });
      assert.equal(missing.status, 404);
      assert.equal(missing.body, '{"error":"missing"}');

      const wsMessage = new Promise<string>((resolve, reject) => {
        const socket = new WebSocket(`wss://localhost:${proxyPort}/api/graphql`, { ca: awaitRead(certPath) });
        socket.once('message', (message) => { resolve(message.toString()); socket.close(); });
        socket.once('error', reject);
      });
      assert.equal(await wsMessage, 'graphql-ws');
      assert.equal(upstreamWebSocketPath, '/graphql');
    } finally {
      await Promise.all([new Promise<void>((resolve) => proxy.close(() => resolve())), new Promise<void>((resolve) => api.close(() => resolve())), new Promise<void>((resolve) => web.close(() => resolve()))]);
      wss.close();
      await rm(temp, { recursive: true, force: true });
    }
  });
});

function awaitRead(path: string): Buffer {
  return readFileSync(path);
}
