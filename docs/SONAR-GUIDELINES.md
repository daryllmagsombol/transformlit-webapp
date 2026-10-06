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
**Fix:** Use stable unique IDs instead of array index. When list items are structurally identical (same type, no id, no content), key by a **per-render ordinal** counted as you map — never the array index.

```ts
// ❌ Bad
{items.map((item, index) => <div key={index}>{item}</div>)}

// ✅ Good
{items.map((item) => <div key={item.id}>{item}</div>)}

// ✅ Also good — items have no id/content identity (e.g. Bible `line_break`)
let lineBreakOrdinal = 0;
{content.map((item) => {
  if (item.type === 'line_break') {
    lineBreakOrdinal += 1;
    return <div key={`lb-${lineBreakOrdinal}`} />;
  }
  return <Verse key={`verse-${item.number}`} />;
})}
```

### S6353 / S6582 / S1854 — Sort comparators, optional chains, redundant assignments
**Fix:** Three related "reliability" findings that appear as High on new code:

```ts
// ❌ Bad — no comparator: sort is alphabetical/type-dependent
[...days].sort();
// ✅ Good — explicit comparator (dayKeys are ISO strings)
[...days].sort((a, b) => a.localeCompare(b));

// ❌ Bad — explicit null check where an optional chain reads cleaner (S6582)
if (!parsed || parsed.year !== year) return fallback;
// ✅ Good
if (parsed?.year !== year) return fallback;

// ❌ Bad — `run` already holds the value on every path (S1854)
if (run > longest) longest = run;
// ✅ Good
longest = Math.max(longest, run);
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

### Hotspot inventory — the gate needs 100% reviewed, so avoid these by construction

These were all surfaced by the scan. Prefer code that does not create them; where a hotspot is intentional test/tooling code, mark it **Safe** in the Sonar UI.

| Rule | Category | What triggers it | Avoid by |
|---|---|---|---|
| `S2245` | Weak crypto | `Math.random()` in `apps/web/scripts/test-utils/pwa-fixture.ts` (temp-dir name) | Fine for a non-security fixture — mark **Safe**, or use a counter. Never use `Math.random()` for tokens/ids. |
| `S1523` | Code injection (RCE) | `runInNewContext(workerSource, sandbox)` in test-utils | It is a test sandbox for a known, repo-owned worker script — mark **Safe**. Never `runInNewContext` on untrusted input. |
| `S5693` | DoS | Multer `FileInterceptor` with no explicit `limits.fileSize` in `apps/api/src/uploads/uploads.controller.ts` | Set `limits: { fileSize: MAX_FILE_SIZE_BYTES }` (already a shared constant). |
| `S5852` | DoS (ReDoS) | `.replace(/\/+$/, '')` in `download-manager.ts` | Use a linear pattern (e.g. a `while (endsWith('/'))` trim) or mark **Safe** after review — `/\/+$/` is not catastrophic. |
| `S6504` | Permission | `COPY --chown=node:node` in `apps/web/Dockerfile` | Intentional: the runtime user is non-root. Mark **Safe**. |
| `S6470` | Permission | `COPY . .` in both Dockerfiles | Covered by a `.dockerignore`; confirm it excludes `.env*`, `.git`, `node_modules`. Mark **Safe**. |
| `S1313` | Hardcoded IP | literal loopback IPs in tests | See the `S1313` rule above — derive from parts. |

**Required review step:** after a scan, open **Security Hotspots → To review** and assess every entry. "Safe" with a one-line rationale is a legitimate outcome; leaving one **To review** fails the gate.

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

## Cleanup / Reliability Rules (from the 2026-10 SonarQube backlog)

These appeared en masse on legacy files. Each is mechanical; fix in the same style everywhere.

| Rule | Message | Fix |
|---|---|---|
| `S4325` | "This assertion is unnecessary since it does not change the type" | Remove the redundant `as T` cast. ❌ `input.baseRevision as number` ✅ `input.baseRevision` |
| `S7778` | "Do not call `Array#push()` multiple times" | Push all items in one call, or push an array. ❌ `a.push(x); a.push(y)` ✅ `a.push(x, y)` |
| `S7755` | "Prefer `.at(…)` over `[…length - index]`" | ❌ `batch[batch.length - 1]` ✅ `batch.at(-1)`; `arr.slice(0, len-12)` → `arr.slice(0, -12)` |
| `S6551` | "Object's default stringification format" | Never `String(value)` on a possibly-object value. Narrow to a string first. ❌ `String(a ?? b ?? '')` ✅ `firstString(a, b) ?? ''` |
| `S3863` | "imported multiple times" | Merge the duplicate import statements from the same module. |
| `S6571` | "'unknown' overrides all other types in this union" | Remove the redundant `unknown` arm, or narrow the union. |
| `S6598` | "Interface has only a call signature" | Convert to a function type alias: `type F = (x: T) => R`. |
| `S2094` | "Unexpected empty class" | Make it a plain type/object, **unless** it is a reflective marker — then add a `readonly marker` field. |
| `S3776` | Cognitive complexity > 15 | Extract cohesive helpers; preserve exact order/branches/messages. |
| `S3626` | "Remove this redundant jump" | Drop the trailing `return;`/`continue` that ends the block. |
| `S4144` | "implementation identical to line N" | Merge/parameterize the duplicate function. |
| `S7059` | "asynchronous operation outside of the constructor" | Move async init to an explicit `init()`/`open()`; update callers. |
| `S6811` | ARIA `progressbar`/`status` role | Use `<progress>` / `<output>` (see Accessibility). |
| `S6704`/`S6845`/`S6847` | Non-interactive element with handlers | Use a real `<button>`, or add `role` + `tabIndex` + keyboard handling per S6701. |
| `S7735` | "Unexpected negated condition" | Invert to the positive form where it reads better. |
| `S7718` | catch param naming | Name a used catch param `error_` (or a descriptive name); use bare `catch` when unused. |
| `S4624` | Nested template literals | Extract the inner literal/expression to a variable. |
| `S6594`/`S4030` | `Set` for membership | Use `new Set([...])` + `.has()` instead of array `.includes()`. |

