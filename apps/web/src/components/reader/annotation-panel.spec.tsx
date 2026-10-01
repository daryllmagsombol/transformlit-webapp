import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { AnnotationPanel, anchorForItem, pageTextLayer, textForAnchor } from './annotation-panel';
import type { PdfTextItem } from '../../lib/reader/api';

const ITEMS: PdfTextItem[] = [
  { t: 'Hello', x: 0.1, y: 0.1, w: 0.2, h: 0.02 },
  { t: 'world', x: 0.35, y: 0.1, w: 0.2, h: 0.02 },
];

interface Harness {
  readonly createHighlight: jest.Mock;
  readonly updateHighlight: jest.Mock;
  readonly deleteHighlight: jest.Mock;
  readonly addBookmark: jest.Mock;
  readonly removeBookmark: jest.Mock;
}

function makeHarness(overrides: Partial<Harness> = {}): Harness {
  return {
    createHighlight: jest.fn().mockResolvedValue({ status: 'SAVED', operationId: 'op-1', error: null }),
    updateHighlight: jest.fn().mockResolvedValue({ status: 'SAVED', operationId: 'op-2', error: null }),
    deleteHighlight: jest.fn().mockResolvedValue({ status: 'SAVED', operationId: 'op-3', error: null }),
    addBookmark: jest.fn().mockResolvedValue({ status: 'SAVED', operationId: 'op-4', error: null }),
    removeBookmark: jest.fn().mockResolvedValue({ status: 'SAVED', operationId: 'op-5', error: null }),
    ...overrides,
  };
}

function renderPanel(harness: Harness, overrides: Record<string, unknown> = {}) {
  return render(
    <AnnotationPanel
      bookId="book-1"
      contentVersion={3}
      page={2}
      items={ITEMS}
      highlights={[]}
      bookmarks={[]}
      onRecordsChanged={jest.fn()}
      records={harness}
      {...overrides}
    />,
  );
}

describe('annotation anchors match the canonical text layer', () => {
  it('resolves a stored anchor back to the exact substring it selected', () => {
    const anchor = anchorForItem(ITEMS, 1, 2);
    expect(textForAnchor(ITEMS, anchor)).toBe('world');
    // The canonical text layer is the exact concatenation the offsets index.
    expect(pageTextLayer(ITEMS)).toBe('Helloworld');
  });

  it('scopes the text fallback to the full page text, not a duplicate item string', () => {
    // Two identical strings on one page: an anchor must win over text equality.
    const items: PdfTextItem[] = [
      { t: 'the', x: 0, y: 0, w: 0.1, h: 0.01 },
      { t: 'the', x: 0.2, y: 0, w: 0.1, h: 0.01 },
    ];
    const harness = makeHarness();
    const highlight = {
      id: 'hl-dup',
      clientEntityId: 'client-dup',
      bookId: 'book-1',
      contentVersion: 3,
      page: 2,
      text: 'the',
      note: 'second one',
      color: null,
      anchor: { version: 1, page: 2, startOffset: 3, endOffset: 6 },
      revision: 1,
      createdAt: 1,
      updatedAt: 1,
      deletedAt: null,
    };
    renderPanel(harness, { items, highlights: [highlight] });

    // There are two identical items; an anchor (not text equality) must bind the
    // second "the" (offset 3..6) to the existing highlight.
    const buttons = screen.getAllByRole('button', { name: /highlight "the"/i });
    fireEvent.click(buttons[1]);
    expect(screen.getByRole('textbox', { name: 'Note' })).toHaveValue('second one');
  });

  it('does not bind a highlight pinned to a different content version', () => {
    const harness = makeHarness();
    // Coincident page/offsets but a different pinned version: offsets are only
    // meaningful within one content version, so this must not bind.
    const staleHighlight = {
      id: 'hl-stale',
      clientEntityId: 'client-stale',
      bookId: 'book-1',
      contentVersion: 999,
      page: 2,
      text: 'Hello',
      note: 'from another pinned version',
      color: null,
      anchor: { version: 1, page: 2, startOffset: 0, endOffset: 5 },
      revision: 1,
      createdAt: 1,
      updatedAt: 1,
      deletedAt: null,
    };
    renderPanel(harness, { highlights: [staleHighlight] });

    fireEvent.click(screen.getByRole('button', { name: /highlight "Hello"/i }));
    expect(screen.getByRole('textbox', { name: 'Note' })).toHaveValue('');
  });
});

