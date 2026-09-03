# Chat + Friends Completion — Design Spec

**Date:** 2026-09-02
**Status:** Draft (pending review)
**Scope:** Realtime chat UI + chat authorization hardening, friends-only DM policy, unread indicators, real suggested/mutual friends, Chat in navigation. Backend chat/friends logic already exists; this phase completes the frontend and closes known gaps.

---

## Overview

The friends backend and UI are complete. The chat backend (conversations, messages, cursor pagination, mark-read, `messageAdded` subscriptions via Postgres LISTEN/NOTIFY) is complete and tested, but `/chat` is a placeholder, Chat is absent from navigation, and the profile "Message" button fires a "coming soon" toast.

This phase delivers:

1. Full chat UI — conversation list + thread, realtime delivery, mark-read, unread indicators (per-conversation chips, nav badge, in-thread "New" divider).
2. Chat authorization hardening — membership checks on all read/write paths (currently any authenticated user can read/post into any conversation).
3. Friends-only DM policy — `startDirectConversation` requires an ACCEPTED friendship; BLOCKED pairs rejected.
4. Real suggested friends (mutual-friend ranked) and real mutual friends on profiles (currently mock data).
5. Chat in sidebar + bottom nav with a live unread badge.
6. Stitch screens (existing project "TransformLit Community Hub" 10935178473689115895) for the chat UI, implemented to match the established cream/amber design system.

Non-goals (future phases): group chat UI, typing indicators, read receipts, blocking UI (BLOCKED status exists in the schema but no product surface), message edit/delete, message search.

---

## Design Decisions

- **DM eligibility: friends only.** `startDirectConversation` requires `Friendship.status === 'ACCEPTED'` between the two users; any BLOCKED relation is rejected. The "Message" button appears only on profiles of current friends. This matches its placement beside friend actions and gives the social graph meaning.
- **Chat state lives in a Zustand store, not the Apollo cache.** The repo has zero `watchQuery` usage; all pages use imperative `apolloClient` with `no-cache`. Keeping chat state in a `chat-store` (conversations, per-conversation unread, messages per open thread, pending sends) avoids two sources of truth. The existing `messages` typePolicy (`apollo-client.ts:270-275`, keyArgs + merge: replace) is a landmine for scroll-up pagination (an older page would replace newer content) — it is currently inert (no-cache) and will be **deleted**.
- **Realtime via one subscription per auth session.** A chat provider mounted in `AppShell` subscribes once (`messageAdded` without a conversationId arg), updates the store, and powers the nav badge anywhere in the app. The subscription is generalized server-side: optional `conversationId`; membership enforced by a `memberIds` array published with each message (no DB calls inside the subscription filter — async/throwing filters silently drop events in the installed `@nestjs/graphql` iterator).
- **Route shape: `/chat` + `/chat/[id]`** (repo convention: `/users/[id]`, `/groups/[slug]`). Desktop: `chat/layout.tsx` renders the list pane with the thread as `children` (two-pane). Mobile: list page → thread page, browser-back returns. No `?conversation=` query-param dance, no Suspense-for-`useSearchParams` issues.
- **`messageAdded` payload stays slim.** Publish `{ messageAdded: msg, memberIds: [...] }` only. Postgres NOTIFY caps payloads at 8000 bytes — a long body would fail *after* the row was persisted (client sees an error, message exists on reload). Hard body cap of 2000 chars at the input/service level. `Message.sender` is resolved server-side (field resolver), never embedded in the payload.
- **Unread semantics.** `unreadCount` = messages with `createdAt > member.lastReadAt` and `senderId != me` (null `lastReadAt` counts all non-self messages). Computed in one `$queryRaw` GROUP BY aggregate over `conversation_members ⋈ messages` — not N count queries. `myLastReadAt` is exposed on `Conversation` so the client can position the "New" divider even when older pages are unloaded.
- **markRead is optimistic fire-and-forget** (pattern matches `notifications-client.tsx`): zero the store count immediately, mutate in background, reconcile on next `conversations` refetch. Triggered on thread open, and when a message arrives while the thread is open and the user is at/near the bottom. No subscription echo (lastReadAt is only consumed by its owner).
- **Suggestions/mutual-friend lookups are direction-agnostic.** `Friendship` has `@@unique([requesterId, addresseeId])`, so both (A→B) and (B→A) rows can exist. All exclusions and matches use `OR: [{requesterId: me}, {addresseeId: me}]`. This also fixes a pre-existing bug: `sendRequest` only checks the exact direction, so A→B pending + B→A pending can coexist — duplicate-direction requests must be rejected in the same PR.
- **Bottom nav grows to 6 items** (Feed, Bible, Friends, Groups, Books, Chat). Verify at 320/360px in Playwright; if overflow, compact labels (icon + short label), never drop items.

