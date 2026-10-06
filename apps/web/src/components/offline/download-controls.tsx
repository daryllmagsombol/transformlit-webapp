'use client';

import type { DownloadStatus } from '../../lib/offline/contracts';

export type DownloadControlState = DownloadStatus | 'IDLE';

export interface DownloadControlsProps {
  /** Content title used in accessible labels. */
  readonly label: string;
  readonly state: DownloadControlState;
  readonly completedItems?: number;
  readonly itemCount?: number;
  readonly error?: string | null;
  /** False when rights forbid the download (e.g. undocumented translation). */
  readonly canDownload?: boolean;
  /** Shown when `canDownload` is false to explain why. */
  readonly deniedReason?: string | null;
  /** False when IndexedDB is unavailable in this browser. */
  readonly storageAvailable?: boolean;
  readonly persistenceGranted?: boolean | null;
  readonly onStart: () => void;
  readonly onRetry?: () => void;
  readonly onCancel?: () => void;
  readonly onRemove?: () => void;
}

function percent(completed: number, total: number): number {
  if (total <= 0) return 0;
  return Math.min(100, Math.round((completed / total) * 100));
}

function DownloadGlyph() {
  return (
    <svg aria-hidden="true" className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 3v12" />
      <path d="M7 10l5 5 5-5" />
      <path d="M4 21h16" />
    </svg>
  );
}

function CheckGlyph() {
  return (
    <svg aria-hidden="true" className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
      <path d="M20 6L9 17l-5-5" />
    </svg>
  );
}

function statusLabel(state: DownloadControlState): string {
  switch (state) {
    case 'STAGING':
      return 'Downloading';
    case 'VERIFYING':
      return 'Verifying';
    case 'READY':
      return 'Saved offline';
    case 'INTERRUPTED':
      return 'Download interrupted';
    case 'FAILED':
      return 'Download failed';
    case 'CANCELLED':
      return 'Download cancelled';
    default:
      return 'Not saved offline';
  }
}

export function DownloadControls({
  label,
  state,
  completedItems = 0,
  itemCount = 0,
  error = null,
  canDownload = true,
  deniedReason = null,
  storageAvailable = true,
  persistenceGranted = null,
  onStart,
  onRetry,
  onCancel,
  onRemove,
}: DownloadControlsProps) {
  const inProgress = state === 'STAGING' || state === 'VERIFYING';
  const failed = state === 'INTERRUPTED' || state === 'FAILED';
  const ready = state === 'READY';
  const disabled = !canDownload || !storageAvailable;

  function renderProgress() {
    const value = percent(completedItems, itemCount);
    return (
      <div className="w-full" data-testid="download-progress">
        <progress
          aria-label={`${label} download progress`}
          value={value}
          max={100}
          className="h-1.5 w-full overflow-hidden rounded-full bg-surface-container-high"
        />
        <p className="mt-1 font-micro text-micro text-on-surface-variant">
          {statusLabel(state)}
          {itemCount > 0 ? ` — ${completedItems} of ${itemCount}` : ''}
        </p>
      </div>
    );
  }

  function renderActions() {
    if (inProgress) {
      return (
        <button
          type="button"
          onClick={onCancel}
          className="rounded-lg border border-outline-variant px-3 py-1.5 font-display text-small font-bold text-on-surface-variant transition-colors hover:bg-surface-container-high active:scale-95"
        >
          Cancel
        </button>
      );
    }
    if (ready) {
      return (
        <button
          type="button"
          onClick={onRemove}
          className="rounded-lg border border-outline-variant px-3 py-1.5 font-display text-small font-bold text-on-surface-variant transition-colors hover:bg-surface-container-high active:scale-95"
        >
          Remove download
        </button>
      );
    }
    if (failed) {
      return (
        <div className="flex gap-2">
          <button
            type="button"
            onClick={onRetry}
            className="rounded-lg bg-brand-orange-dark px-3 py-1.5 font-display text-small font-bold text-white transition-colors hover:opacity-90 active:scale-95"
          >
            Retry
          </button>
          <button
            type="button"
            onClick={onRemove}
            className="rounded-lg border border-outline-variant px-3 py-1.5 font-display text-small font-bold text-on-surface-variant transition-colors hover:bg-surface-container-high active:scale-95"
          >
            Discard
          </button>
        </div>
      );
    }
    return (
        <button
          type="button"
          onClick={onStart}
          disabled={disabled}
          aria-label={`${label}: save offline`}
        title={disabled ? deniedReason ?? undefined : undefined}
        className="flex items-center gap-2 rounded-lg border-2 border-primary px-3 py-1.5 font-display text-small font-bold text-primary transition-colors hover:bg-primary hover:text-on-primary active:scale-95 disabled:cursor-not-allowed disabled:opacity-50"
      >
        <DownloadGlyph />
        Save offline
      </button>
    );
  }

  function renderMessages() {
    if (!storageAvailable) {
      return (
        <p className="font-micro text-micro text-error" role="note">
          Offline storage is unavailable in this browser.
        </p>
      );
    }
    if (disabled) {
      return (
        <p className="font-micro text-micro text-on-surface-variant" role="note">
          {deniedReason ?? 'Offline download is not available for this content.'}
        </p>
      );
    }
    if (failed && error?.startsWith('INSUFFICIENT_SPACE:')) {
      return (
        <p className="font-micro text-micro text-error" role="alert">
          Not enough storage space. Remove other downloads or free browser storage, then retry.
        </p>
      );
    }
    if (persistenceGranted === false) {
      return (
        <p className="font-micro text-micro text-on-surface-variant" role="note">
          Browser persistence was declined. Saved content may be cleared by the browser.
        </p>
      );
    }
    if (failed && error) {
      return (
        <p className="font-micro text-micro text-error" role="alert">
          {error}
        </p>
      );
    }
    return null;
  }

  return (
    <div className="rounded-lg border border-outline-variant bg-paper-warm p-3" data-testid="download-controls">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2 text-on-surface">
          {ready ? <CheckGlyph /> : <DownloadGlyph />}
          <span className="font-display text-small font-bold">
            {failed && error?.startsWith('INSUFFICIENT_SPACE:') ? 'Insufficient storage' : statusLabel(state)}
          </span>
        </div>
        {renderActions()}
      </div>
      {inProgress && <div className="mt-2">{renderProgress()}</div>}
      {!inProgress && <div className="mt-2">{renderMessages()}</div>}
    </div>
  );
}
