# Overlays (Modal / Sheet / Confirm) — Stacking Semantics

## Shared coordinator: `lib/hooks/use-overlay-dismiss.ts`

Module-level overlay stack used by BOTH `Modal` and `Sheet`. Solves two bugs that only
appear when overlays stack (e.g. a `ConfirmDialog` opened on top of the profile sheet):

1. **Escape closes only the topmost overlay** — previously each overlay added its own
   `document` keydown listener, so one Escape ran every handler and closed them all.
2. **Body scroll lock is reference-counted** — previously each overlay cleared
   `body.style.overflow` on close, re-enabling background scroll while an outer overlay
   was still open.

Do not re-implement Escape handling or `body.style.overflow` in a new overlay — call
`useOverlayDismiss(open, onClose)`.

## Primitives

- `components/ui/modal.tsx` — `{ open, onClose, title?, children }`. Native `<dialog>`;
  returns `null` when closed. Animated via `AnimatePresence`.
- `components/ui/sheet.tsx` — `side: 'bottom' | 'right'`. Same semantics; used by the
  Bible study panel.
- `components/ui/confirm-dialog.tsx` — built ON `Modal` (`{ open, onClose, onConfirm, title,
  message, confirmLabel?, cancelLabel?, tone?, pending? }`). `pending` blocks backdrop/Escape
  close and disables both buttons. Use this for destructive/commitment confirms.

## Invariants

- Native `<dialog>` **must carry the `open` attribute** when visible, or it computes to
  `display:none` and the overlay silently vanishes (jsdom cannot catch this). See
  `mem:bible-strongs-popup-dialog-pitfall`.
- `Modal`'s public API is depended on by `ConfirmDialog` and many screens — do not change it
  without updating consumers.
- Backdrop is a real focusable control with `aria-label="Close modal"` / `Close`.
- Keep the `data-testid="sheet-backdrop"` hook (specs click it).

## Related

- Component inventory: `mem:web/components`
- Animation tokens used here: `mem:web/motion`
