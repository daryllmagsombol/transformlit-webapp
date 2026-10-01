import { createHash, randomBytes, randomUUID, X509Certificate } from 'node:crypto';
import { execFileSync, spawn } from 'node:child_process';
import { mkdir, readFile, rename, rm, access, writeFile, chmod, lstat, unlink, readdir } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import type { Server } from 'node:net';
import { request as httpsRequest } from 'node:https';
import { request as httpRequest } from 'node:http';
import { once } from 'node:events';
import { assertOwnedMetadata, assertOwnedArtifactPath, assertOwnedPublicAssetRoot, assertPortAvailable, assertSupervisorSocketIdentity, cleanupAfterStartupFailure, cleanupOwnedResources, listenPwaSupervisorControl, requestPwaSupervisorControl, waitForHarnessReady, waitForSupervisorExit, parsePwaHarnessArgs, isContainerReadableAssetMode, type PwaOwnership } from './pwa-process.js';
import { provisionOwnedDatabase, assertTask1AOwnedDatabaseUrl } from './pwa-db.js';
import { seedPwaFixtures, publishPwaVersion2 } from '../helpers/pwa-fixtures.js';
import { createPwaProxy } from './pwa-proxy.js';

type State = 'starting' | 'ready' | 'failed' | 'stopping';
interface PwaMetadata extends PwaOwnership {
  state: State;
  nonce: string;
  socketPath: string;
  socketIdentity?: { dev: number; ino: number; uid: number };
  assetRoot?: string;
  endpoints: { browser: 'https://localhost:3443'; web: 'http://127.0.0.1:3000'; api: 'http://127.0.0.1:3005' };
  fixtureIds?: { readerId: string; outsiderId: string; readableBookId: string; restrictedBookId: string };
  fixtureCredentials?: readonly { email: string; password: string }[];
  tlsSpkiFingerprint?: string;
  failure?: string;
}

const root = resolve(process.cwd(), '../..');
const stateDir = join(root, '.pwa-harness');
const publicAssetRoot = join(root, '.pwa-harness-assets');
const metadataPath = join(stateDir, 'environment.json');
const fixedPorts = [3443, 3000, 3005];
const apiHostPort = 3005;
const webHostPort = 3000;

function run(command: string, args: string[], cwd = root, env: NodeJS.ProcessEnv = process.env): string {
  return execFileSync(command, args, {
    cwd,
    env,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    timeout: 20 * 60 * 1000,
    maxBuffer: 64 * 1024 * 1024,
  }).trim();
}

async function writeMetadata(metadata: PwaMetadata): Promise<void> {
  const temporaryPath = `${metadataPath}.${metadata.id}.tmp`;
  await writeFile(temporaryPath, `${JSON.stringify(metadata, null, 2)}\n`, { mode: 0o600 });
  await rename(temporaryPath, metadataPath);
}

async function ensurePrivateDirectory(path: string): Promise<void> {
  await mkdir(path, { recursive: true, mode: 0o700 });
  const info = await lstat(path);
  const currentUid = process.getuid?.();
  if (!info.isDirectory() || info.isSymbolicLink() || (info.mode & 0o077) !== 0 || (currentUid !== undefined && info.uid !== currentUid)) {
    throw new Error(`Refusing unsafe owner directory: ${path}`);
  }
}

async function initializeOwnerDirectory(owner: PwaMetadata): Promise<void> {
  const ownerDir = join(stateDir, owner.id);
  await ensurePrivateDirectory(ownerDir);
  const marker = join(ownerDir, 'owner.json');
  await writeFile(marker, `${owner.id}\n${owner.nonce}\n`, { flag: 'wx', mode: 0o600 });
  owner.artifacts.push(marker);
}

