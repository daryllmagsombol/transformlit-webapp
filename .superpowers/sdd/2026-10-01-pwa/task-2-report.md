# Task 2 — Public offline entry and install metadata

## Status

Implemented the static `/offline` entry, install metadata, PWA/Apple artwork, worker response policy, and verified standalone asset packaging. No service worker is implemented or registered. `/offline` remains outside authenticated route groups and uses only the generic client shell.

## Red / green evidence

- **RED:** Before creating `offline-client.tsx`, ran the requested focused Jest command. It failed because `./offline-client` did not exist, confirming the new component tests could not pass without implementation.
- **GREEN:** After implementation and correcting assertions that matched deliberate generic explanatory copy, reran the same command: **1 suite passed, 4 tests passed**. Coverage includes generic/non-personalized copy, online/offline status changes, native install prompt handling, and browser-menu fallback guidance.
- An intermediate test run after implementation caught two test expectation issues: the “no account content” pattern treated the explicit generic “saved books” disclaimer as account data, and an assertion expected install guidance duplicated in a screen-reader-only node. The account-data assertion now checks for personalized greetings/shelf copy; the redundant live region was removed.

## Verification

- `pnpm --filter @transformlit/web test --runInBand --runTestsByPath src/app/offline/offline-client.spec.tsx` — passed (4/4).
- `pnpm --filter @transformlit/web typecheck` — passed.
- `pnpm --filter @transformlit/web build` — passed with Next.js 16.3.6; `/offline` and `/manifest.webmanifest` were emitted as static routes.
- Inspected the generated manifest at `apps/web/.next/server/app/manifest.webmanifest.body`: same-origin `/offline` start URL, `/` scope, standalone display, and all three declared PWA icons including the maskable purpose.
- Inspected the actual standalone output: server entry is `apps/web/.next/standalone/apps/web/server.js`; its generated startup code changes directory to its own folder. The Docker runtime copies that standalone tree plus `apps/web/public` and `apps/web/.next/static`, then starts `node apps/web/server.js`.
- Confirmed image dimensions with `sips`: PWA icons are 192×192 and 512×512, maskable icon is 512×512, and Apple touch icon is 180×180. Reviewed the maskable image; the book mark stays within the central safe area.
- `git diff --check` — passed.

## Runtime and visual limitations

- Docker/container acceptance was **not run**: `docker --version` reports `zsh: command not found: docker`. The Docker build command in the brief therefore remains blocked by the environment.
- Playwright/browser runtime and screenshot comparison were not run. The repo's configured E2E web servers are the Docker-backed API/web harness, unavailable in this environment. The new `apps/web/e2e/pwa-install.spec.ts` is in place for that harness; runtime response headers and rendered responsive/dark-theme appearance remain to be verified there.
- Artwork was produced from the existing warm-paper/ochre/teal brand direction without adding dependencies; no existing PWA icon artwork was present.

## Scope notes

- The install prompt is used only when the browser raises `beforeinstallprompt`; otherwise the page directs the user to the browser's Add to Home Screen menu.
- No per-user data, authenticated providers, chat/profile shell, offline downloads, reader selection state, worker implementation, or worker registration was added.
