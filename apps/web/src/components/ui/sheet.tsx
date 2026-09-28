'use client';

import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import { backdrop, sheetFrom } from '../../lib/motion';
import { useOverlayDismiss } from '../../lib/hooks/use-overlay-dismiss';

interface SheetProps {
  readonly open: boolean;
  readonly onClose: () => void;
  readonly side?: 'bottom' | 'right';
  readonly title?: string;
  readonly children: React.ReactNode;
}

export function Sheet({ open, onClose, side = 'bottom', title, children }: SheetProps) {
  const reduce = useReducedMotion();
  const skip = reduce === true;
  // Stack-aware: Escape only closes the topmost overlay, and body scroll stays
  // locked until the last one closes.
  useOverlayDismiss(open, onClose);

  // NOTE: the `open` attribute is required on the native <dialog>. Without it a
  // <dialog> computes to display:none, hiding the entire sheet. jsdom does not
  // apply UA dialog styles, so unit tests cannot catch this — keep it in sync
  // with the `open` prop and guard it in sheet.spec.tsx.
  return (
    <AnimatePresence>
      {open && (
        <dialog open className="fixed inset-0 z-[80]" aria-modal="true" aria-label={title}>
          <motion.div
            data-testid="sheet-backdrop"
            className="absolute inset-0 bg-black/50 dark:bg-black/70"
            variants={backdrop}
            initial={skip ? false : 'hidden'}
            animate="visible"
            exit="exit"
            onClick={onClose}
          />
          <motion.div
            className={`absolute bg-surface dark:bg-surface-raised border border-outline-variant shadow-lift flex flex-col ${
              side === 'right'
                ? 'inset-y-0 right-0 w-full max-w-[420px] rounded-l-2xl'
                : 'inset-x-0 bottom-0 rounded-t-2xl max-h-[85dvh]'
            }`}
            variants={sheetFrom(side)}
            initial={skip ? false : 'hidden'}
            animate="visible"
            exit="exit"
          >
            {side === 'bottom' && (
              <div className="w-10 h-1 rounded-full bg-outline-variant mx-auto mt-3 shrink-0" aria-hidden />
            )}
            {title && (
              <div className="flex items-center justify-between px-5 pt-4 pb-2 shrink-0">
                <h2 className="font-display text-headline-h3 text-on-surface">{title}</h2>
                <button
                  onClick={onClose}
                  className="text-ink-soft hover:text-ink p-2 -mr-2"
                  aria-label="Close"
                >
                  ✕
                </button>
              </div>
            )}
            <div className="overflow-y-auto px-5 pb-6">{children}</div>
          </motion.div>
        </dialog>
      )}
    </AnimatePresence>
  );
}
