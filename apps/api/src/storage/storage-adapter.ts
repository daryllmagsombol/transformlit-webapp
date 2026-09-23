export const STORAGE_ADAPTER = Symbol('STORAGE_ADAPTER');

export interface ByteRange {
  start: number;
  end: number;
}

/**
 * Provider-neutral object storage. Deliberately has no `getPublicUrl`: book
 * bytes are only ever delivered through authenticated application endpoints.
 */
export interface StorageAdapter {
  put(key: string, data: Buffer, contentType?: string): Promise<void>;
  getBuffer(key: string): Promise<Buffer | null>;
  getStream(key: string, range?: ByteRange): Promise<NodeJS.ReadableStream | null>;
  exists(key: string): Promise<boolean>;
  delete(key: string): Promise<void>;
  deletePrefix(prefix: string): Promise<void>;
}
