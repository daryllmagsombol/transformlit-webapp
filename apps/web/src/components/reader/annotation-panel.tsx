'use client';

import { useCallback, useState } from 'react';
import type { PdfTextItem } from '../../lib/reader/api';
import type { BookmarkRecord, HighlightRecord } from '../../lib/offline/contracts';
import type { ReaderSaveResult } from '../../lib/offline/reader-records';

/**
 * The local-first mutation surface the panel drives. It is the reader record
 * repository (Task 10) — never the network. A `SAVED` result means the local
 * transaction committed (durable on this device), NOT a server acknowledgement.
 */
export interface AnnotationRecords {
  createHighlight(input: {
    readonly bookId: string;
    readonly contentVersion: number;
    readonly page: number;
    readonly text: string;
    readonly note: string | null;
    readonly color: string | null;
    readonly anchor: unknown;
  }): Promise<ReaderSaveResult>;
  updateHighlight(input: {
    readonly bookId: string;
    readonly contentVersion: number;
    readonly page: number;
    readonly text: string;
    readonly note: string | null;
    readonly color: string | null;
    readonly anchor: unknown;
    readonly entityId: string;
    readonly baseRevision: number;
  }): Promise<ReaderSaveResult>;
  deleteHighlight(input: {
    readonly bookId: string;
    readonly contentVersion: number;
    readonly entityId: string;
    readonly baseRevision: number;
  }): Promise<ReaderSaveResult>;
  addBookmark(input: {
    readonly bookId: string;
    readonly contentVersion: number;
    readonly page: number;
    readonly anchor: unknown | null;
  }): Promise<ReaderSaveResult>;
  removeBookmark(input: {
    readonly bookId: string;
    readonly contentVersion: number;
    readonly entityId: string;
    readonly baseRevision: number;
  }): Promise<ReaderSaveResult>;
}

export interface AnnotationPanelProps {
  readonly bookId: string;
  readonly contentVersion: number;
  readonly page: number;
  readonly items: PdfTextItem[] | null;
  readonly highlights: readonly HighlightRecord[];
  readonly bookmarks: readonly BookmarkRecord[];
  readonly records: AnnotationRecords;
  readonly onRecordsChanged: () => void;
}

type SaveStatus = 'IDLE' | 'SAVING' | 'SAVED' | 'FAILED';

const ANCHOR_VERSION = 1;

/** A resolved `PageTextAnchorV1`-shaped range over the canonical text layer. */
export interface PageTextAnchor {
  readonly version: number;
  readonly page: number;
  readonly startOffset: number;
  readonly endOffset: number;
}

/**
 * The CANONICAL text-layer source for anchor offsets.
 *
 * The contract defines `PageTextAnchorV1` offsets as zero-based UTF-16 code
 * units into the exact page text-layer string for the pinned `contentVersion`.
 * That string is the in-order concatenation of the rendered text-layer item
 * strings (exactly what `PageCanvas` renders and what the stored page
 * `textLayerAssetId` contains). Both the online `fetchPageText` and the offline
 * stored record expose that same `{ items: [{ t }] }` shape, so deriving anchors
 * from `items` here index the same string on both paths. Do not insert
 * separators: any character not present in the rendered layer would shift every
 * subsequent offset.
 */
export function pageTextLayer(items: readonly PdfTextItem[]): string {
  return items.map((item) => item.t).join('');
}

/** Selecting item `index` yields `[startOf(index), startOf(index) + t.length)`. */
export function anchorForItem(items: readonly PdfTextItem[], index: number, page: number): PageTextAnchor {
  const startOffset = items
    .slice(0, index)
    .reduce((total, item) => total + item.t.length, 0);
  const item = items[index];
  return {
    version: ANCHOR_VERSION,
    page,
    startOffset,
    endOffset: startOffset + (item?.t.length ?? 0),
  };
}

/** Resolves the substring a stored anchor selects in the canonical text layer. */
export function textForAnchor(items: readonly PdfTextItem[], anchor: PageTextAnchor): string {
  return pageTextLayer(items).slice(anchor.startOffset, anchor.endOffset);
}

/** Index of the text-layer item a stored anchor starts at, or -1 when absent. */
export function itemIndexForAnchor(items: readonly PdfTextItem[], anchor: PageTextAnchor): number {
  let offset = 0;
  for (let index = 0; index < items.length; index += 1) {
    if (offset === anchor.startOffset) return index;
    offset += items[index].t.length;
  }
  return -1;
}

/**
 * Binds a stored highlight to the selected text item by ANCHOR RANGE ONLY.
 *
 * Text-equality is deliberately NOT a fallback: a page can legitimately contain
 * duplicate strings, and binding by text would attach a highlight to the wrong
 * occurrence. A highlight with a null/legacy anchor therefore does not pre-fill
 * an item; the anchor is the only trustworthy provenance.
 *
 * When the panel knows a positive pinned `contentVersion`, a highlight from a
 * DIFFERENT content version cannot bind even if page/offsets coincide — offsets
 * are only meaningful within one pinned text layer. When the panel's version is
 * unknown (`0`, online session), the version criterion is skipped so the anchor
 * still binds; the persisted/queued version is resolved separately by
 * `ReaderRecords`.
 */
