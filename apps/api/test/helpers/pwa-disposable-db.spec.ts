import { assertOwnedDisposableDatabaseUrl } from './pwa-disposable-db.js';

describe('PWA disposable database ownership', () => {
  it('rejects absent database configuration', () => {
    expect(() => assertOwnedDisposableDatabaseUrl(undefined)).toThrow(/disposable/i);
  });

  it('rejects local development and shared database URLs', () => {
    expect(() => assertOwnedDisposableDatabaseUrl('postgresql://localhost:5432/transformlit_test')).toThrow(/owned/i);
  });

  it('rejects a URL that does not match the provided container before any database operation', () => {
    const container = { getConnectionUri: () => 'postgresql://owned:owned@127.0.0.1:54321/testdb' };
    expect(() =>
      assertOwnedDisposableDatabaseUrl(
        'postgresql://shared:shared@127.0.0.1:54322/shared',
        container as never,
      ),
    ).toThrow(/owned/i);
  });

  it('accepts only the URL branded as owned by a running test container', () => {
    expect(() => assertOwnedDisposableDatabaseUrl('postgresql://test:test@127.0.0.1:54321/testdb')).toThrow(/owned/i);
  });
});
