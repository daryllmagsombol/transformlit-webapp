import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import {
  PwaProvider,
  registerUpdateBarrier,
  usePwaUpdate,
  type UpdateBarrier,
} from './pwa-provider';

// The provider wires the Task 11 coordinator; keep this suite isolated from the
// real sync service (IndexedDB + Apollo) and assert the barrier seam directly.
const mockCoordinator = {
  drain: jest.fn().mockResolvedValue({ summary: {}, blockedReason: null }),
  refreshSnapshots: jest.fn().mockResolvedValue(undefined),
  controlledDrain: jest.fn().mockResolvedValue({
    pending: 0,
    inFlightOrUncertain: 0,
    blockedSuccessors: 0,
    conflicts: 0,
    fullyDrained: true,
  }),
};

jest.mock('../../lib/offline/sync-service', () => ({
  syncCoordinator: () => mockCoordinator,
}));

type ListenerMap = Record<string, (() => void) | undefined>;

interface FakeWorker {
  state: string;
  postMessage: jest.Mock;
  addEventListener: (type: string, handler: () => void) => void;
  removeEventListener: (type: string, handler: () => void) => void;
  setState: (state: string) => void;
}

interface FakeRegistration {
  waiting: FakeWorker | null;
  installing: FakeWorker | null;
  addEventListener: (type: string, handler: () => void) => void;
  removeEventListener: (type: string, handler: () => void) => void;
  emit: (type: string) => void;
}

interface FakeContainer {
  controller: unknown;
  register: jest.Mock;
  addEventListener: (type: string, handler: () => void) => void;
  removeEventListener: (type: string, handler: () => void) => void;
  emit: (type: string) => void;
}

function createWorker(initialState = 'installed'): FakeWorker {
  const listeners: ListenerMap = {};
  const worker: FakeWorker = {
    state: initialState,
    postMessage: jest.fn(),
    addEventListener: (type, handler) => {
      listeners[type] = handler;
    },
    removeEventListener: (type) => {
      delete listeners[type];
    },
    setState: (next) => {
      worker.state = next;
      listeners.statechange?.();
    },
  };
  return worker;
}

function createRegistration(): FakeRegistration {
  const listeners: ListenerMap = {};
  return {
    waiting: null,
    installing: null,
    addEventListener: (type, handler) => {
      listeners[type] = handler;
    },
    removeEventListener: (type) => {
      delete listeners[type];
    },
    emit: (type) => listeners[type]?.(),
  };
}

function createContainer(): FakeContainer {
  const listeners: ListenerMap = {};
  return {
    controller: null,
    register: jest.fn(),
    addEventListener: (type, handler) => {
      listeners[type] = handler;
    },
    removeEventListener: (type) => {
      delete listeners[type];
    },
    emit: (type) => listeners[type]?.(),
  };
}

function installServiceWorker(container: FakeContainer | undefined) {
  Object.defineProperty(globalThis.navigator, 'serviceWorker', {
    configurable: true,
    writable: true,
    value: container,
  });
}

const originalServiceWorker = Object.getOwnPropertyDescriptor(globalThis.navigator, 'serviceWorker');
const reloadSpy = jest.fn();

async function setupWaitingWorker() {
  const container = createContainer();
  const registration = createRegistration();
  const waiting = createWorker('installed');
  registration.waiting = waiting;
  container.register.mockResolvedValue(registration);
  installServiceWorker(container);
  return { container, registration, waiting };
}

function renderProvider() {
  return render(
    <PwaProvider reload={reloadSpy}>
      <span>application</span>
    </PwaProvider>,
  );
}

