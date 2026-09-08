# SonarQube Guidelines — Transformlit

This document maps SonarQube rule IDs to concrete fixes. All agents MUST follow these rules to pass the quality gate.

## Table of Contents

- [Critical Rules (Blocker/Critical)](#critical-rules)
- [Major Rules (High)](#major-rules)
- [Minor Rules (Medium/Low)](#minor-rules)
- [Accessibility Rules](#accessibility-rules)
- [React-Specific Rules](#react-specific-rules)
- [Deprecated API Replacements](#deprecated-api-replacements)

---

## Critical Rules

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

### React deprecations
| ❌ Deprecated | ✅ Replacement |
|---------------|----------------|
| `FormEvent` | `React.FormEvent` or import from `react` |

### Testing deprecations
| ❌ Deprecated | ✅ Replacement |
|---------------|----------------|
| `MockedResponse` (MSW) | `HttpResponse` |

---

## Quick Reference — Common Fixes

| Issue | Fix |
|-------|-----|
| `window` reference | `globalThis.window` or `globalThis` |
| Array index in key | Use stable unique ID |
| Empty method | Implement or remove |
| Unused import | Remove |
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
| Promise reject with string | `new Error('message')` |
| Nullish assignment | `??=` |
| Default params not last | Reorder |
| Cognitive complexity > 15 | Extract helpers |
| ARIA role for native element | Use semantic HTML |
| onClick without keyboard | Add `onKeyDown` |
| Form label without `htmlFor` | Add `htmlFor`/`id` |
| Media without `<track>` | Add captions track |
| Props not readonly | Add `readonly` |
| Context value not stable | `useMemo` |
| Setter with state | Use callback form |
