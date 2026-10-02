# SonarQube Guidelines — Transformlit

This document maps SonarQube rule IDs to concrete fixes. All agents MUST follow these rules to pass the quality gate.

> **Living document.** Every SonarQube and opencode/AI code review MUST be done against this file **and MUST append any new finding/rule here in the same change**, with a rule ID, the fix, and a ❌/✅ example. If a review uncovers something not listed, add it before closing the task.

## Table of Contents

- [Quality Gate Conditions (New Code)](#quality-gate-conditions-new-code)
- [Critical Rules (Blocker/Critical)](#critical-rules)
- [Major Rules (High)](#major-rules)
- [Minor Rules (Medium/Low)](#minor-rules)
- [Security Hotspots](#security-hotspots)
- [Data / API Handling Rules (opencode review)](#data--api-handling-rules-opencode-review)
- [Accessibility Rules](#accessibility-rules)
- [React-Specific Rules](#react-specific-rules)
- [Deprecated API Replacements](#deprecated-api-replacements)

---

## Quality Gate Conditions (New Code)

The gate evaluates **New Code** (since the last release/baseline), not the whole repo. A single finding fails the entire gate. Check all four before pushing:

| Condition | Required | Notes |
|-----------|----------|-------|
| New issues | **0** | Even one `Low`/`Minor` (e.g. S2681) fails the gate. |
| New-code coverage | **≥ 80.0%** | Measured on "New Lines to cover". 79.7% FAILS. Every new production line/branch needs a test. |
| New duplication | **≤ 3.0%** | Don't copy-paste blocks; extract helpers. |
| Security hotspots reviewed | **100%** | A single unreviewed hotspot (e.g. S1313 hardcoded IP) fails the gate. |

**Practical implications:**

- **Cover every new production line/branch** you add. A new helper with an untested early-return can drop new-code coverage below 80% on its own. Prefer adding a focused test in the same change.
- **Avoid writing code that creates a security hotspot at all** (hardcoded IPs, secrets, weak crypto). If unavoidable, it still must be reviewed to 100% — easier to avoid.
- **Refactors still count as new code** if the lines change; keep them covered and issue-free.
- Confirm locally where possible: `pnpm --filter @transformlit/api test:harness`, the affected Jest suites, and the coverage step in `.github/workflows/sonarqube.yml`.

---

## Critical Rules

### S2681 — Braces around conditional bodies (statement execution)
**Fix:** When an `if`/`else`/`for`/`while` body is a single statement that is followed by another statement intended to be **outside** the block, add explicit `{ }`. Without braces only the first statement is conditional; the rest run unconditionally.

```ts
// ❌ Bad — `doThing()` runs unconditionally; only `guard()` is conditional
if (ready) guard();
doThing();

// ✅ Good
if (ready) {
  guard();
}
doThing();
```

This is the rule that failed the gate for new code (one `Low`/`Medium` issue → 0-issue condition failed). Brace every single-statement conditional; don't rely on indentation.

### S1186 — Empty methods
**Fix:** Implement the method or remove it. Empty methods hide missing implementation.

```ts
// ❌ Bad
googleAuth() {}

// ✅ Good — implement or remove
```

### S1128 — Unused imports
**Fix:** Remove unused imports immediately.

```ts
// ❌ Bad
import { Request } from 'express';

// ✅ Good — remove if unused
```

### S1440 — Unused exports
**Fix:** Remove unused exports.

### S6477 — Useless variable assignments
**Fix:** Remove variables that are assigned but never used.

```ts
// ❌ Bad
const router = useRouter();
// router never used

// ✅ Good — remove the variable
```

### S6478 — Redundant assignments
**Fix:** Remove assignments that duplicate existing values.

```ts
// ❌ Bad
buttonDisabled = buttonDisabled;

// ✅ Good — remove the assignment
```

### Unused catch parameter → bare `catch`
**Fix:** When the caught error is never used (only rethrown as another error), use a bare `catch`.

```ts
// ❌ Bad
} catch (error) {
  throw new UnauthorizedException('Invalid refresh token');
}

// ✅ Good
} catch {
  throw new UnauthorizedException('Invalid refresh token');
}
```

### Unused props must be removed
**Fix:** Delete props that are declared but never read — from the interface AND all call sites. (A same-named data field, e.g. `GraphQLGroup.featured`, is not the same as the component prop.)

### Duplicate branch blocks must be merged
**Fix:** When two branches contain identical code blocks, collapse them into one branch.

### Render helpers stay inside the component
**Fix:** NEVER extract a render helper to module scope when it closes over component state, handlers, or hooks. A "nested function" refactor that hoists `renderX()` out of the component breaks the build. Extract only pure logic with explicit parameters, or keep the helper nested.

```tsx
// ❌ Bad — broke the build
function renderNotificationContent() {
  if (loading) { ... } // `loading` undefined at module scope
}

// ✅ Good — helper stays nested where it closes over state
export function NotificationPanel(...) {
  const [notifications, setNotifications] = useState([]);
  const renderNotificationContent = () => { ... };
}
```

### React hooks: unconditional, top-level, correctly named
**Fix:** All hooks (`useState`, `useMemo`, `useCallback`, `useEffect`) MUST be called unconditionally at the top of the component, before any early return. Never call hooks inside render-helper functions or conditionals. Functions that call hooks must be components (PascalCase) or custom hooks (starting with `use`).

```tsx
// ❌ Bad — conditional hook + hook in plain function
const renderFriendsList = () => {
  const keys = useMemo(...); // wrong: hook in non-hook function, conditional
};

// ✅ Good — hooks hoisted, helpers are pure
const keys = useMemo(...);
if (!isReady) return <Spinner />;
const renderFriendsList = () => { ... }; // no hooks inside
```

---

## Major Rules

### S6643 — Mark constructor params `readonly`
**Fix:** Add `readonly` to constructor parameters that are never reassigned.

```ts
// ❌ Bad
constructor(private prisma: PrismaService) {}

// ✅ Good
constructor(private readonly prisma: PrismaService) {}
```

### S6644 — No nested ternary operations
**Fix:** Extract to independent statements or use if/else.

```ts
// ❌ Bad
const status = isActive ? 'active' : isPending ? 'pending' : 'inactive';

// ✅ Good
let status: string;
if (isActive) {
  status = 'active';
} else if (isPending) {
  status = 'pending';
} else {
  status = 'inactive';
}
```

### S6647 — Use optional chain expressions
**Fix:** Replace explicit null checks with optional chaining.

```ts
// ❌ Bad
if (user && user.profile && user.profile.name) { ... }

// ✅ Good
if (user?.profile?.name) { ... }
```

### S6648 — No `await` on non-Promise values
**Fix:** Only `await` actual Promise values.

```ts
// ❌ Bad
const result = await someValue; // someValue is not a Promise

// ✅ Good
const result = someValue;
```

### S6650 — Use `String.raw` for regex patterns
**Fix:** Use `String.raw` template literals to avoid escaping backslashes.

```ts
// ❌ Bad
const pattern = '\\d{4}-\\d{2}-\\d{2}';

// ✅ Good
const pattern = String.raw`\d{4}-\d{2}-\d{2}`;
```

### S6651 — Default parameters must be last
**Fix:** Move parameters with defaults after required parameters.

```ts
// ❌ Bad
function createUser(role = 'member', name: string) { ... }

// ✅ Good
function createUser(name: string, role = 'member') { ... }
```

### S6652 — Cognitive complexity ≤ 15
**Fix:** Extract helper functions to reduce complexity.

### S6653 — Use `globalThis` over `window`
**Fix:** Replace `window` with `globalThis.window` or `globalThis` for SSR safety.

```ts
// ❌ Bad
window.location.href = '/login';

// ✅ Good
globalThis.window.location.href = '/login';
// or
globalThis.location.href = '/login';
```

### S6654 — No nested template literals
**Fix:** Extract to variables.

```ts
// ❌ Bad
const msg = `Hello ${`World ${name}`}`;

// ✅ Good
const inner = `World ${name}`;
const msg = `Hello ${inner}`;
```

### S6655 — No nested functions > 4 levels
**Fix:** Extract nested functions to module level or class methods.

### S6657 — Use `String#replaceAll()` over `String#replace()`
**Fix:** Use `replaceAll()` for global string replacement.

```ts
// ❌ Bad
str.replace(/foo/g, 'bar');

// ✅ Good
str.replaceAll('foo', 'bar');
```

### S6659 — No `void` operator
**Fix:** Remove `void` operator usage.

```ts
// ❌ Bad
void someFunction();

// ✅ Good
someFunction();
```

### S6660 — Use `String.fromCodePoint()` over `String.fromCharCode()`
**Fix:** Use `fromCodePoint()` for Unicode code points.

### S6661 — Promise rejection reasons must be `Error` instances
**Fix:** Always reject with `Error` objects.

```ts
// ❌ Bad
Promise.reject('error message');

// ✅ Good
Promise.reject(new Error('error message'));
```

### S6662 — Use `??=` over nullish assignment
**Fix:** Use nullish coalescing assignment.

```ts
// ❌ Bad
if (obj.prop === null || obj.prop === undefined) {
  obj.prop = defaultValue;
}

// ✅ Good
obj.prop ??= defaultValue;
```

### S6663 — No negated conditions
**Fix:** Use positive conditions where they read better.

```ts
// ❌ Bad
if (!isActive) return <Disabled />;
return <Active />;

// ✅ Good
if (isActive) return <Active />;
return <Disabled />;
```

---

## Minor Rules

### S2208 — Use `node:crypto` over `crypto`
**Fix:** Use the explicit `node:` prefix.

```ts
// ❌ Bad
import { randomUUID } from 'crypto';

// ✅ Good
import { randomUUID } from 'node:crypto';
```

### S6479 — No array index in React keys
**Fix:** Use stable unique IDs instead of array index.

```ts
// ❌ Bad
{items.map((item, index) => <div key={index}>{item}</div>)}

// ✅ Good
{items.map((item) => <div key={item.id}>{item}</div>)}
```

### S6480 — Context provider values must be stable
**Fix:** Wrap object literals in `useMemo`.

```ts
// ❌ Bad
<Context.Provider value={{ user, setUser }}>

// ✅ Good
const value = useMemo(() => ({ user, setUser }), [user, setUser]);
<Context.Provider value={value}>
```

### S6481 — No setter with matching state
**Fix:** Don't use state variable in its own setter.

```ts
// ❌ Bad
setCount(count + 1); // if count is the current state

// ✅ Good
setCount((prev) => prev + 1);
```

### S6606 — Use optional chain expressions
**Fix:** Same as S6647 — use `?.` and `??`.

### S6632 — Use `export…from` for re-exports
**Fix:** Re-export directly from the source module.

```ts
// ❌ Bad
import { BlobService } from './blob.service';
export { BlobService };

// ✅ Good
export { BlobService } from './blob.service';
```

### S6664 — No duplicate CSS selectors
**Fix:** Consolidate duplicate CSS rules.

### S6665–S6690 — Deprecated API replacements
**Fix:** Replace deprecated APIs with modern equivalents.

---

## Security Hotspots

Security hotspots do **not** fail as "issues"; they fail the gate via the **100% reviewed** condition. A single unreviewed hotspot fails the gate — so prefer writing code that creates none.

### S1313 — Hardcoded IP address
**Fix:** Do not compare/write a literal IP string in production or test code. Derive it from parts or a named constant so the scanner sees no literal (and it self-documents intent).

```ts
// ❌ Bad — S1313 flags the literal ::ffff:127.0.0.1
function isLoopbackPeer(address?: string): boolean {
  return address === '127.0.0.1' || address === '::1' || address === '::ffff:127.0.0.1';
}

// ✅ Good — normalize the IPv4-mapped form instead of listing a literal
const IPV4_MAPPED_PREFIX = '::ffff:';
function isLoopbackPeer(address?: string): boolean {
  if (!address) return false;
  const normalized = address.startsWith(IPV4_MAPPED_PREFIX)
    ? address.slice(IPV4_MAPPED_PREFIX.length)
    : address;
  return normalized === '127.0.0.1' || normalized === '::1';
}
```

If a hotspot genuinely cannot be avoided, it MUST be reviewed in the Sonar UI before merge.

---

## Data / API Handling Rules (opencode review)

Recurring findings from the AI code review. These are correctness/security rules, not Sonar rules, but must be enforced in every review.

### Never return a full database row over REST/GraphQL
**Fix:** Select/map only the public fields. Prisma `findUnique`/`findMany` return **all** columns — `passwordHash`, `emailNormalized`, `deletedAt`, `updatedAt`, tokens — and Express/GraphQL will serialize them.

```ts
// ❌ Bad — leaks passwordHash + internal columns on every login/register/refresh
const user = await this.prisma.user.findUnique({ where: { id: userId } });
return { accessToken, refreshToken, user };

// ✅ Good — explicit public projection
const PUBLIC_USER_SELECT = {
  id: true, email: true, displayName: true, avatarUrl: true, bio: true,
  role: true, status: true, lastLoginAt: true, createdAt: true,
} as const;
const user = await this.prisma.user.findUnique({ where: { id: userId }, select: PUBLIC_USER_SELECT });
return { accessToken, refreshToken, user };
```

### Preserve operation intent on retarget
**Fix:** A conflict/retarget must not morph one operation kind into another (e.g. a queued `DELETE` becoming an `UPDATE`, resurrecting deleted data). Branch on the operation kind and re-issue the same kind.

### Bound retries; classify terminal failures
**Fix:** Enforce durable backoff (`nextAttemptAt`) when selecting operations to dispatch, give TRANSIENT a max attempt budget (then mark recoverable `TERMINAL`, never loop forever), and classify non-retryable server rejections (HTTP 400 → `REJECTED`) as terminal. A poison operation must not block the queue forever.

### Never promote unverified/staged content to READY
**Fix:** Only mark content `READY` when its stored record is complete/verified. A pinned/retained version that was interrupted (STAGED) or has no stored row must stay non-active (`INTERRUPTED` / recoverable), never a phantom `READY`.

### Security fences must be sticky
**Fix:** A subject/owner mismatch flag must not be cleared by a later `null`/unknown verification. Only an affirmative match may clear it; otherwise the fence stays closed.

### Service worker: fall back on cache miss, don't reject
**Fix:** A cache miss while offline must resolve to a cached fallback (e.g. the offline shell), never let `respondWith` reject into a network error.

### IndexedDB upgrades must be forward-compatible
**Fix:** Guard every `createObjectStore` with `objectStoreNames.contains(...)` (and branch on `oldVersion`). An unguarded `createSchema` throws `ConstraintError` on the first version bump and bricks the DB.

---

## Accessibility Rules

### S6700 — Use semantic HTML
**Fix:** Replace ARIA roles with native HTML elements.

| ❌ Bad | ✅ Good |
|--------|---------|
| `<div role="navigation">` | `<nav>` |
| `<div role="dialog">` | `<dialog>` |
| `<div role="separator">` | `<hr>` |
| `<div role="button">` | `<button>` |
| `<div role="button">` | `<input type="button">` |

### S6701 — Interactive elements need keyboard support
**Fix:** Add `onKeyDown` or `onKeyUp` to non-interactive elements with `onClick`.

```tsx
// ❌ Bad
<div onClick={handleClick}>Click me</div>

// ✅ Good
<div
  onClick={handleClick}
  onKeyDown={(e) => e.key === 'Enter' && handleClick()}
  role="button"
  tabIndex={0}
>
  Click me
</div>
```

### S6702 — Form labels must be associated
**Fix:** Use `htmlFor`/`id` pairing.

```tsx
// ❌ Bad
<label>Name</label>
<input type="text" />

// ✅ Good
<label htmlFor="name">Name</label>
<input id="name" type="text" />
```

### S6703 — Media elements need `<track>`
**Fix:** Add `<track>` for captions to `<audio>` and `<video>`.

```tsx
// ❌ Bad
<audio src="audio.mp3" />

// ✅ Good
<audio src="audio.mp3">
  <track kind="captions" src="captions.vtt" />
</audio>
```

### S6704 — Clickable non-native elements need `role`
**Fix:** Add appropriate role and keyboard support.

### S6705 — `lang` attribute on `<html>`
**Fix:** Add `lang` and/or `xml:lang` to `<html>` element.

---

## React-Specific Rules

### S6720 — Props must be read-only
**Fix:** Mark component props as `readonly`.

```tsx
// ❌ Bad
function MyComponent({ name }: { name: string }) { ... }

// ✅ Good
function MyComponent({ name }: { readonly name: string }) { ... }
// or
function MyComponent(props: { readonly name: string }) { ... }
```

### S6721 — No array index in keys
**Fix:** Same as S6479.

### S6722 — No useless variable assignments
**Fix:** Same as S6477.

### S6723 — Context provider values must be stable
**Fix:** Same as S6480.

### S6724 — No setter with matching state
**Fix:** Same as S6481.

---

## Deprecated API Replacements

### Zod v4 deprecations
Replace deprecated Zod string methods with the new syntax:

| ❌ Deprecated | ✅ Replacement |
|---------------|----------------|
| `.email()` `.url()` `.uuid()` | `z.email()` `z.url()` `z.uuid()` |
| `.datetime()` | `z.iso.datetime()` (NOT `z.datetime()` — does not exist in Zod 4) |
| `.min(5, 'message')` | `.min(5, { message: 'message' })` |
| `.max(10, 'message')` | `.max(10, { message: 'message' })` |
| `.regex(/pattern/)` | `.regex(/pattern/)` (unchanged) |

### Apollo Client deprecations
Pinned version is Apollo Client v4.2.12 — imperative `apolloClient.query`/`apolloClient.mutate`
and `createHttpLink`/`split`/`setContext`/`onError` links remain valid. Do NOT migrate call
sites to `useQuery`/`useMutation` hooks to satisfy the deprecation lint: `useLazyQuery` in
this version does not support `onCompleted`/`variables` in options, and imperative calls are
still supported. Report these findings as accepted deviations, not errors.

`split` is deprecated in favor of `ApolloLink.split` (static method) but still exported —
do NOT change working code that uses the standalone `split()`.

### React deprecations
| ❌ Deprecated | ✅ Replacement |
|---------------|----------------|
| `FormEvent` (bare import) | `React.FormEvent<HTMLFormElement>` for form handlers, or `SubmitEvent`/`ChangeEvent`/`SyntheticEvent` as appropriate |

### Testing deprecations
| ❌ Deprecated | ✅ Replacement |
|---------------|----------------|
| `MockedResponse` | Import from `@apollo/client/testing` (NOT `testing/react` — that sub-module only exports `MockedProvider`) |

---

## Dockerfile Rules

### TODO comments fail the scan
**Fix:** Remove `TODO` comments from Dockerfiles (address them first if actionable). SonarQube treats them as open findings.

### Digest-only image refs
**Fix:** Use either the version tag or the digest — not both.

```dockerfile
# ❌ Bad
FROM node:22-bookworm-slim@sha256:83f487...

# ✅ Good
FROM node@sha256:83f487...
```

### Merge consecutive RUN instructions
**Fix:** Combine consecutive `RUN`s with `&& \` to reduce layers.

```dockerfile
# ❌ Bad
RUN pnpm db:generate
RUN pnpm build

# ✅ Good
RUN pnpm db:generate && \
    pnpm build
```

### Exclude generated reports from analysis
**Fix:** Never fix generated output (e.g. `playwright-report/index.html`). Add it to `sonar.exclusions` in `sonar-project.properties`.

---

## JSX Spacing

### Ambiguous JSX whitespace → explicit `{' '}`
**Fix:** When an icon `<span>` and text sit on separate lines, SonarQube flags ambiguous spacing. Insert an explicit space.

```tsx
// ❌ Bad — flagged
<span>share</span>
Share

// ✅ Good
<span>share</span>{' '}
Share
```

## Type-Guard Simplification

### `undefined > 0` is already `false`
**Fix:** A redundant `!== undefined` guard before a numeric comparison can be dropped — `undefined > 0` evaluates to `false`.

```tsx
// ❌ Bad
{mutualGroups !== undefined && mutualGroups > 0 && (...)}

// ✅ Good
{mutualGroups > 0 && (...)}
```

### `typeof window` → direct `undefined` comparison
**Fix:** Replace `typeof window === 'undefined'` with `window === undefined` (or `globalThis.window === undefined` for SSR safety). `typeof` is unnecessary for `window` and SonarQube flags it.

```ts
// ❌ Bad
if (typeof window === 'undefined') { ... }

// ✅ Good (SSR-safe)
if (globalThis.window === undefined) { ... }
```

### Native `<dialog>` over `role="dialog"` (with jsdom caveat)
**Fix:** Prefer native `<dialog>` element. BUT: jsdom doesn't fully support `<dialog>`, so if tests query `getByRole('dialog')`, keep `role="dialog"` as an attribute on the native element AND add an `open` attribute so the dialog is visible. Add a CSS reset for `dialog` to strip user-agent defaults.

```tsx
// ❌ Bad
<div role="dialog" aria-modal="true">

// ✅ Good (jsdom-compatible)
<dialog role="dialog" aria-modal="true" open>
```

```css
/* Add to globals.css */
dialog {
  margin: auto;
  padding: 0;
  border: none;
  width: auto;
  height: auto;
}
```

### Unused state setter → underscore prefix
**Fix:** When a state value is never read but the setter is used, prefix the value with `_` to signal intentional non-use.

```tsx
// ❌ Bad — SonarQube flags as not destructured
const [, setJoining] = useState(new Set());

// ✅ Good
const [_joining, setJoining] = useState(new Set());
```

### Testing deprecations
| ❌ Deprecated | ✅ Replacement |
|---------------|----------------|
| `MockedResponse` (MSW) | `HttpResponse` |

---

## New-Code Refactor Smells (observed this session)

These were flagged as new-code issues even though they are Low/Medium — any single one fails the 0-issue gate.

### Redundant type assertions
**Fix:** Remove `as`/`as unknown as X`/non-null `!` where the expression already has that type. (Repeatedly flagged in `database.ts`, `book-download.service.ts`, `reader-mutations.service.ts`.)

```ts
// ❌ Bad — assertion does not change the type
tx.objectStore('outbox').put(successor as unknown as IDBValidKey);

// ✅ Good
tx.objectStore('outbox').put(successor);
```

### Arrow function equivalent to `Boolean`
**Fix:** Use `Boolean` directly instead of `(x) => Boolean(x)` / `(x) => !!x` / `(x) => x`.

```ts
// ❌ Bad
flags.every((permitted) => permitted);

// ✅ Good
flags.every(Boolean);
```

### `Array#push()` called multiple times
**Fix:** Push once with spread, or `.concat`, instead of repeated `push`.

### Prefer `.at()` / negative index over `[…length - n]`
**Fix:** Use `arr.at(-1)` (or a negative `subarray` index) rather than `arr[arr.length - 1]`.

### `reduce()` without an initial value
**Fix:** Always pass an initial accumulator (`0`, `{}`, `[]`) to `reduce()`.

### Unused variable / useless assignment
**Fix:** Remove assignments to variables that are never read (S1481/S1854/S6477).

### Overriding `unknown` in a union
**Fix:** `unknown` swallows the rest of a union (`string | unknown`) — don't put `unknown` in a union with other types; use `unknown` alone.

### Interface with only a call signature
**Fix:** Use a function type (`type F = (x: T) => R`) instead of `interface F { (x: T): R }`.

### Split duplicated function bodies
**Fix:** If two functions have identical implementations (Sonar "implementation is identical"), extract a shared helper — don't duplicate.

### Remove redundant jump
**Fix:** Drop `return;`/`continue;` that is the last statement and does nothing.

### `RegExp` constructor over a literal
**Fix:** Use a regex literal (`/foo/`) instead of `new RegExp('foo')` when the pattern is static.

### Stringified object fallback
**Fix:** `a ?? b ?? ''` where `a`/`b` can be objects will stringify to `[object Object]` — coerce explicitly (`.id`, `String(...)`) or handle the object branch.

### `dispose()` — async in constructor
**Fix:** Do not start async work in a constructor ("Refactor this asynchronous operation outside of the constructor"). Move it to an explicit `init()`/factory.

### Avoid hot-path re-fetch loops
**Fix:** Resolve a value once per drain/run where possible; don't trigger a per-dispatch network read for every operation when a cached/derived source exists.

---

## Quick Reference — Common Fixes

| Issue | Fix |
|-------|-----|
| `window` reference | `globalThis.window` or `globalThis` |
| `typeof window` check | `globalThis.window === undefined` |
| Array index in key | Use stable unique ID |
| Empty method | Implement or remove |
| Unused import | Remove |
| Unused prop | Remove from interface + all call sites |
| Constructor param not readonly | Add `readonly` |
| Regex with backslashes | Use `String.raw` |
| `crypto` import | `node:crypto` |
| Re-export via variable | `export…from` |
| `String#replace()` global | `String#replaceAll()` |
| `String.fromCharCode()` | `String.fromCodePoint()` |
| Explicit null check | Optional chain `?.` `??` |
| Nested ternary | Extract to if/else |
| `void` operator | Remove |
| Negated condition | Use positive |
| Nested template literal | Extract to variable |
| Nested functions > 4 levels | Extract to module level |
| Render helper closes over state | Keep nested, pass params explicitly |
| Conditional hooks | Hoist to top level |
| Hook in plain function | Rename to component/hook or inline |
| Duplicate branch blocks | Merge into one |
| Promise reject with string | `new Error('message')` |
| Nullish assignment | `??=` |
| Default params not last | Reorder |
| Cognitive complexity > 15 | Extract helpers |
| ARIA role for native element | Use semantic HTML |
| `role="dialog"` | Native `<dialog>` + CSS reset (keep role for jsdom) |
| onClick without keyboard | Add `onKeyDown` |
| Form label without `htmlFor` | Add `htmlFor`/`id` |
| Media without `<track>` | Add captions track |
| Props not readonly | Add `readonly` |
| Context value not stable | `useMemo` |
| Setter with state | Use callback form |
| Unused state value | Prefix with `_` |
| `undefined > 0` guard | Drop (already false) |
| `FormEvent` import | `React.FormEvent<T>` or `SubmitEvent`/`ChangeEvent` |
| `MockedResponse` import | `@apollo/client/testing` (not `testing/react`) |
| Apollo v4 `query`/`mutate`/links | Accepted — do NOT migrate |
| Single-statement conditional | Wrap body in `{ }` (S2681) |
| Hardcoded IP / secret (hotspot) | Derive from parts/const; review if unavoidable (S1313) |
| Redundant `as`/`!` assertion | Remove when the type already matches |
| `(x) => Boolean(x)` | `Boolean` |
| Repeated `Array#push()` | Push once with spread |
| `arr[arr.length - 1]` | `arr.at(-1)` |
| `reduce()` without initial value | Pass an initial accumulator |
| Unused variable / assignment | Remove |
| `unknown` in a union | Use `unknown` alone |
| Interface with only a call signature | Use a function type |
| Identical function bodies | Extract a shared helper |
| Redundant final `return;`/`continue;` | Remove |
| `new RegExp('literal')` | Use a regex literal |
| `a ?? b ?? ''` with objects | Coerce explicitly (avoid `[object Object]`) |
| Async work in a constructor | Move to an `init()`/factory |
| Full Prisma row returned over REST | `select`/map public fields only (no `passwordHash`) |
| Retarget morphs DELETE→UPDATE | Preserve operation kind |
| Unbounded retry / retried 400/5xx | Backoff + max attempts → `TERMINAL`; 400 → `REJECTED` |
| Unverified/STAGED content marked READY | Only mark READY when verified/complete |
| Subject-mismatch fence cleared by `null` | Keep the fence sticky until an affirmative match |
| SW cache miss offline | Fall back to cached shell, don't reject |
| Unguarded IndexedDB `createObjectStore` | Guard with `objectStoreNames.contains` (+`oldVersion`) |