async function verifyOwnerDirectory(owner: PwaMetadata): Promise<void> {
  const ownerDir = join(stateDir, owner.id);
  await ensurePrivateDirectory(ownerDir);
  const marker = join(ownerDir, 'owner.json');
  const info = await lstat(marker);
  const currentUid = process.getuid?.();
  if (!info.isFile() || info.isSymbolicLink() || (info.mode & 0o077) !== 0 || (currentUid !== undefined && info.uid !== currentUid)) {
    throw new Error('Invalid PWA owner marker file');
  }
  if ((await readFile(marker, 'utf8')) !== `${owner.id}\n${owner.nonce}\n`) throw new Error('PWA owner directory marker mismatch');
}

async function ensurePublicDirectory(path: string): Promise<void> {
  let info: Awaited<ReturnType<typeof lstat>>;
  try { info = await lstat(path); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    await mkdir(path, { mode: 0o755 });
    await chmod(path, 0o755);
    info = await lstat(path);
  }
  const currentUid = process.getuid?.();
  if (!info.isDirectory() || info.isSymbolicLink() || (info.mode & 0o022) !== 0 || (currentUid !== undefined && info.uid !== currentUid) || !isContainerReadableAssetMode(info.mode, 'directory')) {
    throw new Error(`Refusing container-inaccessible or unsafe fixture asset directory: ${path}`);
  }
}

async function initializePublicAssetRoot(owner: PwaMetadata): Promise<void> {
  if (!owner.assetRoot) throw new Error('PWA public asset root is missing from owner metadata');
  const assetRoot = assertOwnedPublicAssetRoot(publicAssetRoot, owner.id, owner.assetRoot);
  await ensurePublicDirectory(publicAssetRoot);
  await ensurePublicDirectory(assetRoot);
  await writeFile(join(assetRoot, '.pwa-owner'), `${owner.id}\n`, { flag: 'wx', mode: 0o644 });
}

async function normalizePublicAssetPermissions(assetRoot: string): Promise<void> {
  const rootInfo = await lstat(assetRoot);
  const currentUid = process.getuid?.();
  if (!rootInfo.isDirectory() || rootInfo.isSymbolicLink() || (currentUid !== undefined && rootInfo.uid !== currentUid)) throw new Error('Unsafe fixture asset directory');
  await chmod(assetRoot, 0o755);
  const entries = await readdir(assetRoot, { withFileTypes: true });
  for (const entry of entries) {
    const path = join(assetRoot, entry.name);
    const info = await lstat(path);
    if (info.isSymbolicLink() || (currentUid !== undefined && info.uid !== currentUid)) throw new Error('Fixture asset tree contains an unowned or symbolic entry');
    if (info.isDirectory()) {
      await chmod(path, 0o755);
      await normalizePublicAssetPermissions(path);
    } else if (info.isFile()) {
      await chmod(path, 0o644);
      const fileInfo = await lstat(path);
      if (!isContainerReadableAssetMode(fileInfo.mode, 'file')) throw new Error('Fixture asset is not readable by the API container user');
    } else {
      throw new Error('Fixture asset tree contains an unsupported filesystem entry');
    }
  }
}

async function verifyPublicAssetRoot(owner: PwaMetadata): Promise<void> {
  if (!owner.assetRoot) return;
  const assetRoot = assertOwnedPublicAssetRoot(publicAssetRoot, owner.id, owner.assetRoot);
  await ensurePublicDirectory(publicAssetRoot);
  await ensurePublicDirectory(assetRoot);
  const markerPath = join(assetRoot, '.pwa-owner');
  const marker = await lstat(markerPath);
  const currentUid = process.getuid?.();
  if (!marker.isFile() || marker.isSymbolicLink() || !isContainerReadableAssetMode(marker.mode, 'file') || (currentUid !== undefined && marker.uid !== currentUid) || (await readFile(markerPath, 'utf8')) !== `${owner.id}\n`) {
    throw new Error('Public fixture asset ownership marker mismatch');
  }
}