**Never "fix" one of these by changing behavior.** If the asserted type, the pushed order, or the constructor's async timing is load-bearing, stop and report it instead.

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
| `<div role="progressbar" aria-valuenow=…>` | `<progress value=… max=…>` (S6811) |
| `<div role="status">` | `<output>` (S6811) |

### S6811 — Prefer native `<progress>` / `<output>` over ARIA roles
**Fix:** Use the native element. A `<progress>` takes `value`/`max` instead of
`aria-valuenow`/`aria-valuemax`, so update tests that queried the old attributes.

```tsx
// ❌ Bad — flagged: custom progressbar role
<div role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={percent}>
  <div style={{ width: `${percent}%` }} />
</div>

// ✅ Good — native element
<progress value={percent} max={100} aria-label="Yearly reading goal progress" />
```
Tests: `screen.getByRole('progressbar')` still works; assert `toHaveAttribute('value', '50')`
and `max` instead of `aria-valuenow`.

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
| `FormEvent` (bare import) | `React.SyntheticEvent<HTMLFormElement>` for form handlers, or `SubmitEvent`/`ChangeEvent` as appropriate |

**`FormEvent` is deprecated in @types/react 19 — do not use `React.FormEvent` either.** The
`@deprecated` tag says *"FormEvent doesn't actually exist"*; prefer `React.SyntheticEvent<T>`
for a generic `onSubmit` handler, or a more specific event type. The existing entry that
recommended `React.FormEvent<HTMLFormElement>` is superseded by this rule.

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

## Test Isolation Rules (opencode review)

Recurring findings from the AI code review about tests that mount real runtime
side-effects. These are not Sonar rules but must be enforced in every review.

### Shell/apollo-consuming component tests must mock the shared Apollo client
**Fix:** Any test that mounts a component tree reaching `apolloClient.query()`
(for example `AppShell` → `Sidebar` → `ProgressWidget`, or `AuthenticatedLayout`
→ `AppShell`) must `jest.mock` the shared client module. Without the mock,
rendering fires a real network request (e.g. to `localhost:3005`) inside jsdom,
which is slow, flaky, environment-dependent, and can leak `act(...)` warnings
from late state updates. Default the mocked `query` to a never-resolving promise
so the consuming effect is inert and the component stays in its loading state.
Mocking the React provider alone is not enough — the production code uses the
client singleton, not the provider.

