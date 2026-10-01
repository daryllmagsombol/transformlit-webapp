import {
  BookReaderAnnotationSnapshotDocument,
  BookReadProgressDocument,
  ApplyBookReaderOperationDocument,
  type BookReaderAnnotationSnapshotQuery,
  type BookReaderAnnotationSnapshotQueryVariables,
  type BookReadProgressQuery,
  type BookReadProgressQueryVariables,
  type ApplyBookReaderOperationMutation,
  type ApplyBookReaderOperationMutationVariables,
} from '@transformlit/graphql';
import { apolloClient, refreshTokens } from '../apollo-client';
import { API_BASE } from '../constants';
import { getAccessToken } from '../auth';

/**
 * Generated, schema-verified reader documents from `@transformlit/graphql`.
 *
 * These are the authoritative wire contracts (see Task 9): the annotation
 * snapshot, the SEPARATE revisioned progress read, and the queued reader
 * mutation. Consumers must not maintain competing handwritten GraphQL snapshot
 * or operation definitions.
 */
export const BOOK_READER_ANNOTATION_SNAPSHOT_QUERY = BookReaderAnnotationSnapshotDocument;
export const BOOK_READ_PROGRESS_QUERY = BookReadProgressDocument;
export const APPLY_BOOK_READER_OPERATION_MUTATION = ApplyBookReaderOperationDocument;

export type {
  BookReaderAnnotationSnapshotQuery,
  BookReaderAnnotationSnapshotQueryVariables,
  BookReadProgressQuery,
  BookReadProgressQueryVariables,
  ApplyBookReaderOperationMutation,
  ApplyBookReaderOperationMutationVariables,
};

export interface PdfTextItem {
  t: string;
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface PdfPageText {
  items: PdfTextItem[];
}

/**
 * Network transport seam consumed by `BookRepository`. Keeping it here (rather
 * than inline in the repository) gives the online reader and Tasks 9–11 a
 * single, minimal interface to bind: metadata, session, and page text. The
 * local/offline path never touches any of these.
 */
export interface ReaderTransport {
  readonly openSession: (bookId: string) => Promise<unknown>;
  readonly fetchText: (bookId: string, page: number) => Promise<PdfPageText>;
  readonly frameUrl: (bookId: string, page: number) => string;
}

/** The default network transport bound to the authenticated reader endpoints. */
export const networkReaderTransport: ReaderTransport = {
  openSession: openReadingSession,
  fetchText: fetchPageText,
  frameUrl: pageFrameUrl,
};

async function ensureOk(response: Response): Promise<Response> {
  if (!response.ok) throw new Error(`Reader request failed with ${response.status}`);
  return response;
}

/** Bearer-authed; the API responds with the scoped reading-session cookie. */
export async function openReadingSession(bookId: string): Promise<{ expiresInMs: number }> {
  const post = () => {
    const token = getAccessToken();
    return fetch(`${API_BASE}/books/${bookId}/reading-session`, {
      method: 'POST',
      credentials: 'include',
      headers: token ? { Authorization: `Bearer ${token}` } : undefined,
    });
  };

  let response = await post();
  if (response.status === 401) {
    // A cold page load (e.g. reader deep-link reload) starts with no in-memory
    // access token. Unlike GraphQL calls, this raw fetch has no error link that
    // refreshes on 401, so restore the token from the httpOnly cookie and retry
    // once instead of tearing down the reader.
    await refreshTokens();
    response = await post();
  }
  return (await ensureOk(response)).json() as Promise<{ expiresInMs: number }>;
}

/** Cookie-authed endpoints below — never send a Bearer header to <img> hosts. */
export function pageFrameUrl(bookId: string, page: number): string {
  return `${API_BASE}/books/${bookId}/pages/${page}/frame`;
}

/**
 * Application-relative path for the version-pinned offline manifest. The
 * download manager joins this with the API base (which already ends in
 * `/api`), so the path deliberately omits the `/api` prefix.
 */
export function offlineManifestPath(bookId: string, contentVersion?: number): string {
  const query = contentVersion === undefined ? '' : `?contentVersion=${contentVersion}`;
  return `/books/${bookId}/offline-manifest${query}`;
}

/** Application-relative path for one immutable, version-pinned asset. */
export function offlineAssetPath(bookId: string, contentVersion: number, assetId: string): string {
  return `/books/${bookId}/content/${contentVersion}/assets/${assetId}`;
}

export async function fetchPageText(bookId: string, page: number): Promise<PdfPageText> {
  const response = await fetch(`${API_BASE}/books/${bookId}/pages/${page}/text`, {
    credentials: 'include',
  });
  return (await ensureOk(response)).json() as Promise<PdfPageText>;
}

/**
 * Server-side reading position, used to resume when the URL has no `?page`, and
 * to detect a stale base revision (progress is the separate REVISIONED
 * endpoint). The returned record always carries `revision`.
 */
export async function fetchReadProgress(
  bookId: string,
): Promise<{ currentPage: number; revision: number } | null> {
  const result = await apolloClient.query<BookReadProgressQuery, BookReadProgressQueryVariables>({
    query: BOOK_READ_PROGRESS_QUERY,
    variables: { bookId },
    fetchPolicy: 'no-cache',
  });
  const progress = result.data?.readProgress;
  if (!progress) return null;
  // Compile-time + runtime proof that the revision is on the wire, not dropped.
  const revision: number = progress.revision;
  return { currentPage: progress.currentPage, revision };
}

/**
 * Loads the authoritative, annotation-only per-book snapshot. Reading progress
 * is fetched separately via `fetchReadProgress` — it is never part of this
 * snapshot (see docs/superpowers/specs/2026-10-01-pwa-contracts.md).
 */
export async function fetchAnnotationSnapshot(
  bookId: string,
): Promise<BookReaderAnnotationSnapshotQuery['bookReaderAnnotationSnapshot']> {
  const result = await apolloClient.query<
    BookReaderAnnotationSnapshotQuery,
    BookReaderAnnotationSnapshotQueryVariables
  >({
    query: BOOK_READER_ANNOTATION_SNAPSHOT_QUERY,
    variables: { bookId },
    fetchPolicy: 'no-cache',
  });
  if (!result.data) throw new Error('Annotation snapshot returned no data');
  return result.data.bookReaderAnnotationSnapshot;
}

/** Sends one queued, replay-safe reader operation and returns its typed result. */
export async function applyReaderOperation(
  input: ApplyBookReaderOperationMutationVariables['input'],
): Promise<ApplyBookReaderOperationMutation['applyBookReaderOperation']> {
  const result = await apolloClient.mutate<
    ApplyBookReaderOperationMutation,
    ApplyBookReaderOperationMutationVariables
  >({
    mutation: APPLY_BOOK_READER_OPERATION_MUTATION,
    variables: { input },
  });
  if (!result.data) throw new Error('Reader operation returned no result');
  return result.data.applyBookReaderOperation;
}