async function removePublicAssetRoot(owner: PwaMetadata): Promise<void> {
  if (!owner.assetRoot) return;
  try { await lstat(owner.assetRoot); }
  catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return; throw error; }
  await verifyPublicAssetRoot(owner);
  await rm(assertOwnedPublicAssetRoot(publicAssetRoot, owner.id, owner.assetRoot), { recursive: true, force: true });
}

async function readMetadata(): Promise<PwaMetadata> {
  const fileInfo = await lstat(metadataPath);
  const currentUid = process.getuid?.();
  if (!fileInfo.isFile() || fileInfo.isSymbolicLink() || (fileInfo.mode & 0o077) !== 0 || (currentUid !== undefined && fileInfo.uid !== currentUid)) {
    throw new Error('PWA ownership metadata must be a private regular file owned by this user');
  }
  const metadata = JSON.parse(await readFile(metadataPath, 'utf8')) as PwaMetadata;
  assertOwnedMetadata(metadata);
  if (!metadata.nonce || !/^[a-f0-9]{64}$/.test(metadata.nonce) || !['starting', 'ready', 'failed', 'stopping'].includes(metadata.state)) {
    throw new Error('Invalid supervisor ownership metadata');
  }
  if (metadata.ports.length !== fixedPorts.length || !fixedPorts.every((port) => metadata.ports.includes(port))) throw new Error('Invalid owner port metadata');
  if (metadata.endpoints?.browser !== 'https://localhost:3443' || metadata.endpoints.web !== 'http://127.0.0.1:3000' || metadata.endpoints.api !== 'http://127.0.0.1:3005') throw new Error('Invalid PWA endpoints');
  if (metadata.socketPath !== join('/tmp', `pwa-${metadata.id}.sock`) || metadata.artifacts.some((artifact) => assertOwnedArtifactPath(stateDir, metadata.id, artifact) !== artifact)) {
    throw new Error('Invalid owner artifact or supervisor socket path');
  }
  if (metadata.assetRoot !== undefined) assertOwnedPublicAssetRoot(publicAssetRoot, metadata.id, metadata.assetRoot);
  await verifyOwnerDirectory(metadata);
  return metadata;
}

async function unlinkOwnedStaleSocket(owner: PwaMetadata): Promise<void> {
  try {
    const info = await lstat(owner.socketPath);
    if (!owner.socketIdentity) throw new Error('Supervisor socket has no recorded identity; refusing removal');
    assertSupervisorSocketIdentity({ dev: info.dev, ino: info.ino, uid: info.uid, isSocket: info.isSocket() }, owner.socketIdentity);
    await unlink(owner.socketPath);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
  }
}

function initialMetadata(id: string, nonce: string): PwaMetadata {
  return {
    owner: 'transformlit-pwa', id, nonce, createdAt: new Date().toISOString(), state: 'starting',
    endpoints: { browser: 'https://localhost:3443', web: 'http://127.0.0.1:3000', api: 'http://127.0.0.1:3005' },
    socketPath: join('/tmp', `pwa-${id}.sock`), ports: fixedPorts, containers: [], images: [], pids: [], artifacts: [],
  };
}

function dockerRuntime() {
  return {
    async inspect(id: string) {
      try {
        const output = run('docker', ['inspect', '--format', '{{.Id}} {{ index .Config.Labels "transformlit.owner" }}', id]);
        const [resourceId, ownerLabel] = output.split(' ');
        return { id: resourceId, labels: { 'transformlit.owner': ownerLabel } };
      } catch (error) {
        const details = error as NodeJS.ErrnoException & { stderr?: Buffer | string; status?: number };
        const stderr = String(details.stderr ?? '');
        if (details.status === 1 && /No such (object|container)/i.test(stderr)) throw Object.assign(new Error('Resource not found'), { code: 'NOT_FOUND' });
        throw error;
      }
    },
    async remove(id: string) { run('docker', ['rm', '-f', id]); },
  };
}

