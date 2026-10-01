import { PubSubService } from './pubsub.service.js';

// Capture the fake pg client so we can drive the 'notification' event handler
// that onModuleInit registers against the real service instance.
const mockClient = {
  on: jest.fn(),
  query: jest.fn().mockResolvedValue({}),
  end: jest.fn().mockResolvedValue(undefined),
  release: jest.fn(),
};

const mockPool = {
  connect: jest.fn().mockResolvedValue(mockClient),
  query: jest.fn().mockResolvedValue({}),
  end: jest.fn().mockResolvedValue(undefined),
};

jest.mock('pg', () => ({
  Pool: jest.fn().mockImplementation(() => mockPool),
}));

const flush = () => new Promise((resolve) => setImmediate(resolve));

describe('PubSubService', () => {
  let service: PubSubService;
  let errorSpy: jest.SpyInstance;

  const notificationHandler = () => {
    const registration = mockClient.on.mock.calls
      .filter(([event]) => event === 'notification')
      .pop();
    if (!registration) throw new Error('no notification handler was registered');
    return registration[1] as (msg: { channel: string; payload?: string | null }) => void;
  };

  beforeEach(async () => {
    jest.clearAllMocks();
    errorSpy = jest.spyOn(console, 'error').mockImplementation(() => undefined);
    service = new PubSubService({
      get: jest.fn().mockReturnValue('postgresql://test:test@localhost:5432/test'),
    } as any);
    await service.onModuleInit();
  });

  afterEach(() => {
    errorSpy.mockRestore();
  });

  it('registers a notification handler and LISTEN queries on init', () => {
    expect(mockClient.on).toHaveBeenCalledWith('notification', expect.any(Function));
    expect(mockClient.query).toHaveBeenCalledWith('LISTEN "messageAdded"');
    expect(mockClient.query).toHaveBeenCalledWith('LISTEN "notificationReceived"');
  });

  it('releases the dedicated LISTEN connection before ending the pool on destroy', async () => {
    await service.onModuleDestroy();

    // Pool.end() blocks until every checked-out client is released, so the
    // LISTEN client must be released first or shutdown hangs forever.
    expect(mockClient.release).toHaveBeenCalledTimes(1);
    expect(mockPool.end).toHaveBeenCalledTimes(1);
    expect(mockClient.release.mock.invocationCallOrder[0]).toBeLessThan(
      mockPool.end.mock.invocationCallOrder[0],
    );
  });

  it('does not throw on a malformed JSON payload and does not resolve waiting triggers', async () => {
    const handler = notificationHandler();
    const iterator = service.asyncIterator('messageAdded');
    const pending = iterator.next();

    let settled = false;
    pending.then(() => {
      settled = true;
    });

    // Must not throw out of the handler (an uncaught throw in the pg client's
    // event emitter could crash the process).
    expect(() =>
      handler({ channel: 'messageAdded', payload: '{this is not json' }),
    ).not.toThrow();

    await flush();
    expect(settled).toBe(false);
    expect(errorSpy).toHaveBeenCalledWith(
      '[pubsub] Ignoring notification with malformed JSON payload:',
      '{this is not json',
    );

    // The malformed message must not have consumed the waiting trigger: a
    // subsequent valid payload on the same channel still resolves it.
    handler({ channel: 'messageAdded', payload: JSON.stringify({ ok: true }) });
    await expect(pending).resolves.toEqual({ value: { ok: true }, done: false });
  });

  it('resolves waiting triggers with a parsed JSON payload', async () => {
    const handler = notificationHandler();
    const iterator = service.asyncIterator('notificationReceived');
    const pending = iterator.next();

    handler({
      channel: 'notificationReceived',
      payload: JSON.stringify({ id: 'n1', type: 'TEST' }),
    });
    await expect(pending).resolves.toEqual({
      value: { id: 'n1', type: 'TEST' },
      done: false,
    });
  });

  it('resolves waiting triggers with null when the payload is empty', async () => {
    const handler = notificationHandler();
    const iterator = service.asyncIterator('messageAdded');
    const pending = iterator.next();

    handler({ channel: 'messageAdded', payload: null });
    await expect(pending).resolves.toEqual({ value: null, done: false });
  });
});
