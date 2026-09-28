# Testing `motion` (framer-motion successor) under Jest + jsdom

Measured empirically in this repo (motion 13.1.1, jsdom via jest-environment-jsdom).

## Findings
1. **`AnimatePresence` keeps the exiting node mounted.** Immediately after
   setting state so a child unmounts, `screen.queryByText(x)` is still
   non-null. Any *synchronous* `expect(...).not.toBeInTheDocument()` after a
   dismiss/close WILL FAIL once you wrap the component in `AnimatePresence`.
2. **The node does eventually unmount.** `await waitFor(() =>
   expect(screen.queryByText(x)).toBeNull())` passes with real timers.
   => Adapt assertions to `waitFor`; do NOT try to force synchronous removal.
3. **`MotionGlobalConfig` is exported from `motion/react`** but in 13.1.1 it
   has NO `skipAnimations` property (`'skipAnimations' in MotionGlobalConfig`
   is `false`). There is no supported global "instantly finish exit" switch.
4. jsdom has no layout, so `scrollIntoView` must be stubbed
   (`Element.prototype.scrollIntoView = jest.fn()`), and real scroll offsets
   can never be asserted — assert on the mock's call args instead.
5. `jest.setup.ts` already mocks `window.matchMedia` and
   `IntersectionObserver` (needed by `whileInView`).

## Practical rules
- Wrap motion components in AnimatePresence, then update existing specs from
  sync assertions to `await waitFor(...)` — do not weaken the assertion itself.
- Prefer short durations; tests that wait out exits are slow, so keep exit
  animations <= ~200ms.
- `useReducedMotion()` returns based on matchMedia; with the setup mock it is
  false, so animated paths are what tests exercise.
- Never leave throwaway `__probe*.spec.tsx` files in the repo — delete them.

## Origin
Two delegated lanes stalled/burned large effort trying to make
AnimatePresence exit assertions synchronous. The answer is `waitFor`.