function discoverLabeledContainers(ownerId: string): string[] {
  const output = run('docker', ['ps', '-aq', '--no-trunc', '--filter', `label=transformlit.owner=${ownerId}`]);
  return output.split('\n').filter(Boolean);
}

function containerCleanupOrder(owner: PwaMetadata): string[] {
  return [...owner.containers.slice(1), ...owner.containers.slice(0, 1)];
}

async function request(url: string, ca?: Buffer): Promise<{ status: number; body: string }> {
  return new Promise((resolveResponse, reject) => {
    const parsed = new URL(url);
    const requester = parsed.protocol === 'https:' ? httpsRequest : httpRequest;
    const request = requester({ hostname: parsed.hostname, port: parsed.port, path: `${parsed.pathname}${parsed.search}`, ca }, (response) => {
      const chunks: Buffer[] = [];
      response.on('data', (chunk: Buffer) => chunks.push(chunk));
      response.on('end', () => resolveResponse({ status: response.statusCode ?? 0, body: Buffer.concat(chunks).toString() }));
    });
    request.on('error', reject);
    request.end();
  });
}

async function waitForEndpoints(cert: Buffer): Promise<void> {
  await waitForHarnessReady({
    api: async () => (await request('http://127.0.0.1:3005/health')).status === 200,
    web: async () => {
      const status = (await request('http://127.0.0.1:3000/login')).status;
      return status >= 200 && status < 400;
    },
    proxy: async () => (await request('https://localhost:3443/', cert)).status === 200,
  }, 60, 1000);
}

function spkiPin(cert: Buffer): string {
  const publicKey = new X509Certificate(cert).publicKey.export({ type: 'spki', format: 'der' });
  return createHash('sha256').update(publicKey).digest('base64');
}

