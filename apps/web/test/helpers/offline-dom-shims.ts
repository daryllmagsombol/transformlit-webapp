import { Blob as NodeBlob } from 'node:buffer';
import { webcrypto } from 'node:crypto';
import { TextDecoder as NodeTextDecoder, TextEncoder as NodeTextEncoder } from 'node:util';

/**
 * jsdom capability shims required by the offline/download specs.
 *
 * These are deliberately NOT installed from the global `jest.setup.ts`: doing
 * so replaced `globalThis.Blob`/`crypto`/`Response` for every suite, which can
 * change `instanceof Blob`/`File` behavior in unrelated UI tests. A spec opts in
 * by importing this module (see the offline/download/repository specs), so
 * global suite behavior is unchanged.
 */

// jsdom does not expose the WHATWG encoding globals that the offline download
// manager (and its specs) rely on. Provide Node's implementations when absent.
if (globalThis.TextEncoder === undefined) {
  Object.defineProperty(globalThis, 'TextEncoder', { writable: true, value: NodeTextEncoder });
}
if (globalThis.TextDecoder === undefined) {
  Object.defineProperty(globalThis, 'TextDecoder', { writable: true, value: NodeTextDecoder });
}
// jsdom's Blob lacks `arrayBuffer()`; the download manager hashes stored page
// bytes, so expose Node's Blob (which implements it) when missing.
if (globalThis.Blob === undefined || typeof globalThis.Blob.prototype.arrayBuffer !== 'function') {
  Object.defineProperty(globalThis, 'Blob', { writable: true, value: NodeBlob });
}
// `crypto.subtle` is used to hash download assets; jsdom has no WebCrypto.
if (globalThis.crypto === undefined || !globalThis.crypto?.subtle) {
  Object.defineProperty(globalThis, 'crypto', { writable: true, value: webcrypto });
}

// jsdom provides neither `fetch` nor `Response`. The offline module's specs use
// a small Response surface (`ok`, `status`, `json()`, `arrayBuffer()`); provide
// a minimal implementation when the environment lacks it. Exported so specs can
// construct responses even if a future jsdom starts shipping a partial one.
export class MinimalResponse {
  readonly status: number;
  readonly ok: boolean;
  private readonly body: BodyInit | null;
  private readonly contentType: string | null;

  constructor(body: BodyInit | null = null, init: { status?: number; headers?: Record<string, string> } = {}) {
    this.status = init.status ?? 200;
    this.ok = this.status >= 200 && this.status < 300;
    this.body = body;
    this.contentType = init.headers?.['content-type'] ?? null;
  }

  private bytes(): Uint8Array {
    if (this.body === null) return new Uint8Array();
    if (typeof this.body === 'string') return new NodeTextEncoder().encode(this.body);
    // Realm-safe: jsdom's Uint8Array differs from Node's, so `instanceof`
    // fails for Buffers created in the test realm. Duck-type instead.
    if (ArrayBuffer.isView(this.body)) {
      const view = this.body as ArrayBufferView;
      return new Uint8Array(view.buffer, view.byteOffset, view.byteLength);
    }
    if (this.body instanceof ArrayBuffer) return new Uint8Array(this.body);
    return new Uint8Array();
  }

  async arrayBuffer(): Promise<ArrayBuffer> {
    const bytes = this.bytes();
    return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
  }

  async json(): Promise<unknown> {
    return JSON.parse(new NodeTextDecoder().decode(this.bytes())) as unknown;
  }
}

if (globalThis.Response === undefined) {
  Object.defineProperty(globalThis, 'Response', { writable: true, value: MinimalResponse });
}
