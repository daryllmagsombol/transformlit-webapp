'use client';

import { useEffect, useId, useState } from 'react';
import type { ExitWorkSummary } from '../../lib/offline/account-exit';

/**
 * Informed sign-out / account-switch confirmation. It NAMES the exact
 * unresolved work that would be discarded (pending, in-flight/uncertain,
 * blocked successors, unresolved conflicts, local-only records) and requires an
 * explicit checkbox before the destructive action is enabled, so no one can
 * silently discard offline edits. All controls are native, focusable buttons.
 */
export interface AccountExitDialogProps {
  readonly open: boolean;
  readonly work: ExitWorkSummary;
  readonly busy?: boolean;
  /** Runs a bounded foreground drain, then re-reads `work`. */
  readonly onSync: () => void;
  /** Confirmed discard of the named work + sign out. */
  readonly onConfirmDiscard: () => void;
  readonly onCancel: () => void;
  readonly error?: string | null;
}

interface WorkLine {
  readonly count: number;
  readonly singular: string;
  readonly plural: string;
}

function workLines(work: ExitWorkSummary): WorkLine[] {
  return [
    { count: work.pending, singular: 'waiting to sync', plural: 'waiting to sync' },
    { count: work.inFlightOrUncertain, singular: 'in flight', plural: 'in flight' },
    { count: work.blockedSuccessors, singular: 'blocked', plural: 'blocked' },
    { count: work.conflicts, singular: 'conflict', plural: 'conflicts' },
    { count: work.localOnly, singular: 'saved only on this device', plural: 'saved only on this device' },
  ];
}

function WorkSummary({ work }: { readonly work: ExitWorkSummary }) {
  const lines = workLines(work).filter((line) => line.count > 0);
  if (lines.length === 0) {
    return <p className="font-body text-small text-on-surface">Everything is synced. You can sign out safely.</p>;
  }
  return (
    <ul className="flex flex-col gap-1">
      {lines.map((line) => (
        <li key={line.plural} className="font-body text-small text-on-surface">
          {line.count === 1 ? `1 ${line.singular}` : `${line.count} ${line.plural}`}
        </li>
      ))}
    </ul>
  );
}

export function AccountExitDialog({
  open,
  work,
  busy = false,
  onSync,
  onConfirmDiscard,
  onCancel,
  error = null,
}: AccountExitDialogProps) {
  const headingId = useId();
  const confirmId = useId();
  const [confirmed, setConfirmed] = useState(false);

  // A fresh confirmation is required each time the dialog opens.
  useEffect(() => {
    if (!open) setConfirmed(false);
  }, [open]);

  if (!open) return null;

  const hasWork = !work.fullyDrained;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <section
        role="dialog"
        aria-modal="true"
        aria-labelledby={headingId}
        aria-busy={busy}
        data-testid="account-exit-dialog"
        className="w-full max-w-md rounded-xl border border-outline-variant bg-surface p-5 shadow-lg"
      >
        <h2 id={headingId} className="font-display text-headline-h4 text-on-surface">
          Sign out
        </h2>
        <p className="mt-1 font-body text-small text-on-surface-variant">
          {hasWork
            ? 'Some changes have not synced yet.'
            : 'Your account data on this device will be cleared.'}
        </p>

        <div className="mt-3 rounded-lg border border-outline-variant bg-surface-container-low p-3">
          <WorkSummary work={work} />
        </div>

        {error ? (
          <p role="alert" className="mt-3 font-small text-small text-error">
            {error}
          </p>
        ) : null}

        {hasWork ? (
          <div className="mt-3 flex items-start gap-2">
            <input
              id={confirmId}
              type="checkbox"
              checked={confirmed}
              onChange={(event) => setConfirmed(event.target.checked)}
              className="mt-1"
            />
            <label htmlFor={confirmId} className="font-small text-small text-on-surface">
              I understand these changes will be permanently discarded and cannot be recovered.
            </label>
          </div>
        ) : null}

        <div className="mt-4 flex flex-wrap justify-end gap-2">
          <button
            type="button"
            onClick={onCancel}
            className="inline-flex min-h-11 items-center rounded-lg border border-outline-variant px-4 font-small text-small font-semibold text-on-surface-variant"
          >
            Cancel
          </button>
          {hasWork ? (
            <button
              type="button"
              onClick={onSync}
              disabled={busy}
              className="inline-flex min-h-11 items-center rounded-lg bg-primary px-4 font-small text-small font-semibold text-on-primary disabled:opacity-50"
            >
              Sync now
            </button>
          ) : null}
          <button
            type="button"
            onClick={onConfirmDiscard}
            disabled={busy || (hasWork && !confirmed)}
            className="inline-flex min-h-11 items-center rounded-lg border border-error px-4 font-small text-small font-semibold text-error disabled:opacity-50"
          >
            Discard and sign out
          </button>
        </div>
      </section>
    </div>
  );
}
