'use client';

import { useEffect, useRef } from 'react';
import { serverProgressPage, type ConflictView, type ProgressChoice } from '../../lib/offline/conflicts';

/**
 * Accessible, keyboard-operable conflict resolution surface (Task 12).
 *
 * It compares the user's OFFLINE edit, the authoritative SERVER record and the
 * linked CONFLICT COPY, and records an explicit decision: accept the server
 * record, keep the offline edit as its conflict copy, or retarget later edits
 * onto the copy. Progress compares the local and server resume positions and
 * requires an explicit choice — never a highest-page-wins default.
 *
 * All controls are native, focusable buttons; the current status is announced
 * through `role="status"` and failures through `role="alert"`. It uses the
 * shared warm-paper/ochre/teal design tokens (dark-mode aware) and deliberately
 * uses no emoji or remote icon font.
 */
export interface ConflictPanelProps {
  readonly conflicts: readonly ConflictView[];
  readonly onChooseServer: (conflict: ConflictView) => void;
  readonly onKeepOfflineCopy: (conflict: ConflictView) => void;
  readonly onRetarget?: (conflict: ConflictView, successorOperationIds: readonly string[]) => void;
  readonly onResolveProgress?: (conflict: ConflictView, choice: ProgressChoice) => void;
  readonly busy?: boolean;
  readonly statusMessage?: string | null;
  readonly error?: string | null;
}

function readField(value: Record<string, unknown> | null | undefined, key: string): string | null {
  const field = value?.[key];
  if (typeof field === 'string') return field;
  if (typeof field === 'number') return String(field);
  return null;
}

function conflictKindLabel(conflict: ConflictView): string {
  switch (conflict.conflictKind) {
    case 'PROGRESS':
      return 'Reading progress';
    case 'BOOKMARK':
      return 'Bookmark';
    default:
      return 'Highlight';
  }
}

function reasonLabel(conflict: ConflictView): string {
  if (conflict.reason === 'DELETE_VS_EDIT') return 'Deleted on another device, edited here';
  return 'Edited on another device since you went offline';
}

/** One labelled comparison row (offline vs server). */
function ComparisonRow({
  label,
  value,
  detail = null,
}: {
  readonly label: string;
  readonly value: string;
  readonly detail?: string | null;
}) {
  return (
    <div className="rounded-lg border border-outline-variant bg-surface px-3 py-2">
      <dt className="font-micro text-micro uppercase tracking-[0.18em] text-on-surface-variant">{label}</dt>
      <dd className="font-body text-small text-on-surface">{value}</dd>
      {detail ? <dd className="font-small text-small text-on-surface-variant">{detail}</dd> : null}
    </div>
  );
}

function ConflictCopyNote({ conflict }: { readonly conflict: ConflictView }) {
  if (!conflict.conflictCopy) return null;
  return (
    <p className="font-small text-small text-primary" data-testid="conflict-copy">
      Conflict copy preserved: {conflict.conflictCopy.text}
    </p>
  );
}

function AnnotationComparison({ conflict }: { readonly conflict: ConflictView }) {
  const offlineText = readField(conflict.offlineEdit, 'text') ?? conflict.conflictCopy?.text ?? '(no text)';
  const serverText = readField(conflict.serverValue, 'text');
  const offlineNote = readField(conflict.offlineEdit, 'note');
  const serverNote = readField(conflict.serverValue, 'note');
  return (
    <dl className="grid grid-cols-1 gap-2 sm:grid-cols-2">
      <ComparisonRow label="Your offline edit" value={offlineText} detail={offlineNote} />
      <ComparisonRow
        label="Server version"
        value={serverText ?? 'Server record unavailable'}
        detail={serverNote}
      />
    </dl>
  );
}

function ProgressComparison({ conflict }: { readonly conflict: ConflictView }) {
  const localPage = readField(conflict.offlineEdit, 'currentPage') ?? 'unknown';
  const serverPage = readField(conflict.serverValue, 'currentPage') ?? 'unknown';
  return (
    <dl className="grid grid-cols-1 gap-2 sm:grid-cols-2">
      <ComparisonRow label="Your page" value={localPage} />
      <ComparisonRow label="Server page" value={serverPage} />
    </dl>
  );
}

type ChoiceTone = 'neutral' | 'primary' | 'accent';

const TONE_CLASS: Record<ChoiceTone, string> = {
  primary: 'bg-primary text-on-primary hover:bg-primary-container hover:text-on-primary-container',
  accent: 'bg-secondary-container text-on-secondary-container hover:bg-secondary',
  neutral: 'border border-outline-variant text-on-surface hover:bg-surface-container-high',
};

function ChoiceButton({
  label,
  onClick,
  disabled,
  tone = 'neutral',
}: {
  readonly label: string;
  readonly onClick: () => void;
  readonly disabled: boolean;
  readonly tone?: ChoiceTone;
}) {
  const toneClass = TONE_CLASS[tone];
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={`inline-flex min-h-11 items-center rounded-lg px-4 font-small text-small font-semibold transition-colors disabled:opacity-50 ${toneClass}`}
    >
      {label}
    </button>
  );
}

