'use client';

import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { SyncStatus } from './sync-status';
import { syncCoordinator } from '../../lib/offline/sync-service';
import type { CoordinatorStatus } from '../../lib/offline/sync-coordinator';

/**
 * The authenticated-shell consumer for the Task 11 coordinator status. Without
 * this mount the coordinator's status (and the required reauthenticate/discard
 * UX) would be unreachable. It subscribes to the coordinator, retries on
 * demand, routes to sign-in for reauthentication, and discards ONLY true
 * conflicts when the user chooses to; terminal non-conflict outcomes are
 * surfaced for recovery instead.
 *
 * It renders nothing until there is something actionable to say, so a
 * fully-synced reader is never cluttered.
 */
export function SyncStatusConnected() {
  const router = useRouter();
  const [status, setStatus] = useState<CoordinatorStatus | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const coordinator = syncCoordinator();
    setStatus(coordinator.getStatus());
    return coordinator.subscribe(setStatus);
  }, []);

  const retry = useCallback(() => {
    setBusy(true);
    syncCoordinator()
      .drain()
      .catch(() => undefined)
      .finally(() => setBusy(false));
  }, []);

  const reauthenticate = useCallback(() => {
    router.push('/login');
  }, [router]);

  const discard = useCallback(() => {
    setBusy(true);
    syncCoordinator()
      .discardConflicts()
      .catch(() => undefined)
      .finally(() => setBusy(false));
  }, []);

  if (!status) return null;
  const hasActionable =
    status.pending > 0 ||
    status.conflicts > 0 ||
    status.terminal > 0 ||
    status.incompatibleVersion > 0 ||
    status.accessDenied > 0 ||
    status.authRequired ||
    status.storageFailure ||
    status.state === 'ERROR';
  if (!hasActionable) return null;

  return (
    <SyncStatus
      pending={status.pending}
      conflicts={status.conflicts}
      terminal={status.terminal}
      incompatibleVersion={status.incompatibleVersion}
      accessDenied={status.accessDenied}
      state={busy ? 'SYNCING' : status.state}
      lastError={status.lastError}
      authRequired={status.authRequired}
      storageFailure={status.storageFailure}
      onRetry={retry}
      onReauthenticate={reauthenticate}
      onDiscard={discard}
    />
  );
}