```tsx
// ❌ Bad — mounts the shell, which fires a real MyProgress fetch in jsdom
import { render, screen } from '@testing-library/react';
import { AppShell } from './app-shell';

it('renders children', () => {
  render(<AppShell><div>Content</div></AppShell>);
  expect(screen.getByText('Content')).toBeInTheDocument();
});

// ✅ Good — the shared client is mocked; the query never leaves the process
jest.mock('../../lib/apollo-client', () => ({
  apolloClient: { query: jest.fn(() => new Promise(() => {})) },
}));
import { render, screen } from '@testing-library/react';
import { AppShell } from './app-shell';

it('renders children', () => {
  render(<AppShell><div>Content</div></AppShell>);
  expect(screen.getByText('Content')).toBeInTheDocument();
});
```

---

## Fire-and-forget helpers and side-effect ordering (opencode review)

### FIRE-AND-FORGET-CONTRACT — "Never throws" must guard synchronous throws too
**Fix:** A helper documented as fire-and-forget / "never throws" must not throw
synchronously either. A trailing `.catch()` only handles a rejected promise; it
does nothing for a synchronous throw from argument evaluation or from a `mutate`
that throws instead of rejecting. Wrap the **entire** body in `try/catch`, and
return a promise that resolves to `void` so callers may either ignore it or
`await` it.

❌ `client.mutate({ operationId: globalThis.crypto.randomUUID() /* or mutate throws */ }).catch(() => {})` — the UUID or the `mutate` call can throw before `.catch` is attached.
✅ `try { return client.mutate({...}).then(() => undefined, () => undefined); } catch { return Promise.resolve(); }`

### SIDE-EFFECT-ORDERING — Await a write before re-reading, and keep unrelated effects out of a failure boundary
**Fix:** Two related ordering rules. (1) When a UI action writes then immediately
re-reads (a check-in then `loadData`), `await` the write first — a fire-and-forget
write races the read and renders stale data. (2) A side effect that must never
determine the success/failure of a primary operation (recording analytics/activity
after a create) must sit **outside** the primary operation's `try/catch`, or a
throw there is misreported as the primary operation failing.

❌ `recordActivity(...); loadData(year);` — reload typically renders before the write lands.
✅ `void recordActivity(...).then(() => loadData(year));`

❌ `try { await createPost(); recordActivity(...); setBody(''); } catch { toast('Failed to post'); }` — an activity throw reports a succeeded post as failed.
✅ `await createPost(); /* separate */ recordActivity(...); setBody('');` — keep the recorder out of the create `try/catch`.

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
| Shell test mounts real Apollo query | `jest.mock` shared `apollo-client`; default `query` to a pending promise |

## PWA E2E infrastructure findings — CI run 37032368483

- **New-code coverage gate (≥80%; configuration scope, no rule ID):** excluding
  `**/*.spec.*` alone leaves Playwright fixture helpers classified as production
  code without Jest coverage. Exclude the entire E2E infrastructure tree from
  sources and coverage; do not modify production code to compensate.
  ❌ Only `**/*.spec.*` and `apps/web/test/**` exclusions.
  ✅ `/apps/web/e2e/**` in `sonar.exclusions` and `apps/web/e2e/**` in
  `sonar.coverage.exclusions`.
- **E2E correctness (no Sonar rule ID):** cookie-only login does not install the
  app session, substring READY checks match `Not saved offline`, and dispatching
  focus does not await the foreground drain. Use the real login UI, exact READY
  text and bounded polling of the committed receipt. Authenticate fresh devices
  independently and assert their server snapshot by acknowledged entity ID.
  ❌ Raw REST login → route wait; `getByText('Saved offline')`; immediate receipt read.
  ✅ Capture the form login response; `getByText('Saved offline', { exact: true })`;
  `expect.poll(readReceipt, { timeout: 15_000 })` asserting `APPLIED`.
