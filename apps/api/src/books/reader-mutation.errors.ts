import { GraphQLError } from 'graphql';

/** Stable code returned for any legacy (pre-offline) reader write. */
export const UPGRADE_REQUIRED_CODE = 'UPGRADE_REQUIRED';

/**
 * Thrown for legacy reader mutation writes. Carries a stable GraphQL
 * `extensions.code` so old clients can classify and prompt for an upgrade
 * instead of silently corrupting revision/tombstone state.
 *
 * Kept in its own module so both the read-side `BooksService` (which rejects
 * legacy writes) and the new `ReaderMutationsService` can reference it without
 * a circular import.
 */
export class UpgradeRequiredError extends GraphQLError {
  constructor(kind: string) {
    super(`Legacy reader mutation "${kind}" is no longer supported; upgrade the client`, {
      extensions: { code: UPGRADE_REQUIRED_CODE, kind },
    });
    this.name = 'UpgradeRequiredError';
  }
}
