import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import { type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import cookieParser from 'cookie-parser';
import { graphqlUploadExpress } from 'graphql-upload-ts';
import { Pool } from 'pg';
import { rm } from 'node:fs/promises';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { execSync } from 'node:child_process';
import { MAX_FILE_SIZE_BYTES } from '@transformlit/shared';
import { AppModule } from '../../src/app.module.js';
import {
  assertOwnedDisposableDatabaseUrl,
  startOwnedDisposableDatabase,
} from './pwa-disposable-db.js';

function isDockerAvailable(): boolean {
  try {
    execSync('docker info', { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

/**
 * Fails loudly when Docker/Testcontainers is unavailable. These suites reset the
 * schema, so there is deliberately no shared-database fallback: pointing them at
 * an arbitrary URL would be unsafe.
 */
export async function startOwnedDatabase(label: string): Promise<{
  container: StartedPostgreSqlContainer;
  databaseUrl: string;
  pool: Pool;
}> {
  if (!isDockerAvailable()) {
    throw new Error(
      `Docker is required for ${label} integration tests (Testcontainers)`,
    );
  }
  const container = await startOwnedDisposableDatabase();
  const databaseUrl = container.getConnectionUri();
  assertOwnedDisposableDatabaseUrl(databaseUrl, container);
  const pool = new Pool({ connectionString: databaseUrl });
  return { container, databaseUrl, pool };
}

/** Absolute path to the Prisma migrations directory for the API app. */
export function migrationsRoot(): string {
  return path.resolve(__dirname, '../../prisma/migrations');
}

/** Applies a single migration directory's `migration.sql` when present. */
export async function applyMigration(pool: Pool, directory: string): Promise<void> {
  const sqlFile = path.join(migrationsRoot(), directory, 'migration.sql');
  if (fs.existsSync(sqlFile)) {
    await pool.query(fs.readFileSync(sqlFile, 'utf-8'));
  }
}

/** Drops every public table and type so a fresh migration run starts clean. */
async function resetSchema(pool: Pool): Promise<void> {
  await pool.query(`
    DO $$ DECLARE
      r RECORD;
    BEGIN
      FOR r IN (SELECT tablename FROM pg_tables WHERE schemaname = 'public') LOOP
        EXECUTE 'DROP TABLE IF EXISTS ' || quote_ident(r.tablename) || ' CASCADE';
      END LOOP;
      FOR r IN (SELECT typname FROM pg_type WHERE typnamespace = (SELECT oid FROM pg_namespace WHERE nspname = 'public')) LOOP
        EXECUTE 'DROP TYPE IF EXISTS ' || quote_ident(r.typname) || ' CASCADE';
      END LOOP;
    END $$;
  `);
}

/** Resets the schema, then applies every migration in filename order. */
export async function applyMigrations(pool: Pool): Promise<void> {
  await resetSchema(pool);
  for (const directory of fs.readdirSync(migrationsRoot()).sort((a, b) => a.localeCompare(b))) {
    await applyMigration(pool, directory);
  }
}

/** Sets the environment AppModule reads. `extra` overrides any default. */
export function setIntegrationTestEnv(
  databaseUrl: string,
  extra: Record<string, string> = {},
): void {
  Object.assign(process.env, {
    DATABASE_URL: databaseUrl,
    JWT_SECRET: 'test-jwt-secret',
    GOOGLE_CLIENT_ID: 'test',
    GOOGLE_CLIENT_SECRET: 'test',
    GOOGLE_CALLBACK_URL: 'http://localhost:3005/auth/google/callback',
    FRONTEND_URL: 'http://localhost:3000',
    AZURE_STORAGE_CONNECTION_STRING: '',
    AZURE_STORAGE_CONTAINER: 'test',
    AZURE_COMMUNICATION_CONNECTION_STRING: '',
    AZURE_EMAIL_SENDER: 'test@example.com',
    ...extra,
  });
}

/**
 * Boots the real AppModule. When `graphqlUpload` is set, mirrors `main.ts` by
 * registering `cookie-parser` and the path-scoped `graphqlUploadExpress` before
 * the Apollo route so multipart `uploadPdf` behaves exactly as in production.
 */
export async function createTestApp(
  options: { graphqlUpload?: boolean } = {},
): Promise<{ app: INestApplication; moduleFixture: TestingModule }> {
  const moduleFixture = await Test.createTestingModule({
    imports: [AppModule],
  }).compile();
  const app = moduleFixture.createNestApplication();
  if (options.graphqlUpload) {
    app.use(cookieParser());
    app.use('/graphql', graphqlUploadExpress({ maxFileSize: MAX_FILE_SIZE_BYTES }));
  }
  await app.init();
  return { app, moduleFixture };
}

/**
 * Shared teardown ceremony: bounded app close (a hang must not wedge Jest),
 * then close the pool, stop the container, and remove any scratch storage dirs.
 */
export async function closeTestApp(
  app: INestApplication | undefined,
  pool: Pool | undefined,
  container: StartedPostgreSqlContainer | null | undefined,
  storageDirs: string[] = [],
): Promise<void> {
  const closeTimeout = new Promise<void>((_, reject) =>
    setTimeout(() => reject(new Error('close timeout')), 15000),
  );
  try {
    await Promise.race([app?.close(), closeTimeout]);
  } catch {
    // ignore close errors or timeout
  }
  await pool?.end();
  if (container) {
    await container.stop();
  }
  for (const dir of storageDirs) {
    await rm(dir, { recursive: true, force: true });
  }
}
