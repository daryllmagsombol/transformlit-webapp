import { realpathSync, statSync } from 'node:fs';
import { isAbsolute, relative, resolve } from 'node:path';

export type SchemaAction = 'check' | 'export';

export function schemaPathForAction(
  action: SchemaAction,
  canonicalPath: string,
  expectedPathOverride: string | undefined,
  fixtureDirectory: string,
): string {
  if (expectedPathOverride === undefined) return canonicalPath;
  if (action !== 'check') {
    throw new Error('PWA_SCHEMA_CHECK_EXPECTED_PATH is supported only by read-only schema check');
  }
  if (!isAbsolute(expectedPathOverride)) {
    throw new Error('PWA_SCHEMA_CHECK_EXPECTED_PATH must be an absolute path');
  }

  const realFixtureDirectory = realpathSync(fixtureDirectory);
  const realExpectedPath = realpathSync(resolve(expectedPathOverride));
  const relativePath = relative(realFixtureDirectory, realExpectedPath);
  if (relativePath.length === 0 || relativePath.startsWith('..') || isAbsolute(relativePath)) {
    throw new Error('PWA_SCHEMA_CHECK_EXPECTED_PATH must point inside apps/api/test/fixtures/schema');
  }
  if (!statSync(realExpectedPath).isFile()) {
    throw new Error('PWA_SCHEMA_CHECK_EXPECTED_PATH must point to a regular SDL fixture file');
  }
  return realExpectedPath;
}