- **Persistent browser isolation (no Sonar rule ID):** the harness-owned browser
  profile is a parent cleanup boundary, not a profile shared by independent test
  scenarios. A preceding account recovery test can leave an intentional deferred
  logout barrier in IndexedDB. Reusing the same profile can make the next
  scenario mistake that barrier for its own login failure. Give every Playwright
  test a unique child profile beneath the owned root; never dismiss/reset a
  barrier to make fixture login pass. Within one scenario, reuse that child for
  tabs and cold restarts.
  ❌ All tests launch persistent Chromium against `PWA_BROWSER_PROFILE` directly.
  ✅ `resolve(PWA_BROWSER_PROFILE, 'test-profiles', testInfo.testId + uniqueId)`;
  retain the child path in a fixture for cold restart.
- **Epoch-fenced E2E writes (no Sonar rule ID):** synthetic outbox records must
  use the active persisted owner epoch and the next account sequence, not a
  hard-coded epoch/sequence. First assert lifecycle state is ACTIVE and its
  subject matches the fixture; do not bypass an account-exit barrier.
  ❌ `epoch: 1, seq: 1` without reading durable ownership/queue state.
  ✅ Read ACTIVE owner and queue sequence, then seed with its epoch and next seq.
- **Cold deep-link synchronization (no Sonar rule ID):** a hash-routed client
  view must not open persisted, account-owned resources before asynchronous
  ownership restoration resolves. Mounting the reader from the URL hash while
  the persisted owner is still null rejects the local open and leaves a
  permanent "unavailable" error, because the child effect does not re-run after
  hydration. Gate reader mounting on the existing hydration state and fail
  closed when restoration ends signed out or rejects.
  ❌ Render `OfflineBookReader`/`OfflineBibleReader` unconditionally from
  `view.kind === 'book' | 'bible'` while restoration is still pending.
  ✅ Gate the reader branches until hydration resolves to a restored owner; show
  an accessible `role="status"` loading state while pending and a signed-out
  message when no owner exists. Cover it with a deferred-hydration regression
  test for both the initial hash and an immediate `hashchange`.

## Oracle deployment review findings — AI review IDs (not Sonar rules)

### DEPLOY-EXACT-RELEASE — Deploy only the approved immutable release
**Fix:** Pin every image and source artifact to the approved SHA; verify the deployed image IDs/OCI labels, and explicitly use Compose `--no-build` so a local build cannot silently replace the approved artifact.

❌ Reuse prepared candidate `7fefa49` when the approved target is `65aa90f`, or let Compose build an image during deployment.
✅ Verify that all deployed images identify approved SHA `65aa90f`, then run Compose with `--no-build`.

### DEPLOY-WORKER-PARITY — Prepare the independent conversion worker
**Fix:** Run the worker independently from the API container using the same API image and `node apps/api/dist/worker/main.js`; match the API's database and book-storage mounts.

❌ Deploy API and web only, with no conversion worker.
✅ Deploy the API, web, and worker from the same approved API image, with matching database and book mounts.

### DEPLOY-READINESS-EVIDENCE — Prove application readiness, not just process health
**Fix:** A static `health: { status: "ok" }` proves only process response. Verify a DB-backed authenticated operation and worker/storage checks before declaring the release ready.

❌ Treat a successful static health response as proof the database, authentication, worker, and storage work.
✅ Check an authenticated DB-backed operation and verify worker processing and book-storage access.

### DEPLOY-ARTIFACT-CAPABILITY — Keep signed artifact capabilities out of logs and argv
**Fix:** Treat signed artifact URLs as temporary bearer secrets: do not log them or pass them in process arguments. Retain permanent GitHub credentials locally; capture redirects in memory and send the signed URL through SSH stdin to a quiet, bounded remote downloader.

❌ Log a signed URL or pass it as a remote command-line argument; copy permanent GitHub credentials to the server.
✅ Keep credentials local, capture the redirect in memory, and provide the temporary URL over SSH stdin to a quiet downloader with a time/size bound.

### DEPLOY-RUNBOOK-CURRENCY — Separate historical assumptions from verified state
**Fix:** Label historical ACA and unmerged-branch instructions as historical. Record current VM, routing, merge, and asset-retention state with the verification date and target SHA.

❌ Present old ACA or unmerged-branch assumptions as verified current VM/routing state.
✅ Record SHA- and date-specific checks for the current VM, routing, merge, and asset retention.