---

## Backend Changes

### Chat module (`apps/api/src/chat/`)

**1. Authorization (must-fix):** membership validation on every path, currently missing:

| Operation | Check |
|---|---|
| `getMessages(conversationId)` | caller is a member of the conversation (and conversation `deletedAt: null`) |
| `sendMessage(input)` | caller is a member; body non-empty after trim, ≤ 2000 chars |
| `startDirectConversation(otherUserId)` | `otherUserId !== userId`; target user exists (clean GraphQL error, not raw P2003); an ACCEPTED friendship exists (either direction); no BLOCKED relation (either direction); existing conversation reused if present |
| `getOrCreateGroupConversation(groupId)` | caller is an ACTIVE member of the group (guard before it is resolver-exposed) |
| `messageAdded` subscription | delivered only to conversation members (see below) |

Membership errors → `GraphQLError`/Nest exception mapped to a friendly message ("You don't have access to this conversation").

**2. Subscription generalization.** `sendMessage` publishes `{ messageAdded: msg, memberIds }` where `memberIds` comes from one membership query per send. Resolver filter becomes synchronous: when `conversationId` arg is present, `payload.messageAdded.conversationId === variables.conversationId && payload.memberIds.includes(userId)`; when absent, `payload.memberIds.includes(userId)`. `userId` read from `context.req.user.id` (populated by `JwtAuthGuard` at subscribe time; pin with a test). SDL change is breaking (`conversationId: String!` → nullable) — web is the only client; deploy API + web together.

**3. `Conversation` type gains** (all service-computed, no Prisma schema changes):
- `otherUser: User` — the other member for DIRECT conversations.
- `group: Group`-lite (id, name, avatar/cover) — for GROUP conversation rows (title/avatar rendering).
- `lastMessage: Message` — preview + timestamp (already fetched: `messages: { take: 1, orderBy: createdAt desc }`).
- `unreadCount: Int` — from the raw aggregate.
- `myLastReadAt: DateTime` — for the "New" divider.

`listConversations` capped at `take: 50`, ordered by `updatedAt desc` (existing). Keep the member/user includes; compute the aggregate in one `$queryRaw` GROUP BY keyed by conversationId, then hydrate.

**4. `Message` type gains `sender: User`** — field resolver (or service include) on `Message`; never embedded in the NOTIFY payload.

**5. `MessageConnection` drops `totalCount`** (currently `0, // lazy` — a lying value; nothing consumes it; `hasNextPage` drives pagination).

**6. `markRead`** unchanged (service already correct), but add a membership guard.

### Friends module (`apps/api/src/friends/`)

**7. `sendRequest` duplicate-direction fix:** reject when *any* non-REJECTED friendship row exists between the pair in either direction (both the pending-coexistence bug and BLOCKED handling).

**8. New `suggestedFriends(limit: Int = 5): [User!]!` query:**
- Clamp limit 1–20.
- Exclude: self, existing ACCEPTED friends, any PENDING/BLOCKED row involving me (both directions), and users I've REJECTED (re-suggesting a decline is hostile) — exclude REJECTED rows where I am the addressee (I declined); a request *I* sent that was rejected counts as "not a friend" but may be re-suggested? Decision: exclude any REJECTED row involving me in either direction for v1 simplicity — the declined direction is the common case.
- Rank by count of mutual ACCEPTED friendships (query ACCEPTED friendships of my friends, count occurrences of the "other party").
- Empty-graph fallback: newest members (`users.service` already orders by `createdAt desc`), capped at limit.
- Hydrate top-N with `displayName`, `avatarUrl`, `bio`.

**9. `removeFriend` authorization fix (pre-existing hole):** resolver must pass `@CurrentUser()` and the service must verify the friendship involves the caller before deleting (`friends.resolver.ts:51-55` currently deletes any friendship by ID).

### Users module (`apps/api/src/users/`)

**10. `userProfile` gains `mutualFriends: [User!]!`** — requires `@CurrentUser()` in the resolver (currently absent; guard already applied). Users who are ACCEPTED friends with both the caller and the viewed user, capped at 10. Empty list when viewing own profile.

### PubSub hardening (`apps/api/src/chat/pubsub.service.ts`)

**11.** Add error logging + reconnect-or-exit on the LISTEN client (currently `client.on('error', () => {})` — silent app-wide realtime death). Document the `triggers.shift()` single-wake behavior (fine at this scale; add a comment). No new channels needed.

---

## GraphQL API Surface (delta)

