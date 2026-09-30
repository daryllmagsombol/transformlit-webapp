import { resolve } from 'node:path';
import { schemaPathForAction } from './schema-check-path.js';

describe('schema command file selection', () => {
  const canonicalPath = resolve('src/schema.gql');
  const fixtureDirectory = resolve('test/fixtures/schema');
  const staleFixture = resolve(fixtureDirectory, 'stale.gql');

  it('defaults check to canonical SDL and keeps export canonical-only', () => {
    expect(schemaPathForAction('check', canonicalPath, undefined, fixtureDirectory)).toBe(canonicalPath);
    expect(schemaPathForAction('export', canonicalPath, undefined, fixtureDirectory)).toBe(canonicalPath);
  });

  it('permits a read-only check override only inside the schema fixture directory', () => {
    expect(schemaPathForAction('check', canonicalPath, staleFixture, fixtureDirectory)).toBe(staleFixture);
  });

  it.each([
    ['export', staleFixture],
    ['check', canonicalPath],
    ['check', resolve('test/fixtures/build-pdf.ts')],
    ['check', resolve(fixtureDirectory, 'missing.gql')],
  ] as const)('rejects unsafe %s path override %s', (action, overridePath) => {
    expect(() => schemaPathForAction(action, canonicalPath, overridePath, fixtureDirectory)).toThrow();
  });
});
