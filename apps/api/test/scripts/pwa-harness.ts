import { createHash, randomBytes, randomUUID, X509Certificate } from 'node:crypto';
import { execFileSync, spawn } from 'node:child_process';
import { mkdir, readFile, rename, rm, access, writeFile, chmod, lstat, unlink } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { createServer } from 'node:net';
import { request as httpsRequest } from 'node:https';
import { request as httpRequest } from 'node:http';
import { once } from 'node:events';
import { assertOwnedMetadata, assertOwnedArtifactPath, assertPortAvailable, assertSupervisorNonce, assertSupervisorSocketIdentity, cleanupOwnedResources, waitForHarnessReady, type PwaOwnership } from './pwa-process.js';
import { provisionOwnedDatabase, assertTask1AOwnedDatabaseUrl } from './pwa-db.js';
import { seedPwaFixtures, publishPwaVersion2 } from '../helpers/pwa-fixtures.js';
import { createPwaProxy } from './pwa-proxy.js';

type State = 'starting' | 'ready' | 'failed' | 'stopping';
interface PwaMetadata extends PwaOwnership {
  state: State;
  nonce: string;
  socketPath: string;
  socketIdentity?: { dev: number; ino: number; uid: number };
  endpoints: { browser: 'https://localhost:3443'; web: 'http://127.0.0.1:3000'; api: 'http://127.0.0.1:3005' };
  fixtureIds?: { readerId: string; outsiderId: string; readableBookId: string; restrictedBookId: string };
  fixtureCredentials?: readonly { email: string; password: string }[];
  tlsSpkiFingerprint?: string;
  failure?: string;
}

const root = resolve(process.cwd(), '../..');
const stateDir = join(root, '.pwa-harness');
const metadataPath = join(stateDir, 'environment.json');
const fixedPorts = [3443, 3000, 3005];
const apiHostPort = 3005;
const webHostPort = 3000;