### DEPLOY-MIGRATION-PROOF — Prove migration state before resolving a ledger mismatch
**Fix:** Resolve a migration-ledger mismatch only after catalog equivalence is established and fresh, quiesced database and book-storage backups are confirmed.

❌ Mark a migration resolved from a ledger entry alone, without checking catalog equivalence or fresh backups.
✅ Verify catalog equivalence and confirm fresh quiesced DB/book backups before resolving the ledger discrepancy.

### DEPLOY-STATIC-RETENTION — Retain immutable assets across the release union
**Fix:** Retain the union of old and new hashed Next static assets. Stop on any byte mismatch for the same asset path, and ensure missing assets return 404 rather than an HTML fallback.

❌ Delete old hashed assets at deploy, overwrite a colliding path, or serve the app HTML for a missing asset.
✅ Keep old and new hashed assets, stop on a byte collision, and return 404 for missing static assets.

### DEPLOY-DIGEST-REPRESENTATION — Verify OCI identity across descriptor types
**Fix:** OCI config, manifest, and index digests identify different objects. A CI-recorded config ID can differ from Docker 29/containerd's reported manifest ID; verify the config-to-manifest-to-index reference chain, blob hashes, loaded descriptor and runtime config, ordered `rootFS.diffIDs`, OS/architecture, and revision. Do not reject or waive an `.Id` mismatch without verifying this chain.

❌ Fail deployment solely because the runtime `.Id` differs from CI's config ID, or waive the mismatch without checking image contents and metadata.
✅ Verify each descriptor and referenced blob hash, then compare the loaded descriptor, runtime config, ordered `rootFS.diffIDs`, OS/architecture, and revision with the approved image.

### DEPLOY-IMAGE-STORE-CAPACITY — Budget actual image-store consumption
**Fix:** Gzip transfer size and `inspect.Size` are not portable measures of required capacity. Budget stored content, unpacked snapshots, temporary files, and a hard disk reserve; estimate padded archive-layer needs conservatively and monitor actual filesystem usage. Load images sequentially within the bounded budget.

❌ Treat gzip size as image-load cost or require `inspect.Size` equality as a portable capacity check.
✅ Use conservative padded layer estimates, account for stored and unpacked data plus temporary space and reserve, monitor free disk, and load one image at a time.

### DEPLOY-BACKUP-DATABASE-SELECTION — Select the application database explicitly
**Fix:** On a shared PostgreSQL cluster, `POSTGRES_DB=postgres` may name the maintenance database, not the application database. Dump with explicit `--dbname=transformlit`; require a nonempty dump and `pg_restore --list` output, then restore in isolation and verify application identity, tables, and migration ledger before relying on it.

❌ Dump `$POSTGRES_DB` without confirming it targets the application database, or accept a successful command without checking dump contents.
✅ Use `pg_dump --dbname=transformlit`, verify the nonempty archive and its `pg_restore --list`, then isolated-restore and check app identity, tables, and migration ledger.

### DEPLOY-COMPOSE-SUBCOMMAND-FLAGS — Verify flags against the installed subcommand
**Fix:** Compose flags differ by subcommand: `compose run` has no `--no-build`; use a build-free pinned-image configuration with `run --rm --no-deps --pull never`. `compose up` supports `--no-build --no-deps`. Verify the installed CLI's actual options before execution.

❌ Pass `--no-build` to `compose run` or assume `run` and `up` share flags.
✅ Use pinned images and a build-free config with `compose run --rm --no-deps --pull never`, or use `compose up --no-build --no-deps` when appropriate.

### DEPLOY-MAINTENANCE-DRAIN — Drain writers before taking backups
**Fix:** An Nginx graceful reload that serves 503 to new requests does not close existing WebSockets or stop API/worker processes and their database or storage writes. Stop the API and worker, then confirm their processes and all DB/storage writers are absent before backing up.

❌ Treat a 503 maintenance page or graceful Nginx reload as proof there are no active writers.
✅ After maintenance mode, stop API and worker processes and verify no API, worker, DB, or storage writers remain before the backup.

### DEPLOY-CATALOG-EXACTNESS — Compare migration catalogs exactly
**Fix:** Migration equivalence requires exact `format_type` including timestamp precision, schema and enum ordering, primary/foreign-key definitions, index definitions and valid/ready state, and validated nondeferrable constraints. Matching generic types or object names alone is insufficient.

