import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { buildSchema } from 'graphql';
import { assertCanonicalSchemaMatches, deterministicSchemaBytes } from './schema-drift.js';

describe('canonical SDL drift check', () => {
  const fixtures = join(__dirname, '../fixtures/schema');
  const canonicalPath = join(__dirname, '../../src/schema.gql');
  const runtimeSchema = deterministicSchemaBytes(buildSchema('type Query { books: [String!]! }'));

  it('reproduces the checked-in canonical banner and deterministic SDL format', () => {
    const canonical = readFileSync(canonicalPath);
    expect(deterministicSchemaBytes(buildSchema(canonical.toString('utf8')))).toEqual(canonical);
  });

  it('accepts canonical bytes when they match runtime SDL', () => {
    expect(() => assertCanonicalSchemaMatches(runtimeSchema, runtimeSchema)).not.toThrow();
  });

  it.each(['stale.gql', 'malformed.gql'])('rejects %s without mutating fixture bytes', (fixture) => {
    const path = join(fixtures, fixture);
    const before = readFileSync(path);
    const canonicalBefore = readFileSync(canonicalPath);
    expect(() => assertCanonicalSchemaMatches(runtimeSchema, before)).toThrow();
    expect(readFileSync(path)).toEqual(before);
    expect(readFileSync(canonicalPath)).toEqual(canonicalBefore);
  });
});
