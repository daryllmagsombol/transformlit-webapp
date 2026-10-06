import { RecordActivityDocument } from '@transformlit/graphql';
import { apolloClient } from '../apollo-client';
import { recordActivity, recordActivityWith } from './record-activity';

jest.mock('../apollo-client', () => ({
  apolloClient: { mutate: jest.fn() },
}));

const mutateMock = apolloClient.mutate as jest.Mock;

describe('recordActivityWith', () => {
  afterEach(() => {
    jest.clearAllMocks();
  });

  it('never throws when the mutation rejects', async () => {
    const client = { mutate: jest.fn().mockRejectedValue(new Error('offline')) };
    expect(() => recordActivityWith(client, { type: 'FEED_READ' })).not.toThrow();
  });

  it('never throws when mutate throws synchronously', () => {
    const client = {
      mutate: jest.fn(() => {
        throw new Error('sync boom');
      }),
    };
    expect(() => recordActivityWith(client, { type: 'FEED_READ' })).not.toThrow();
  });

  it('never throws when crypto.randomUUID is unavailable', () => {
    const original = globalThis.crypto;
    // Simulate a non-secure context / old browser where randomUUID is missing.
    Object.defineProperty(globalThis, 'crypto', { value: {}, configurable: true });
    try {
      const client = { mutate: jest.fn().mockResolvedValue({ data: {} }) };
      expect(() => recordActivityWith(client, { type: 'FEED_READ' })).not.toThrow();
    } finally {
      Object.defineProperty(globalThis, 'crypto', { value: original, configurable: true });
    }
  });

  it('resolves even when the mutation rejects, so callers can await safely', async () => {
    const client = { mutate: jest.fn().mockRejectedValue(new Error('offline')) };
    await expect(recordActivityWith(client, { type: 'FEED_READ' })).resolves.toBeUndefined();
  });

  it('swallows the rejection (no unhandled promise)', async () => {
    const client = { mutate: jest.fn().mockRejectedValue(new Error('offline')) };
    recordActivityWith(client, { type: 'FEED_READ' });
    await Promise.resolve();
    // no assertion needed — the test fails if the rejection escapes
  });

  it('sends the generated RecordActivity mutation with a generated operationId', () => {
    const client = { mutate: jest.fn().mockResolvedValue({ data: {} }) };

    recordActivityWith(client, { type: 'FEED_READ', pagesDelta: 3 });

    expect(client.mutate).toHaveBeenCalledWith({
      mutation: RecordActivityDocument,
      variables: {
        input: {
          type: 'FEED_READ',
          pagesDelta: 3,
          operationId: expect.any(String),
        },
      },
    });
    const operationId = client.mutate.mock.calls[0][0].variables.input.operationId;
    expect(operationId.length).toBeGreaterThan(0);
  });

  it('defaults pagesDelta to 0 when omitted', () => {
    const client = { mutate: jest.fn().mockResolvedValue({ data: {} }) };

    recordActivityWith(client, { type: 'BOOK_READ' });

    expect(client.mutate).toHaveBeenCalledWith(
      expect.objectContaining({
        variables: { input: expect.objectContaining({ pagesDelta: 0, type: 'BOOK_READ' }) },
      }),
    );
  });

  it('honors a caller-supplied operationId', () => {
    const client = { mutate: jest.fn().mockResolvedValue({ data: {} }) };

    recordActivityWith(client, { type: 'BIBLE_READ', operationId: 'caller-op' });

    expect(client.mutate).toHaveBeenCalledWith(
      expect.objectContaining({
        variables: { input: expect.objectContaining({ operationId: 'caller-op' }) },
      }),
    );
  });
});

describe('recordActivity', () => {
  beforeEach(() => {
    mutateMock.mockResolvedValue({ data: {} });
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('delegates to the app Apollo client', () => {
    recordActivity({ type: 'GROUP_POST' });

    expect(apolloClient.mutate).toHaveBeenCalledWith(
      expect.objectContaining({ mutation: RecordActivityDocument }),
    );
  });

  it('never throws when the app client rejects', () => {
    (apolloClient.mutate as jest.Mock).mockRejectedValueOnce(new Error('offline'));

    expect(() => recordActivity({ type: 'FEED_READ' })).not.toThrow();
  });
});
