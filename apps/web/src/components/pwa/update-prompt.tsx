'use client';

interface UpdatePromptProps {
  readonly open: boolean;
  readonly onUpdate: () => void;
  readonly onLater: () => void;
}

/**
 * Accessible, non-blocking prompt shown when a new version of the app is
 * waiting to activate. Activation only happens after the user chooses
 * "Update now"; "Later" keeps running the current version.
 */
export function UpdatePrompt({ open, onUpdate, onLater }: UpdatePromptProps) {
  if (!open) return null;

  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-0 z-50 flex justify-center px-4 pb-[max(1rem,env(safe-area-inset-bottom))]">
      <section
        aria-label="Application update"
        className="pointer-events-auto w-full max-w-md rounded-2xl border border-outline-variant bg-surface-container-high p-4 text-on-surface shadow-[0_18px_50px_-24px_rgba(56,38,19,0.55)] motion-reduce:transition-none sm:p-5"
      >
        <div className="flex items-start gap-3">
          <span
            aria-hidden="true"
            className="grid size-10 shrink-0 place-items-center rounded-full bg-secondary-container text-on-secondary-container"
          >
            <svg viewBox="0 0 24 24" className="size-5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
              <path d="M20 12a8 8 0 1 1-2.34-5.66" />
              <path d="M20 4v4h-4" />
            </svg>
          </span>
          <div className="min-w-0 flex-1">
            {/* The live region holds only the announcement so screen readers do
                not re-read the action buttons when the status updates. */}
            <p role="status" aria-live="polite" className="font-display text-base font-semibold tracking-tight">
              An update is ready
            </p>
            <p className="mt-1 font-small text-sm leading-relaxed text-on-surface-variant">
              Refresh to use the newest version of Transform Lit. Your saved reading stays on this device.
            </p>
          </div>
        </div>
        <div className="mt-4 flex flex-col gap-2 sm:flex-row sm:justify-end">
          <button
            type="button"
            onClick={onLater}
            className="inline-flex min-h-11 items-center justify-center rounded-full px-5 font-small text-sm font-semibold text-primary underline decoration-primary/50 underline-offset-4 transition-colors hover:bg-surface-container-highest focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary motion-reduce:transition-none"
          >
            Later
          </button>
          <button
            type="button"
            onClick={onUpdate}
            className="inline-flex min-h-11 items-center justify-center rounded-full bg-primary px-6 font-small text-sm font-semibold text-on-primary transition-colors hover:bg-primary-container hover:text-on-primary-container focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary motion-reduce:transition-none"
          >
            Update now
          </button>
        </div>
      </section>
    </div>
  );
}
