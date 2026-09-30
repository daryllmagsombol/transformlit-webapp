import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import { GraphQLSchemaHost } from '@nestjs/graphql';
import { Pool } from 'pg';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { AppModule } from '../src/app.module.js';
import { startOwnedDisposableDatabase, assertOwnedDisposableDatabaseUrl } from './helpers/pwa-disposable-db.js';
import { assertCanonicalSchemaMatches, deterministicSchemaBytes, exportCanonicalSchema } from './helpers/schema-drift.js';

async function applyMigrations(databaseUrl: string): Promise<void> {
  const pool = new Pool({ connectionString: databaseUrl });
  const migrations = resolve('prisma/migrations');
  try {
    for (const directory of readdirSync(migrations).sort()) {
      const migrationPath = join(migrations, directory, 'migration.sql');
      if (existsSync(migrationPath)) await pool.query(readFileSync(migrationPath, 'utf8'));
    }
  } finally {
    await pool.end();
  }
}

async function main(): Promise<void> {
  const action = process.argv[2];
  if (action !== 'check' && action !== 'export') {
    throw new Error('Usage: tsx test/graphql-schema.ts <check|export>');
  }
  const container = await startOwnedDisposableDatabase();
  const databaseUrl = container.getConnectionUri();
  let app: INestApplication | undefined;
  try {
    assertOwnedDisposableDatabaseUrl(databaseUrl, container);
    process.env.DATABASE_URL = databaseUrl;
    process.env.JWT_SECRET = 'schema-contract-test-secret';
    process.env.AZURE_STORAGE_CONNECTION_STRING = '';
    await applyMigrations(databaseUrl);
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    await app.init();
    const schema = app.get(GraphQLSchemaHost).schema;
    const runtimeBytes = deterministicSchemaBytes(schema);
    const canonicalPath = resolve('src/schema.gql');
    if (action === 'check') {
      assertCanonicalSchemaMatches(runtimeBytes, readFileSync(canonicalPath));
      process.stdout.write('Canonical GraphQL SDL is current.\n');
    } else {
      exportCanonicalSchema(runtimeBytes, canonicalPath, databaseUrl, container);
      process.stdout.write(`Exported canonical GraphQL SDL to ${canonicalPath}\n`);
    }
  } finally {
    await app?.close();
    await container.stop();
  }
}

main().catch((error: unknown) => {
  process.stderr.write(`${error instanceof Error ? error.stack : String(error)}\n`);
  process.exitCode = 1;
});
