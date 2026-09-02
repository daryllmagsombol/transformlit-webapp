/**
 * Creates the search Web Worker. Isolated in its own module so Jest (CommonJS,
 * no vm-modules on this Node) can mock it: `import.meta.url` is ESM-only and
 * cannot survive a CommonJS transform. Turbopack statically detects the
 * `new Worker(new URL(...))` pattern here and emits a dedicated worker chunk.
 */
export function createSearchWorker(): Worker {
  return new Worker(new URL('./search-worker.ts', import.meta.url));
}