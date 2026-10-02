import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { describe, it } from 'node:test';
import { execFileSync } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { request as httpsRequest } from 'node:https';
import { createServer } from 'node:http';
import { createConnection } from 'node:net';
import { PassThrough } from 'node:stream';
import { once } from 'node:events';
import ts from 'typescript';
import { WebSocket, WebSocketServer } from 'ws';
import { createPwaProxy, isLoopbackPeer, stripApiPrefix, pipeSafely } from './pwa-proxy.js';
import { assertOwnedMetadata, assertPortAvailable, assertSupervisorNonce, assertSupervisorSocketIdentity, cleanupOwnedResources, cleanupAfterStartupFailure, assertOwnedArtifactPath, assertOwnedPublicAssetRoot, isContainerReadableAssetMode, parsePwaHarnessArgs, waitForHarnessReady, waitForSupervisorExit, listenPwaSupervisorControl, requestPwaSupervisorControl } from './pwa-process.js';
import { assertTask1AOwnedDatabaseUrl } from './pwa-db.js';
import { createPwaFixturePlan, createPwaFramePayload, createPwaTextPayload } from '../helpers/pwa-fixtures.js';

function inspectPwaLoginUi(sourceText: string): {
  capturesLoginResponse: boolean;
  submitsLoginForm: boolean;
  waitsForFeed: boolean;
  bypassesLoginUi: boolean;
} {
  const source = ts.createSourceFile('pwa-fixtures.ts', sourceText, ts.ScriptTarget.Latest, true);
  let loginFunction: ts.FunctionDeclaration | undefined;
  function findLogin(node: ts.Node): void {
    if (ts.isFunctionDeclaration(node) && node.name?.text === 'loginPwaPage') {
      loginFunction = node;
    }
    ts.forEachChild(node, findLogin);
  }
  findLogin(source);
  if (!loginFunction?.body) {
    return { capturesLoginResponse: false, submitsLoginForm: false, waitsForFeed: false, bypassesLoginUi: false };
  }

  const calls: ts.CallExpression[] = [];
  function collectCalls(node: ts.Node): void {
    if (ts.isCallExpression(node)) calls.push(node);
    ts.forEachChild(node, collectCalls);
  }
  collectCalls(loginFunction.body);

  function methodName(call: ts.CallExpression): string | null {
    return ts.isPropertyAccessExpression(call.expression) ? call.expression.name.text : null;
  }
  function pageMethod(call: ts.CallExpression, method: string): boolean {
    return methodName(call) === method && ts.isPropertyAccessExpression(call.expression) &&
      ts.isIdentifier(call.expression.expression) && call.expression.expression.text === 'page';
  }
  function subtreeContainsLoginPath(node: ts.Node): boolean {
    if (ts.isStringLiteral(node) && node.text === '/api/auth/login') {
      return true;
    }
    return node.getChildren(source).some(subtreeContainsLoginPath);
  }

  const capturesLoginResponse = calls.some((call) =>
    pageMethod(call, 'waitForResponse') && call.arguments.some(subtreeContainsLoginPath),
  );
  const submitsLoginForm = calls.some((call) => {
    if (methodName(call) !== 'click' || !ts.isPropertyAccessExpression(call.expression)) {
      return false;
    }
    const locator = call.expression.expression;
    return ts.isCallExpression(locator) && ts.isPropertyAccessExpression(locator.expression) &&
      locator.expression.name.text === 'getByRole' && ts.isIdentifier(locator.expression.expression) &&
      locator.expression.expression.text === 'page';
  });
  const waitsForFeed = calls.some((call) => {
    if (methodName(call) !== 'toHaveURL' || !ts.isPropertyAccessExpression(call.expression)) {
      return false;
    }
    const assertion = call.expression.expression;
    return ts.isCallExpression(assertion) && ts.isIdentifier(assertion.expression) &&
      assertion.expression.text === 'expect' &&
      assertion.arguments.some((argument) => ts.isIdentifier(argument) && argument.text === 'page') &&
      call.arguments.some((argument) => ts.isRegularExpressionLiteral(argument) && /feed/.test(argument.text));
  });
  const bypassesLoginUi = calls.some((call) =>
    (ts.isIdentifier(call.expression) && call.expression.text === 'fetch') ||
    methodName(call) === 'post' || methodName(call) === 'clearCookies',
  );
  return { capturesLoginResponse, submitsLoginForm, waitsForFeed, bypassesLoginUi };
}

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

  it('parses publish-v2 book ID separately from supervise owner ID and nonce', () => {
    assert.deepEqual(parsePwaHarnessArgs(['publish-v2', 'book-123']), { operation: 'publish-v2', bookId: 'book-123' });
    assert.deepEqual(parsePwaHarnessArgs(['supervise', 'owner-123', 'nonce-456']), { operation: 'supervise', ownerId: 'owner-123', nonce: 'nonce-456' });
  });

  it('uses half-open IPC and responds after delayed publish-v2 work completes', async () => {
    const nonce = randomUUID();
    const socketPath = `/tmp/pwa-ipc-${randomUUID()}.sock`;
    let updated = false;
    const server = await listenPwaSupervisorControl(socketPath, nonce, async (message) => {
      await new Promise((resolve) => setTimeout(resolve, 20));
      updated = message.command === 'publish-v2' && message.bookId === 'book-1';
      return { ok: updated, state: 'updated' };
    });
    const closed = once(server, 'close');
    try {
      const response = await requestPwaSupervisorControl(socketPath, nonce, 'publish-v2', 'book-1');
      assert.deepEqual(response, { ok: true, state: 'updated' });
      assert.equal(updated, true);
    } finally {
      server.close();
      await closed;
    }
  });

  it('returns shutdown only after async metadata work and lets the supervisor socket close', async () => {
    const nonce = randomUUID();
    const socketPath = `/tmp/pwa-ipc-${randomUUID()}.sock`;
    let metadataSaved = false;
    let server: import('node:net').Server;
    server = await listenPwaSupervisorControl(socketPath, nonce, async (message) => {
      await new Promise((resolve) => setTimeout(resolve, 20));
      metadataSaved = message.command === 'shutdown';
      server.close();
      return { ok: metadataSaved, state: 'stopped' };
    });
    const closed = once(server, 'close');
    const response = await requestPwaSupervisorControl(socketPath, nonce, 'shutdown');
    assert.deepEqual(response, { ok: true, state: 'stopped' });
    assert.equal(metadataSaved, true);
    await closed;
  });

  it('completes supervisor work when a peer closes early and continues serving requests', async () => {
    const nonce = randomUUID();
    const socketPath = `/tmp/pwa-ipc-${randomUUID()}.sock`;
    let startWork!: () => void;
    let finishWork!: () => void;
    const workStarted = new Promise<void>((resolve) => { startWork = resolve; });
    const workGate = new Promise<void>((resolve) => { finishWork = resolve; });
    let workCompleted = false;
    const server = await listenPwaSupervisorControl(socketPath, nonce, async (message) => {
      if (message.command === 'slow') {
        startWork();
        await workGate;
        workCompleted = true;
        return { ok: true };
      }
      return { ok: true, state: 'ready' };
    });
    const closed = once(server, 'close');
    const peer = createConnection(socketPath);
    try {
      await once(peer, 'connect');
      peer.end(`${JSON.stringify({ nonce, command: 'slow' })}\n`);
      await workStarted;
      peer.destroy();
      finishWork();
      await new Promise((resolve) => setTimeout(resolve, 10));
      assert.equal(workCompleted, true);
      assert.deepEqual(await requestPwaSupervisorControl(socketPath, nonce, 'ping'), { ok: true, state: 'ready' });
    } finally {
      peer.destroy();
      server.close();
      await closed;
    }
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

  it('keeps container-readable assets in their exact ignored root, separate from owner secrets', () => {
    const assets = assertOwnedPublicAssetRoot('/repo/.pwa-harness-assets', 'owner-1', '/repo/.pwa-harness-assets/owner-1');
    assert.equal(assets, '/repo/.pwa-harness-assets/owner-1');
    assert.throws(() => assertOwnedPublicAssetRoot('/repo/.pwa-harness-assets', 'owner-1', '/repo/.pwa-harness-assets/owner-10'), /equal this invocation/i);
    assert.notEqual(assets, '/repo/.pwa-harness/owner-1');
    assert.equal(isContainerReadableAssetMode(0o755, 'directory'), true);
    assert.equal(isContainerReadableAssetMode(0o644, 'file'), true);
    assert.equal(isContainerReadableAssetMode(0o700, 'directory'), false);
    assert.equal(isContainerReadableAssetMode(0o600, 'file'), false);
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
    const v1Text = JSON.parse(createPwaTextPayload(1, 1, 'v1 page').toString()) as { items: Array<Record<string, unknown>> };
    const v2Text = JSON.parse(createPwaTextPayload(2, 1, 'v2 page').toString()) as { items: Array<Record<string, unknown>> };
    assert.deepEqual(Object.keys(v1Text.items[0]).sort(), ['h', 't', 'w', 'x', 'y']);
    assert.equal(v1Text.items[0].t, 'v1 page (v1)');
    assert.equal(v2Text.items[0].t, 'v2 page (v2)');
    for (const item of [...v1Text.items, ...v2Text.items]) {
      for (const coordinate of ['x', 'y', 'w', 'h']) assert.equal(typeof item[coordinate], 'number');
    }
  });

  it('keeps private harness state out of Docker contexts and uses pinned TLS profile configuration', () => {
    const dockerignore = readFileSync('../../.dockerignore', 'utf8');
    const playwrightConfig = readFileSync('../../apps/web/playwright.pwa.config.ts', 'utf8');
    const playwrightFixture = readFileSync('../../apps/web/e2e/pwa-fixtures.ts', 'utf8');
    const smoke = readFileSync('../../apps/web/e2e/pwa-smoke.pwa.spec.ts', 'utf8');
    assert.match(dockerignore, /^\/\.pwa-harness\/$/m);
    assert.match(dockerignore, /^\/\.pwa-harness-assets\/$/m);
    assert.match(readFileSync('../../.gitignore', 'utf8'), /^\/\.pwa-harness-assets\/$/m);
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
    assert.match(fixtureSeeder, /createPwaTextPayload/);
    assert.match(fixtureSeeder, /conversionStatus: 'READY'/);
    assert.match(fixtureSeeder, /publishPwaVersion2/);
    assert.match(webFixtures, /PWA_FIXTURE_CREDENTIALS/);
    assert.match(webFixtures, /\/api\/auth\/login/);
    assert.deepEqual(inspectPwaLoginUi(webFixtures), {
      capturesLoginResponse: true,
      submitsLoginForm: true,
      waitsForFeed: true,
      bypassesLoginUi: false,
    });
    assert.match(harness, /127\.0\.0\.1:3000\/login/);
    assert.doesNotMatch(harness, /127\.0\.0\.1:3000\/offline/);
    assert.ok(harness.indexOf("['build', '-f', 'apps/api/Dockerfile'") < harness.indexOf('randomBytes(48)'));
    assert.match(harness, /\.pwa-harness-assets/);
    assert.match(harness, /owner\.assetRoot = join\(publicAssetRoot, id\)/);
    assert.match(harness, /BOOK_STORAGE_DIR=\/pwa-book-storage/);
    assert.match(harness, /\$\{storageDir\}:\/pwa-book-storage:ro/);
    assert.match(harness, /runtimeEnvPath = join\(ownedDir,/);
    assert.match(harness, /chmod\(path, 0o755\)/);
    assert.match(harness, /chmod\(path, 0o644\)/);
    assert.doesNotMatch(harness, /\bvoid\s+[A-Za-z_$({]/);
    assert.equal(isContainerReadableAssetMode(0o755, 'directory'), true);
    assert.equal(isContainerReadableAssetMode(0o644, 'file'), true);
    assert.equal(isContainerReadableAssetMode(0o700, 'directory'), false);
    assert.equal(isContainerReadableAssetMode(0o600, 'file'), false);
    assert.match(harness, /child\.once\('exit'/);
    assert.match(harness, /Supervisor exited during startup/);
  });

  it('checks the PWA UI-login AST contract and rejects comments/API bypasses', () => {
    const commentOnly = `// page.getByRole('button').click(); page.waitForResponse('/api/auth/login'); expect(page).toHaveURL(/feed/);\nfunction loginPwaPage(page) { return undefined; }`;
    assert.deepEqual(inspectPwaLoginUi(commentOnly), {
      capturesLoginResponse: false,
      submitsLoginForm: false,
      waitsForFeed: false,
      bypassesLoginUi: false,
    });

    const bypasses = `function loginPwaPage(page) { fetch('/api/auth/login'); page.request.post('/api/auth/login'); page.context.clearCookies(); }`;
    assert.deepEqual(inspectPwaLoginUi(bypasses), {
      capturesLoginResponse: false,
      submitsLoginForm: false,
      waitsForFeed: false,
      bypassesLoginUi: true,
    });
  });
});

describe('same-origin HTTPS proxy', () => {
  it('accepts only loopback peers including the IPv4-mapped form', () => {
    assert.equal(isLoopbackPeer('127.0.0.1'), true);
    assert.equal(isLoopbackPeer('::1'), true);
    assert.equal(isLoopbackPeer('::ffff:127.0.0.1'), true);
    assert.equal(isLoopbackPeer('10.0.0.1'), false);
    assert.equal(isLoopbackPeer('::ffff:10.0.0.1'), false);
    assert.equal(isLoopbackPeer(undefined), false);
  });

  it('treats a destroy-before-pipe race as a disconnect instead of an uncaught crash', () => {
    // Regression: a browser aborting a fetch while the upstream is still opening
    // leaves the destination destroyed. Node's `pipeline()` throws synchronously
    // with ERR_STREAM_UNABLE_TO_PIPE, which previously escaped to the
    // supervisor's uncaughtException handler and killed the harness mid-run.
    const source = new PassThrough();
    const destination = new PassThrough();
    destination.destroy();
    assert.doesNotThrow(() => pipeSafely(source, destination));
  });

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
      if (request.url === '/immutable') {
        // Mirrors Next's real `/_next/static/**` cache policy: the proxy must
        // pass this through, not clobber it with `no-store`.
        response.writeHead(200, { 'content-type': 'application/javascript', 'cache-control': 'public, max-age=31536000, immutable' }).end('chunk');
        return;
      }
      if (request.url === '/no-store-worker') {
        // Mirrors the generated `/sw.js` policy: an explicit upstream no-store
        // is also preserved verbatim.
        response.writeHead(200, { 'content-type': 'application/javascript', 'cache-control': 'no-cache, no-store, must-revalidate' }).end('worker');
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

      // An upstream-declared cache policy must pass through unchanged. A
      // forced `no-store` here would hide the real `/_next/static/**` immutable
      // header a production deployment serves.
      const immutable = await new Promise<{ status: number; cacheControl: string | undefined; body: string }>((resolve, reject) => {
        const request = httpsRequest({ hostname: 'localhost', port: proxyPort, path: '/api/immutable', ca: awaitRead(certPath) }, (result) => {
          const chunks: Buffer[] = [];
          result.on('data', (chunk: Buffer) => chunks.push(chunk));
          result.on('end', () => resolve({ status: result.statusCode ?? 0, cacheControl: result.headers['cache-control'], body: Buffer.concat(chunks).toString() }));
        });
        request.on('error', reject);
        request.end();
      });
      assert.equal(immutable.status, 200);
      assert.equal(immutable.body, 'chunk');
      assert.equal(immutable.cacheControl, 'public, max-age=31536000, immutable');

      const worker = await new Promise<{ status: number; cacheControl: string | undefined }>((resolve, reject) => {
        const request = httpsRequest({ hostname: 'localhost', port: proxyPort, path: '/api/no-store-worker', ca: awaitRead(certPath) }, (result) => {
          result.resume();
          result.on('end', () => resolve({ status: result.statusCode ?? 0, cacheControl: result.headers['cache-control'] }));
        });
        request.on('error', reject);
        request.end();
      });
      assert.equal(worker.status, 200);
      assert.equal(worker.cacheControl, 'no-cache, no-store, must-revalidate');

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
