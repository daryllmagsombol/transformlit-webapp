import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { SyncStatusConnected } from './sync-status-connected';
import type { CoordinatorStatus } from '../../lib/offline/sync-coordinator';

const mockPush = jest.fn();
jest.mock('next/navigation', () => ({
  useRouter: () => ({ push: mockPush }),
}));

type Listener = (status: CoordinatorStatus) => void;

const listeners = new Set<Listener>();
let currentStatus: CoordinatorStatus | null = null;

const mockCoordinator = {
  getStatus: jest.fn(() => currentStatus),
  subscribe: jest.fn((listener: Listener) => {
    listeners.add(listener);
    return () => listeners.delete(listener);
  }),
  drain: jest.fn().mockResolvedValue({ summary: {}, blockedReason: null }),
  discardConflicts: jest.fn().mockResolvedValue(1),
};

jest.mock('../../lib/offline/sync-service', () => ({
  syncCoordinator: () => mockCoordinator,
}));

function emit(status: CoordinatorStatus): void {
  currentStatus = status;
  act(() => {
    for (const listener of listeners) listener(status);
  });
}

function status(overrides: Partial<CoordinatorStatus> = {}): CoordinatorStatus {
  return {
    state: 'IDLE',
    pending: 0,
    conflicts: 0,
    terminal: 0,
    incompatibleVersion: 0,
    accessDenied: 0,
    authRequired: false,
    storageFailure: false,
    lastError: null,
    ...overrides,
  };
}

describe('SyncStatusConnected', () => {
  beforeEach(() => {
    listeners.clear();
    currentStatus = null;
    mockPush.mockClear();
    mockCoordinator.drain.mockClear();
    mockCoordinator.discardConflicts.mockClear();
  });

  it('renders nothing when there is no actionable sync state', () => {
    currentStatus = status();
    render(<SyncStatusConnected />);
    expect(screen.queryByTestId('sync-status')).not.toBeInTheDocument();
  });

  it('surfaces the explicit auth-required status emitted by the coordinator', () => {
    render(<SyncStatusConnected />);
    emit(status({ state: 'BLOCKED', pending: 1, authRequired: true }));

    expect(screen.getByRole('alert')).toHaveTextContent(/sign in again/i);
    fireEvent.click(screen.getByRole('button', { name: /sign in again/i }));
    expect(mockPush).toHaveBeenCalledWith('/login');
  });

  it('retries the drain on demand', async () => {
    render(<SyncStatusConnected />);
    emit(status({ pending: 2 }));

    fireEvent.click(screen.getByRole('button', { name: /retry now/i }));
    await waitFor(() => expect(mockCoordinator.drain).toHaveBeenCalledTimes(1));
  });

  it('discards conflicting changes on demand', async () => {
    render(<SyncStatusConnected />);
    emit(status({ conflicts: 1 }));

    fireEvent.click(screen.getByRole('button', { name: /discard/i }));
    await waitFor(() => expect(mockCoordinator.discardConflicts).toHaveBeenCalledTimes(1));
  });

  it('surfaces terminal work for recovery without offering discard', () => {
    render(<SyncStatusConnected />);
    emit(status({ state: 'ERROR', terminal: 2 }));

    expect(screen.getByRole('alert')).toHaveTextContent(/2/);
    expect(screen.queryByRole('button', { name: /discard/i })).not.toBeInTheDocument();
  });

  it('surfaces an incompatible-version result explicitly (not as a generic conflict)', () => {
    render(<SyncStatusConnected />);
    emit(status({ state: 'ERROR', terminal: 1, incompatibleVersion: 1 }));

    expect(screen.getByRole('alert')).toHaveTextContent(/newer version of the app/i);
    expect(screen.queryByRole('button', { name: /discard/i })).not.toBeInTheDocument();
  });
});
