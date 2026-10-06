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
 * Never throws and never surfaces the mutation result: a dropped activity record
 * must not interrupt reading. A fresh `operationId` is generated per call so the
 * server can deduplicate retries.
 */
export function recordActivityWith(
  client: ActivityMutationClient,
  input: RecordActivityInput,
): void {
  client
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
    .catch(() => {
      // Fire-and-forget: an offline or failed activity record is intentionally
      // dropped rather than surfaced to the reader.
    });
}

/** Records a reading activity through the app's shared Apollo client. */
export function recordActivity(input: RecordActivityInput): void {
  recordActivityWith(apolloClient, input);
}
