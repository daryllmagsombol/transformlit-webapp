import { randomUUID } from 'node:crypto';
import { execFileSync, spawn, type ChildProcess } from 'node:child_process';
import { mkdir, readFile, writeFile, access } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { assertOwnedMetadata, assertPortAvailable, isSafeDatabaseUrl, type PwaOwnership } from './pwa-process.js';
import { provisionOwnedDatabase } from './pwa-db.js';
import { seedPwaFixtures } from '../helpers/pwa-fixtures.js';

const root = resolve(process.cwd(), '../..');
const stateDir = join(root, '.pwa-harness');
const metadataPath = join(stateDir, 'environment.json');
const ports = [3443, 3000, 3005];

function run(command: string, args: string[], cwd = root, env: NodeJS.ProcessEnv = process.env): string {
  return execFileSync(command, args, { cwd, env, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
}

async function readOwner(): Promise<PwaOwnership> {
  let content: string;
  try { content = await readFile(metadataPath, 'utf8'); } catch { throw new Error('PWA ownership metadata is absent; refusing cleanup or replacement'); }
  const owner: unknown = JSON.parse(content);
  assertOwnedMetadata(owner);
  if (owner.ports.length !== ports.length || !ports.every((port) => owner.ports.includes(port)) || owner.artifacts.some((artifact) => !artifact.startsWith(`${stateDir}/${owner.id}`))) {
    throw new Error('Invalid ownership metadata paths or ports');
  }
  return owner;
}

function writeOwner(owner: PwaOwnership): Promise<void> {
  return writeFile(metadataPath, `${JSON.stringify({ ...owner, endpoints: { browser: 'https://localhost:3443', web: 'http://127.0.0.1:3000', api: 'http://127.0.0.1:3005' } }, null, 2)}\n`, { mode: 0o600 });
}

async function up(): Promise<void> {
  try { run('docker', ['info', '--format', '{{.ServerVersion}}']); } catch { throw new Error('Docker runtime is unavailable; refusing PWA harness startup'); }
  try { await access(metadataPath); throw new Error('Existing PWA owner metadata found; run down first'); } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
  for (const port of ports) await assertPortAvailable(port);
  const id = randomUUID();
  await mkdir(stateDir, { recursive: true, mode: 0o700 });
  const ownedDir = join(stateDir, id);
  await mkdir(ownedDir, { mode: 0o700 });
  const apiImage = `transformlit-api:pwa-${id}`;
  const webImage = `transformlit-web:pwa-${id}`;
  const db = await provisionOwnedDatabase();
  if (!isSafeDatabaseUrl(db.databaseUrl)) { await db.container.stop(); throw new Error('Provisioner returned an unsafe database URL'); }
  const owner: PwaOwnership = { owner: 'transformlit-pwa', id, createdAt: new Date().toISOString(), ports, containers: [db.containerId], images: [apiImage, webImage], pids: [], artifacts: [ownedDir], databaseUrl: db.databaseUrl };
  await writeOwner(owner);
  run('pnpm', ['exec', 'prisma', 'migrate', 'deploy', '--schema', 'prisma/schema.prisma'], join(root, 'apps/api'), { ...process.env, DATABASE_URL: db.databaseUrl });
  await seedPwaFixtures(db.databaseUrl, db.container);
  const dbUrl = new URL(db.databaseUrl);
  dbUrl.hostname = 'host.docker.internal';
  const dockerDbUrl = dbUrl.toString();
  try {
    run('docker', ['build', '-f', 'apps/api/Dockerfile', '-t', apiImage, '.']);
    run('docker', ['build', '-f', 'apps/web/Dockerfile', '-t', webImage,
      '--build-arg', 'NEXT_PUBLIC_API_URL=https://localhost:3443/api/graphql',
      '--build-arg', 'NEXT_PUBLIC_WS_URL=wss://localhost:3443/api/graphql', '.']);
    owner.containers.push(run('docker', ['run', '-d', '--name', `transformlit-pwa-api-${id}`, '--label', `transformlit.owner=${id}`, '-p', '127.0.0.1:3005:3005', '-e', `DATABASE_URL=${dockerDbUrl}`, '-e', 'CORS_ORIGIN=https://localhost:3443', apiImage]));
    await writeOwner(owner);
    owner.containers.push(run('docker', ['run', '-d', '--name', `transformlit-pwa-web-${id}`, '--label', `transformlit.owner=${id}`, '-p', '127.0.0.1:3000:3000', webImage]));
    await writeOwner(owner);
    const key = join(ownedDir, 'localhost-key.pem');
    const cert = join(ownedDir, 'localhost-cert.pem');
    run('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-sha256', '-nodes', '-days', '2', '-keyout', key, '-out', cert, '-subj', '/CN=localhost', '-addext', 'subjectAltName=DNS:localhost,IP:127.0.0.1']);
    owner.artifacts.push(key, cert);
    const browserProfile = join(ownedDir, 'browser-profile');
    await mkdir(browserProfile, { recursive: true, mode: 0o700 });
    run('certutil', ['-N', '-d', `sql:${browserProfile}`, '--empty-password']);
    run('certutil', ['-A', '-d', `sql:${browserProfile}`, '-n', `pwa-${id}`, '-t', 'C,,', '-i', cert]);
    owner.artifacts.push(browserProfile);
    const proxyEnv = { ...process.env, PWA_PROXY_PORT: '3443', PWA_API_PORT: '3005', PWA_WEB_PORT: '3000', PWA_TLS_KEY: key, PWA_TLS_CERT: cert };
    const proxy: ChildProcess = spawn('pnpm', ['exec', 'tsx', join(root, 'apps/api/test/scripts/pwa-proxy.ts')], { cwd: join(root, 'apps/api'), env: proxyEnv, detached: true, stdio: 'ignore' });
    if (!proxy.pid) throw new Error('Failed to start owned HTTPS proxy');
    owner.pids.push(proxy.pid);
    await writeOwner(owner);
    console.log('PWA harness started; browser endpoint https://localhost:3443');
  } catch (error) {
    await writeOwner(owner);
    throw error;
  }
}

async function test(): Promise<void> {
  const owner = await readOwner();
  if (!isSafeDatabaseUrl(owner.databaseUrl)) throw new Error('Invalid owned database endpoint');
  run('pnpm', ['exec', 'playwright', 'test', '-c', 'playwright.pwa.config.ts'], join(root, 'apps/web'), { ...process.env, PWA_BROWSER_PROFILE: join(stateDir, owner.id, 'browser-profile') });
}

async function down(): Promise<void> {
  try { await access(metadataPath); } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') { console.log('PWA harness is already down'); return; }
    throw error;
  }
  const owner = await readOwner();
  try { run('docker', ['info', '--format', '{{.ServerVersion}}']); } catch { throw new Error('Docker runtime is unavailable; refusing cleanup without ownership verification'); }
  for (const pid of owner.pids) {
    let command = '';
    try { command = run('ps', ['-p', String(pid), '-o', 'command=']); } catch { continue; }
    if (!command.includes('pwa-proxy.ts') || !command.includes(root)) throw new Error(`PID ${pid} is not the owned PWA proxy`);
  }
  for (const containerId of owner.containers.slice(1)) {
    try {
      const labels = run('docker', ['inspect', '--format', '{{ index .Config.Labels "transformlit.owner" }}', containerId]);
      if (labels !== owner.id) throw new Error(`Container ${containerId} is not owned by this invocation`);
    } catch (error) {
      if (error instanceof Error && error.message.includes('not owned')) throw error;
    }
  }
  const databaseContainer = owner.containers[0];
  if (databaseContainer) {
    try {
      const image = run('docker', ['inspect', '--format', '{{.Config.Image}}', databaseContainer]);
      const hostPort = run('docker', ['inspect', '--format', '{{(index (index .NetworkSettings.Ports "5432/tcp") 0).HostPort}}', databaseContainer]);
      if (image !== 'postgres:15-alpine' || Number(hostPort) !== Number(new URL(owner.databaseUrl).port)) {
        throw new Error('Database container does not match the owned disposable endpoint');
      }
    } catch (error) {
      if (error instanceof Error && error.message.includes('does not match')) throw error;
      // A missing tracked container is already stopped, so repeated down is safe.
    }
  }
  for (const containerId of owner.containers.slice(1)) {
    let labels: string;
    try { labels = run('docker', ['inspect', '--format', '{{ index .Config.Labels "transformlit.owner" }}', containerId]); } catch { continue; }
    if (labels !== owner.id) throw new Error(`Container ${containerId} is not owned by this invocation`);
    run('docker', ['rm', '-f', containerId]);
  }
  for (const pid of owner.pids) {
    let command = '';
    try { command = run('ps', ['-p', String(pid), '-o', 'command=']); } catch { continue; }
    if (!command.includes('pwa-proxy.ts') || !command.includes(root)) throw new Error(`PID ${pid} is not the owned PWA proxy`);
    process.kill(-pid, 'SIGTERM');
  }
  if (databaseContainer) {
    try { run('docker', ['rm', '-f', databaseContainer]); } catch { /* already removed */ }
  }
  for (const image of owner.images) {
    try { run('docker', ['image', 'inspect', image]); run('docker', ['image', 'rm', image]); } catch { /* already removed */ }
  }
  run('rm', ['-rf', ...owner.artifacts]);
  run('rm', ['-f', metadataPath]);
  console.log('PWA harness resources removed');
}

async function main(): Promise<void> {
  const operation = process.argv[2];
  if (!['up', 'test', 'down'].includes(operation ?? '')) throw new Error('Usage: pwa-harness.ts <up|test|down>');
  if (operation === 'up') await up();
  if (operation === 'test') await test();
  if (operation === 'down') await down();
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
