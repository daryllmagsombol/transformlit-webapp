import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { LocalStorageAdapter } from './local-storage.adapter';

describe('LocalStorageAdapter', () => {
  let root: string;
  let adapter: LocalStorageAdapter;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'book-storage-'));
    adapter = new LocalStorageAdapter(root);
  });

  afterEach(() => rmSync(root, { recursive: true, force: true }));

  it('puts, exists, gets buffer and stream, deletes', async () => {
    await adapter.put('books/1/original.pdf', Buffer.from('%PDF-1.4'), 'application/pdf');
    expect(await adapter.exists('books/1/original.pdf')).toBe(true);
    expect((await adapter.getBuffer('books/1/original.pdf'))?.toString()).toBe('%PDF-1.4');

    const stream = await adapter.getStream('books/1/original.pdf');
    expect(stream).not.toBeNull();
    const chunks: Buffer[] = [];
    for await (const chunk of stream as NodeJS.ReadableStream) chunks.push(Buffer.from(chunk));
    expect(Buffer.concat(chunks).toString()).toBe('%PDF-1.4');

    await adapter.delete('books/1/original.pdf');
    expect(await adapter.exists('books/1/original.pdf')).toBe(false);
  });

  it('supports ranged reads', async () => {
    await adapter.put('k', Buffer.from('0123456789'));
    const stream = await adapter.getStream('k', { start: 2, end: 4 });
    const chunks: Buffer[] = [];
    for await (const chunk of stream as NodeJS.ReadableStream) chunks.push(Buffer.from(chunk));
    expect(Buffer.concat(chunks).toString()).toBe('234');
  });

  it('deletes a prefix', async () => {
    await adapter.put('books/1/v1/pages/1.png', Buffer.from('a'));
    await adapter.put('books/1/v1/pages/2.png', Buffer.from('b'));
    await adapter.deletePrefix('books/1/v1');
    expect(await adapter.exists('books/1/v1/pages/1.png')).toBe(false);
  });

  it('rejects traversal and absolute keys', async () => {
    await expect(adapter.put('../escape', Buffer.from('x'))).rejects.toThrow();
    await expect(adapter.getBuffer('/etc/passwd')).rejects.toThrow();
    await expect(adapter.getBuffer('a/../../b')).rejects.toThrow();
  });

  it('returns null for missing keys', async () => {
    expect(await adapter.getBuffer('nope')).toBeNull();
    expect(await adapter.getStream('nope')).toBeNull();
    expect(await adapter.exists('nope')).toBe(false);
  });
});