describe('AnnotationPanel', () => {
  it('saves a highlight with an anchor derived from the selected text-layer item', async () => {
    const harness = makeHarness();
    renderPanel(harness);

    fireEvent.click(screen.getByRole('button', { name: /highlight "Hello"/i }));
    fireEvent.change(screen.getByRole('textbox', { name: 'Note' }), { target: { value: 'my note' } });
    fireEvent.click(screen.getByRole('button', { name: /save highlight/i }));

    await waitFor(() => expect(harness.createHighlight).toHaveBeenCalledTimes(1));
    const input = harness.createHighlight.mock.calls[0][0];
    expect(input).toMatchObject({
      bookId: 'book-1',
      contentVersion: 3,
      page: 2,
      text: 'Hello',
      note: 'my note',
    });
    expect(input.anchor).toMatchObject({ version: 1, page: 2, startOffset: 0, endOffset: 5 });
  });

  it('shows "Saved on this device" only after the local transaction commits', async () => {
    const harness = makeHarness();
    renderPanel(harness);
    fireEvent.click(screen.getByRole('button', { name: /highlight "Hello"/i }));
    fireEvent.click(screen.getByRole('button', { name: /save highlight/i }));
    expect(await screen.findByRole('status')).toHaveTextContent(/saved on this device/i);
  });

  it('reports a save failure honestly and does not claim saved', async () => {
    const harness = makeHarness({
      createHighlight: jest.fn().mockResolvedValue({ status: 'FAILED', operationId: null, error: 'quota exceeded' }),
    });
    renderPanel(harness);
    fireEvent.click(screen.getByRole('button', { name: /highlight "Hello"/i }));
    fireEvent.click(screen.getByRole('button', { name: /save highlight/i }));

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent(/quota exceeded/i);
    expect(screen.queryByText(/saved on this device/i)).not.toBeInTheDocument();
  });

  it('edits the note of an existing highlight', async () => {
    const harness = makeHarness();
    const highlight = {
      id: 'hl-1',
      clientEntityId: 'client-1',
      bookId: 'book-1',
      contentVersion: 3,
      page: 2,
      text: 'Hello',
      note: 'old',
      color: null,
      anchor: { version: 1, page: 2, startOffset: 0, endOffset: 5 },
      revision: 1,
      createdAt: 1,
      updatedAt: 1,
      deletedAt: null,
    };
    renderPanel(harness, { highlights: [highlight] });

    fireEvent.click(screen.getByRole('button', { name: /edit note/i }));
    fireEvent.change(screen.getByRole('textbox', { name: 'Note' }), { target: { value: 'new note' } });
    fireEvent.click(screen.getByRole('button', { name: /save highlight/i }));

    await waitFor(() => expect(harness.updateHighlight).toHaveBeenCalledTimes(1));
    expect(harness.updateHighlight.mock.calls[0][0]).toMatchObject({
      entityId: 'hl-1',
      baseRevision: 1,
      note: 'new note',
    });
  });

  it('adds and removes a bookmark with no label or colour controls', async () => {
    const harness = makeHarness();
    renderPanel(harness);

    expect(screen.queryByLabelText(/label/i)).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/colour|color/i)).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /bookmark this page/i }));
    await waitFor(() => expect(harness.addBookmark).toHaveBeenCalledTimes(1));
    expect(harness.addBookmark.mock.calls[0][0]).toMatchObject({ bookId: 'book-1', page: 2 });
  });

  it('shows a pending state while a save is in flight', async () => {
    let resolveSave: (value: unknown) => void = () => {};
    const harness = makeHarness({
      createHighlight: jest.fn().mockReturnValue(new Promise((resolve) => { resolveSave = resolve; })),
    });
    renderPanel(harness);
    fireEvent.click(screen.getByRole('button', { name: /highlight "Hello"/i }));
    fireEvent.click(screen.getByRole('button', { name: /save highlight/i }));

    expect(await screen.findByText(/saving/i)).toBeInTheDocument();
    resolveSave({ status: 'SAVED', operationId: 'op-1', error: null });
    expect(await screen.findByText(/saved on this device/i)).toBeInTheDocument();
  });
});

describe('AnnotationPanel content-version provenance', () => {
  function highlight(contentVersion: number) {
    return {
      id: 'hl-1',
      clientEntityId: 'client-1',
      bookId: 'book-1',
      contentVersion,
      page: 2,
      text: 'Hello',
      note: 'old note',
      color: null,
      anchor: { version: 1, page: 2, startOffset: 0, endOffset: 5 },
      revision: 1,
      createdAt: 1,
      updatedAt: 1,
      deletedAt: null,
    };
  }

  it('marks an annotation unresolved when its content version is no longer downloaded', () => {
    renderPanel(makeHarness(), { highlights: [highlight(6)], availableContentVersions: [7] });
    expect(screen.getByTestId('annotation-unresolved')).toHaveTextContent(/no longer|unresolved/i);
    // Editing would reinterpret the anchor against new content, so it is disabled.
    expect(screen.getByRole('button', { name: /edit note/i })).toBeDisabled();
  });

  it('leaves a pinned annotation editable', () => {
    renderPanel(makeHarness(), { highlights: [highlight(7)], availableContentVersions: [7] });
    expect(screen.queryByTestId('annotation-unresolved')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /edit note/i })).toBeEnabled();
  });
});
