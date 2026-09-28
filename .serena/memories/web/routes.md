# Route & Feature Map (Web)

## Page pattern (avoids reading every route)

Nearly every route is a **thin server shell + co-located client component**:

```
app/<route>/page.tsx        → server component: metadata, params/validation, renders the client
app/<route>/<name>-client.tsx → 'use client' component holding state, data fetching, handlers
```

So to understand a screen's behaviour, read `<name>-client.tsx`, not `page.tsx`.
Exception: pure-static pages (`settings/`, `help/`) are self-contained in `page.tsx`.
Dynamic route params are `Promise`-typed in Next 16 and must be awaited.

## Route tree

Authenticated pages live under the `(app)` route group (which supplies the app shell).

| Route | Client component |
|---|---|
| `/` | `page.tsx` (landing) |
| `/login`, `/register` | `login-form.tsx` / `register-form.tsx` |
| `/feed` | `(app)/feed/feed-client.tsx` |
| `/bible` | `(app)/bible/bible-client.tsx` |
| `/bible/[translation]` | server-only redirect → `/bible?translation=` |
| `/bible/[translation]/[book]/[chapter]` | `…/bible-reader-client.tsx` (validated server-side via `lib/bible/chapter-route.ts`) |
| `/books` | `(app)/books/books-client.tsx` |
| `/books/[id]/read` | `(reader)/books/[id]/read/reader-client.tsx` — separate `(reader)` group, **no app shell** |
| `/chat` | `components/chat/conversation-list.tsx` |
| `/chat/[id]` | `components/chat/chat-thread.tsx` |
| `/friends` | `(app)/friends/friends-client.tsx` |
| `/groups` | `(app)/groups/groups-client.tsx` |
| `/groups/[slug]` | `components/groups/group-detail-client.tsx` |
| `/users` | `(app)/users/users-client.tsx` |
| `/users/[id]` | `(app)/users/[id]/user-profile-client.tsx` |
| `/notifications` | `(app)/notifications/notifications-client.tsx` |
| `/settings`, `/help` | static, no client component |

## Route groups

- `(app)/` — authenticated shell (`AppShell`: TopBar + Sidebar + BottomNav). Has `loading.tsx` + `layout.tsx`.
- `(reader)/` — immersive book reader; deliberately outside the shell.
- Root `auth-redirect.tsx` is a **guard** that bounces signed-in users from public pages to `/feed` — it does NOT parse tokens.

## Related

- Component inventory: `mem:web/components`
- Domain detail for the Bible section: `mem:bible/domain`
- Animation/layout primitives used by these screens: `mem:web/motion`
