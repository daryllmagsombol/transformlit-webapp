import { gql } from '@apollo/client';
import { apolloClient } from '../apollo-client';
import { API_BASE } from '../constants';
import { getAccessToken } from '../auth';

export const READ_PROGRESS_QUERY = gql`
  query ReadProgress($bookId: ID!) {
    readProgress(bookId: $bookId) {
      currentPage
    }
  }
`;

export const SAVE_PROGRESS_MUTATION = gql`
  mutation SaveReaderProgress($input: SaveProgressInput!) {
    saveProgress(input: $input) {
      currentPage
    }
  }
`;

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

async function ensureOk(response: Response): Promise<Response> {
  if (!response.ok) throw new Error(`Reader request failed with ${response.status}`);
  return response;
}

/** Bearer-authed; the API responds with the scoped reading-session cookie. */
export async function openReadingSession(bookId: string): Promise<{ expiresInMs: number }> {
  const token = getAccessToken();
  const response = await fetch(`${API_BASE}/books/${bookId}/reading-session`, {
    method: 'POST',
    credentials: 'include',
    headers: token ? { Authorization: `Bearer ${token}` } : undefined,
  });
  return (await ensureOk(response)).json() as Promise<{ expiresInMs: number }>;
}

/** Cookie-authed endpoints below — never send a Bearer header to <img> hosts. */
export function pageFrameUrl(bookId: string, page: number): string {
  return `${API_BASE}/books/${bookId}/pages/${page}/frame`;
}

export async function fetchPageText(bookId: string, page: number): Promise<PdfPageText> {
  const response = await fetch(`${API_BASE}/books/${bookId}/pages/${page}/text`, {
    credentials: 'include',
  });
  return (await ensureOk(response)).json() as Promise<PdfPageText>;
}

/** Server-side reading position, used to resume when the URL has no `?page`. */
export async function fetchReadProgress(bookId: string): Promise<{ currentPage: number } | null> {
  const result = await apolloClient.query<{ readProgress: { currentPage: number } | null }>({
    query: READ_PROGRESS_QUERY,
    variables: { bookId },
    fetchPolicy: 'no-cache',
  });
  return result.data?.readProgress ?? null;
}

/** Debounced by the reader client; persists the page so a later visit can resume. */
export async function saveReaderProgress(bookId: string, currentPage: number): Promise<void> {
  await apolloClient.mutate({
    mutation: SAVE_PROGRESS_MUTATION,
    variables: { input: { bookId, currentPage } },
  });
}
