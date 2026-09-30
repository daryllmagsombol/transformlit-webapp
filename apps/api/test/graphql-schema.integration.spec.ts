import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { execFileSync } from 'node:child_process';
import { join, resolve } from 'node:path';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { GraphQLSchemaHost } from '@nestjs/graphql';
import { Pool } from 'pg';
import type { StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { AppModule } from '../src/app.module.js';
import { assertOwnedDisposableDatabaseUrl, startOwnedDisposableDatabase } from './helpers/pwa-disposable-db.js';
import {
  assertCanonicalSchemaMatches,
  deterministicSchemaBytes,
  exportCanonicalSchema,
} from './helpers/schema-drift.js';

describe('guarded runtime GraphQL schema commands', () => {
  let container: StartedPostgreSqlContainer;
  let databaseUrl: string;
  let app: INestApplication;

  beforeAll(async () => {
    container = await startOwnedDisposableDatabase();
    databaseUrl = container.getConnectionUri();
    assertOwnedDisposableDatabaseUrl(databaseUrl, container);
    process.env.DATABASE_URL = databaseUrl;
    process.env.JWT_SECRET = 'schema-contract-integration-secret';
    process.env.AZURE_STORAGE_CONNECTION_STRING = '';

    const pool = new Pool({ connectionString: databaseUrl });
    const migrationsDir = join(__dirname, '../prisma/migrations');
    const { existsSync, readdirSync } = await import('node:fs');
    for (const directory of readdirSync(migrationsDir).sort()) {
      const migrationPath = join(migrationsDir, directory, 'migration.sql');
      if (existsSync(migrationPath)) await pool.query(readFileSync(migrationPath, 'utf8'));
    }
    await pool.end();

    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    await app.init();
  }, 120000);

  afterAll(async () => {
    await app?.close();
    await container?.stop();
  });

  it('passes the clean runtime check and preserves canonical SDL bytes', () => {
    const canonicalPath = join(__dirname, '../src/schema.gql');
    const canonicalBefore = readFileSync(canonicalPath);
    const runtimeBytes = deterministicSchemaBytes(app.get(GraphQLSchemaHost).schema);
    expect(() => assertCanonicalSchemaMatches(runtimeBytes, canonicalBefore)).not.toThrow();
    expect(readFileSync(canonicalPath)).toEqual(canonicalBefore);
  });

  it.each(['stale.gql', 'malformed.gql'])('rejects %s and preserves the canonical SDL', (fixture) => {
    const canonicalPath = join(__dirname, '../src/schema.gql');
    const canonicalBefore = readFileSync(canonicalPath);
    const fixtureBytes = readFileSync(join(__dirname, 'fixtures/schema', fixture));
    const runtimeBytes = deterministicSchemaBytes(app.get(GraphQLSchemaHost).schema);
    expect(() => assertCanonicalSchemaMatches(runtimeBytes, fixtureBytes)).toThrow();
    expect(readFileSync(canonicalPath)).toEqual(canonicalBefore);
  });

  it('exports only to an explicit target after ownership verification', () => {
    const targetDirectory = mkdtempSync(join(tmpdir(), 'pwa-schema-export-'));
    const targetPath = join(targetDirectory, 'schema.gql');
    try {
      const runtimeBytes = deterministicSchemaBytes(app.get(GraphQLSchemaHost).schema);
      expect(() => exportCanonicalSchema(runtimeBytes, targetPath, databaseUrl, container)).not.toThrow();
      expect(readFileSync(targetPath)).toEqual(runtimeBytes);
      expect(() => exportCanonicalSchema(runtimeBytes, targetPath, `${databaseUrl}?other=1`, container)).toThrow(/owned/i);
    } finally {
      rmSync(targetDirectory, { recursive: true, force: true });
    }
  });

  it('runs the named check and explicit export commands without changing already-canonical bytes', () => {
    const canonicalPath = join(__dirname, '../src/schema.gql');
    const canonicalBefore = readFileSync(canonicalPath);
    const apiDirectory = resolve(__dirname, '..');
    const checkOutput = execFileSync('pnpm', ['graphql:schema:check'], {
      cwd: apiDirectory,
      encoding: 'utf8',
    });
    expect(checkOutput).toContain('Canonical GraphQL SDL is current.');
    const exportOutput = execFileSync('pnpm', ['graphql:schema:export'], {
      cwd: apiDirectory,
      encoding: 'utf8',
    });
    expect(exportOutput).toContain('Exported canonical GraphQL SDL');
    expect(readFileSync(canonicalPath)).toEqual(canonicalBefore);
  });
});
