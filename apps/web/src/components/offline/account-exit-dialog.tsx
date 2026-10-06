'use client';

import { useEffect, useId, useRef, useState } from 'react';
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
  /**
   * `recovery` renders the informed escape for a durable barrier whose remote
   * session invalidation could not be confirmed: the user can reset this
   * device's session (discarding the previous account's local data) so they are
   * not permanently blocked from signing in.
   */
  readonly mode?: 'exit' | 'recovery';
  /** Confirmed reset of this device's blocked session (recovery mode). */
  readonly onResetDevice?: () => void;
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
  mode = 'exit',
  onResetDevice,
}: AccountExitDialogProps) {
  const headingId = useId();
  const confirmId = useId();
  const [confirmed, setConfirmed] = useState(false);
  const dialogRef = useRef<HTMLDialogElement | null>(null);
  const restoreFocusRef = useRef<HTMLElement | null>(null);

  // A fresh confirmation is required each time the dialog opens.
  useEffect(() => {
    if (!open) setConfirmed(false);
  }, [open]);

  // Open as a MODAL native dialog (focus trap + Escape handled by the platform),
  // falling back to the `open` attribute where showModal is unavailable. Focus
  // returns to the element that opened it when the dialog closes.
  useEffect(() => {
    if (!open) return;
    restoreFocusRef.current = (document.activeElement as HTMLElement | null) ?? null;
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (typeof dialog.showModal === 'function' && !dialog.open) {
      dialog.showModal();
    } else {
      dialog.setAttribute('open', '');
    }
    return () => {
      restoreFocusRef.current?.focus?.();
    };
  }, [open]);

  // Escape closes the dialog. The native modal already emits `cancel` in a real
  // browser; this scoped document-level listener additionally covers
  // environments (e.g. jsdom) where that event is not synthesized, without
  // putting a keyboard listener on a non-interactive element. It mirrors the
  // previous dialog-scoped handler: only keydowns inside the dialog count, and
  // `preventDefault` suppresses the duplicate native `cancel` event.
  useEffect(() => {
    if (!open) return;
    const handler = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      if (!dialogRef.current?.contains(event.target as Node)) return;
      event.preventDefault();
      onCancel();
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [open, onCancel]);

  if (!open) return null;

  const hasWork = !work.fullyDrained;
  const recovery = mode === 'recovery';

  let description = 'Your account data on this device will be cleared.';
  if (recovery) {
    description =
      'This device could not confirm your previous session ended, so signing in is blocked. Resetting this device signs you out and permanently discards the previous account’s saved data here.';
  } else if (hasWork) {
    description = 'Some changes have not synced yet.';
  }

  return (
    <dialog
      ref={dialogRef}
      aria-labelledby={headingId}
      aria-busy={busy}
      onCancel={onCancel}
      data-testid="account-exit-dialog"
      className="w-[calc(100%-2rem)] max-w-md rounded-xl border border-outline-variant bg-surface p-5 text-on-surface shadow-lg backdrop:bg-black/40"
    >
      <div>
        <h2 id={headingId} className="font-display text-headline-h4 text-on-surface">
          {recovery ? 'Session could not be confirmed' : 'Sign out'}
        </h2>
        <p className="mt-1 font-body text-small text-on-surface-variant">{description}</p>

        {recovery ? null : (
          <div className="mt-3 rounded-lg border border-outline-variant bg-surface-container-low p-3">
            <WorkSummary work={work} />
          </div>
        )}

        {error ? (
          <p role="alert" className="mt-3 font-small text-small text-error">
            {error}
          </p>
        ) : null}

        {(recovery || hasWork) ? (
          <div className="mt-3 flex items-start gap-2">
            <input
              id={confirmId}
              type="checkbox"
              checked={confirmed}
              disabled={busy}
              onChange={(event) => setConfirmed(event.target.checked)}
              className="mt-1"
            />
            <label htmlFor={confirmId} className="font-small text-small text-on-surface">
              {recovery
                ? 'I understand this permanently discards the previous account’s data on this device and cannot be recovered.'
                : 'I understand these changes will be permanently discarded and cannot be recovered.'}
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
          {!recovery && hasWork ? (
            <button
              type="button"
              onClick={onSync}
              disabled={busy}
              className="inline-flex min-h-11 items-center rounded-lg bg-primary px-4 font-small text-small font-semibold text-on-primary disabled:opacity-50"
            >
              Sync now
            </button>
          ) : null}
          {recovery ? (
            <button
              type="button"
              onClick={onResetDevice}
              disabled={busy || !confirmed}
              className="inline-flex min-h-11 items-center rounded-lg border border-error px-4 font-small text-small font-semibold text-error disabled:opacity-50"
            >
              Reset this device’s session
            </button>
          ) : (
            <button
              type="button"
              onClick={onConfirmDiscard}
              disabled={busy || (hasWork && !confirmed)}
              className="inline-flex min-h-11 items-center rounded-lg border border-error px-4 font-small text-small font-semibold text-error disabled:opacity-50"
            >
              Discard and sign out
            </button>
          )}
        </div>
      </div>
    </dialog>
  );
}
