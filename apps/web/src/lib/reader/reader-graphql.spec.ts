import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { buildSchema, parse, print, validate } from 'graphql';
import { BookReaderAnnotationSnapshotDocument, BookReadProgressDocument, ApplyBookReaderOperationDocument } from '@transformlit/graphql';

/**
 * Guards against drift between the reader's web GraphQL documents and the
 * API's committed schema.
 *
 * Task 9 makes the generated `@transformlit/graphql` documents authoritative:
 * the reader consumes `BookReaderAnnotationSnapshotDocument`,
 * `BookReadProgressDocument`, and `ApplyBookReaderOperationDocument` rather than
 * maintaining handwritten definitions. This spec validates those generated
 * documents against the committed `apps/api/src/schema.gql` the same way a
 * GraphQL server would before execution.
 *
 * It also keeps a guard for REST reader transport definitions in `api.ts` (there
 * are intentionally none — the reader uses generated documents exclusively) and
 * a progress-must-be-separate completeness assertion.
 *
 * Paths are resolved from this file (`apps/web/src/lib/reader`) so the guard is
 * independent of the process working directory.
 */
const WEB_ROOT = join(__dirname, '..', '..', '..');
const SCHEMA_PATH = join(WEB_ROOT, '..', 'api', 'src', 'schema.gql');

function extractGqlTemplates(source: string): string[] {
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

  const generated = [
    BookReaderAnnotationSnapshotDocument,
    BookReadProgressDocument,
    ApplyBookReaderOperationDocument,
  ];

  it('exposes the three generated reader documents from the package barrel', () => {
    for (const document of generated) {
      expect(document).toBeDefined();
      expect((document as { kind?: string }).kind).toBe('Document');
    }
  });

  it('has zero GraphQL validation errors for the generated documents against apps/api/src/schema.gql', () => {
    const errors = generated.flatMap((document) =>
      validate(schema, parse(print(document as never))).map((error) => error.message),
    );
    expect(errors).toEqual([]);
  });

  it('keeps the annotation snapshot free of progress and exposes deletions and conflicts', () => {
    const printed = print(BookReaderAnnotationSnapshotDocument as never);
    expect(printed).toContain('bookReaderAnnotationSnapshot');
    expect(printed).toContain('snapshotRevision');
    expect(printed).toContain('tombstones');
    expect(printed).toContain('conflictCopies');
    // Progress is a separate revisioned endpoint, never folded into the snapshot.
    expect(printed).not.toContain('readProgress');
    expect(printed).not.toContain('ProgressRecord');
  });

  it('reads progress through its own generated document, including its revision', () => {
    const printed = print(BookReadProgressDocument as never);
    expect(printed).toContain('readProgress');
    expect(printed).not.toContain('snapshotRevision');
    // Progress must be revisioned on the wire so conflicts are detectable.
    expect(printed).toContain('revision');
  });

  it('does not maintain competing handwritten reader GraphQL definitions', () => {
    // Task 10 removed the last handwritten progress write: the snapshot, the
    // separate progress read, and the queued operation all come from
    // `@transformlit/graphql`.
    const documents = extractGqlTemplates(readFileSync(join(WEB_ROOT, 'src', 'lib', 'reader', 'api.ts'), 'utf-8'));
    expect(documents).toEqual([]);
  });
});
