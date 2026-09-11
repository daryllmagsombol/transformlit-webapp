import { ReaderClient } from './reader-client';

interface PageProps {
  readonly params: Promise<{ readonly id: string }>;
  readonly searchParams: Promise<{ readonly page?: string }>;
}

export default async function ReadPage({ params, searchParams }: PageProps) {
  const [{ id }, query] = await Promise.all([params, searchParams]);
  const parsed = Number.parseInt(query.page ?? '', 10);
  // No `?page` → let the client resume from saved progress.
  const initialPage = Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
  return <ReaderClient bookId={id} initialPage={initialPage} />;
}
