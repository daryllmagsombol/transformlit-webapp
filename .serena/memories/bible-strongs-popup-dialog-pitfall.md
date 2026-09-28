# Native `<dialog>` pitfall (apps/web)

## The bug (fixed 2026-09-23)
`components/ui/sheet.tsx` rendered a native `<dialog>` **without** the `open`
attribute. A native `<dialog>` without `open` computes to `display: none`,
so the whole sheet never painted. This silently broke Bible **word study
(Strong's) popup**, footnotes, and cross-references — `StudySheet` is the only
`Sheet` consumer.

## Why tests missed it
jsdom does NOT apply user-agent styles to `<dialog>`, so
`queryByText(...)` still finds the children and tests pass. **Unit tests cannot
detect this class of bug.** Guard the attribute explicitly:
`expect(container.querySelector('dialog')).toHaveAttribute('open')`.

## Origin
Commit `845b26f` ("resolve 319 SonarQube issues") replaced
`<div role="dialog">` with `<dialog>` (SonarQube prefers semantic HTML) but
dropped `open`. `modal.tsx` kept `open`; `sheet.tsx` did not.

## Rules
- Any native `<dialog>` in this repo MUST carry `open` when it should be
  visible. `Modal` returns `null` when closed; `Sheet` mounts conditionally.
- Verify dialog/overlay changes in a real browser, not only jsdom
  (`pnpm --filter @transformlit/web exec playwright test`), because
  computed-style/UA-default bugs are invisible to Jest.
- SonarQube semantic-HTML "fixes" must preserve the functional attributes
  those elements require.

## Related
- `components/ui/modal.tsx`, `components/ui/sheet.tsx`,
  `components/ui/confirm-dialog.tsx` (built on Modal).
- Escape handling is a `document` keydown listener in each of Modal/Sheet, so
  two stacked overlays both close on Escape (known minor issue).
