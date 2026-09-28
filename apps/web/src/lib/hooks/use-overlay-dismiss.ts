'use client';

import { useEffect, useId } from 'react';

/**
 * Shared overlay coordination for stacked dialogs/sheets.
 *
 * Two problems this solves, both of which only appear when overlays stack
 * (e.g. a ConfirmDialog opened on top of the profile sheet):
 *
 * 1. Escape closing every open overlay at once. Each overlay used to add its
 *    own `document` keydown listener, so one Escape press ran every handler.
 *    Only the TOPMOST overlay should respond.
 * 2. Body scroll lock being released early. Each overlay set
 *    `body.style.overflow` and cleared it on close, so closing an inner dialog
 *    re-enabled background scrolling while the outer overlay was still open.
 *
 * The stack is module-level on purpose: it must be shared by every overlay
 * instance regardless of where it sits in the React tree.
 */

const overlayStack: string[] = [];
let scrollLockCount = 0;

function pushOverlay(id: string): void {
  const existing = overlayStack.indexOf(id);
  if (existing !== -1) overlayStack.splice(existing, 1);
  overlayStack.push(id);
}

function removeOverlay(id: string): void {
  const existing = overlayStack.indexOf(id);
  if (existing !== -1) overlayStack.splice(existing, 1);
}

function isTopOverlay(id: string): boolean {
  return overlayStack.length > 0 && overlayStack[overlayStack.length - 1] === id;
}

function lockBodyScroll(): void {
  scrollLockCount += 1;
  document.body.style.overflow = 'hidden';
}

function unlockBodyScroll(): void {
  scrollLockCount = Math.max(0, scrollLockCount - 1);
  if (scrollLockCount === 0) {
    document.body.style.overflow = '';
  }
}

/**
 * Registers an overlay while `open`, closing it on Escape only when it is the
 * topmost overlay, and holds the body scroll lock until the last overlay closes.
 * Pair with `AnimatePresence` for exit animation.
 */
export function useOverlayDismiss(open: boolean, onClose: () => void): void {
  const id = useId();

  useEffect(() => {
    if (!open) return;
    pushOverlay(id);
    lockBodyScroll();
    return () => {
      removeOverlay(id);
      unlockBodyScroll();
    };
  }, [open, id]);

  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && isTopOverlay(id)) onClose();
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [open, id, onClose]);
}
