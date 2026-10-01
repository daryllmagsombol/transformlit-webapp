'use client';

import { PageCanvas } from './page-canvas';
import { ReaderToolbar } from './reader-toolbar';
import type { PdfTextItem } from '../../lib/reader/api';
import type { FrameHandle, ReaderCapabilities } from '../../lib/reader/repository';
import type { ReaderTheme } from '../../store/reader-store';

/**
 * The book reader surface shared by the online reader and the offline hub.
 * It is purely presentational: callers resolve the content (via
 * `BookRepository`), own page state, and supply a disposal-aware `FrameHandle`.
 * It never branches on storage implementation and never builds a frame URL.
 */
export interface BookReaderViewProps {
  readonly title: string;
  readonly page: number;
  readonly pageCount: number;
  readonly items: PdfTextItem[] | null;
  readonly frame: FrameHandle;
  readonly capabilities: ReaderCapabilities;
  readonly onPageChange: (page: number) => void;
  readonly onBack: () => void;
  /** Reader presentation theme; defaults to the paper theme. */
  readonly theme?: ReaderTheme;
  /** Optional source notice (e.g. "Saved offline") shown under the toolbar. */
  readonly statusNotice?: string | null;
}

/**
 * Network-only book features. When a capability is unavailable this renders a
 * disabled, labelled control instead of silently omitting it, so an offline
 * reader is honestly described rather than appearing fully featured.
 */
function UnavailableFeatures({ capabilities }: { readonly capabilities: ReaderCapabilities }) {
  const unavailable: string[] = [];
  if (!capabilities.audio) unavailable.push('Audio');
  if (!capabilities.remoteSearch) unavailable.push('Search');
  if (!capabilities.enrichment) unavailable.push('Study tools');
  if (!capabilities.realtime) unavailable.push('Live sync');
  if (unavailable.length === 0) return null;

  return (
    <p
      data-testid="reader-unavailable-features"
      role="note"
      className="border-b border-outline-variant bg-surface-container-low px-4 py-2 font-small text-small text-on-surface-variant"
    >
      Unavailable offline: {unavailable.join(', ')}.
    </p>
  );
}

export function BookReaderView({
  title,
  page,
  pageCount,
  items,
  frame,
  capabilities,
  onPageChange,
  onBack,
  theme = 'paper',
  statusNotice = null,
}: BookReaderViewProps) {
  return (
    <div data-reader-theme={theme} className="flex min-h-dvh flex-col bg-paper text-on-surface">
      <ReaderToolbar
        title={title}
        page={page}
        pageCount={pageCount}
        onPageChange={onPageChange}
        onBack={onBack}
      />
      {statusNotice ? (
        <p
          data-testid="reader-status-notice"
          role="status"
          className="border-b border-outline-variant bg-secondary-container/40 px-4 py-2 font-small text-small text-on-secondary-container"
        >
          {statusNotice}
        </p>
      ) : null}
      <UnavailableFeatures capabilities={capabilities} />
      <main className="flex flex-1 items-start justify-center overflow-auto p-4">
        <PageCanvas frame={frame} items={items} />
      </main>
    </div>
  );
}
