import { fireEvent, render, screen } from '@testing-library/react';
import { ConflictPanel } from './conflict-panel';
import type { ConflictView } from '../../lib/offline/conflicts';

function conflict(overrides: Partial<ConflictView> = {}): ConflictView {
  return {
    operationId: 'op-a',
    outboxId: 'subject-a\u0000outbox\u0000a',
    kind: 'ANNOTATION_UPDATE',
    conflictKind: 'ANNOTATION',
    bookId: 'book-1',
    contentVersion: 7,
    baseRevision: 2,
    entityKey: 'subject-a\u0000highlight\u0000client-1',
    sourceEntityId: 'server-1',
    serverRevision: 9,
    serverValue: { id: 'server-1', page: 1, text: 'server version', note: 'theirs', revision: 9 },
    offlineEdit: { entityId: 'server-1', page: 1, text: 'my offline edit', note: 'mine' },
    conflictCopy: {
      serverId: 'cc-1',
      revision: 3,
      reason: 'STALE_REVISION',
      sourceEntityId: 'server-1',
      contentVersion: 7,
      page: 1,
      text: 'my offline edit',
      note: 'mine',
      color: null,
      anchor: null,
    },
    reason: 'STALE_REVISION',
    successorOperationIds: [],
    ...overrides,
  };
}

function renderPanel(overrides: Partial<Parameters<typeof ConflictPanel>[0]> = {}) {
  return render(
    <ConflictPanel
      conflicts={[conflict()]}
      onChooseServer={jest.fn()}
      onKeepOfflineCopy={jest.fn()}
      onRetarget={jest.fn()}
      onResolveProgress={jest.fn()}
      {...overrides}
    />,
  );
}

describe('ConflictPanel', () => {
  it('compares the offline edit, the server version and the conflict copy', () => {
    renderPanel();
    expect(screen.getByRole('region', { name: /conflicts/i })).toBeInTheDocument();
    expect(screen.getByText('my offline edit')).toBeInTheDocument();
    expect(screen.getByText('server version')).toBeInTheDocument();
    expect(screen.getByText(/conflict copy/i)).toBeInTheDocument();
  });

  it('choosing the server record invokes the server choice', () => {
    const onChooseServer = jest.fn();
    renderPanel({ onChooseServer });
    fireEvent.click(screen.getByRole('button', { name: /use server version/i }));
    expect(onChooseServer).toHaveBeenCalledTimes(1);
  });

  it('keeping the offline edit invokes the keep-offline-copy choice', () => {
    const onKeepOfflineCopy = jest.fn();
    renderPanel({ onKeepOfflineCopy });
    fireEvent.click(screen.getByRole('button', { name: /keep my version/i }));
    expect(onKeepOfflineCopy).toHaveBeenCalledTimes(1);
  });

  it('offers retarget only when there are later edits, forwarding their identities', () => {
    const onRetarget = jest.fn();
    renderPanel({
      conflicts: [conflict({ successorOperationIds: ['op-later'] })],
      onRetarget,
    });
    fireEvent.click(screen.getByRole('button', { name: /retarget my later edits/i }));
    expect(onRetarget).toHaveBeenCalledWith(expect.objectContaining({ operationId: 'op-a' }), ['op-later']);
  });

  it('does not offer retarget when there are no later edits', () => {
    renderPanel();
    expect(screen.queryByRole('button', { name: /retarget my later edits/i })).not.toBeInTheDocument();
  });

  it('compares progress positions and resolves to the explicit local or server page', () => {
    const onResolveProgress = jest.fn();
    renderPanel({
      conflicts: [conflict({
        kind: 'PROGRESS_SET',
        conflictKind: 'PROGRESS',
        serverValue: { currentPage: 40, revision: 9 },
        offlineEdit: { currentPage: 2, scrollY: null },
        conflictCopy: null,
      })],
      onResolveProgress,
    });

    expect(screen.getByText('2')).toBeInTheDocument();
    expect(screen.getByText('40')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /resume at my page/i }));
    fireEvent.click(screen.getByRole('button', { name: /resume at server page/i }));
    expect(onResolveProgress).toHaveBeenNthCalledWith(1, expect.objectContaining({ operationId: 'op-a' }), 'LOCAL');
    expect(onResolveProgress).toHaveBeenNthCalledWith(2, expect.objectContaining({ operationId: 'op-a' }), 'SERVER');
  });

  it('announces resolution status and surfaces errors accessibly', () => {
    renderPanel({ statusMessage: 'Resolved: kept the server version', error: 'Could not resolve' });
    expect(screen.getByRole('status')).toHaveTextContent(/kept the server version/i);
    expect(screen.getByRole('alert')).toHaveTextContent(/could not resolve/i);
  });

  it('renders nothing when there are no conflicts', () => {
    const { container } = renderPanel({ conflicts: [] });
    expect(container).toBeEmptyDOMElement();
  });
});
