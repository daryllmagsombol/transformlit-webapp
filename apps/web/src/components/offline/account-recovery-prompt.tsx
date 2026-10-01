'use client';

import { useCallback, useEffect, useState } from 'react';
import { AccountExitDialog } from './account-exit-dialog';
import {
  EMPTY_EXIT_WORK,
  abandonDeferredLogout,
  accountActivationEligible,
} from '../../lib/offline/account-exit';

/**
 * User-reachable recovery for a durable barrier whose remote session could not
 * be confirmed (e.g. a failed/timed-out logout followed by cookie expiry).
 * Without this, a genuinely cookie-less profile is permanently blocked from
 * signing in. It checks activation eligibility on mount and, when blocked,
 * offers the informed `AccountExitDialog` recovery escape that calls
 * `abandonDeferredLogout()` only after explicit confirmation.
 */
export function AccountRecoveryPrompt() {
  const [blocked, setBlocked] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    accountActivationEligible()
      .then((eligible) => {
        if (!cancelled) setBlocked(!eligible);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, []);

  const reset = useCallback(() => {
    setBusy(true);
    setError(null);
    abandonDeferredLogout()
      .then(() => accountActivationEligible())
      .then((eligible) => {
        setBlocked(!eligible);
      })
      .catch(() => {
        setError('Could not reset this device. Please try again.');
      })
      .finally(() => {
        setBusy(false);
      });
  }, []);

  const dismiss = useCallback(() => {
    setBlocked(false);
    setError(null);
  }, []);

  return (
    <AccountExitDialog
      open={blocked}
      mode="recovery"
      work={EMPTY_EXIT_WORK}
      busy={busy}
      error={error}
      onSync={() => undefined}
      onConfirmDiscard={() => undefined}
      onCancel={dismiss}
      onResetDevice={reset}
    />
  );
}
