import { createServer as createHttpsServer } from 'node:https';
import { readFileSync } from 'node:fs';
import { pipeline, type Readable, type Writable } from 'node:stream';
import { request as httpRequest } from 'node:http';
import { connect } from 'node:net';

export function stripApiPrefix(path: string): string | null {
  const queryIndex = path.indexOf('?');
  const pathname = queryIndex === -1 ? path : path.slice(0, queryIndex);
  const query = queryIndex === -1 ? '' : path.slice(queryIndex);
  if (pathname === '/api') return `/${query}`;
  if (pathname.startsWith('/api/')) return `${pathname.slice(4)}${query}`;
  return null;
}

function isLoopbackPeer(address: string | undefined): boolean {
  return address === '127.0.0.1' || address === '::1' || address === '::ffff:127.0.0.1';
}

/**
 * Pipes one request-half into the other without ever letting a raced client
 * disconnect crash the supervisor. Node's `pipeline()` throws synchronously with
 * `ERR_STREAM_UNABLE_TO_PIPE` when the destination was already destroyed (a
 * browser aborting a fetch while the upstream is still opening), and that
 * synchronous throw bypasses the callback. Treat that race as a normal
 * disconnect: abort the source and move on instead of surfacing an
 * `uncaughtException`.
 */
export function pipeSafely(source: Readable, destination: Writable): void {
  try {
    pipeline(source, destination, (error) => {
      if (error && !destination.destroyed) destination.destroy(error);
    });
  } catch {
    if (!source.destroyed) source.destroy();
  }
}

export function createPwaProxy(options: { keyPath: string; certPath: string; apiPort: number; webPort: number }) {
  const server = createHttpsServer({ key: readFileSync(options.keyPath), cert: readFileSync(options.certPath) }, (request, response) => {
    const path = stripApiPrefix(request.url ?? '/');
    const targetPort = path === null ? options.webPort : options.apiPort;
    const headers = { ...request.headers, host: `127.0.0.1:${targetPort}`, connection: 'close' };
    const canWrite = (): boolean => !response.destroyed && !response.writableEnded;
    const upstream = httpRequest({ hostname: '127.0.0.1', port: targetPort, method: request.method, path: path ?? request.url, headers }, (upstreamResponse) => {
      if (canWrite()) response.writeHead(upstreamResponse.statusCode ?? 502, upstreamResponse.statusMessage, { ...upstreamResponse.headers, 'cache-control': 'no-store' });
      pipeSafely(upstreamResponse, response);
    });
    upstream.on('error', (error) => {
      if (!canWrite()) return;
      if (!response.headersSent) response.writeHead(502, { 'content-type': 'text/plain', 'cache-control': 'no-store' });
      response.end(error.message);
    });
    pipeSafely(request, upstream);
  });
  server.on('connection', (socket) => { if (!isLoopbackPeer(socket.remoteAddress)) socket.destroy(); });
  server.on('clientError', (_error, socket) => { socket.destroy(); });
  server.on('upgrade', (request, socket, head) => {
    if ((request.url ?? '').split('?')[0] !== '/api/graphql') { socket.destroy(); return; }
    const upstream = connect({ host: '127.0.0.1', port: options.apiPort });
    let closed = false;
    const closeBoth = () => {
      if (closed) return;
      closed = true;
      socket.destroy();
      upstream.destroy();
    };
    upstream.once('connect', () => {
      const headers = Object.entries(request.headers).map(([name, value]) => `${name}: ${Array.isArray(value) ? value.join(', ') : value}`).join('\r\n');
      upstream.write(`GET /graphql${request.url?.includes('?') ? request.url.slice(request.url.indexOf('?')) : ''} HTTP/${request.httpVersion}\r\n${headers}\r\n\r\n`);
      if (head.length) upstream.write(head);
      socket.pipe(upstream).pipe(socket);
    });
    socket.on('error', closeBoth);
    upstream.on('error', closeBoth);
  });
  return server;
}

if (process.argv[1]?.endsWith('pwa-proxy.ts')) {
  const port = Number(process.env.PWA_PROXY_PORT ?? 3443);
  const apiPort = Number(process.env.PWA_API_PORT ?? 3005);
  const webPort = Number(process.env.PWA_WEB_PORT ?? 3000);
  const server = createPwaProxy({ keyPath: process.env.PWA_TLS_KEY ?? '', certPath: process.env.PWA_TLS_CERT ?? '', apiPort, webPort });
  server.listen(port, '127.0.0.1');
}
