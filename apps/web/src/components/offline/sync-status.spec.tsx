import { fireEvent, render, screen } from '@testing-library/react';
import { SyncStatus } from './sync-status';

describe('SyncStatus', () => {
  it('reports an idle state with no pending work', () => {
    render(<SyncStatus pending={0} conflicts={0} state="IDLE" onRetry={jest.fn()} onReauthenticate={jest.fn()} onDiscard={jest.fn()} />);
    expect(screen.getByRole('status')).toHaveTextContent(/saved on this device/i);
  });

  it('reports pending work with a count', () => {
    render(<SyncStatus pending={3} conflicts={0} state="SYNCING" onRetry={jest.fn()} onReauthenticate={jest.fn()} onDiscard={jest.fn()} />);
    expect(screen.getByRole('status')).toHaveTextContent(/3/);
    expect(screen.getByRole('status')).toHaveTextContent(/sync/i);
  });

  it('surfaces conflicts and offers retry and discard', () => {
    const onRetry = jest.fn();
    const onDiscard = jest.fn();
    render(<SyncStatus pending={1} conflicts={2} state="ERROR" onRetry={onRetry} onReauthenticate={jest.fn()} onDiscard={onDiscard} />);
    expect(screen.getByRole('alert')).toHaveTextContent(/2/);
    fireEvent.click(screen.getByRole('button', { name: /retry/i }));
    fireEvent.click(screen.getByRole('button', { name: /discard/i }));
    expect(onRetry).toHaveBeenCalledTimes(1);
    expect(onDiscard).toHaveBeenCalledTimes(1);
  });

  it('offers reauthentication when auth is required', () => {
    const onReauthenticate = jest.fn();
    render(
      <SyncStatus
        pending={1}
        conflicts={0}
        state="BLOCKED"
        lastError="AUTH_REQUIRED"
        onRetry={jest.fn()}
        onReauthenticate={onReauthenticate}
        onDiscard={jest.fn()}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: /sign in again/i }));
    expect(onReauthenticate).toHaveBeenCalledTimes(1);
  });

  it('offers reauthentication from the explicit authRequired flag the coordinator emits', () => {
    const onReauthenticate = jest.fn();
    render(
      <SyncStatus
        pending={1}
        conflicts={0}
        state="BLOCKED"
        authRequired
        onRetry={jest.fn()}
        onReauthenticate={onReauthenticate}
        onDiscard={jest.fn()}
      />,
    );
    expect(screen.getByRole('alert')).toHaveTextContent(/sign in again/i);
    fireEvent.click(screen.getByRole('button', { name: /sign in again/i }));
    expect(onReauthenticate).toHaveBeenCalledTimes(1);
  });

  it('surfaces incompatible-version recovery distinctly from access denial', () => {
    const { rerender } = render(
      <SyncStatus
        pending={0}
        conflicts={0}
        terminal={1}
        incompatibleVersion={1}
        state="ERROR"
        onRetry={jest.fn()}
        onReauthenticate={jest.fn()}
        onDiscard={jest.fn()}
      />,
    );
    expect(screen.getByRole('alert')).toHaveTextContent(/newer version of the app/i);

    rerender(
      <SyncStatus
        pending={0}
        conflicts={0}
        terminal={1}
        accessDenied={1}
        state="ERROR"
        onRetry={jest.fn()}
        onReauthenticate={jest.fn()}
        onDiscard={jest.fn()}
      />,
    );
    expect(screen.getByRole('alert')).toHaveTextContent(/need.*access to sync/i);
    expect(screen.getByRole('alert')).not.toHaveTextContent(/newer version/i);
  });

  it('surfaces terminal work as needing recovery and never offers discard for it', () => {
    render(
      <SyncStatus
        pending={0}
        conflicts={0}
        terminal={2}
        state="ERROR"
        onRetry={jest.fn()}
        onReauthenticate={jest.fn()}
        onDiscard={jest.fn()}
      />,
    );
    expect(screen.getByRole('alert')).toHaveTextContent(/2/);
    expect(screen.getByRole('button', { name: /retry/i })).toBeInTheDocument();
    // Terminal outcomes were never conflicts: no "discard" affordance.
    expect(screen.queryByRole('button', { name: /discard/i })).not.toBeInTheDocument();
  });

  it('offers discard only for true conflicts, not for terminal work', () => {
    render(
      <SyncStatus
        pending={0}
        conflicts={1}
        terminal={3}
        state="ERROR"
        onRetry={jest.fn()}
        onReauthenticate={jest.fn()}
        onDiscard={jest.fn()}
      />,
    );
    expect(screen.getByRole('button', { name: /discard conflicting changes/i })).toBeInTheDocument();
  });

  it('surfaces a storage failure honestly and distinctly from a network retry', () => {
    render(
      <SyncStatus
        pending={0}
        conflicts={0}
        state="ERROR"
        storageFailure
        onRetry={jest.fn()}
        onReauthenticate={jest.fn()}
        onDiscard={jest.fn()}
      />,
    );
    expect(screen.getByRole('alert')).toHaveTextContent(/could not store/i);
  });

  it('never claims synchronized when work remains', () => {
    render(<SyncStatus pending={1} conflicts={0} state="SYNCING" onRetry={jest.fn()} onReauthenticate={jest.fn()} onDiscard={jest.fn()} />);
    expect(screen.queryByText(/all changes synchronized/i)).not.toBeInTheDocument();
  });
});