function findHighlightForItem(
  highlights: readonly HighlightRecord[],
  anchor: PageTextAnchor,
  contentVersion: number,
): HighlightRecord | undefined {
  return highlights.find((highlight) => {
    if (contentVersion >= 1 && highlight.contentVersion !== contentVersion) return false;
    const recordAnchor = highlight.anchor as Partial<PageTextAnchor> | null;
    if (!recordAnchor || recordAnchor.version !== ANCHOR_VERSION) return false;
    if (recordAnchor.page !== anchor.page) return false;
    return recordAnchor.startOffset === anchor.startOffset && recordAnchor.endOffset === anchor.endOffset;
  });
}

function statusText(status: SaveStatus): string {
  switch (status) {
    case 'SAVING':
      return 'Saving on this device…';
    case 'SAVED':
      return 'Saved on this device';
    case 'FAILED':
      return 'Could not save on this device';
    default:
      return '';
  }
}

/** Renders the save status, using an alert for failures and a status otherwise. */
function SaveStatusNotice({ status, error }: { readonly status: SaveStatus; readonly error: string | null }) {
  const text = statusText(status);
  if (!text) return null;
  if (status === 'FAILED') {
    return (
      <p role="alert" className="font-small text-small text-error" data-testid="annotation-error">
        {error ?? text}
      </p>
    );
  }
  return (
    <p role="status" className="font-small text-small text-on-surface-variant" data-testid="annotation-status">
      {text}
    </p>
  );
}

