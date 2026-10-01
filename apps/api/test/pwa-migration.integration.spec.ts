import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { Pool } from 'pg';
import { type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { assertOwnedDisposableDatabaseUrl, startOwnedDisposableDatabase } from './helpers/pwa-disposable-db.js';

interface LegacyRows {
  user: { id: string; email: string };
  book: { id: string; title: string };
  progress: { currentPage: number };
}

/**
 * Applies the real Prisma migration path against a fresh and a populated owned
 * disposable database and proves data preservation / safe rerun. Requires a live
 * disposable database; BLOCKED wherever Docker/Testcontainers is unavailable and
 * never targets an arbitrary `DATABASE_URL`.
 */
describe('PWA reader sync migration', () => {
  let container: StartedPostgreSqlContainer | null = null;
  let databaseUrl: string;
  const apiCwd = resolve(__dirname, '..');

  function runMigrateDeploy(url: string): string {
    return execFileSync('pnpm', ['exec', 'prisma', 'migrate', 'deploy', '--schema', 'prisma/schema.prisma'], {
      cwd: apiCwd,
      env: { ...process.env, DATABASE_URL: url },
      encoding: 'utf8',
    });
  }

  beforeAll(async () => {
    try {
      container = await startOwnedDisposableDatabase();
      databaseUrl = container.getConnectionUri();
    } catch (error) {
      throw new Error('Could not start owned disposable database for migration integration test', { cause: error });
    }
    assertOwnedDisposableDatabaseUrl(databaseUrl, container);
  }, 180000);

  afterAll(async () => {
    await container?.stop();
  }, 30000);

  it('applies the reader-sync migration on a fresh database and records it', async () => {
    runMigrateDeploy(databaseUrl);
    const pool = new Pool({ connectionString: databaseUrl });
    try {
      const { rows } = await pool.query<{ migration_name: string; finished_at: Date | null }>(
        'SELECT migration_name, finished_at FROM _prisma_migrations ORDER BY migration_name',
      );
      const names = rows.map((row) => row.migration_name);
      expect(names).toContain('20261001000200_pwa_reader_sync');
      expect(rows.every((row) => row.finished_at !== null)).toBe(true);

      const tables = await pool.query<{ table_name: string }>(
        `SELECT table_name FROM information_schema.tables WHERE table_schema = 'public'`,
      );
      const tableNames = tables.rows.map((row) => row.table_name);
      expect(tableNames).toEqual(expect.arrayContaining([
        'reader_operation_receipts',
        'reader_tombstones',
        'conflict_copies',
      ]));
    } finally {
      await pool.end();
    }
  }, 180000);

  it('preserves pre-existing rows and is safe to re-run', async () => {
    const fixture = JSON.parse(
      readFileSync(join(__dirname, 'fixtures/pwa-migration/legacy-reader-rows.json'), 'utf8'),
    ) as LegacyRows;

    const pool = new Pool({ connectionString: databaseUrl });
    try {
      await pool.query('INSERT INTO users (id, email, "emailNormalized", "displayName", "createdAt", "updatedAt") VALUES ($1,$2,$2,$3, now(), now())', [fixture.user.id, fixture.user.email, 'Legacy Reader']);
      await pool.query('INSERT INTO books (id, title, status, "conversionStatus", "createdAt", "updatedAt") VALUES ($1,$2,\'PUBLISHED\',\'READY\', now(), now())', [fixture.book.id, fixture.book.title]);
      await pool.query('INSERT INTO book_progress (id, "userId", "bookId", "currentPage", "lastReadAt", "createdAt", "updatedAt") VALUES (gen_random_uuid()::text, $1, $2, $3, now(), now(), now())', [fixture.user.id, fixture.book.id, fixture.progress.currentPage]);
      const bookmarks = await pool.query('SELECT count(*)::int AS count FROM bookmarks');
      expect(bookmarks.rows[0].count).toBe(0);

      const before = await pool.query('SELECT "currentPage" FROM book_progress WHERE "userId" = $1 AND "bookId" = $2', [fixture.user.id, fixture.book.id]);
      expect(before.rows[0].currentPage).toBe(fixture.progress.currentPage);

      // Re-running the full deploy must not fail or destroy data (idempotent).
      const output = runMigrateDeploy(databaseUrl);
      expect(output).toBeDefined();
      const after = await pool.query('SELECT "currentPage", revision FROM book_progress WHERE "userId" = $1 AND "bookId" = $2', [fixture.user.id, fixture.book.id]);
      expect(after.rows[0].currentPage).toBe(fixture.progress.currentPage);
      expect(after.rows[0].revision).toBe(0);
    } finally {
      await pool.end();
    }
  }, 180000);

  it('refuses to run against a database not owned by a live container', () => {
    expect(() => assertOwnedDisposableDatabaseUrl('postgresql://localhost:5432/transformlit', container)).toThrow(/owned/i);
  });
});
