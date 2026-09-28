'use client';

import { useCallback, useEffect, useId, useRef } from 'react';
import { Modal } from './modal';

export interface ConfirmDialogProps {
  readonly open: boolean;
  readonly onClose: () => void;
  readonly onConfirm: () => void | Promise<void>;
  readonly title: string;
  readonly message: string;
  readonly confirmLabel?: string;
  readonly cancelLabel?: string;
  readonly tone?: 'default' | 'danger';
  readonly pending?: boolean;
}

const NEUTRAL_BUTTON_CLASS =
  'px-4 py-2 bg-surface-container-highest text-on-surface-variant rounded-lg font-small font-bold hover:bg-outline-variant/20 transition-all disabled:opacity-50 disabled:cursor-not-allowed';

const DANGER_BUTTON_CLASS =
  'px-4 py-2 bg-error text-on-error rounded-lg font-small font-bold hover:opacity-90 transition-all disabled:opacity-50 disabled:cursor-not-allowed';

const DEFAULT_BUTTON_CLASS =
  'px-4 py-2 bg-primary text-on-primary rounded-lg font-small font-bold hover:opacity-90 transition-all disabled:opacity-50 disabled:cursor-not-allowed';

/**
 * Accessible confirmation dialog built on top of the shared `Modal` primitive.
 * Focus, Escape, backdrop and body scroll-lock behaviour all come from `Modal`;
 * this component only adds the confirm/cancel affordances and wires the
 * accessible name/description onto the underlying dialog element.
 */
export function ConfirmDialog({
  open,
  onClose,
  onConfirm,
  title,
  message,
  confirmLabel = 'Confirm',
  cancelLabel = 'Cancel',
  tone = 'default',
  pending = false,
}: ConfirmDialogProps) {
  const titleId = useId();
  const descriptionId = useId();
  const contentRef = useRef<HTMLDivElement>(null);

  const handleClose = useCallback(() => {
    if (pending) return;
    onClose();
  }, [pending, onClose]);

  const handleConfirm = useCallback(() => {
    Promise.resolve(onConfirm()).catch(() => undefined);
  }, [onConfirm]);

  useEffect(() => {
    if (!open) return;
    const dialog = contentRef.current?.closest('dialog');
    const heading = dialog?.querySelector('h2') ?? null;
    if (!dialog) return;

    dialog.setAttribute('aria-describedby', descriptionId);
    if (heading) {
      heading.id = titleId;
      dialog.setAttribute('aria-labelledby', titleId);
    } else {
      dialog.setAttribute('aria-label', title);
    }

    return () => {
      dialog.removeAttribute('aria-describedby');
      dialog.removeAttribute('aria-labelledby');
      dialog.removeAttribute('aria-label');
      heading?.removeAttribute('id');
    };
  }, [open, title, titleId, descriptionId]);

  const confirmButtonClass = tone === 'danger' ? DANGER_BUTTON_CLASS : DEFAULT_BUTTON_CLASS;
  const confirmText = pending ? `${confirmLabel}…` : confirmLabel;

  return (
    <Modal open={open} onClose={handleClose} title={title}>
      <div ref={contentRef}>
        <p id={descriptionId} className="font-body text-body text-on-surface mb-6">
          {message}
        </p>
        <div className="flex gap-3 justify-end">
          <button
            type="button"
            onClick={handleClose}
            disabled={pending}
            className={NEUTRAL_BUTTON_CLASS}
          >
            {cancelLabel}
          </button>
          <button
            type="button"
            onClick={handleConfirm}
            disabled={pending}
            className={confirmButtonClass}
          >
            {confirmText}
          </button>
        </div>
      </div>
    </Modal>
  );
}