async function supervise(id: string, nonce: string): Promise<void> {
  const bootstrap = await readMetadata();
  if (bootstrap.id !== id || bootstrap.nonce !== nonce || bootstrap.state !== 'starting') throw new Error('Supervisor launch does not match starting owner metadata');
  const owner = bootstrap;
  const ownedDir = join(stateDir, id);
  let db: Awaited<ReturnType<typeof provisionOwnedDatabase>> | undefined;
  let proxy: ReturnType<typeof createPwaProxy> | undefined;
  let control: Server | undefined;
  let storageDir = '';
  try {
    await verifyOwnerDirectory(owner);
    await writeMetadata(owner);
    db = await provisionOwnedDatabase(id);
    assertTask1AOwnedDatabaseUrl(db.databaseUrl, db.container);
    owner.databaseUrl = db.databaseUrl;
    owner.containers = [db.containerId];
    await writeMetadata(owner);

    owner.assetRoot = join(publicAssetRoot, id);
    await writeMetadata(owner);
    const apiImage = `transformlit-api:pwa-${id}`;
    const webImage = `transformlit-web:pwa-${id}`;
    owner.images = [];
    run('pnpm', ['exec', 'prisma', 'migrate', 'deploy', '--schema', 'prisma/schema.prisma'], join(root, 'apps/api'), { ...process.env, DATABASE_URL: db.databaseUrl });
    run('docker', ['build', '-f', 'apps/api/Dockerfile', '-t', apiImage, '.']);
    run('docker', ['build', '-f', 'apps/web/Dockerfile', '-t', webImage,
      '--build-arg', 'NEXT_PUBLIC_API_URL=https://localhost:3443/api/graphql',
      '--build-arg', 'NEXT_PUBLIC_WS_URL=wss://localhost:3443/api/graphql', '.']);
    await initializePublicAssetRoot(owner);
    storageDir = assertOwnedPublicAssetRoot(publicAssetRoot, id, owner.assetRoot ?? '');
    const fixture = await seedPwaFixtures(db.databaseUrl, db.container, storageDir, id);
    await normalizePublicAssetPermissions(storageDir);
    owner.fixtureIds = {
      readerId: fixture.accounts[0].id,
      outsiderId: fixture.accounts[1].id,
      readableBookId: fixture.books.readable.id,
      restrictedBookId: fixture.books.restricted.id,
    };
    owner.fixtureCredentials = fixture.credentials;
    owner.artifacts.push(join(ownedDir, 'browser-profile'));
    const jwtSecret = randomBytes(48).toString('base64url');
    const dockerDbUrl = new URL(db.databaseUrl);
    dockerDbUrl.hostname = 'host.docker.internal';
    const runtimeEnvPath = join(ownedDir, 'api.runtime.env');
    await writeFile(runtimeEnvPath, `DATABASE_URL=${dockerDbUrl}\nJWT_SECRET=${jwtSecret}\nCORS_ORIGIN=https://localhost:3443\nBOOK_STORAGE_DIR=/pwa-book-storage\n`, { mode: 0o600 });
    owner.artifacts.push(runtimeEnvPath);
    await writeMetadata(owner);

    owner.containers.push(run('docker', ['run', '-d', '--name', `transformlit-pwa-api-${id}`, '--label', `transformlit.owner=${id}`, '-p', '127.0.0.1:3005:3005', '--add-host', 'host.docker.internal:host-gateway', '--env-file', runtimeEnvPath, '-v', `${storageDir}:/pwa-book-storage:ro`, apiImage]));
    await writeMetadata(owner);
    owner.containers.push(run('docker', ['run', '-d', '--name', `transformlit-pwa-web-${id}`, '--label', `transformlit.owner=${id}`, '-p', '127.0.0.1:3000:3000', webImage]));
    await writeMetadata(owner);

    const keyPath = join(ownedDir, 'localhost-key.pem');
    const certPath = join(ownedDir, 'localhost-cert.pem');
    run('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-sha256', '-nodes', '-days', '2', '-keyout', keyPath, '-out', certPath, '-subj', '/CN=localhost', '-addext', 'subjectAltName=DNS:localhost,IP:127.0.0.1']);
    const cert = await readFile(certPath);
    await chmod(keyPath, 0o600);
    await chmod(certPath, 0o600);
    owner.artifacts.push(keyPath, certPath);
    owner.tlsSpkiFingerprint = spkiPin(cert);
    proxy = createPwaProxy({ keyPath, certPath, apiPort: apiHostPort, webPort: webHostPort });
    proxy.listen(3443, '::1');
    await once(proxy, 'listening');
    await waitForEndpoints(cert);
    let shutdownStarted = false;
    const controlServer = await listenPwaSupervisorControl(owner.socketPath, nonce, async (message, server) => {
      if (message.command === 'publish-v2' && message.bookId && db) {
        await publishPwaVersion2(db.databaseUrl, db.container, storageDir, id, message.bookId);
        await normalizePublicAssetPermissions(storageDir);
        return { ok: true, state: 'ready' };
      }
      if (message.command === 'ping') return { ok: true, state: owner.state };
      if (message.command !== 'shutdown' || shutdownStarted) return { ok: false, state: owner.state };
      shutdownStarted = true;
      owner.state = 'stopping';
      try {
        await writeMetadata(owner);
        server.close();
        await new Promise<void>((resolveClose) => proxy?.close(() => resolveClose()));
        await cleanupOwnedResources(containerCleanupOrder(owner), id, dockerRuntime());
        for (const artifact of owner.artifacts) assertOwnedArtifactPath(stateDir, id, artifact);
        await verifyOwnerDirectory(owner);
        await removePublicAssetRoot(owner);
        await rm(ownedDir, { recursive: true, force: true });
        await rm(metadataPath, { force: true });
        return { ok: true, state: 'stopped' };
      } catch (error) {
        owner.state = 'failed';
        owner.failure = `Shutdown cleanup failed: ${error instanceof Error ? error.message : 'unknown error'}`;
        await writeMetadata(owner);
        server.close();
        return { ok: false, state: 'failed' };
      }
    });
    control = controlServer;
    const serverState = new Promise<void | Error>((resolveState) => {
      controlServer.once('close', () => resolveState());
      controlServer.once('error', (error) => {
        owner.state = 'failed';
        owner.failure = `Supervisor IPC error: ${error.message}`;
        resolveState(error);
      });
    });
    await chmod(owner.socketPath, 0o600);
    const info = await lstat(owner.socketPath);
    owner.socketIdentity = { dev: info.dev, ino: info.ino, uid: info.uid };
    await writeMetadata(owner);
    owner.state = 'ready';
    await writeMetadata(owner);
    const serverResult = await serverState;
    if (serverResult instanceof Error) throw serverResult;
  } catch (error) {
    owner.state = 'failed';
    owner.failure = error instanceof Error ? error.message : 'Unknown startup failure';
    await cleanupAfterStartupFailure(async () => {
      await writeMetadata(owner);
      if (proxy?.listening) await new Promise<void>((resolveClose) => proxy?.close(() => resolveClose()));
      if (control?.listening) await new Promise<void>((resolveClose) => control?.close(() => resolveClose()));
      owner.containers = [...new Set([...owner.containers, ...discoverLabeledContainers(id)])];
      await writeMetadata(owner);
      await cleanupOwnedResources(containerCleanupOrder(owner), id, dockerRuntime());
      await removePublicAssetRoot(owner);
      await verifyOwnerDirectory(owner);
      await rm(ownedDir, { recursive: true, force: true });
      await rm(metadataPath, { force: true });
    }, async (cleanupError) => {
      owner.failure = `${owner.failure}; cleanup verification failed: ${cleanupError instanceof Error ? cleanupError.message : 'unknown error'}`;
      await writeMetadata(owner);
    });
    throw error;
  }
}

