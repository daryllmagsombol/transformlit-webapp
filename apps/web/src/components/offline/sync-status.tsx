'use client';

import type { ReactNode } from 'react';

/**
 * Accessible foreground-synchronization status. Reports pending work, conflicts,
 * and the current state, and exposes the actionable controls the spec requires:
 * retry, reauthenticate, and discard. It NEVER claims synchronized while work
 * remains, and it never promises connectivity (the coordinator, not
 * `navigator.onLine`, decides reachability).
 */
export interface SyncStatusProps {
  readonly pending: number;
  readonly conflicts: number;
  readonly state: 'IDLE' | 'SYNCING' | 'BLOCKED' | 'ERROR';
  readonly lastError?: string | null;
  readonly onRetry: () => void;
  readonly onReauthenticate: () => void;
  readonly onDiscard: () => void;
}

type AuthRequired = boolean;

function isAuthRequired(lastError: string | null | undefined): AuthRequired {
  return lastError === 'AUTH_REQUIRED';
}

function statusLabel(pending: number, conflicts: number, state: SyncStatusProps['state'], authRequired: boolean): string {
  if (authRequired) return 'Sign in again to sync your changes';
  if (conflicts > 0) {
    return `${conflicts} change${conflicts === 1 ? '' : 's'} need${conflicts === 1 ? 's' : ''} your attention`;
  }
  if (pending > 0) {
    return `${pending} change${pending === 1 ? '' : 's'} waiting to sync`;
  }
  if (state === 'SYNCING') return 'Checking for updates…';
  return 'Saved on this device';
}

export function SyncStatus({
  pending,
  conflicts,
  state,
  lastError = null,
  onRetry,
  onReauthenticate,
  onDiscard,
}: SyncStatusProps) {
  const authRequired = isAuthRequired(lastError);
  const hasWork = pending > 0 || conflicts > 0;
  const label = statusLabel(pending, conflicts, state, authRequired);

  const controls = (
    <div className="flex flex-wrap gap-2">
      <button
        type="button"
        onClick={onRetry}
        disabled={state === 'SYNCING'}
        className="inline-flex min-h-11 items-center rounded-lg border border-outline-variant px-4 font-small text-small font-semibold text-on-surface transition-colors hover:bg-surface-container-high disabled:opacity-50"
      >
        Retry now
      </button>
      {authRequired ? (
        <button
          type="button"
          onClick={onReauthenticate}
          className="inline-flex min-h-11 items-center rounded-lg bg-primary px-4 font-small text-small font-semibold text-on-primary transition-colors hover:bg-primary-container hover:text-on-primary-container"
        >
          Sign in again
        </button>
      ) : null}
      {conflicts > 0 ? (
        <button
          type="button"
          onClick={onDiscard}
          className="inline-flex min-h-11 items-center rounded-lg border border-outline-variant px-4 font-small text-small font-semibold text-on-surface-variant transition-colors hover:bg-surface-container-high"
        >
          Discard conflicting changes
        </button>
      ) : null}
    </div>
  );

  return (
    <section
      aria-label="Sync status"
      data-testid="sync-status"
      className="flex flex-col gap-3 rounded-xl border border-outline-variant bg-surface-container-low p-4"
    >
      <SyncStatusBody label={label} conflicts={conflicts} authRequired={authRequired} showControls={hasWork} controls={controls} />
    </section>
  );
}

function SyncStatusBody({
  label,
  conflicts,
  authRequired,
  showControls,
  controls,
}: {
  readonly label: string;
  readonly conflicts: number;
  readonly authRequired: boolean;
  readonly showControls: boolean;
  readonly controls: ReactNode;
}) {
  if (conflicts > 0 || authRequired) {
    return (
      <>
        <p role="alert" className="font-small text-small text-error" data-testid="sync-alert">
          {label}
        </p>
        {controls}
      </>
    );
  }
  return (
    <>
      <p role="status" className="font-small text-small text-on-surface-variant" data-testid="sync-status-text">
        {label}
      </p>
      {showControls ? controls : null}
    </>
  );
}
