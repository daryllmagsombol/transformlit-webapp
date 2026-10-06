import { RecordActivityDocument } from '@transformlit/graphql';
import type { ActivityType } from '@transformlit/shared';
import { apolloClient } from '../apollo-client';

/** Public input for recording a single reading-activity event. */
export interface RecordActivityInput {
  readonly type: ActivityType;
  readonly pagesDelta?: number;
  readonly operationId?: string;
}

interface RecordActivityMutationInput {
  readonly type: ActivityType;
  readonly pagesDelta: number;
  readonly operationId: string;
}

/**
 * Minimal Apollo-compatible client seam. Keeping the mutation surface narrow
 * lets callers inject a fake in tests without booting a real client.
 */
export interface ActivityMutationClient {
  readonly mutate: (options: {
    readonly mutation: typeof RecordActivityDocument;
    readonly variables: { readonly input: RecordActivityMutationInput };
  }) => Promise<unknown>;
}

/**
 * Fire-and-forget activity recorder bound to an injected Apollo-like client.
 *
 * Never throws synchronously: a dropped activity record must not interrupt
 * reading. Both the `operationId` generation and the `mutate` call are guarded,
 * and the returned promise resolves to `void` so callers that want to await the
 * write can, while fire-and-forget callers can ignore it. A fresh `operationId`
 * is generated per call so the server can deduplicate retries.
 */
export function recordActivityWith(
  client: ActivityMutationClient,
  input: RecordActivityInput,
): Promise<void> {
  try {
    return client
      .mutate({
        mutation: RecordActivityDocument,
        variables: {
          input: {
            type: input.type,
            pagesDelta: input.pagesDelta ?? 0,
            operationId: input.operationId ?? globalThis.crypto.randomUUID(),
          },
        },
      })
      .then(
        () => undefined,
        () => undefined,
      );
  } catch {
    // A synchronous throw (e.g. `crypto.randomUUID` unavailable, or a `mutate`
    // that throws instead of rejecting) must not escape: this recorder is
    // fire-and-forget and must never break the caller's control flow.
    return Promise.resolve();
  }
}

/** Records a reading activity through the app's shared Apollo client. */
export function recordActivity(input: RecordActivityInput): Promise<void> {
  return recordActivityWith(apolloClient, input);
}
