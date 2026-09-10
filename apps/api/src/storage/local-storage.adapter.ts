import { Injectable } from '@nestjs/common';
import { createReadStream } from 'node:fs';
import { mkdir, rm, stat, readFile, writeFile } from 'node:fs/promises';
import { dirname, join, normalize, resolve, sep } from 'node:path';
import { ByteRange, StorageAdapter } from './storage-adapter.js';

@Injectable()
export class LocalStorageAdapter implements StorageAdapter {
  private readonly root: string;

  constructor(root: string) {
    this.root = resolve(root);
  }

  async put(key: string, data: Buffer, _contentType?: string): Promise<void> {
    const target = this.resolveKey(key);
    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, data);
  }

  async getBuffer(key: string): Promise<Buffer | null> {
    const target = this.resolveKey(key);
    try {
      return await readFile(target);
    } catch {
      return null;
    }
  }

  async getStream(key: string, range?: ByteRange): Promise<NodeJS.ReadableStream | null> {
    const target = this.resolveKey(key);
    try {
      await stat(target);
    } catch {
      return null;
    }
    if (range) return createReadStream(target, { start: range.start, end: range.end });
    return createReadStream(target);
  }

  async exists(key: string): Promise<boolean> {
    const target = this.resolveKey(key);
    try {
      await stat(target);
      return true;
    } catch {
      return false;
    }
  }

  async delete(key: string): Promise<void> {
    await rm(this.resolveKey(key), { force: true });
  }

  async deletePrefix(prefix: string): Promise<void> {
    await rm(this.resolveKey(prefix), { recursive: true, force: true });
  }

  /** Rejects traversal, absolute paths and null bytes; keeps access inside root. */
  private resolveKey(key: string): string {
    if (!key || key.includes('\0')) throw new Error('Invalid storage key');
    const normalized = normalize(key).replaceAll('\\', '/');
    const segments = normalized.split('/');
    if (normalized.startsWith('/') || normalized === '' || normalized === '.' || segments.includes('..')) {
      throw new Error(`Unsafe storage key: ${key}`);
    }
    const target = resolve(join(this.root, normalized));
    // Every key must resolve to a path strictly inside the storage root so a
    // destructive op can never target the root itself.
    if (!target.startsWith(`${this.root}${sep}`)) {
      throw new Error(`Storage key escapes root: ${key}`);
    }
    return target;
  }
}
