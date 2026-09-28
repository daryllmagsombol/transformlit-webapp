'use client';

import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import { backdrop, scaleIn } from '../../lib/motion';
import { useOverlayDismiss } from '../../lib/hooks/use-overlay-dismiss';

interface ModalProps {
  readonly open: boolean;
  readonly onClose: () => void;
  readonly title?: string;
  readonly children: React.ReactNode;
}

export function Modal({ open, onClose, title, children }: ModalProps) {
  const reduce = useReducedMotion();
  // Stack-aware: Escape only closes the topmost overlay, and body scroll stays
  // locked until the last one closes.
  useOverlayDismiss(open, onClose);

  const skip = reduce === true;

  return (
    <AnimatePresence>
      {open && (
        <dialog
          className="fixed inset-0 z-[80] flex items-center justify-center"
          aria-modal="true"
          open
        >
          <motion.button
            type="button"
            className="absolute inset-0 bg-black/50 dark:bg-black/70 cursor-default"
            variants={backdrop}
            initial={skip ? false : 'hidden'}
            animate="visible"
            exit="exit"
            onClick={onClose}
            aria-label="Close modal"
          />
          <motion.div
            className="relative bg-surface border border-outline-variant rounded-xl shadow-lg max-w-lg w-full mx-4 max-h-[90dvh] overflow-y-auto p-6"
            variants={scaleIn}
            initial={skip ? false : 'hidden'}
            animate="visible"
            exit="exit"
          >
            {title && (
              <div className="flex items-center justify-between mb-4">
                <h2 className="text-h4 font-semibold">{title}</h2>
                <button
                  onClick={onClose}
                  className="text-ink-soft hover:text-ink p-2 -mr-2"
                  aria-label="Close"
                >
                  ✕
                </button>
              </div>
            )}
            {children}
          </motion.div>
        </dialog>
      )}
    </AnimatePresence>
  );
}
