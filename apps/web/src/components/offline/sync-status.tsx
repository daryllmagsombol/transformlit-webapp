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
  /** TRUE conflicts only; these are what "Discard" targets. */
  readonly conflicts: number;
  /**
   * Non-conflict terminal outcomes (access denied / incompatible version).
   * Surfaced as needing recovery; never offered as discardable conflicts.
   */
  readonly terminal?: number;
  /**
   * Terminal outcomes whose content version was unavailable/incompatible.
   * Surfaced with an explicit "update the app" recovery message rather than the
   * generic terminal "recovery" label.
   */
  readonly incompatibleVersion?: number;
  /** Terminal outcomes retained because access was denied. */
  readonly accessDenied?: number;
  readonly state: 'IDLE' | 'SYNCING' | 'BLOCKED' | 'ERROR';
  readonly lastError?: string | null;
  /**
   * Explicit auth-required signal emitted by the coordinator. Preferred over
   * parsing `lastError`; the string form is still honored for compatibility.
   */
  readonly authRequired?: boolean;
  /** True when a storage fault (not a network failure) is blocking sync. */
  readonly storageFailure?: boolean;
  readonly onRetry: () => void;
  readonly onReauthenticate: () => void;
  readonly onDiscard: () => void;
}

function isAuthRequired(authRequired: boolean | undefined, lastError: string | null | undefined): boolean {
  return authRequired === true || lastError === 'AUTH_REQUIRED';
}

interface StatusInput {
  readonly pending: number;
  readonly conflicts: number;
  readonly terminal: number;
  readonly incompatibleVersion: number;
  readonly accessDenied: number;
  readonly state: SyncStatusProps['state'];
  readonly authRequired: boolean;
  readonly storageFailure: boolean;
}

function changeCount(count: number): string {
  return `${count} change${count === 1 ? '' : 's'}`;
}

function needVerb(count: number): string {
  return count === 1 ? 'needs' : 'need';
}

/** "3 changes need your attention" plus the count-correct verb. */
function changesNeed(count: number, suffix: string): string {
  return `${changeCount(count)} ${needVerb(count)} ${suffix}`;
}

function statusLabel({
  pending,
  conflicts,
  terminal,
  incompatibleVersion,
  accessDenied,
  state,
  authRequired,
  storageFailure,
}: StatusInput): string {
  if (authRequired) return 'Sign in again to sync your changes';
  if (storageFailure) return 'This device could not store your changes';
  if (conflicts > 0) return changesNeed(conflicts, 'your attention');
  if (incompatibleVersion > 0) return changesNeed(incompatibleVersion, 'a newer version of the app to sync');
  if (accessDenied > 0) return changesNeed(accessDenied, 'access to sync');
  if (terminal > 0) return changesNeed(terminal, 'recovery');
  if (pending > 0) return `${changeCount(pending)} waiting to sync`;
  if (state === 'SYNCING') return 'Checking for updates…';
  return 'Saved on this device';
}

export function SyncStatus({
  pending,
  conflicts,
  terminal = 0,
  incompatibleVersion = 0,
  accessDenied = 0,
  state,
  lastError = null,
  authRequired: authRequiredProp,
  storageFailure = false,
  onRetry,
  onReauthenticate,
  onDiscard,
}: SyncStatusProps) {
  const authRequired = isAuthRequired(authRequiredProp, lastError);
  const hasWork =
    pending > 0 || conflicts > 0 || terminal > 0 || incompatibleVersion > 0 || accessDenied > 0 || storageFailure;
  const label = statusLabel({
    pending,
    conflicts,
    terminal,
    incompatibleVersion,
    accessDenied,
    state,
    authRequired,
    storageFailure,
  });

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
      <SyncStatusBody
        label={label}
        conflicts={conflicts}
        terminal={terminal}
        incompatibleVersion={incompatibleVersion}
        authRequired={authRequired}
        storageFailure={storageFailure}
        showControls={hasWork}
        controls={controls}
      />
    </section>
  );
}

function SyncStatusBody({
  label,
  conflicts,
  terminal,
  incompatibleVersion,
  authRequired,
  storageFailure,
  showControls,
  controls,
}: {
  readonly label: string;
  readonly conflicts: number;
  readonly terminal: number;
  readonly incompatibleVersion: number;
  readonly authRequired: boolean;
  readonly storageFailure: boolean;
  readonly showControls: boolean;
  readonly controls: ReactNode;
}) {
  if (conflicts > 0 || terminal > 0 || incompatibleVersion > 0 || authRequired || storageFailure) {
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
      <output className="font-small text-small text-on-surface-variant" data-testid="sync-status-text">
        {label}
      </output>
      {showControls ? controls : null}
    </>
  );
}