❌ Declare catalogs equivalent because tables and generic column types or constraint names match.
✅ Compare exact formatted types/precision, schema and enum order, PK/FK/index definitions and index validity/readiness, plus validation and deferrability of constraints.

### DEPLOY-MAINTENANCE-ACCEPTANCE-ORDER — Validate service in safe reopening order
**Fix:** While public traffic remains in maintenance, prove internal readiness; run static public checks under maintenance; reload Nginx to reopen traffic while retaining static locations; then immediately run public acceptance checks. Do not require public API success during the 503 window or restore a whole old Nginx file that discards static routes.

❌ Require public API acceptance while maintenance intentionally returns 503, or replace all of Nginx config with an old copy that loses static locations.
✅ Verify internally during 503, check public static assets under maintenance, reload with static locations retained, then immediately verify public acceptance.

**Bound the activation checks:** a successful reload signal is not proof that the new config is active. Poll reload/activation for a bounded interval and use explicit HTTP connect and request timeouts; verify direct-origin and public responses for every controller/user-approved active hostname.

### DEPLOY-BIND-MOUNT-INODE-CONSISTENCY — Verify the mounted Nginx config inode
**Fix:** A single-file Docker bind mount remains attached to the original inode. Replacing the host pathname atomically can make the host checksum describe new bytes while the container still reads the old inode. Before edits or reloads, compare host and container-mounted device/inode and intended file hash, and inspect the effective config with `nginx -T`. Repair an existing stale mount narrowly while retaining its original routes; use a read-only mount before cutover. For future updates, preserve the host source inode rather than atomically renaming a replacement over it.

❌ Replace the host config pathname, see the desired host checksum plus a successful `nginx -t`/reload signal, and assume the running container loaded the edit.
✅ Confirm host and mounted-source device/inode/hash agreement and the intended directives in `nginx -T`; after graceful reload, use bounded polling and timed direct-origin/public checks on every approved active hostname to prove activation.

If the controller explicitly approves a temporary dual-inode workaround, remount only the private config bind read/write, update both the actual mounted file and host source in place, then restore read-only before testing or reloading. Verify the intended hash in both files and `nginx -T`, verify the mount is read-only, and record both inodes. This is a temporary content workaround, not an inode repair; Docker recreation must pass the strict same-inode gate against the current host source. Keep fallback/runtime work marked ongoing until activation and acceptance checks actually pass.

For an explicitly authorized nginx-only recreation, capture the nginx ID/start time before and after, verify the pinned image/config/ports/network/mounts, and compare every unrelated container ID/start time to the pre-recreation baseline. Record the nginx-only baseline exception explicitly; never report “all containers unchanged” when nginx was recreated.

❌ Recreate nginx and compare only its running status, or describe the original eight-container baseline as unchanged.
✅ Record the authorized old/new nginx identities and prove the other seven containers and shared volumes/images are unchanged; require host/mount inode agreement after recreation.

### DEPLOY-NAMESPACE-PROC-FD-VISIBILITY — Separate open-FD lifetime from procfs visibility
**Fix:** `/proc/self/fd/N` is resolved through the procfs view and PID namespace visible to the process doing the lookup. An FD can remain open while that pathname is inaccessible after `nsenter` because procfs and PID namespace views do not align. Reading an inherited raw descriptor (`<&3`) proves FD lifetime only; it does not prove procfs pathname visibility or bind-mount correctness. Verify process/PID-namespace and procfs alignment independently, and do not assume Docker accepts a cross-namespace bind mount.

❌ Conclude FD 3 was closed because `/proc/self/fd/3` is inaccessible after `nsenter`, or treat a raw-FD read as proof that a cross-namespace bind works.
✅ Test inherited-FD readability separately; resolve `/proc/<pid>/fd/N` only from an aligned PID/procfs view, and verify namespace ownership and mount support before relying on a cross-namespace path.

