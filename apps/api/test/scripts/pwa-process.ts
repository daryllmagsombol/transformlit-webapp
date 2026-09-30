import { createServer } from 'node:net';
import { isAbsolute, relative, resolve, sep } from 'node:path';
import { timingSafeEqual } from 'node:crypto';

export interface PwaOwnership {
  owner: 'transformlit-pwa';
  id: string;
  createdAt: string;
  ports: number[];
  containers: string[];
  images: string[];
  pids: number[];
  artifacts: string[];
  databaseUrl?: string;
}

function isLocalDatabaseEndpointMetadata(databaseUrl: string | undefined): boolean {
  if (!databaseUrl) return false;
  try {
    const parsed = new URL(databaseUrl);
    const allowedHost = parsed.hostname === 'localhost' || parsed.hostname === '127.0.0.1' || parsed.hostname === '::1' || parsed.hostname === '[::1]';
    const port = Number(parsed.port);
    // This validates serialized endpoint shape only. Task 1A's live-container
    // assertion is the sole DB ownership authority before any database access.
    return ['postgres:', 'postgresql:'].includes(parsed.protocol) && allowedHost &&
      port >= 1024 && port <= 65535 && parsed.pathname === '/testdb';
  } catch {
    return false;
  }
}

export interface OwnedResourceRuntime {
  inspect(id: string): Promise<{ id: string; labels: Record<string, string | undefined> }>;
  remove(id: string): Promise<void>;
}

function isNotFound(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === 'NOT_FOUND';
}

export async function cleanupOwnedResources(ids: readonly string[], ownerId: string, runtime: OwnedResourceRuntime): Promise<void> {
  const ownedIds: string[] = [];
  for (const id of ids) {
    let resource: { id: string; labels: Record<string, string | undefined> };
    try { resource = await runtime.inspect(id); }
    catch (error) { if (isNotFound(error)) continue; throw error; }
    if (resource.id !== id || resource.labels['transformlit.owner'] !== ownerId) {
      throw new Error(`Resource ${id} is not owned by invocation ${ownerId}`);
    }
    ownedIds.push(id);
  }
  for (const id of ownedIds) await runtime.remove(id);
}

export function assertOwnedArtifactPath(harnessRoot: string, ownerId: string, artifactPath: string): string {
  const ownerDirectory = resolve(harnessRoot, ownerId);
  const artifact = resolve(artifactPath);
  const relativePath = relative(ownerDirectory, artifact);
  if (!isAbsolute(harnessRoot) || relativePath === '' || relativePath === '..' || relativePath.startsWith(`..${sep}`) || isAbsolute(relativePath)) {
    throw new Error('Artifact path must be a strict descendant of the owner directory');
  }
  return artifact;
}

export interface HarnessProbes {
  api(): Promise<boolean>;
  web(): Promise<boolean>;
  proxy(): Promise<boolean>;
}

export async function waitForHarnessReady(probes: HarnessProbes, attempts = 30, intervalMs = 500): Promise<void> {
  const names = ['api', 'web', 'proxy'] as const;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const results = await Promise.all(names.map(async (name) => {
      try { return [name, await probes[name]()] as const; }
      catch { return [name, false] as const; }
    }));
    const failed = results.filter(([, ready]) => !ready).map(([name]) => name);
    if (failed.length === 0) return;
    if (attempt === attempts - 1) throw new Error(`${failed.join(', ')} not ready after ${attempts} probes`);
    await new Promise((resolveWait) => setTimeout(resolveWait, intervalMs));
  }
}

export async function waitForSupervisorExit(isRunning: () => Promise<boolean>, attempts = 60, intervalMs = 100): Promise<void> {
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    if (!(await isRunning())) return;
    if (attempt < attempts - 1) await new Promise((resolveWait) => setTimeout(resolveWait, intervalMs));
  }
  throw new Error(`Supervisor did not exit after ${attempts} checks`);
}

export async function cleanupAfterStartupFailure(
  cleanup: () => Promise<void>,
  preserveFailedOwner: (error: unknown) => Promise<void>,
): Promise<boolean> {
  try { await cleanup(); return true; }
  catch (error) { await preserveFailedOwner(error); return false; }
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
  if (metadata.owner !== 'transformlit-pwa' || typeof metadata.id !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(metadata.id) ||
      !Array.isArray(metadata.ports) || !Array.isArray(metadata.containers) || !Array.isArray(metadata.pids) ||
      !Array.isArray(metadata.artifacts) || !Array.isArray(metadata.images) ||
      (metadata.databaseUrl !== undefined && !isLocalDatabaseEndpointMetadata(metadata.databaseUrl))) {
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

export function assertSupervisorNonce(actual: string, expected: string): void {
  const supplied = Buffer.from(actual);
  const ownerSecret = Buffer.from(expected);
  if (supplied.length !== ownerSecret.length || !timingSafeEqual(supplied, ownerSecret)) throw new Error('Supervisor ownership nonce mismatch');
}

export function assertSupervisorSocketIdentity(actual: { dev: number; ino: number; uid: number; isSocket: boolean }, expected: { dev: number; ino: number; uid: number }): void {
  if (!actual.isSocket || actual.dev !== expected.dev || actual.ino !== expected.ino || actual.uid !== expected.uid) {
    throw new Error('Supervisor IPC socket identity mismatch');
  }
}