function run(command: string, args: string[], cwd = root, env: NodeJS.ProcessEnv = process.env): string {
  return execFileSync(command, args, { cwd, env, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
}

async function writeMetadata(metadata: PwaMetadata): Promise<void> {
  const temporaryPath = `${metadataPath}.${metadata.id}.tmp`;
  await writeFile(temporaryPath, `${JSON.stringify(metadata, null, 2)}\n`, { mode: 0o600 });
  await rename(temporaryPath, metadataPath);
}

async function readMetadata(): Promise<PwaMetadata> {
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
  const output = run('docker', ['ps', '-aq', '--filter', `label=transformlit.owner=${ownerId}`]);
  return output.split('\n').filter(Boolean);
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
    web: async () => (await request('http://127.0.0.1:3000/offline')).status === 200,
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
  let control: ReturnType<typeof createServer> | undefined;
  try {
    await mkdir(ownedDir, { recursive: true, mode: 0o700 });
    await writeMetadata(owner);
    db = await provisionOwnedDatabase(id);
    assertTask1AOwnedDatabaseUrl(db.databaseUrl, db.container);
    owner.databaseUrl = db.databaseUrl;
    owner.containers = [db.containerId];
    await writeMetadata(owner);

    const storageDir = join(ownedDir, 'storage');
    await mkdir(storageDir, { recursive: true, mode: 0o700 });
    owner.artifacts.push(storageDir);
    await writeMetadata(owner);
    const apiImage = `transformlit-api:pwa-${id}`;
    const webImage = `transformlit-web:pwa-${id}`;
    owner.images = [];
    run('pnpm', ['exec', 'prisma', 'migrate', 'deploy', '--schema', 'prisma/schema.prisma'], join(root, 'apps/api'), { ...process.env, DATABASE_URL: db.databaseUrl });
    const fixture = await seedPwaFixtures(db.databaseUrl, db.container, storageDir, id);
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

    run('docker', ['build', '-f', 'apps/api/Dockerfile', '-t', apiImage, '.']);
    run('docker', ['build', '-f', 'apps/web/Dockerfile', '-t', webImage,
      '--build-arg', 'NEXT_PUBLIC_API_URL=https://localhost:3443/api/graphql',
      '--build-arg', 'NEXT_PUBLIC_WS_URL=wss://localhost:3443/api/graphql', '.']);
    owner.containers.push(run('docker', ['run', '-d', '--name', `transformlit-pwa-api-${id}`, '--label', `transformlit.owner=${id}`, '-p', '127.0.0.1:3005:3005', '--add-host', 'host.docker.internal:host-gateway', '--env-file', runtimeEnvPath, '-v', `${storageDir}:/pwa-book-storage`, apiImage]));
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
    let resolveShutdown!: () => void;
    let rejectShutdown!: (error: unknown) => void;
    const shutdown = new Promise<void>((resolve, reject) => { resolveShutdown = resolve; rejectShutdown = reject; });
    const controlServer = createServer((socket) => {
        let data = '';
        socket.on('data', (chunk) => { data += chunk.toString(); });
        socket.on('end', async () => {
          try {
            const message = JSON.parse(data) as { nonce: string; command: string; bookId?: string };
            assertSupervisorNonce(message.nonce, nonce);
            if (message.command === 'publish-v2' && message.bookId && db) {
              await publishPwaVersion2(db.databaseUrl, db.container, storageDir, id, message.bookId);
              socket.end(JSON.stringify({ ok: true }));
              return;
            }
            if (message.command === 'ping') { socket.end(JSON.stringify({ ok: true, state: 'ready' })); return; }
            if (message.command !== 'shutdown') throw new Error('Unsupported supervisor command');
            owner.state = 'stopping';
            await writeMetadata(owner);
            socket.end(JSON.stringify({ ok: true }));
            controlServer.close(async () => {
              try {
                await new Promise<void>((resolveClose) => proxy?.close(() => resolveClose()));
                await cleanupOwnedResources(owner.containers, id, dockerRuntime());
                for (const artifact of owner.artifacts) assertOwnedArtifactPath(stateDir, id, artifact);
                await rm(ownedDir, { recursive: true, force: true });
                await rm(metadataPath, { force: true });
                resolveShutdown();
              } catch (error) { rejectShutdown(error); }
            });
          } catch (error) {
            socket.end(JSON.stringify({ ok: false }));
            rejectShutdown(error);
          }
      });
    });
    control = controlServer;
    controlServer.once('error', rejectShutdown);
    await new Promise<void>((resolveListening, rejectListening) => {
      controlServer.listen(owner.socketPath, () => {
        void chmod(owner.socketPath, 0o600).then(async () => {
          const info = await lstat(owner.socketPath);
          owner.socketIdentity = { dev: info.dev, ino: info.ino, uid: info.uid };
          await writeMetadata(owner);
          resolveListening();
        }).catch(rejectListening);
      });
    });
    owner.state = 'ready';
    await writeMetadata(owner);
    await shutdown;
  } catch (error) {
    owner.state = 'failed';
    owner.failure = error instanceof Error ? error.message : 'Unknown startup failure';
    try {
      await writeMetadata(owner);
      if (proxy?.listening) await new Promise<void>((resolveClose) => proxy?.close(() => resolveClose()));
      if (control?.listening) await new Promise<void>((resolveClose) => control?.close(() => resolveClose()));
      owner.containers = [...new Set([...owner.containers, ...discoverLabeledContainers(id)])];
      await writeMetadata(owner);
      await cleanupOwnedResources(owner.containers, id, dockerRuntime());
      await rm(ownedDir, { recursive: true, force: true });
      await rm(metadataPath, { force: true });
    } catch (cleanupError) {
      owner.failure = `${owner.failure}; cleanup verification failed: ${cleanupError instanceof Error ? cleanupError.message : 'unknown error'}`;
      await writeMetadata(owner);
    }
    throw error;
  }
}

async function sendSupervisor(metadata: PwaMetadata, command: string, bookId?: string): Promise<unknown> {
  const net = await import('node:net');
  return new Promise((resolveResponse, reject) => {
    const socket = net.createConnection(metadata.socketPath);
    let response = '';
    socket.on('connect', () => socket.end(JSON.stringify({ nonce: metadata.nonce, command, bookId })));
    socket.on('data', (chunk) => { response += chunk.toString(); });
    socket.on('end', () => {
      try { const parsed: unknown = JSON.parse(response); resolveResponse(parsed); }
      catch (error) { reject(error); }
    });
    socket.on('error', reject);
  });
}

async function up(): Promise<void> {
  try { run('docker', ['info', '--format', '{{.ServerVersion}}']); } catch { throw new Error('Docker runtime is unavailable; refusing PWA harness startup'); }
  try { await access(metadataPath); throw new Error('Existing PWA owner metadata found; run down first'); }
  catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
  for (const port of fixedPorts) await assertPortAvailable(port);
  await mkdir(stateDir, { recursive: true, mode: 0o700 });
  const id = randomUUID();
  const nonce = randomBytes(32).toString('hex');
  const boot = initialMetadata(id, nonce);
  await mkdir(join(stateDir, id), { mode: 0o700 });
  await writeMetadata(boot);
  const scriptPath = join(root, 'apps/api/test/scripts/pwa-harness.ts');
  const child = spawn('pnpm', ['exec', 'tsx', scriptPath, 'supervise', id, nonce], { cwd: join(root, 'apps/api'), detached: true, stdio: 'ignore' });
  let spawnFailure: Error | undefined;
  child.once('error', (error) => { spawnFailure = error; });
  child.unref();
  for (let attempt = 0; attempt < 120; attempt += 1) {
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
    await cleanupOwnedResources(owner.containers, owner.id, dockerRuntime());
    for (const artifact of owner.artifacts) assertOwnedArtifactPath(stateDir, owner.id, artifact);
    await unlinkOwnedStaleSocket(owner);
    await rm(join(stateDir, owner.id), { recursive: true, force: true });
    await rm(metadataPath, { force: true });
    return;
  }
  const result = await sendSupervisor(owner, 'shutdown') as { ok?: boolean };
  if (!result.ok) throw new Error('Supervisor refused shutdown');
  for (let attempt = 0; attempt < 60; attempt += 1) {
    try { await access(metadataPath); } catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return; throw error; }
    await new Promise((resolveWait) => setTimeout(resolveWait, 100));
  }
  throw new Error('Supervisor acknowledged shutdown but did not finish owned cleanup');
}

async function main(): Promise<void> {
  const [operation, id, nonce, bookId] = process.argv.slice(2);
  if (operation === 'up') return up();
  if (operation === 'test') return test();
  if (operation === 'down') return down();
  if (operation === 'supervise' && id && nonce) return supervise(id, nonce);
  if (operation === 'publish-v2') {
    const metadata = await readMetadata();
    if (metadata.state !== 'ready' || !bookId || metadata.fixtureIds?.readableBookId !== bookId) throw new Error('publish-v2 requires this invocation\'s ready owner and readable fixture ID');
    const response = await sendSupervisor(metadata, 'publish-v2', bookId) as { ok?: boolean };
    if (!response.ok) throw new Error('Supervisor refused publish-v2 fixture transition');
    return;
  }
  throw new Error('Usage: pwa-harness.ts <up|test|down|publish-v2 <bookId>>');
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