export function AnnotationPanel({
  bookId,
  contentVersion,
  page,
  items,
  highlights,
  bookmarks,
  records,
  onRecordsChanged,
}: AnnotationPanelProps) {
  const textItems = items ?? [];
  const [selectedIndex, setSelectedIndex] = useState<number | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [note, setNote] = useState('');
  const [status, setStatus] = useState<SaveStatus>('IDLE');
  const [error, setError] = useState<string | null>(null);

  const pageBookmark = bookmarks.find((bookmark) => bookmark.page === page) ?? null;

  const reset = useCallback(() => {
    setSelectedIndex(null);
    setEditingId(null);
    setNote('');
  }, []);

  const selectItem = useCallback((index: number) => {
    const item = textItems[index];
    if (!item) return;
    const anchor = anchorForItem(textItems, index, page);
    setSelectedIndex(index);
    const existing = findHighlightForItem(highlights, anchor, contentVersion);
    setEditingId(existing?.id ?? null);
    setNote(existing?.note ?? '');
    setError(null);
    setStatus('IDLE');
  }, [textItems, highlights, page, contentVersion]);

  const beginEdit = useCallback((highlight: HighlightRecord) => {
    setEditingId(highlight.id);
    // Re-select the exact item the highlight's anchor points at, so editing
    // preserves provenance instead of matching by (possibly duplicate) text.
    const recordAnchor = highlight.anchor as PageTextAnchor | null;
    const index = recordAnchor ? itemIndexForAnchor(textItems, recordAnchor) : -1;
    setSelectedIndex(index >= 0 ? index : null);
    setNote(highlight.note ?? '');
    setError(null);
    setStatus('IDLE');
  }, [textItems]);

  const applyResult = useCallback((result: ReaderSaveResult) => {
    if (result.status === 'SAVED') {
      setStatus('SAVED');
      setError(null);
      reset();
      onRecordsChanged();
      return;
    }
    setStatus('FAILED');
    setError(result.error ?? 'Could not save on this device');
  }, [onRecordsChanged, reset]);

  const submitHighlight = useCallback(async () => {
    if (selectedIndex === null) return;
    const item = textItems[selectedIndex];
    if (!item) return;
    setStatus('SAVING');
    setError(null);
    const anchor = anchorForItem(textItems, selectedIndex, page);
    if (editingId) {
      const existing = highlights.find((row) => row.id === editingId);
      const result = await records.updateHighlight({
        bookId,
        contentVersion,
        page,
        text: existing?.text ?? item.t,
        note: note.trim().length === 0 ? null : note,
        color: existing?.color ?? null,
        anchor,
        entityId: editingId,
        baseRevision: existing?.revision ?? 1,
      });
      applyResult(result);
      return;
    }
    const result = await records.createHighlight({
      bookId,
      contentVersion,
      page,
      text: item.t,
      note: note.trim().length === 0 ? null : note,
      color: null,
      anchor,
    });
    applyResult(result);
  }, [selectedIndex, textItems, editingId, highlights, note, records, bookId, contentVersion, page, applyResult]);

  const removeHighlight = useCallback(async (highlight: HighlightRecord) => {
    setStatus('SAVING');
    setError(null);
    const result = await records.deleteHighlight({
      bookId,
      contentVersion,
      entityId: highlight.id,
      baseRevision: highlight.revision,
    });
    applyResult(result);
  }, [records, bookId, contentVersion, applyResult]);

  const toggleBookmark = useCallback(async () => {
    setStatus('SAVING');
    setError(null);
    if (pageBookmark) {
      applyResult(await records.removeBookmark({
        bookId,
        contentVersion,
        entityId: pageBookmark.id,
        baseRevision: pageBookmark.revision,
      }));
      return;
    }
    applyResult(await records.addBookmark({ bookId, contentVersion, page, anchor: null }));
  }, [pageBookmark, records, bookId, contentVersion, page, applyResult]);

  return (
    <section
      aria-label="Annotations"
      data-testid="annotation-panel"
      className="flex flex-col gap-4 rounded-xl border border-outline-variant bg-surface-container-low p-4"
    >
      <div className="flex items-center justify-between gap-3">
        <h2 className="font-display text-headline-h4 text-on-surface">Notes &amp; bookmarks</h2>
        <button
          type="button"
          onClick={toggleBookmark}
          aria-label={pageBookmark ? 'Remove bookmark for this page' : 'Bookmark this page'}
          className="inline-flex min-h-11 items-center gap-2 rounded-full border border-outline-variant px-4 font-small text-small font-semibold text-on-surface transition-colors hover:bg-surface-container-high"
        >
          <span className="material-symbols-outlined" aria-hidden="true">
            {pageBookmark ? 'bookmark' : 'bookmark_border'}
          </span>
          {pageBookmark ? 'Bookmarked' : 'Bookmark'}
        </button>
      </div>

      {statusText(status) ? (
        <SaveStatusNotice status={status} error={error} />
      ) : null}

      <div>
        <p className="mb-2 font-micro text-micro uppercase tracking-[0.18em] text-on-surface-variant">
          Select text to highlight
        </p>
        <div className="flex flex-wrap gap-2" data-testid="annotation-text-items">
          {textItems.length === 0 ? (
            <p className="font-small text-small text-on-surface-variant">No text layer is available for this page.</p>
          ) : (
            textItems.map((item, index) => (
              <button
                key={`${index}-${item.x}-${item.y}-${item.t}`}
                type="button"
                aria-label={`Highlight "${item.t}"`}
                aria-pressed={selectedIndex === index}
                onClick={() => selectItem(index)}
                className={`rounded px-2 py-1 font-body text-small transition-colors ${
                  selectedIndex === index
                    ? 'bg-primary-container text-on-primary-container'
                    : 'bg-surface-container-high text-on-surface hover:bg-surface-container-highest'
                }`}
              >
                {item.t}
              </button>
            ))
          )}
        </div>
      </div>

      {selectedIndex !== null ? (
        <div className="flex flex-col gap-2">
          <label htmlFor="annotation-note" className="font-small text-small font-semibold text-on-surface">
            Note
          </label>
          <textarea
            id="annotation-note"
            aria-label="Note"
            value={note}
            onChange={(event) => setNote(event.target.value)}
            rows={3}
            className="rounded-lg border border-outline-variant bg-surface px-3 py-2 font-body text-small text-on-surface"
          />
          <div className="flex gap-2">
            <button
              type="button"
              onClick={submitHighlight}
              className="inline-flex min-h-11 items-center rounded-lg bg-primary px-4 font-small text-small font-semibold text-on-primary"
            >
              Save highlight
            </button>
            <button
              type="button"
              onClick={reset}
              className="inline-flex min-h-11 items-center rounded-lg border border-outline-variant px-4 font-small text-small font-semibold text-on-surface-variant"
            >
              Cancel
            </button>
          </div>
        </div>
      ) : null}

      {highlights.length > 0 ? (
        <ul className="flex flex-col gap-2" data-testid="annotation-highlights">
          {highlights.map((highlight) => (
            <li
              key={highlight.id}
              className="flex items-start justify-between gap-3 rounded-lg border border-outline-variant bg-surface px-3 py-2"
            >
              <div className="min-w-0">
                <p className="truncate font-body text-small text-on-surface">{highlight.text}</p>
                {highlight.note ? (
                  <p className="font-small text-small text-on-surface-variant">{highlight.note}</p>
                ) : null}
              </div>
              <div className="flex shrink-0 gap-2">
                <button
                  type="button"
                  onClick={() => beginEdit(highlight)}
                  aria-label={`Edit note for ${highlight.text}`}
                  className="font-small text-small font-semibold text-primary underline"
                >
                  Edit note
                </button>
                <button
                  type="button"
                  onClick={() => removeHighlight(highlight)}
                  aria-label={`Delete highlight for ${highlight.text}`}
                  className="font-small text-small font-semibold text-on-surface-variant underline"
                >
                  Delete
                </button>
              </div>
            </li>
          ))}
        </ul>
      ) : null}
    </section>
  );
}