function sendSupervisor(metadata: PwaMetadata, command: string, bookId?: string): Promise<unknown> {
  return requestPwaSupervisorControl(metadata.socketPath, metadata.nonce, command, bookId);
}

async function up(): Promise<void> {
  try { run('docker', ['info', '--format', '{{.ServerVersion}}']); } catch { throw new Error('Docker runtime is unavailable; refusing PWA harness startup'); }
  try { await access(metadataPath); throw new Error('Existing PWA owner metadata found; run down first'); }
  catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
  for (const port of fixedPorts) await assertPortAvailable(port);
  await ensurePrivateDirectory(stateDir);
  const id = randomUUID();
  const nonce = randomBytes(32).toString('hex');
  const boot = initialMetadata(id, nonce);
  await writeMetadata(boot);
  try {
    await initializeOwnerDirectory(boot);
    await writeMetadata(boot);
  } catch (error) {
    boot.state = 'failed';
    boot.failure = `Unable to initialize owner directory: ${error instanceof Error ? error.message : 'unknown error'}`;
    await writeMetadata(boot);
    throw error;
  }
  const scriptPath = join(root, 'apps/api/test/scripts/pwa-harness.ts');
  const child = spawn(process.execPath, ['--import', 'tsx', scriptPath, 'supervise', id, nonce], { cwd: join(root, 'apps/api'), detached: true, stdio: 'ignore' });
  let spawnFailure: Error | undefined;
  let supervisorExit: { code: number | null; signal: NodeJS.Signals | null } | undefined;
  child.once('error', (error) => { spawnFailure = error; });
  child.once('exit', (code, signal) => { supervisorExit = { code, signal }; });
  child.unref();
  for (let attempt = 0; attempt < 2400; attempt += 1) {
    await new Promise((resolveWait) => setTimeout(resolveWait, 500));
    if (spawnFailure) {
      boot.state = 'failed';
      boot.failure = `Unable to launch supervisor: ${spawnFailure.message}`;
      await writeMetadata(boot);
      throw new Error(boot.failure);
    }
    try { await access(metadataPath); }
    catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') throw new Error('Supervisor startup failed and cleaned its owned resources'); throw error; }
    const metadata = await readMetadata();
    if (metadata.state === 'ready') { console.log('PWA harness ready at https://localhost:3443'); return; }
    if (metadata.state === 'failed') throw new Error(`PWA startup failed: ${metadata.failure ?? 'unknown failure'}`);
    if (supervisorExit) {
      metadata.state = 'failed';
      metadata.failure = `Supervisor exited during startup (code ${supervisorExit.code ?? 'null'}, signal ${supervisorExit.signal ?? 'none'})`;
      await writeMetadata(metadata);
      throw new Error(metadata.failure);
    }
  }
  throw new Error('PWA supervisor did not reach readiness; inspect failed owner metadata before cleanup');
}

