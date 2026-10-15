jest.mock('graphql-ws', () => ({ createClient: jest.fn(() => ({})) }));

import { ApolloLink } from '@apollo/client';
import { Observable } from 'rxjs';
import {
  createHttpOrUploadLink,
  getUploadTransportOptions,
  isUploadOperation,
  UPLOAD_LINK_OPTIONS,
  UPLOAD_OPERATION_NAMES,
} from './apollo-client';

/** Minimal operation stub — the split predicate only reads `operationName`. */
function makeOperation(operationName: string | undefined): never {
  return {
    operationName,
    query: {},
    variables: {},
    extensions: {},
    getContext: () => ({}),
    setContext: () => undefined,
  } as never;
}

function emitting(transport: string): jest.Mock {
  return jest.fn(
    () =>
      new Observable<{ data: string }>((subscriber) => {
        subscriber.next({ data: transport });
        subscriber.complete();
      }),
  );
}

type LooseLink = { request: (op: unknown, forward: (op: unknown) => unknown) => Observable<unknown> };

function run(link: ApolloLink, operationName: string | undefined): Promise<unknown> {
  const loose = link as unknown as LooseLink;
  return new Promise((resolve, reject) => {
    loose
      .request(makeOperation(operationName), (op) => new Observable<unknown>((s) => s.complete()))
      .subscribe({ next: (value) => resolve(value), error: reject });
  });
}

describe('Apollo multipart upload link routing', () => {
  let multipartRequest: jest.Mock;
  let jsonRequest: jest.Mock;
  let transportFactory: jest.Mock;
  let link: ApolloLink;

  beforeEach(() => {
    multipartRequest = emitting('multipart');
    jsonRequest = emitting('json');
    transportFactory = jest.fn(async () => new ApolloLink(multipartRequest as never));
    link = createHttpOrUploadLink(transportFactory, new ApolloLink(jsonRequest as never));
  });

  it('routes the UploadPdf operation to the multipart transport', async () => {
    await expect(run(link, 'UploadPdf')).resolves.toEqual({ data: 'multipart' });
    expect(transportFactory).toHaveBeenCalledTimes(1);
    expect(multipartRequest).toHaveBeenCalledTimes(1);
    expect(jsonRequest).not.toHaveBeenCalled();
  });

  it('routes a non-upload operation to the JSON link', async () => {
    await expect(run(link, 'ListBooks')).resolves.toEqual({ data: 'json' });
    expect(jsonRequest).toHaveBeenCalledTimes(1);
    expect(transportFactory).not.toHaveBeenCalled();
    expect(multipartRequest).not.toHaveBeenCalled();
  });

  it('does not route an anonymous operation (undefined name) to multipart', async () => {
    await expect(run(link, undefined)).resolves.toEqual({ data: 'json' });
    expect(jsonRequest).toHaveBeenCalledTimes(1);
    expect(transportFactory).not.toHaveBeenCalled();
  });

  it('keeps the allowlist to real schema operations only', () => {
    expect([...UPLOAD_OPERATION_NAMES]).toEqual(['UploadPdf']);
    expect(isUploadOperation('UploadPdf')).toBe(true);
    expect(isUploadOperation('UploadBookFile')).toBe(false);
    expect(isUploadOperation(undefined)).toBe(false);
  });

  it('builds the upload transport with the CSRF preflight header and credentials', () => {
    const options = getUploadTransportOptions();
    expect(options.headers['apollo-require-preflight']).toBe('true');
    expect(options.credentials).toBe('include');
    // The preflight header must live in the shared options object so the real
    // UploadHttpLink construction cannot silently drop it.
    expect(UPLOAD_LINK_OPTIONS.headers['apollo-require-preflight']).toBe('true');
  });
});
