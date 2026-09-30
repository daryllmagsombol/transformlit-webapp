import { createServer as createHttpsServer } from 'node:https';
import { readFileSync } from 'node:fs';
import { pipeline } from 'node:stream';
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

export function createPwaProxy(options: { keyPath: string; certPath: string; apiPort: number; webPort: number }) {
  const server = createHttpsServer({ key: readFileSync(options.keyPath), cert: readFileSync(options.certPath) }, (request, response) => {
    const path = stripApiPrefix(request.url ?? '/');
    const targetPort = path === null ? options.webPort : options.apiPort;
    const headers = { ...request.headers, host: `127.0.0.1:${targetPort}`, connection: 'close' };
    const upstream = httpRequest({ hostname: '127.0.0.1', port: targetPort, method: request.method, path: path ?? request.url, headers }, (upstreamResponse) => {
      response.writeHead(upstreamResponse.statusCode ?? 502, upstreamResponse.statusMessage, { ...upstreamResponse.headers, 'cache-control': 'no-store' });
      pipeline(upstreamResponse, response, (error) => { if (error) response.destroy(error); });
    });
    upstream.on('error', (error) => { if (!response.headersSent) response.writeHead(502, { 'content-type': 'text/plain', 'cache-control': 'no-store' }); response.end(error.message); });
    pipeline(request, upstream, (error) => { if (error) upstream.destroy(error); });
  });
  server.on('upgrade', (request, socket, head) => {
    if ((request.url ?? '').split('?')[0] !== '/api/graphql') { socket.destroy(); return; }
    const upstream = connect({ host: '127.0.0.1', port: options.apiPort });
    upstream.once('connect', () => {
      const headers = Object.entries(request.headers).map(([name, value]) => `${name}: ${Array.isArray(value) ? value.join(', ') : value}`).join('\r\n');
      upstream.write(`GET /graphql${request.url?.includes('?') ? request.url.slice(request.url.indexOf('?')) : ''} HTTP/${request.httpVersion}\r\n${headers}\r\n\r\n`);
      if (head.length) upstream.write(head);
      socket.pipe(upstream).pipe(socket);
    });
    upstream.on('error', () => socket.destroy());
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