describe('PwaProvider', () => {
  beforeEach(() => {
    installServiceWorker(createContainer());
    reloadSpy.mockClear();
    mockCoordinator.controlledDrain.mockReset();
    mockCoordinator.controlledDrain.mockResolvedValue({
      pending: 0,
      inFlightOrUncertain: 0,
      blockedSuccessors: 0,
      conflicts: 0,
      fullyDrained: true,
    });
  });

  afterEach(() => {
    jest.restoreAllMocks();
    if (originalServiceWorker) {
      Object.defineProperty(globalThis.navigator, 'serviceWorker', originalServiceWorker);
    }
  });

  it('registers the worker at the root scope and renders children', async () => {
    const container = createContainer();
    container.register.mockResolvedValue(createRegistration());
    installServiceWorker(container);

    renderProvider();

    expect(screen.getByText('application')).toBeInTheDocument();
    await waitFor(() => expect(container.register).toHaveBeenCalledWith('/sw.js', { scope: '/' }));
  });

  it('does not register or prompt when service workers are unsupported', async () => {
    installServiceWorker(undefined);

    renderProvider();

    await act(async () => {
      await Promise.resolve();
    });
    expect(screen.queryByRole('button', { name: /update now/i })).not.toBeInTheDocument();
    expect(screen.getByText('application')).toBeInTheDocument();
  });

  it('shows an accessible update prompt for a waiting worker', async () => {
    await setupWaitingWorker();

    renderProvider();

    expect(await screen.findByRole('button', { name: /update now/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /later/i })).toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent(/update/i);
  });

  it('waits for registered barriers before asking the worker to activate', async () => {
    const { waiting } = await setupWaitingWorker();

    let releaseBarrier: () => void = () => {
      /* replaced below */
    };
    const barrierPending = new Promise<void>((resolve) => {
      releaseBarrier = resolve;
    });
    const barrier: UpdateBarrier = jest.fn(() => barrierPending);
    const unregister = registerUpdateBarrier(barrier);

    renderProvider();
    fireEvent.click(await screen.findByRole('button', { name: /update now/i }));

    await waitFor(() => expect(barrier).toHaveBeenCalled());
    expect(waiting.postMessage).not.toHaveBeenCalled();

    await act(async () => {
      releaseBarrier();
      await barrierPending;
    });

    await waitFor(() => expect(waiting.postMessage).toHaveBeenCalledWith({ type: 'SKIP_WAITING' }));
    unregister();
  });

  it('registers a controlled-drain barrier that only activates when fully drained', async () => {
    const { waiting } = await setupWaitingWorker();
    mockCoordinator.controlledDrain.mockClear();
    mockCoordinator.controlledDrain.mockResolvedValue({
      pending: 0,
      inFlightOrUncertain: 0,
      blockedSuccessors: 0,
      conflicts: 0,
      fullyDrained: true,
    });

    renderProvider();
    fireEvent.click(await screen.findByRole('button', { name: /update now/i }));

    // Activation waits on the registered controlled-drain barrier; a fully
    // drained report permits the waiting worker to activate.
    await waitFor(() => expect(mockCoordinator.controlledDrain).toHaveBeenCalled());
    await waitFor(() => expect(waiting.postMessage).toHaveBeenCalledWith({ type: 'SKIP_WAITING' }));
  });

  it('does not activate when the controlled drain is not fully drained', async () => {
    const { waiting } = await setupWaitingWorker();
    mockCoordinator.controlledDrain.mockClear();
    mockCoordinator.controlledDrain.mockResolvedValue({
      pending: 2,
      inFlightOrUncertain: 1,
      blockedSuccessors: 0,
      conflicts: 1,
      fullyDrained: false,
    });

    renderProvider();
    fireEvent.click(await screen.findByRole('button', { name: /update now/i }));

    await waitFor(() => expect(mockCoordinator.controlledDrain).toHaveBeenCalled());
    // The worker must stay waiting; the update remains available for retry.
    await act(async () => {
      await Promise.resolve();
    });
    expect(waiting.postMessage).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: /update now/i })).toBeInTheDocument();
  });

  it('lets a barrier veto activation by returning false', async () => {
    const { waiting } = await setupWaitingWorker();
    const barrier = jest.fn(() => false);
    const unregister = registerUpdateBarrier(barrier);

    function Probe() {
      const update = usePwaUpdate();
      return <span>{update.updateDeferred ? 'deferred' : 'not-deferred'}</span>;
    }

    try {
      render(
        <PwaProvider reload={reloadSpy}>
          <Probe />
        </PwaProvider>,
      );

      fireEvent.click(await screen.findByRole('button', { name: /update now/i }));

      await waitFor(() => expect(barrier).toHaveBeenCalled());
      expect(waiting.postMessage).not.toHaveBeenCalled();
      expect(await screen.findByText('deferred')).toBeInTheDocument();
      // The user sees why activation was deferred while the prompt stays open.
      expect(screen.getByText(/finishing your saved work before updating/i)).toBeInTheDocument();
      // The update stays advertised so the user can retry once work settles.
      expect(screen.getByRole('button', { name: /update now/i })).toBeInTheDocument();
    } finally {
      unregister();
    }
  });

  it('proceeds immediately when no barriers are registered', async () => {
    const { waiting } = await setupWaitingWorker();

    renderProvider();
    fireEvent.click(await screen.findByRole('button', { name: /update now/i }));

    await waitFor(() => expect(waiting.postMessage).toHaveBeenCalledWith({ type: 'SKIP_WAITING' }));
  });

  it('never activates without consent and hides the prompt on later', async () => {
    const { waiting } = await setupWaitingWorker();

    renderProvider();
    fireEvent.click(await screen.findByRole('button', { name: /later/i }));

    expect(waiting.postMessage).not.toHaveBeenCalled();
    expect(screen.queryByRole('button', { name: /update now/i })).not.toBeInTheDocument();
  });

  it('reloads only after consent when the controller changes', async () => {
    const { container, waiting } = await setupWaitingWorker();

    renderProvider();
    fireEvent.click(await screen.findByRole('button', { name: /update now/i }));
    await waitFor(() => expect(waiting.postMessage).toHaveBeenCalled());

    container.controller = {};
    act(() => container.emit('controllerchange'));

    expect(reloadSpy).toHaveBeenCalledTimes(1);
  });

  it('does not reload on controllerchange before consent', async () => {
    const { container } = await setupWaitingWorker();

    renderProvider();
    await waitFor(() => expect(container.register).toHaveBeenCalled());

    container.controller = {};
    act(() => container.emit('controllerchange'));

    expect(reloadSpy).not.toHaveBeenCalled();
  });

  it('exposes update state through usePwaUpdate and dismisses without activating', async () => {
    const { waiting } = await setupWaitingWorker();

    function Probe() {
      const update = usePwaUpdate();
      return (
        <button type="button" onClick={update.dismissUpdate}>
          {update.updateAvailable ? 'update-available' : 'no-update'}
        </button>
      );
    }

    render(
      <PwaProvider reload={reloadSpy}>
        <Probe />
      </PwaProvider>,
    );

    expect(await screen.findByText('update-available')).toBeInTheDocument();
    fireEvent.click(screen.getByText('update-available'));
    expect(await screen.findByText('no-update')).toBeInTheDocument();
    expect(waiting.postMessage).not.toHaveBeenCalled();
  });

  it('detects an update installed after registration', async () => {
    const container = createContainer();
    const registration = createRegistration();
    container.controller = {};
    container.register.mockResolvedValue(registration);
    installServiceWorker(container);

    renderProvider();

    await waitFor(() => expect(container.register).toHaveBeenCalled());

    const installing = createWorker('installing');
    registration.installing = installing;
    act(() => registration.emit('updatefound'));
    act(() => installing.setState('installed'));

    expect(await screen.findByRole('button', { name: /update now/i })).toBeInTheDocument();
  });
});
