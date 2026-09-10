'use client';

interface ReaderToolbarProps {
  readonly title: string;
  readonly page: number;
  readonly pageCount: number;
  readonly onPageChange: (page: number) => void;
  readonly onBack: () => void;
}

export function ReaderToolbar({ title, page, pageCount, onPageChange, onBack }: ReaderToolbarProps) {
  return (
    <header className="sticky top-0 z-10 flex items-center gap-3 border-b border-outline-variant bg-surface-container-low px-4 py-2">
      <button type="button" onClick={onBack} aria-label="Back to library" className="material-symbols-outlined min-h-11 min-w-11">
        arrow_back
      </button>
      <h1 className="min-w-0 flex-1 truncate font-display text-headline-h3">{title}</h1>
      <nav aria-label="Page navigation" className="flex items-center gap-2">
        <button
          type="button"
          aria-label="Previous page"
          disabled={page <= 1}
          onClick={() => onPageChange(page - 1)}
          className="material-symbols-outlined min-h-11 min-w-11 disabled:opacity-40"
        >
          chevron_left
        </button>
        <span aria-live="polite" className="font-small text-small tabular-nums">
          Page {page} of {pageCount}
        </span>
        <button
          type="button"
          aria-label="Next page"
          disabled={page >= pageCount}
          onClick={() => onPageChange(page + 1)}
          className="material-symbols-outlined min-h-11 min-w-11 disabled:opacity-40"
        >
          chevron_right
        </button>
      </nav>
    </header>
  );
}