async function test(): Promise<void> {
  const owner = await readMetadata();
  if (owner.state !== 'ready') throw new Error(`PWA owner is ${owner.state}; refusing browser run`);
  const response = await sendSupervisor(owner, 'ping') as { ok?: boolean };
  if (!response.ok) throw new Error('PWA supervisor did not acknowledge current owner');
  const testEnv = {
    ...process.env,
    PWA_BROWSER_PROFILE: join(stateDir, owner.id, 'browser-profile'),
    PWA_TLS_SPKI: owner.tlsSpkiFingerprint,
    PWA_FIXTURE_CREDENTIALS: JSON.stringify(owner.fixtureCredentials ?? []),
    PWA_FIXTURE_IDS: JSON.stringify(owner.fixtureIds ?? {}),
  };
  run('pnpm', ['exec', 'playwright', 'test', '-c', 'playwright.pwa.config.ts'], join(root, 'apps/web'), testEnv);
}

async function down(): Promise<void> {
  try { await access(metadataPath); }
  catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return; throw error; }
  const owner = await readMetadata();
  if (owner.state === 'failed') {
    try {
      await sendSupervisor(owner, 'ping');
      throw new Error('Failed supervisor is still live; refusing external cleanup');
    } catch (error) { if (error instanceof Error && error.message.includes('still live')) throw error; }
    owner.containers = [...new Set([...owner.containers, ...discoverLabeledContainers(owner.id)])];
    await writeMetadata(owner);
    await cleanupOwnedResources(containerCleanupOrder(owner), owner.id, dockerRuntime());
    await removePublicAssetRoot(owner);
    for (const artifact of owner.artifacts) assertOwnedArtifactPath(stateDir, owner.id, artifact);
    await verifyOwnerDirectory(owner);
    await unlinkOwnedStaleSocket(owner);
    await rm(join(stateDir, owner.id), { recursive: true, force: true });
    await rm(metadataPath, { force: true });
    return;
  }
  const result = await sendSupervisor(owner, 'shutdown') as { ok?: boolean };
  if (!result.ok) throw new Error('Supervisor refused shutdown');
  await waitForSupervisorExit(async () => {
    try { await access(metadataPath); return true; }
    catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false; throw error; }
  });
}

async function main(): Promise<void> {
  const args = parsePwaHarnessArgs(process.argv.slice(2));
  if (args.operation === 'up') return up();
  if (args.operation === 'test') return test();
  if (args.operation === 'down') return down();
  if (args.operation === 'supervise') return supervise(args.ownerId, args.nonce);
  if (args.operation === 'publish-v2') {
    const metadata = await readMetadata();
    if (metadata.state !== 'ready' || metadata.fixtureIds?.readableBookId !== args.bookId) throw new Error('publish-v2 requires this invocation\'s ready owner and readable fixture ID');
    const response = await sendSupervisor(metadata, 'publish-v2', args.bookId) as { ok?: boolean };
    if (!response.ok) throw new Error('Supervisor refused publish-v2 fixture transition');
    return;
  }
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