### DEPLOY-ACCEPTANCE-MATRIX-COMPLETENESS — Require every approved host/endpoint/route cell
**Fix:** Derive the initial-maintenance matrix from the controller/user-approved active-hostname inventory: `N` active hostnames × public DNS/direct origin × app root, auth, GraphQL HTTP, and GraphQL WS = `8N` cells. Every cell must complete transport and return HTTP 503. Retain each cell's command/result, curl exit status, HTTP status, stdout, and stderr (with secrets redacted). Do not stop after the first failure and silently omit remaining cells; timeout or a missing cell fails the phase. Later phases use their own expected statuses; a DNS, TLS, timeout, or connection error is never a successful HTTP 503. The historical two-host example was 16 cells, not a standing requirement to probe a hostname retired from this server's acceptance scope.

❌ Break on the first failed probe, treat a missing result or curl error as the expected maintenance 503, or report only an aggregate green flag.
✅ Record all `8N` approved-host × endpoint × route observations with command, transport exit, HTTP status, and expected status; fail the gate if any cell is absent or does not match.

### DEPLOY-ACCEPTANCE-PHASE-SCOPE — Separate maintenance, static, and open acceptance
**Fix:** Keep probes scoped to the actual deployment phase. Initial maintenance runs before the target static service exists, so check only app/auth/GraphQL HTTP and WS 503 on every approved active hostname and both public/direct-origin endpoints. After static service/snippets are installed, separately verify old/new static bytes, immutable cache headers, missing-asset 404, and continued API/auth/WS 503. Only after normal routes are restored, verify app/API/auth, PWA, static, and worker/readiness behavior.

❌ Require target static 200s during initial maintenance before the static service is running, or omit static-under-maintenance verification after publishing it.
✅ Run three explicit phases: maintenance-only 503; static published while API/auth remain 503; then full open-phase acceptance with static retained.

### DEPLOY-EFFECTIVE-ORIGIN-OWNERSHIP — Prove active hostname routing and writer ownership
**Fix:** Maintain an explicit controller/user-approved active-hostname inventory for this server. For every active hostname, correlate a unique public response marker with direct-origin probes using correct SNI/certificate, and retain both public and origin results for each acceptance cell. A hostname retired from this server's acceptance scope is not a DNS deletion and does not prove its other origin cannot write the shared database or book storage. Before backups, account for every DB/book-storage writer across all origins and services, including other origins that might still serve a retired hostname. `CF-Cache-Status: DYNAMIC` alone is not proof that public traffic reached this nginx origin; if public and direct-origin results disagree, identify the effective public origin path and stop before stopping writers or taking backups. Do not purge Cloudflare caches or change DNS without authorization. If Cloudflare access is unavailable, request nonsecret route/marker evidence or an explicit scope change; never invent credentials or claim that hostname passed.

For this server's current approved scope, `app.transformlit.com` is active; `transformlit.darjosh.dev` is retired from this server's acceptance inventory only. Leave its DNS/external route unchanged and do not claim it was validated by this server. Still establish that its other origin cannot write shared DB/book-storage, or include those writers in the drain/ownership gate.

❌ Treat `CF-Cache-Status: DYNAMIC` plus direct-origin 503 as proof the public hostname is in maintenance, delete/ignore a retired hostname's DNS, or assume its other origin cannot write shared data.
✅ Correlate unique markers on public and direct-origin paths for every approved active hostname, preserve per-cell results, leave retired-host DNS untouched, and account for every origin's DB/storage writers before backup.

### DEPLOY-CHECKER-HTML-NORMALIZATION — Normalize HTML signatures consistently
**Fix:** Normalize both the response body and the signature to the same case before testing for an HTML fallback. A legitimate nginx 404 body may be HTML; reject a missing asset only when it returns the wrong status or an HTML fallback with HTTP 200.

❌ `b'<!DOCTYPE html>' in body.upper()` (mixed-case comparison), or fail a correct 404 because its error body is HTML.
✅ `b'<!DOCTYPE HTML>' in body.upper()` or `b'<!doctype html>' in body.lower()`; accept an actual 404 and fail an HTML fallback served with HTTP 200.

### DEPLOY-CHECKPOINT-RESUME-GATES — Resume from current durable state
**Fix:** Every state-changing command invalidates assumptions tied to the previous state. On resume, inspect the latest successful command/result, current migration ledger/schema and DB-write state, running service IDs/start times, and backup/recovery evidence. Reuse still-valid evidence, repeat only checks invalidated by later writes or a required post-quiescence gate, and continue from the next incomplete phase. A busy/waiting task is not progress without new evidence.