function ProgressActions({
  conflict,
  busy,
  onResolveProgress,
}: {
  readonly conflict: ConflictView;
  readonly busy: boolean;
  readonly onResolveProgress?: (conflict: ConflictView, choice: ProgressChoice) => void;
}) {
  if (!onResolveProgress) return null;
  const serverPageKnown = serverProgressPage(conflict) !== null;
  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap gap-2">
        <ChoiceButton
          label="Resume at my page"
          tone="primary"
          disabled={busy}
          onClick={() => onResolveProgress(conflict, 'LOCAL')}
        />
        <ChoiceButton
          label="Resume at server page"
          disabled={busy || !serverPageKnown}
          onClick={() => onResolveProgress(conflict, 'SERVER')}
        />
      </div>
      {!serverPageKnown ? (
        <p role="status" aria-live="polite" className="font-small text-small text-on-surface-variant">
          The server position is not available yet; you can still resume at your page.
        </p>
      ) : null}
    </div>
  );
}

function AnnotationActions({
  conflict,
  busy,
  onChooseServer,
  onKeepOfflineCopy,
  onRetarget,
}: {
  readonly conflict: ConflictView;
  readonly busy: boolean;
  readonly onChooseServer: (conflict: ConflictView) => void;
  readonly onKeepOfflineCopy: (conflict: ConflictView) => void;
  readonly onRetarget?: (conflict: ConflictView, successorOperationIds: readonly string[]) => void;
}) {
  return (
    <div className="flex flex-wrap gap-2">
      <ChoiceButton
        label="Use server version"
        tone="primary"
        disabled={busy}
        onClick={() => onChooseServer(conflict)}
      />
      <ChoiceButton
        label="Keep my version"
        disabled={busy}
        onClick={() => onKeepOfflineCopy(conflict)}
      />
      {onRetarget && conflict.successorOperationIds.length > 0 ? (
        <ChoiceButton
          label="Retarget my later edits"
          tone="accent"
          disabled={busy}
          onClick={() => onRetarget(conflict, conflict.successorOperationIds)}
        />
      ) : null}
    </div>
  );
}

function ConflictCard({
  conflict,
  busy,
  onChooseServer,
  onKeepOfflineCopy,
  onRetarget,
  onResolveProgress,
}: {
  readonly conflict: ConflictView;
  readonly busy: boolean;
} & Pick<ConflictPanelProps, 'onChooseServer' | 'onKeepOfflineCopy' | 'onRetarget' | 'onResolveProgress'>) {
  const isProgress = conflict.conflictKind === 'PROGRESS';
  return (
    <li
      key={conflict.operationId}
      className="flex flex-col gap-3 rounded-xl border border-secondary/50 bg-surface-container-low p-4"
      data-testid={`conflict-${conflict.operationId}`}
    >
      <div>
        <h3 className="font-display text-headline-h4 text-on-surface">{conflictKindLabel(conflict)} needs a decision</h3>
        <p className="font-small text-small text-on-surface-variant">{reasonLabel(conflict)}</p>
      </div>
      {isProgress ? <ProgressComparison conflict={conflict} /> : <AnnotationComparison conflict={conflict} />}
      {!isProgress ? <ConflictCopyNote conflict={conflict} /> : null}
      {isProgress ? (
        <ProgressActions conflict={conflict} busy={busy} onResolveProgress={onResolveProgress} />
      ) : (
        <AnnotationActions
          conflict={conflict}
          busy={busy}
          onChooseServer={onChooseServer}
          onKeepOfflineCopy={onKeepOfflineCopy}
          onRetarget={onRetarget}
        />
      )}
    </li>
  );
}

export function ConflictPanel({
  conflicts,
  onChooseServer,
  onKeepOfflineCopy,
  onRetarget,
  onResolveProgress,
  busy = false,
  statusMessage = null,
  error = null,
}: ConflictPanelProps) {
  const sectionRef = useRef<HTMLElement | null>(null);
  const previousCount = useRef(conflicts.length);

  useEffect(() => {
    // When a conflict resolves, its focused control unmounts. Move focus to the
    // panel so keyboard users are not dropped back to <body>.
    if (conflicts.length < previousCount.current) {
      sectionRef.current?.focus();
    }
    previousCount.current = conflicts.length;
  }, [conflicts.length]);

  if (conflicts.length === 0 && !statusMessage && !error) return null;

  return (
    <section
      ref={sectionRef}
      tabIndex={-1}
      aria-label="Conflicts needing resolution"
      role="region"
      data-testid="conflict-panel"
      className="flex flex-col gap-3 rounded-xl border border-outline-variant bg-surface-container-low p-4"
    >
      {conflicts.length > 0 ? (
        <h2 className="font-display text-headline-h4 text-on-surface">
          {conflicts.length === 1 ? '1 conflict' : `${conflicts.length} conflicts`} need your decision
        </h2>
      ) : null}

      {statusMessage ? (
        <p role="status" aria-live="polite" className="font-small text-small text-primary" data-testid="conflict-status">
          {statusMessage}
        </p>
      ) : null}
      {error ? (
        <p role="alert" className="font-small text-small text-error" data-testid="conflict-error">
          {error}
        </p>
      ) : null}

      {conflicts.length > 0 ? (
        <ul className="flex flex-col gap-3">
          {conflicts.map((conflict) => (
            <ConflictCard
              key={conflict.operationId}
              conflict={conflict}
              busy={busy}
              onChooseServer={onChooseServer}
              onKeepOfflineCopy={onKeepOfflineCopy}
              onRetarget={onRetarget}
              onResolveProgress={onResolveProgress}
            />
          ))}
        </ul>
      ) : null}
    </section>
  );
}
