'use client';

import { useEffect } from 'react';
import { AnimatePresence, motion } from 'motion/react';

interface SheetProps {
  readonly open: boolean;
  readonly onClose: () => void;
  readonly side?: 'bottom' | 'right';
  readonly title?: string;
  readonly children: React.ReactNode;
}

export function Sheet({ open, onClose, side = 'bottom', title, children }: SheetProps) {
  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', handler);
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', handler);
      document.body.style.overflow = '';
    };
  }, [open, onClose]);

  return (
    <AnimatePresence>
      {open && (
        <dialog className="fixed inset-0 z-[80]" aria-modal="true" aria-label={title}>
          <motion.div
            data-testid="sheet-backdrop"
            className="absolute inset-0 bg-black/50 dark:bg-black/70"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={onClose}
          />
          <motion.div
            className={`absolute bg-surface dark:bg-surface-raised border border-outline-variant shadow-lift flex flex-col ${
              side === 'right'
                ? 'inset-y-0 right-0 w-full max-w-[420px] rounded-l-2xl'
                : 'inset-x-0 bottom-0 rounded-t-2xl max-h-[85dvh]'
            }`}
            initial={side === 'right' ? { x: '100%' } : { y: '100%' }}
            animate={side === 'right' ? { x: 0 } : { y: 0 }}
            exit={side === 'right' ? { x: '100%' } : { y: '100%' }}
            transition={{ type: 'tween', duration: 0.25, ease: 'easeOut' }}
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
