import { execFileSync } from 'node:child_process';
import { cpSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { runInNewContext } from 'node:vm';

// This util is compiled by ts-jest to CommonJS, so `__dirname` is the scripts dir.
export const buildScriptPath = resolve(__dirname, '..', 'build-pwa-assets.mjs');

export interface FixtureChunk {
  /** URL path under `/_next/static/`, e.g. `/chunks/app.css`. */
  readonly url: string;
  readonly contents: string;
}

export interface FixtureOptions {
  readonly buildId?: string;
  readonly chunks?: readonly FixtureChunk[];
  readonly fonts?: readonly string[];
  readonly omitChunkFileFor?: string;
  readonly omitPublicAsset?: string;
  readonly omitOfflineHtml?: boolean;
  readonly omitLocalReaderManifests?: boolean;
}

export interface Fixture {
  readonly root: string;
  readonly nextDir: string;
  readonly publicDir: string;
  cleanup(): void;
}

const DEFAULT_CHUNKS: readonly FixtureChunk[] = [
  { url: '/chunks/runtime.js', contents: 'console.log("runtime")' },
  { url: '/chunks/app.css', contents: 'body{color:#000}' },
];

// Distinct chunks referenced only by the local-reader client manifests. The
// allowlist must include these so a cold offline hub can run the shared views.
const LOCAL_READER_CHUNKS: readonly FixtureChunk[] = [
  { url: '/chunks/reader.js', contents: 'console.log("reader")' },
];

function staticToFile(nextDir: string, staticUrl: string): string {
  return join(nextDir, staticUrl.replace(/^\/_next\//, ''));
}

function writeOfflineHtml(nextDir: string, chunks: readonly FixtureChunk[], fonts: readonly string[]): void {
  const scriptTags = chunks
    .filter((chunk) => chunk.url.endsWith('.js'))
    .map((chunk) => `<script src="/_next/static${chunk.url}" async=""></script>`)
    .join('');
  const styleTags = chunks
    .filter((chunk) => chunk.url.endsWith('.css'))
    .map((chunk) => `<link rel="stylesheet" href="/_next/static${chunk.url}"/>`)
    .join('');
  const fontTags = fonts
    .map((font) => `<link rel="preload" href="/_next/static/media/${font}" as="font" type="font/woff2"/>`)
    .join('');
  const html = `<!DOCTYPE html><html><head>${fontTags}${styleTags}</head><body><main>offline</main>${scriptTags}</body></html>`;
  writeFileSync(join(nextDir, 'server/app/offline.html'), html);
}

function writeClientReferenceManifest(nextDir: string, chunks: readonly FixtureChunk[]): void {
  const jsChunks = chunks.filter((chunk) => chunk.url.endsWith('.js')).map((chunk) => `/_next/static${chunk.url}`);
  const manifest = {
    clientModules: {
      '[project]/apps/web/src/app/offline/offline-client.tsx': {
        id: 1,
        name: '*',
        chunks: jsChunks,
        async: false,
      },
    },
  };
  const source = `globalThis.__RSC_MANIFEST = globalThis.__RSC_MANIFEST || {};\nglobalThis.__RSC_MANIFEST["/offline/page"] = ${JSON.stringify(manifest)};\n`;
  writeFileSync(join(nextDir, 'server/app/offline/page_client-reference-manifest.js'), source);
}

/** Mirrors the build's route-manifest layout for the shared local-reader chunks. */
function writeLocalReaderManifest(
  nextDir: string,
  relativeDir: string,
  chunks: readonly FixtureChunk[],
): void {
  const dir = join(nextDir, 'server/app', relativeDir);
  mkdirSync(dir, { recursive: true });
  const jsChunks = chunks.filter((chunk) => chunk.url.endsWith('.js')).map((chunk) => `/_next/static${chunk.url}`);
  const manifest = {
    clientModules: {
      '[project]/apps/web/src/components/reader/book-reader-view.tsx': {
        id: 1,
        name: 'BookReaderView',
        chunks: jsChunks,
        async: false,
      },
    },
  };
  const source = `globalThis.__RSC_MANIFEST = globalThis.__RSC_MANIFEST || {};\nglobalThis.__RSC_MANIFEST["${relativeDir}"] = ${JSON.stringify(manifest)};\n`;
  writeFileSync(join(dir, 'page_client-reference-manifest.js'), source);
}

function writePublicShell(publicDir: string, omitPublicAsset?: string): void {
  const assets: Record<string, string> = {
    'manifest.webmanifest': '{"name":"Transform Lit"}',
    'icons/pwa-192.png': 'png-192',
    'icons/pwa-512.png': 'png-512',
    'icons/pwa-maskable-512.png': 'png-maskable',
    'icons/apple-touch-icon.png': 'png-apple',
  };
  for (const [relativePath, contents] of Object.entries(assets)) {
    if (omitPublicAsset === `/${relativePath}`) continue;
    const target = join(publicDir, relativePath);
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, contents);
  }
}

export function createFixture(options: FixtureOptions = {}): Fixture {
  const root = resolve(tmpdir(), `pwa-fixture-${Date.now()}-${Math.random().toString(16).slice(2)}`);
  const nextDir = join(root, '.next');
  const publicDir = join(root, 'public');
  const chunks = options.chunks ?? DEFAULT_CHUNKS;
  const fonts = options.fonts ?? ['display.woff2', 'body.woff2'];

  mkdirSync(join(nextDir, 'server/app/offline'), { recursive: true });
  mkdirSync(join(nextDir, 'static/media'), { recursive: true });
  writeFileSync(join(nextDir, 'BUILD_ID'), options.buildId ?? 'build-a');

  for (const chunk of chunks) {
    if (options.omitChunkFileFor === chunk.url) continue;
    const target = staticToFile(nextDir, `/_next/static${chunk.url}`);
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, chunk.contents);
  }
  for (const font of fonts) {
    writeFileSync(join(nextDir, 'static/media', font), `font:${font}`);
  }

  if (!options.omitOfflineHtml) writeOfflineHtml(nextDir, chunks, fonts);
  writeClientReferenceManifest(nextDir, chunks);
  if (!options.omitLocalReaderManifests) {
    const readerChunks = [...chunks, ...LOCAL_READER_CHUNKS];
    for (const chunk of LOCAL_READER_CHUNKS) {
      const target = staticToFile(nextDir, `/_next/static${chunk.url}`);
      mkdirSync(dirname(target), { recursive: true });
      writeFileSync(target, chunk.contents);
    }
    writeLocalReaderManifest(nextDir, '(reader)/books/[id]/read', readerChunks);
    writeLocalReaderManifest(nextDir, '(app)/bible/[translation]/[book]/[chapter]', readerChunks);
  }
  writePublicShell(publicDir, options.omitPublicAsset);

  return {
    root,
    nextDir,
    publicDir,
    cleanup: () => rmSync(root, { recursive: true, force: true }),
  };
}

export interface BuildResult {
  readonly status: number;
  readonly stdout: string;
  readonly stderr: string;
}

export function runBuildScript(
  fixture: Fixture,
  env: Record<string, string> = {},
  args: readonly string[] = [],
): BuildResult {
  try {
    const stdout = execFileSync(process.execPath, [buildScriptPath, ...args], {
      env: { ...process.env, PWA_WEB_ROOT: fixture.root, ...env },
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    return { status: 0, stdout, stderr: '' };
  } catch (error) {
    const failure = error as { status?: number; stdout?: string; stderr?: string };
    return {
      status: failure.status ?? 1,
      stdout: failure.stdout ?? '',
      stderr: failure.stderr ?? '',
    };
  }
}

export function readGeneratedWorker(fixture: Fixture): string {
  return readFileSync(join(fixture.publicDir, 'sw.js'), 'utf8');
}

export interface GeneratedInventory {
  releaseId: string;
  inventoryDigest: string;
  buildId: string;
  assets: string[];
  excluded: string[];
}

export function readGeneratedInventory(fixture: Fixture): GeneratedInventory {
  return JSON.parse(readFileSync(join(fixture.publicDir, 'pwa-assets.json'), 'utf8'));
}

export function copyFixture(source: Fixture, targetRoot: string): void {
  cpSync(source.root, targetRoot, { recursive: true });
}

/** Simulated network/cache/worker harness for evaluating the released worker. */
export interface NetworkResponse {
  status?: number;
  body?: string;
  type?: string;
  redirected?: boolean;
}

export interface WorkerHarness {
  setNetwork(handler: (url: string, request: Request) => NetworkResponse | 'offline'): void;
  dispatch(input: {
    url: string;
    method?: string;
    mode?: string;
    headers?: Record<string, string>;
  }): Promise<{ handled: boolean; status?: number; body?: string }>;
  install(): Promise<void>;
  activate(): Promise<void>;
  message(data: unknown): void;
  skipWaitingCalls(): number;
  cacheNames(): Promise<string[]>;
  cacheEntries(name: string): Promise<string[]>;
}

const ORIGIN = 'https://app.example';

class FakeHeaders {
  private readonly map = new Map<string, string>();

  constructor(init?: Record<string, string>) {
    for (const [key, value] of Object.entries(init ?? {})) {
      this.map.set(key.toLowerCase(), value);
    }
  }

  get(name: string): string | null {
    return this.map.get(name.toLowerCase()) ?? null;
  }

  has(name: string): boolean {
    return this.map.has(name.toLowerCase());
  }
}

interface FakeRequestInit {
  method?: string;
  mode?: string;
  headers?: Record<string, string> | FakeHeaders;
}

class FakeRequest {
  readonly url: string;
  readonly method: string;
  readonly mode: string;
  readonly headers: FakeHeaders;

  constructor(url: string, init: FakeRequestInit = {}) {
    this.url = url;
    this.method = init.method ?? 'GET';
    this.mode = init.mode ?? 'cors';
    const headers = init.headers instanceof FakeHeaders ? init.headers : new FakeHeaders(init.headers);
    this.headers = headers;
  }
}

export function createWorkerHarness(workerSource: string): WorkerHarness {
  const listeners: Record<string, (event: unknown) => void> = {};
  let skipWaitingCalls = 0;
  let network: (url: string, request: Request) => NetworkResponse | 'offline' = () => ({ status: 200, body: 'asset' });

  const cacheStore = new Map<string, Map<string, { status: number; body: string }>>();
  const caches = {
    open: async (name: string) => {
      if (!cacheStore.has(name)) cacheStore.set(name, new Map());
      const store = cacheStore.get(name)!;
      return {
        put: async (key: string, value: { status: number; body: string }) => {
          store.set(key, value);
        },
        match: async (key: string) => store.get(key),
      };
    },
    keys: async () => [...cacheStore.keys()],
    delete: async (name: string) => cacheStore.delete(name),
  };

  const toResponse = (init: NetworkResponse) => {
    const status = init.status ?? 200;
    return {
      ok: status >= 200 && status < 300,
      status,
      type: init.type ?? 'basic',
      redirected: init.redirected ?? false,
      body: init.body ?? '',
      headers: { get: () => null },
      json: async () => JSON.parse(init.body ?? '{}'),
      clone() {
        return toResponse(init);
      },
    };
  };

  const sandbox: Record<string, unknown> = {
    self: {
      location: { origin: ORIGIN },
      addEventListener: (type: string, handler: (event: unknown) => void) => {
        listeners[type] = handler;
      },
      clients: { claim: () => Promise.resolve() },
      skipWaiting: () => {
        skipWaitingCalls += 1;
      },
    },
    caches,
    fetch: async (input: string | FakeRequest) => {
      const url = typeof input === 'string' ? input : input.url;
      const request = typeof input === 'string' ? new FakeRequest(url) : input;
      const result = network(url, request as unknown as Request);
      if (result === 'offline') throw new TypeError('Failed to fetch');
      return toResponse(result);
    },
    URL,
    Request: FakeRequest,
    Headers: FakeHeaders,
    console,
  };
  sandbox.globalThis = sandbox;
  runInNewContext(workerSource, sandbox);

  const runWithWaitUntil = async (type: string, event: Record<string, unknown>) => {
    const captured: Promise<unknown>[] = [];
    const wrapped = { ...event, waitUntil: (promise: Promise<unknown>) => captured.push(promise) };
    listeners[type]?.(wrapped);
    await Promise.all(captured);
  };

  return {
    setNetwork: (handler) => {
      network = handler;
    },
    install: () => runWithWaitUntil('install', {}),
    activate: () => runWithWaitUntil('activate', {}),
    message: (data) => listeners.message?.({ data }),
    skipWaitingCalls: () => skipWaitingCalls,
    cacheNames: async () => [...cacheStore.keys()],
    cacheEntries: async (name) => [...(cacheStore.get(name)?.keys() ?? [])],
    dispatch: async (input) => {
      const request = new FakeRequest(new URL(input.url, ORIGIN).toString(), {
        method: input.method ?? 'GET',
        mode: input.mode ?? 'cors',
        headers: input.headers,
      });
      let captured: Promise<unknown> | undefined;
      const event = {
        request,
        respondWith: (promise: Promise<unknown>) => {
          captured = promise;
        },
      };
      listeners.fetch?.(event);
      if (!captured) return { handled: false };
      const response = (await captured) as { status: number; body: string };
      return { handled: true, status: response.status, body: response.body };
    },
  };
}
