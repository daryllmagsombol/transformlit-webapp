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
import { assertOwnedMetadata, assertPortAvailable, isSafeDatabaseUrl } from './pwa-process.js';
import { createPwaFixturePlan } from '../helpers/pwa-fixtures.js';

describe('PWA harness safety contract', () => {
  it('strips /api while preserving path and query', () => {
    assert.equal(stripApiPrefix('/api/books?page=2'), '/books?page=2');
    assert.equal(stripApiPrefix('/api'), '/');
    assert.equal(stripApiPrefix('/api?health=1'), '/?health=1');
    assert.equal(stripApiPrefix('/other'), null);
  });

  it('accepts only a loopback disposable database URL', () => {
    assert.equal(isSafeDatabaseUrl('postgresql://pwa:secret@127.0.0.1:49152/testdb'), true);
    assert.equal(isSafeDatabaseUrl('postgresql://user:pass@localhost:5432/postgres'), false);
    assert.equal(isSafeDatabaseUrl('postgresql://remote.example/testdb'), false);
  });

  it('rejects metadata without this harness ownership marker', () => {
    assert.throws(() => assertOwnedMetadata({ owner: 'not-pwa', id: 'x' }), /ownership/i);
    assert.throws(() => assertOwnedMetadata({ owner: 'transformlit-pwa', id: '' }), /ownership/i);
    assert.doesNotThrow(() => assertOwnedMetadata({ owner: 'transformlit-pwa', id: '11111111-1111-4111-8111-111111111111', ports: [], containers: [], images: [], pids: [], artifacts: [], databaseUrl: 'postgresql://pwa:secret@127.0.0.1:49152/testdb' }));
    assert.throws(() => assertOwnedMetadata({ owner: 'transformlit-pwa', id: '11111111-1111-4111-8111-111111111111', ports: [], containers: ['unowned'], images: [], pids: [], artifacts: [], databaseUrl: 'postgresql://pwa:secret@127.0.0.1:49152/testdb' }), /ownership/i);
  });

  it('refuses occupied loopback ports', async () => {
    const server = createServer();
    server.listen(0, '127.0.0.1');
    await once(server, 'listening');
    const port = (server.address() as import('node:net').AddressInfo).port;
    try { await assert.rejects(assertPortAvailable(port), /occupied/i); }
    finally { await new Promise<void>((resolve) => server.close(() => resolve())); }
  });

  it('describes two accounts and version/publication fixture setup without database access', () => {
    const plan = createPwaFixturePlan('owner-test');
    assert.equal(plan.accounts.length, 2);
    assert.ok(plan.books.readable.pages.length > 1);
    assert.equal(plan.books.restricted.restricted, true);
    assert.deepEqual(plan.books.readable.contentVersions, [1, 2]);
    assert.equal(plan.books.publicationChangeDuringDownload, true);
  });
});

describe('same-origin HTTPS proxy', () => {
  it('streams API responses without fallback, preserving status, MIME, CSP, cookies and WS upgrades', async () => {
    const temp = await mkdtemp(join(tmpdir(), 'pwa-proxy-test-'));
    const keyPath = join(temp, 'key.pem');
    const certPath = join(temp, 'cert.pem');
    execFileSync('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-days', '1', '-keyout', keyPath, '-out', certPath, '-subj', '/CN=localhost', '-addext', 'subjectAltName=DNS:localhost']);
    const api = createServer((request, response) => {
      if (request.url === '/stream') {
        response.writeHead(206, { 'content-type': 'application/octet-stream', 'content-security-policy': "default-src 'none'", 'set-cookie': 'session=secret; Secure; HttpOnly; SameSite=Strict' });
        response.write('first');
        setTimeout(() => response.end('second'), 5);
        return;
      }
      response.writeHead(404, { 'content-type': 'application/json' }).end('{"error":"missing"}');
    });
    const web = createServer((_request, response) => response.end('<html>web-shell</html>'));
    const wss = new WebSocketServer({ noServer: true });
    wss.on('connection', (socket) => socket.send('graphql-ws')); 
    api.on('upgrade', (request, socket, head) => wss.handleUpgrade(request, socket, head, (client) => wss.emit('connection', client, request)));
    api.listen(0, '127.0.0.1');
    web.listen(0, '127.0.0.1');
    await Promise.all([once(api, 'listening'), once(web, 'listening')]);
    const proxy = createPwaProxy({ keyPath, certPath, apiPort: (api.address() as import('node:net').AddressInfo).port, webPort: (web.address() as import('node:net').AddressInfo).port });
    proxy.listen(0, '127.0.0.1');
    await once(proxy, 'listening');
    const proxyPort = (proxy.address() as import('node:net').AddressInfo).port;
    try {
      const response = await new Promise<{ status: number; headers: import('node:http').IncomingHttpHeaders; body: string }>((resolve, reject) => {
        const request = httpsRequest({ hostname: 'localhost', port: proxyPort, path: '/api/stream', ca: awaitRead(certPath) }, (result) => {
          const chunks: Buffer[] = [];
          result.on('data', (chunk: Buffer) => chunks.push(chunk));
          result.on('end', () => resolve({ status: result.statusCode ?? 0, headers: result.headers, body: Buffer.concat(chunks).toString() }));
        });
        request.on('error', reject);
        request.end();
      });
      assert.equal(response.status, 206);
      assert.equal(response.body, 'firstsecond');
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
