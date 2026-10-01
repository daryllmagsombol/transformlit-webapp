import { classifyStorageError, QuotaExceededError, TransactionAbortedError } from './contracts';
import {
  OFFLINE_DB_NAME,
  OFFLINE_DB_VERSION,
  OFFLINE_STORES,
  bookKey,
  bibleChapterKey,
  qualifyKey,
} from './database';

const PRIVATE_STORES = [
  'downloadManifests',
  'bookVersions',
  'bookPages',
  'bibleChapters',
  'readerRecords',
  'tombstones',
  'conflicts',
  'outbox',
  'receipts',
] as const;

describe('offline database schema', () => {
  it('is a single versioned database', () => {
    expect(OFFLINE_DB_NAME).toBe('transformlit-offline');
    expect(OFFLINE_DB_VERSION).toBeGreaterThanOrEqual(1);
  });

  it('creates every store required by the contract', () => {
    const names = OFFLINE_STORES.map((store) => store.name);
    expect(names).toEqual(
      expect.arrayContaining([
        'lifecycle',
        'leases',
        'downloadManifests',
        'bookVersions',
        'bookPages',
        'bibleChapters',
        'readerRecords',
        'tombstones',
        'conflicts',
        'outbox',
        'receipts',
      ]),
    );
  });

  it('namespaces every private store by an immutable subject index', () => {
    for (const name of PRIVATE_STORES) {
      const store = OFFLINE_STORES.find((candidate) => candidate.name === name);
      expect(store).toBeDefined();
      const subjectIndex = store?.indexes?.find((index) => index.name === 'subject');
      expect(subjectIndex?.keyPath).toBe('subject');
    }
  });

  it('uses compound keys that always include subject for private records', () => {
    expect(qualifyKey('user-a', 'book', 'b1')).toContain('user-a');
    expect(bookKey('user-a', 'b1')).toBe(qualifyKey('user-a', 'book', 'b1'));
    expect(bibleChapterKey('user-a', 'BSB', 'ROM', 8)).toBe(qualifyKey('user-a', 'bible', 'BSB', 'ROM', 8));
    expect(bookKey('user-a', 'b1')).not.toBe(bookKey('user-b', 'b1'));
  });
});

describe('storage error classification', () => {
  it('maps quota and abort DOMExceptions to typed errors', () => {
    expect(classifyStorageError(new DOMException('full', 'QuotaExceededError'))).toBeInstanceOf(QuotaExceededError);
    expect(classifyStorageError(new DOMException('aborted', 'AbortError'))).toBeInstanceOf(TransactionAbortedError);
  });

  it('wraps unknown errors as offline storage errors', () => {
    const classified = classifyStorageError(new Error('boom'));
    expect(classified.name).toBe('OfflineStorageError');
  });
});