```graphql
# Changed
messageAdded(conversationId: ID): Message!          # arg now nullable; membership-filtered
conversations: [Conversation!]!                      # + otherUser, group, lastMessage, unreadCount, myLastReadAt
messages(conversationId: ID!, cursor: String, limit: Int): MessageConnection!  # - totalCount
userProfile(id: ID!): UserProfile                    # + mutualFriends
sendFriendRequest(addresseeId: ID!): Friendship!     # duplicate-direction rejection

# New
suggestedFriends(limit: Int = 5): [User!]!

# Unchanged
startDirectConversation(otherUserId: ID!): Conversation!  # + ACCEPTED-friendship requirement
sendMessage(input: SendMessageInput!): Message!           # + membership + 2000-char cap
markConversationRead(conversationId: ID!): Boolean!       # + membership guard
```

`SendMessageInput.body` gains validation: non-empty after trim, ≤ 2000 chars.

---

## Web — Chat UI

### Routes & layout

- `apps/web/src/app/(app)/chat/layout.tsx` — two-pane shell: left = conversation list (fixed width, scrollable), right = `<Outlet/>`/children = thread. On mobile: single column; list page shows the list, thread page shows the thread full-width with a back button.
- `apps/web/src/app/(app)/chat/page.tsx` + `chat-client.tsx` — conversation list (replaces placeholder). States: loading skeletons, empty ("No conversations yet — message a friend from their profile", links to `/friends`), error toast + retry.
- `apps/web/src/app/(app)/chat/[id]/page.tsx` + `chat-client.tsx` — message thread. Not-found state ("Conversation not found", back to `/chat`).

### Conversation list rows

Avatar, display name (or group name), `lastMessage` body preview (`line-clamp-1`), relative time, unread count chip (`primary` pill, hidden when 0). Newest first. Row tap → `/chat/[id]`. On GROUP rows: group name + cover avatar, no per-user avatar.

### Thread

- Message bubbles: own messages right-aligned (`primary`-tinted), others left-aligned with avatar + sender name. Relative timestamp. Date dividers where sensible (reuse `relativeTime` util — see below).
- "New" divider: positioned at `myLastReadAt` boundary when `unreadCount > 0`; clears after markRead.
- Pagination: scroll to top loads older via `messages(cursor)`; append-prev into store (dedupe by `node.id`); loading spinner at top while fetching.
- Composer: textarea (Enter to send, Shift+Enter newline), send button, disabled while sending or when empty. Pending message appended optimistically to the thread; reconciled on mutation result / subscription echo (dedupe by id).
- On mount: fetch last page, subscribe to thread events (already covered by the global subscription — filter by conversationId client-side), markRead when thread opened or when receiving while at/near bottom.

### Chat store (`apps/web/src/store/chat-store.ts`, alongside `auth.ts`/`ui.ts`)

Data-only Zustand store + a `ChatProvider` mounted in `AppShell` next to `ProfileSheetProvider` (subscription wiring lives in the provider, not the store):

- State: `conversations` (list + unread), `totalUnread`, `messagesByConversation: Record<id, Message[]>`, `pendingByConversation`, `lastFetchAt`.
- Actions: `setConversations`, `upsertConversation` (on new message: bump `updatedAt`, update `lastMessage`, increment unread unless thread open & at bottom), `setMessages`, `prependMessages`, `appendMessage` (dedupe by id), `clearUnread`, `reset`.
- Delete the inert `messages` typePolicy (`apollo-client.ts:270-275`) — chat state lives exclusively in the store, never the cache.
- Subscription: `messageAdded` (no arg) once per auth session — deps `[userId]` only (the existing `bell-icon.tsx:53-74` pattern self-unsubscribes via `isSubscribed` in deps; do **not** copy it), teardown on unmount/logout.

### Wiring the Message button

- `users/[id]/user-profile-client.tsx:235-241`: replace the "coming soon" toast. Button shows **only when friendship status is ACCEPTED** (friends-only policy). Tap → `startDirectConversation(otherUserId)` → `router.push(/chat/${id})` (conversation id from mutation result). Loading state on button while mutating.
- The profile **sheet** (`user-profile-sheet.tsx`) has no Message button today (only Add Friend / View Full Profile) — add one for friends (ACCEPTED) for consistency, same flow. [Oracle verified sheet has no button; adding it is a small bonus consistent with the feature.]

---

## Web — Friends improvements

- `friends-client.tsx:216` suggested row: replace mock cards with `suggestedFriends(limit: 5)`; hide section when empty (no more unconditional mock rendering); add button → `sendFriendRequest` → card moves to "Pending" state → removed on accept/refresh.
- `user-profile-client.tsx:168,255-272` mutual friends: render real `mutualFriends` (max 10); hide section when 0 or viewing own profile.

---

## Navigation

