import { buildSchema, lexicographicSortSchema, printSchema } from 'graphql';
import { writeFileSync } from 'node:fs';
import { assertOwnedDisposableDatabaseUrl } from './pwa-disposable-db.js';

const GENERATED_SCHEMA_HEADER = [
  '# ------------------------------------------------------',
  '# THIS FILE WAS AUTOMATICALLY GENERATED (DO NOT MODIFY)',
  '# ------------------------------------------------------',
  '',
  '',
].join('\n');

export function deterministicSchemaBytes(schema: Parameters<typeof printSchema>[0]): Buffer {
  return Buffer.from(`${GENERATED_SCHEMA_HEADER}${printSchema(lexicographicSortSchema(schema))}`);
}

export function assertCanonicalSchemaMatches(runtimeSchema: Buffer, canonicalSchema: Buffer): void {
  try {
    buildSchema(canonicalSchema.toString('utf8'));
  } catch (error) {
    throw new Error('Canonical GraphQL SDL is malformed', { cause: error });
  }
  if (!runtimeSchema.equals(canonicalSchema)) {
    const firstDifferentByte = runtimeSchema.findIndex((byte, index) => byte !== canonicalSchema[index]);
    const mismatchAt = firstDifferentByte >= 0 ? firstDifferentByte : Math.min(runtimeSchema.length, canonicalSchema.length);
    const runtimeContext = runtimeSchema.toString('utf8', Math.max(0, mismatchAt - 60), mismatchAt + 100);
    const canonicalContext = canonicalSchema.toString('utf8', Math.max(0, mismatchAt - 60), mismatchAt + 100);
    throw new Error(
      `Canonical GraphQL SDL is stale at byte ${mismatchAt}; runtime=${JSON.stringify(runtimeContext)} canonical=${JSON.stringify(canonicalContext)}; run the explicit graphql:schema:export command`,
    );
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
