import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { buildSchema, parse, validate } from 'graphql';

/**
 * Guards against drift between the reader's web GraphQL documents and the
 * API's committed schema. A variable-type mismatch (e.g. the reader asking
 * for `$id: ID!` while the API declares `book(id: String!)`) makes every
 * reader operation fail at runtime, so validate the documents the same way a
 * GraphQL server would before execution.
 *
 * Paths are resolved from this file (`apps/web/src/lib/reader`) so the guard is
 * independent of the process working directory. The tradeoff is that moving
 * `schema.gql` or the reader sources requires updating these relative paths.
 */
const WEB_ROOT = join(__dirname, '..', '..', '..');
const SCHEMA_PATH = join(WEB_ROOT, '..', 'api', 'src', 'schema.gql');
const READER_SOURCES = [
  join(WEB_ROOT, 'src', 'app', '(reader)', 'books', '[id]', 'read', 'reader-client.tsx'),
  join(WEB_ROOT, 'src', 'lib', 'reader', 'api.ts'),
];

function extractGraphqlDocuments(source: string): string[] {
  const documents: string[] = [];
  const pattern = /gql`([\s\S]*?)`/g;
  let match: RegExpExecArray | null = pattern.exec(source);
  while (match !== null) {
    documents.push(match[1]);
    match = pattern.exec(source);
  }
  return documents;
}

describe('reader GraphQL documents match the API schema', () => {
  const schema = buildSchema(readFileSync(SCHEMA_PATH, 'utf-8'));
  const documents = READER_SOURCES.flatMap((sourcePath) =>
    extractGraphqlDocuments(readFileSync(sourcePath, 'utf-8')),
  );

  it('extracts every reader operation (manifest, progress, save)', () => {
    expect(documents).toHaveLength(3);
  });

  it('has zero GraphQL validation errors against apps/api/src/schema.gql', () => {
    const errors = documents.flatMap((document) =>
      validate(schema, parse(document)).map((error) => error.message),
    );
    expect(errors).toEqual([]);
  });
});