❌ After `prisma migrate resolve` succeeds and advances the ledger from the four-entry pre-state to five finished entries, rerun the four-entry catalog gate or call `resolve` again because `test ! -e reader-catalog-transformlit-corrected.txt` failed; report eight migrations before deploy ran.
✅ Reuse/checksum the approved catalog proof and retain the successful resolve result. At the observed 13:03:48 checkpoint, the ledger had five finished entries and the PWA migrations were still pending: read that current state, run the pending deploy once, and expect eight finished entries only after it succeeds. Put any new observation in a unique evidence file without overwriting the original proof.

### DEPLOY-AUTH-CREDENTIAL-PROVENANCE — Verify authenticated probe credential origin and type
**Fix:** Before an authenticated production probe, verify the credential belongs to an existing session at the canonical application origin and is an existing application access JWT. The protected GraphQL `me` resolver uses `JwtAuthGuard`/Passport Bearer JWT authentication, validates the configured `JWT_SECRET`, and resolves `sub` to an existing nondeleted database user; application access JWTs expire after 15 minutes. A refresh cookie is not a standalone access JWT; neither a fresh provider/OAuth token nor a token copied from a retired hostname/other deployment proves the deployed app's authenticated path. Pass raw JWT bytes to a helper that adds `Bearer`; never double-prefix or quote the token. Do not print credentials, token claims, user identifiers, or secret material.

❌ Try fresh provider/refresh tokens or copy a token from a retired deployment after `UNAUTHENTICATED`; rotate secrets or restart services, then report a production login regression or a pass without a canonical protected read.
✅ Verify existing access-JWT provenance/type from the canonical app origin, pass only the raw token to a helper that adds the Bearer header, and perform the approved protected DB-backed read. Record only nonsecret origin/operation/status/error metadata. If no approved existing token is available or the read returns `UNAUTHENTICATED`, report authentication acceptance blocked; do not retry token sources, mutate accounts, rotate secrets, or restart services.

### DEPLOY-MIGRATION-ADDITIVE-SCOPE — Never let `migrate dev` resolve unrelated drift

**Fix:** `prisma migrate dev` auto-generates whatever DDL closes the gap between the live database and the Prisma schema, including pre-existing drift that is intentionally unresolved (a column deliberately retained in the DB while dropped from the schema). Review every generated `migration.sql` before committing it and delete any statement outside the task's schema change. A feature migration must contain only that feature's additive changes; destructive statements (`DROP COLUMN`, `DROP TABLE`, type narrowing) on unrelated tables reverse documented decisions and violate the additive rollback policy. When a column's retention is documented in a prior migration, the drift is the documented state, not something to "fix". After editing an already-applied migration, reconcile `_prisma_migrations.checksum` and the DB state so `prisma migrate status` stays consistent.

❌ Ship a migration named `<feature>_activity` that also contains `ALTER TABLE "book_progress" DROP COLUMN "clientEntityId";`, silently reversing `20261001000300_pwa_contract_cleanup`'s documented decision to retain the column.
✅ Inspect the generated SQL; remove the out-of-scope DROP (and any drift-resolution DDL); add a NOTE explaining why the documented drift is left untouched; restore the local DB column and update the recorded checksum.

### DEPLOY-CHECKER-FAILURE-EVIDENCE — Preserve probe failures before recovery
**Fix:** Save each checker command, UTC time, exit status, stdout, and stderr (with credentials/tokens redacted) before parsing output, hashing results, or attempting rollback/recovery. Failure wrappers must be syntax/import checked and exercised with stubs for both the initiating command failure and recovery failure so a wrapper exception cannot erase the original checker result. Distinguish an output-file exists guard from a failed validation command: inspect and reuse existing proof; use a new unique evidence path only for a genuinely new observation, never overwrite or rerun a completed state-changing step to satisfy a filename guard.

❌ Let a missing `hashlib` import in a failure handler discard the maintenance check’s exit status/stdout/stderr, then claim the public gate passed or guess which route failed.
✅ Persist the raw checker result first; parse it second; if recovery runs, record its separate command/result while preserving the initiating failure evidence.
