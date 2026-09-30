import { createServer, isIP } from 'node:net';

export interface PwaOwnership {
  owner: 'transformlit-pwa';
  id: string;
  createdAt: string;
  ports: number[];
  containers: string[];
  images: string[];
  pids: number[];
  artifacts: string[];
  databaseUrl: string;
}

export function isSafeDatabaseUrl(databaseUrl: string | undefined): boolean {
  if (!databaseUrl) return false;
  try {
    const parsed = new URL(databaseUrl);
    const allowedHost = parsed.hostname === '127.0.0.1' || parsed.hostname === '::1' || parsed.hostname === '[::1]';
    const port = Number(parsed.port);
    return ['postgres:', 'postgresql:'].includes(parsed.protocol) && allowedHost && isIP(parsed.hostname.replaceAll('[', '').replaceAll(']', '')) > 0 &&
      port >= 1024 && port <= 65535 && parsed.pathname === '/testdb';
  } catch {
    return false;
  }
}

export async function assertPortAvailable(port: number): Promise<void> {
  await new Promise<void>((resolvePort, reject) => {
    const server = createServer();
    server.once('error', () => reject(new Error(`Port ${port} is occupied; refusing to attach to an unowned service`)));
    server.listen(port, '127.0.0.1', () => server.close((error) => error ? reject(error) : resolvePort()));
  });
}

export function assertOwnedMetadata(value: unknown): asserts value is PwaOwnership {
  if (!value || typeof value !== 'object') throw new Error('Invalid ownership metadata');
  const metadata = value as Partial<PwaOwnership>;
  if (metadata.owner !== 'transformlit-pwa' || typeof metadata.id !== 'string' || !/^[a-f0-9-]{36}$/.test(metadata.id) ||
      !Array.isArray(metadata.ports) || !Array.isArray(metadata.containers) || !Array.isArray(metadata.pids) ||
      !Array.isArray(metadata.artifacts) || !Array.isArray(metadata.images) || !isSafeDatabaseUrl(metadata.databaseUrl)) {
    throw new Error('Invalid ownership metadata; refusing to manage resources without valid harness ownership');
  }
  if (metadata.ports.some((port) => !Number.isInteger(port) || port < 1024 || port > 65535) ||
      metadata.containers.some((container) => typeof container !== 'string' || !/^[a-f0-9]{12,64}$/i.test(container)) ||
      metadata.images.some((image) => typeof image !== 'string' || !/^transformlit-(api|web):pwa-[a-f0-9-]{36}$/.test(image)) ||
      metadata.pids.some((pid) => !Number.isInteger(pid) || pid < 1) ||
      metadata.artifacts.some((artifact) => typeof artifact !== 'string' || artifact.includes('..'))) {
    throw new Error('Invalid ownership metadata resources');
  }
}
