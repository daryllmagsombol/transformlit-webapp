'use client';

import { useCallback, useState, type ReactNode } from 'react';
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
  /**
   * The resolved frame, or null while a page is opening or after it failed to
   * open. The toolbar stays visible in every case so navigation never hangs.
   */
  readonly frame: FrameHandle | null;
  readonly capabilities: ReaderCapabilities;
  readonly onPageChange: (page: number) => void;
  readonly onBack: () => void;
  /** Reader presentation theme; defaults to the paper theme. */
  readonly theme?: ReaderTheme;
  /** Optional source notice (e.g. "Saved offline") shown under the toolbar. */
  readonly statusNotice?: string | null;
  /**
   * A failed page open. Rendered as a non-blocking inline error instead of an
   * infinite spinner or a stale previous page.
   */
  readonly pageError?: string | null;
  /**
   * Annotation surface (highlight/note/bookmark). When provided, the toolbar
   * gains a toggle and the panel renders beside the page. Callers own the
   * local-first mutation wiring; the view stays presentational.
   */
  readonly annotations?: ReactNode;
  /**
   * Conflict resolution surface. When provided, it renders as a full-width
   * region above the page so an unresolved sync conflict is always visible and
   * cannot be silently ignored. Callers own the resolution wiring.
   */
  readonly conflicts?: ReactNode;
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

function ReaderSurface({
  frame,
  items,
  pageError,
}: {
  readonly frame: FrameHandle | null;
  readonly items: PdfTextItem[] | null;
  readonly pageError: string | null;
}) {
  if (pageError) {
    return (
      <p
        data-testid="reader-page-error"
        role="alert"
        className="mx-auto mt-8 max-w-md rounded-lg border border-error/40 bg-error-container/30 px-4 py-3 text-center font-body text-body text-on-error-container"
      >
        {pageError}
      </p>
    );
  }
  if (!frame) {
    return (
      <div
        data-testid="reader-page-loading"
        aria-hidden="true"
        className="mt-8 h-8 w-8 animate-spin rounded-full border-2 border-primary border-t-transparent"
      />
    );
  }
  return <PageCanvas frame={frame} items={items} />;
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
  pageError = null,
  annotations = null,
  conflicts = null,
}: BookReaderViewProps) {
  const [annotationsOpen, setAnnotationsOpen] = useState(false);
  const toggleAnnotations = useCallback(() => setAnnotationsOpen((open) => !open), []);

  return (
    <div data-reader-theme={theme} className="flex min-h-dvh flex-col bg-paper text-on-surface">
      <ReaderToolbar
        title={title}
        page={page}
        pageCount={pageCount}
        onPageChange={onPageChange}
        onBack={onBack}
        onToggleAnnotations={annotations ? toggleAnnotations : undefined}
        annotationsOpen={annotationsOpen}
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
      {conflicts ? (
        <div
          data-testid="reader-conflicts"
          className="border-b border-outline-variant bg-surface-container-low px-4 py-3"
        >
          {conflicts}
        </div>
      ) : null}
      <div className="flex flex-1 flex-col lg:flex-row">
        <main className="flex flex-1 items-start justify-center overflow-auto p-4">
          <ReaderSurface frame={frame} items={items} pageError={pageError} />
        </main>
        {annotations && annotationsOpen ? (
          <aside className="w-full shrink-0 border-t border-outline-variant bg-surface p-4 lg:w-[360px] lg:border-l lg:border-t-0">
            {annotations}
          </aside>
        ) : null}
      </div>
    </div>
  );
}
