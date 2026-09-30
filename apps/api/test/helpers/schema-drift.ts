import { buildSchema, lexicographicSortSchema, printSchema } from 'graphql';
import { writeFileSync } from 'node:fs';
import { assertOwnedDisposableDatabaseUrl } from './pwa-disposable-db.js';

export function deterministicSchemaBytes(schema: Parameters<typeof printSchema>[0]): Buffer {
  return Buffer.from(`${printSchema(lexicographicSortSchema(schema))}\n`);
}

export function assertCanonicalSchemaMatches(runtimeSchema: Buffer, canonicalSchema: Buffer): void {
  try {
    buildSchema(canonicalSchema.toString('utf8'));
  } catch (error) {
    throw new Error('Canonical GraphQL SDL is malformed', { cause: error });
  }
  if (!runtimeSchema.equals(canonicalSchema)) {
    throw new Error('Canonical GraphQL SDL is stale; run the explicit graphql:schema:export command');
  }
}

export function exportCanonicalSchema(
  runtimeSchema: Buffer,
  targetPath: string,
  databaseUrl: string,
  container: import('@testcontainers/postgresql').StartedPostgreSqlContainer,
): void {
  assertOwnedDisposableDatabaseUrl(databaseUrl, container);
  writeFileSync(targetPath, runtimeSchema);
}
