const mockCreateClient = jest.fn();

jest.mock('graphql-ws', () => ({
  createClient: mockCreateClient,
}));

import {
  registerWsReconnectHandler,
  unregisterWsReconnectHandler,
} from './apollo-client';

// The ClientOptions object apollo-client passed to graphql-ws createClient.
// Captured once at module load (createClient is called a single time at
// import) so per-test mock resets cannot wipe it.
const wsClientOptions = mockCreateClient.mock.calls[0][0] as {
  on: {
    connected: (socket: unknown, payload: unknown, wasRetry: boolean) => void;
  };
};

describe('WS reconnect handlers', () => {
  beforeEach(() => {
    mockCreateClient.mockClear();
  });

  it('fires registered handlers only when the connection is re-established after a retry', () => {
    const handler = jest.fn();
    registerWsReconnectHandler(handler);

    expect(wsClientOptions.on).toBeDefined();

    // Initial connection (wasRetry=false) must NOT trigger a refetch.
    wsClientOptions.on.connected(undefined, undefined, false);
    expect(handler).not.toHaveBeenCalled();

    // Reconnect after a network drop (wasRetry=true) must trigger a refetch.
    wsClientOptions.on.connected(undefined, undefined, true);
    expect(handler).toHaveBeenCalledTimes(1);

    // Unregistering stops further notifications.
    unregisterWsReconnectHandler(handler);
    wsClientOptions.on.connected(undefined, undefined, true);
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it('isolates handler failures so one bad handler cannot break the others', () => {
    const good = jest.fn();
    const bad = jest.fn(() => {
      throw new Error('boom');
    });
    registerWsReconnectHandler(bad);
    registerWsReconnectHandler(good);

    wsClientOptions.on.connected(undefined, undefined, true);
    expect(good).toHaveBeenCalledTimes(1);

    unregisterWsReconnectHandler(bad);
    unregisterWsReconnectHandler(good);
  });
});