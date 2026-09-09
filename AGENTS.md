# Transformlit — Agent Guidelines

Project-specific rules for AI coding agents. These supplement the global AGENTS.md with conventions learned from SonarQube audits and codebase patterns.

## SonarQube Compliance

All code MUST pass SonarQube quality gate. See `docs/SONAR-GUIDELINES.md` for the full rule set. Key non-negotiable rules:

- **No `window` references** — use `globalThis.window` or `globalThis` (S6653)
- **No array index in React keys** — use stable unique IDs (S6479)
- **No empty methods** — implement or remove (S1186)
- **No unused imports** — remove immediately (S1128, S1440)
- **Mark constructor params `readonly`** when never reassigned (S6643)
- **Use `String.raw`** for regex patterns with backslashes (S6650)
- **Use `node:crypto`** over bare `crypto` import (S2208)
- **Use `export…from`** for re-exports (S6632)
- **Use `String#replaceAll()`** over `String#replace()` for global replacement (S6657)
- **Use `String.fromCodePoint()`** over `String.fromCharCode()` (S6660)
- **Use optional chains** (`?.`, `??`) over explicit null checks (S6606, S6647)
- **No nested ternary operations** — extract to independent statements (S6644)
- **No `void` operator** in expressions (S6659)
- **No `await` on non-Promise values** (S6648)
- **Default parameters must be last** (S6651)
- **Cognitive complexity ≤ 15** per function (S6652)
- **No nested template literals** (S6654)
- **No nested functions > 4 levels** (S6655)
- **Promise rejection reasons must be `Error` instances** (S6661)
- **Use `??=`** over assignment with nullish check (S6662)
- **No negated conditions** where positive reads better (S6663)
- **No duplicate CSS selectors** (S6664)
- **No deprecated APIs** — Zod `.email()`, `.url()`, `.uuid()`, `.datetime()`, `.cuid()`, `.cuid2()`, `.ulid()`, `.ip()`, `.date()`, `.time()`, `.duration()`, `.emoji()`, `.base64()`, `.cidr()`, `.trim()`, `.toLowerCase()`, `.toUpperCase()`, `.nonempty()`, `.min()`, `.max()`, `.length()`, `.regex()`, `.startsWith()`, `.endsWith()`, `.datetime()` with string arg; Apollo `createHttpLink`, `split`, `setContext`, `onError`, `query`, `mutate` legacy signatures; React `FormEvent`; `MockedResponse` (S6665–S6690)

## Accessibility (S6700–S6710)

- **Use semantic HTML** — `<nav>` not `role="navigation"`, `<dialog>` not `role="dialog"`, `<hr>` not `role="separator"`, `<button>` not `role="button"`, `<input type="button">` not `role="button"`
- **Interactive elements need keyboard support** — `onClick` on non-interactive elements requires `onKeyDown` or `onKeyUp`
- **Form labels must be associated** — use `htmlFor`/`id` pairing
- **Media elements need `<track>`** — `<audio>` and `<video>` require captions track
- **Clickable non-native elements need `role`** + tab/keyboard/mouse/touch support

## React Patterns (S6720–S6730)

- **Props must be read-only** — mark component props as `readonly` (S6643)
- **No array index in keys** — use stable unique IDs (S6479)
- **No useless variable assignments** — remove unused vars and redundant assignments (S6477, S6478)
- **Context provider values must be stable** — wrap in `useMemo` if object literal (S6480)
- **No setter with matching state** — don't use state variable in its own setter (S6481)

## Code Organization

- **Re-export with `export…from`** — don't re-export via intermediate variable
- **Default params last** — put parameters with defaults after required params
- **No duplicate selectors** — consolidate CSS rules
- **No nested template literals** — extract to variables
- **Cognitive complexity ≤ 15** — extract helper functions

## Security

- **No `window` direct reference** — always `globalThis.window` for SSR safety
- **No unused imports** — they bloat bundles and confuse tree-shaking
- **No empty methods** — they hide missing implementation