- `SIDEBAR_NAV_ITEMS` (`constants.ts:79`): add `{ label: 'Chat', href: '/chat', icon: 'chat_bubble' }` after Friends. `BOTTOM_NAV_ITEMS` inherits (6 items — verify at 320px, compact labels if needed).
- Badges are **not** added to the static `as const` array — rendered by href in `Sidebar`/`BottomNav`: `NavItem` (`nav-item.tsx:33-44`) gains an optional `badge` prop (count or dot); both nav components read `totalUnread` from the chat store and render a badge on the `/chat` item (count, capped "9+").

---

## Real-time flow (end-to-end)

1. App loads → `ChatProvider` subscribes to `messageAdded` (no arg) → store seeded from `conversations` query on `/chat` mount.
2. A sends message → `sendMessage` mutation → optimistic append in A's thread → publish `{ messageAdded, memberIds }` → B's subscription delivers → B's store: thread append (if open) + unread increment + `lastMessage` update + nav badge bump.
3. B opens `/chat` → list shows unread chips; opens thread → markRead (optimistic clear + background mutation) → "New" divider clears.
4. A's thread updates `updatedAt` ordering via store `upsertConversation` on echo.
5. Friend request flow unchanged (existing notifications + bell, with `sendRequest` duplicate-direction fix).

---

## Error handling & edge cases

- Membership-denied / non-friend DM attempt → GraphQL error → toast "You can only message your friends" (and Message button hidden on non-friend profiles, so this path is mostly defensive).
- Send failure → pending message marked failed with retry affordance (simple: remove + toast; retry by resending).
- Subscription drop → `graphql-ws` auto-reconnect (existing); store refetches `conversations` on reconnect.
- Duplicate-direction friend request → friendly error toast.
- Self-chat → guarded server-side (clean error, not raw Prisma P2002).
- Same-millisecond cursor skip (cursor = `createdAt.toISOString()`, `createdAt < cursor`) — accepted v1 limitation (seeds/bursts may skip a message on old-page load; not user-visible in normal use).
- Concurrent first-DM race can create duplicate conversations (no unique on DIRECT pair) — accepted v1 limitation; `getOrCreateDirectConversation` returns one deterministically for the client.

---

## Testing

- **API integration** (`apps/api/test/chat.integration.spec.ts`, `friends.integration.spec.ts` — extend existing):
  - Authorization matrix at the **GraphQL boundary**: supertest with JWT against `app.getHttpServer()` (the existing specs test `ChatService` directly — exactly why the M1 gaps were never caught): non-member getMessages/sendMessage rejected; non-friend startDirectConversation rejected; blocked pair rejected; self-chat rejected.
  - Unread counts: fresh conversation counts all non-self messages; after markRead → 0; new message → 1; raw aggregate correctness.
  - Subscription: filter unit tests (arg present/absent, non-member excluded) + pubsub delivery.
  - `suggestedFriends`: exclusion matrix (self/friends/pending/blocked/rejected both directions), ranking by mutual count, limit clamp, empty-graph fallback.
  - `mutualFriends` correctness; `removeFriend` authorization.
  - Duplicate-direction sendRequest rejection.
- **Web component specs**: conversation list (render, unread chip, empty state), thread (render, send, pagination append-prev, New divider), store (dedupe, unread transitions), Message button visibility per friendship status. Replace `chat.spec.tsx:13` "coming soon" assertion with the real page spec.
- **E2E (Playwright)**: full flow — A sends request → B accepts → A opens B's profile → Message → realtime chat both ways (two contexts) → unread chips + nav badge → mark-read clears → bottom nav fits at 320px.
- **Verification runs:** `pnpm test`, `pnpm lint`, `pnpm build` (turbo). Dev smoke: two logged-in users chat in realtime.

---

## Stitch design (project 10935178473689115895)

Generate screens matching the established design system (paper `#FFF6E8`, amber primary `#845400`/`#f4a11c`, teal secondary `#006b5e`, Space Grotesk headlines, Newsreader body, Manrope small labels, `rounded-md` cards, outline-variant borders, 1200px max content):

1. Chat conversation list — desktop (list pane + empty thread pane) and mobile.
2. Chat thread — desktop two-pane and mobile full-width with back button; unread "New" divider; own vs other bubbles.
3. Empty state — "No conversations yet" (link to friends).
4. Nav badge on Chat item (sidebar + bottom nav).

Web implementation follows these screens; visual fidelity is an acceptance criterion.

---

## Known limitations (accepted for v1)

- Group conversations render in the list (title/avatar) but have no thread UI this phase.
- No typing indicators / read receipts / message edit-delete.
- Concurrent first-DM duplicate conversation race; same-millisecond cursor skip.
- Bottom nav 6 items is above MD3's 3–5 guidance — verified compact at 320px via e2e; revisit if analytics show it hurts.