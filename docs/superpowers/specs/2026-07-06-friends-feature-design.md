# Friends Feature — Design Spec

**Date:** 2026-07-06
**Status:** Approved
**Scope:** Full feature — friends management, user profiles, real-time notifications, contextual friending

---

## Overview

Implement a full social friendship system on the frontend (backend is already complete), including:

- Friends page with list, requests, search, and suggestions
- User profile page with activity feed
- Real-time notification panel and full notification center
- Contextual "Add Friend" from anywhere a user avatar/name appears
- BottomNav updated with Friends tab

The backend `Friendship` model, service, resolver, and GraphQL schema already exist. The `Notification` model and type enums (`FRIEND_REQUEST`, `FRIEND_ACCEPTED`) exist but are not wired into the friend flow.

---

## Backend Changes

### 1. Notification Wiring in FriendsService

**File:** `apps/api/src/friends/friends.service.ts`

- After `sendFriendRequest()` succeeds → create a `Notification`:
  - `type: FRIEND_REQUEST`
  - `userId: addresseeId`
  - `createdById: requesterId`
  - `payload: { friendshipId, requesterName }`
- After `acceptFriendRequest()` succeeds → create a `Notification`:
  - `type: FRIEND_ACCEPTED`
  - `userId: requesterId` (the original requester)
  - `createdById: addresseeId`
  - `payload: { friendshipId, addresseeName }`
- Import `NotificationsModule` into `FriendsModule` to access `NotificationsService`.
- Check module dependency to avoid circular references.

### 2. Real-Time Notification Subscription

- Add `notificationReceived` subscription to `NotificationsResolver`
- Filter by `userId` so users only receive their own notifications
- Use `@nestjs/graphql` `PubSub` (existing pattern from `ChatModule`)
- `NotificationsService` publishes to PubSub after creating a notification
- Wire `NotificationsModule` into `ApiModule` subscription config in `main.ts`

### 3. User Profile Query

- Add `userProfile(id: ID!)` query to `UsersResolver` returning:
  - `User` with `displayName`, `avatarUrl`, `bio`, `role`
  - `groups` (public groups only, filtered by membership)
  - `bookProgress` (currently reading books with progress)
  - `_count` of friends, groups, books

---

## Frontend — Routes

| Route | Page | Description |
|-------|------|-------------|
| `/friends` | Friends page | Friend list, incoming requests, search, suggested friends |
| `/users/[id]` | User profile | Full profile with reading activity, groups, mutual friends |
| `/notifications` | Notification center | Full chronological list, grouped by date |

---

## Frontend — Components

### New UI Components (`src/components/ui/`)

| Component | Purpose |
|-----------|---------|
| `FriendCard` | Friend row: avatar, name, bio snippet, tap opens profile sheet |
| `FriendRequestItem` | Incoming request: avatar, name, mutual groups, accept/reject buttons |
| `SuggestedFriendCard` | Compact card: avatar (center), name, interest tag, add button |
| `NotificationItem` | Single notification: colored icon circle, body text, timestamp, unread dot |
| `UserSearchInput` | Debounced search bar with dropdown results |
| `MutualGroupsBadge` | "X mutual groups" chip on user cards |

### Feature Components

| Component | Location | Purpose |
|-----------|----------|---------|
| `UserProfileSheet` | `src/components/friends/` | Slide-in modal from any avatar tap; shows profile peek + action button |
| `NotificationPanel` | `src/components/notifications/` | Slide-out drawer from TopBar bell; shows 5 recent notifications + View All |
| `BellIconWithBadge` | `src/components/notifications/` | Bell icon in TopBar with unread count badge (real-time from subscription) |

### Existing Components to Reuse

`UserAvatar`, `Card`, `Button`, `Input`, `Badge`, `SkeletonCard`, `Modal`, `Toast`, `BookCard`, `CompactGroupCard`, `CategoryChip`

---

## Frontend — Pages Detail

### `/friends` Page

**Layout (top to bottom):**

1. **Search bar** — sticky, placeholder "Search users...", debounced results dropdown with user rows + action buttons (Add Friend / Pending / Friends)
2. **Friend Requests** — collapsible section (shown only when count > 0), header: "Friend Requests (N)" with chevron toggle. Each item: avatar, name, bio snippet, Accept/Decline buttons
3. **Suggested Friends** — horizontal scrollable row of `SuggestedFriendCard` on mobile, grid on desktop
4. **Your Friends** — vertical list of `FriendCard` rows. Header: "Your Friends (N)". Empty state: illustration + "No friends yet" + search prompt

**States:**
- Loading: 3-4 skeleton cards
- Empty (no friends, no requests, no suggestions): centered illustration + search bar
- Error: toast + retry

**GraphQL operations needed:**
- `friends` query (existing)
- `friendRequests` query (existing)
- `searchUsers($query)` query (existing, Users resolver)
- `sendFriendRequest($addresseeId)` mutation (existing)
- `acceptFriendRequest($friendshipId)` mutation (existing)
- `rejectFriendRequest($friendshipId)` mutation (existing)
- `removeFriend($friendshipId)` mutation (existing)

### `/users/[id]` Page

**Layout (top to bottom, scrollable):**

1. **Header** — large avatar (96px), display name (H1), role badge, bio text, action button (Add Friend / Pending / Friends ✓ / Message)
2. **Stats row** — [N Friends] · [N Groups] · [N Books]
3. **Mutual Friends** — horizontal scroll of small avatar+name chips, only shown if > 0
4. **Currently Reading** — horizontal scroll of `BookCard` components
5. **Active Groups** — grid of `CompactGroupCard` components (2 columns mobile, 3 desktop)

**States:**
- Loading: skeleton circle + text lines + skeleton cards
- Not found: "User not found" + back button
- Error: toast + retry

**GraphQL operations needed:**
- `userProfile($id)` query (new — see backend changes)
- `sendFriendRequest`, `acceptFriendRequest`, etc. (existing)

### `/notifications` Page

**Layout:**

1. **Header** — "Notifications" (H1) + "Mark all read" link (top right)
2. **Date groups** — "Today", "Yesterday", "This Week", "Older"
3. **Items** — `NotificationItem` components: colored icon circle (blue=friend, green=group, amber=system), body text, relative timestamp, unread blue dot
4. **Empty state** — illustration + "All caught up!" + refresh button

**States:**
- Loading: 5-6 skeleton items
- Empty: illustration + message
- Error: toast + retry

**GraphQL operations needed:**
- `notifications` query (existing)
- `unreadNotificationCount` query (existing)
- `markNotificationRead($id)` mutation (existing)
- `markAllNotificationsRead` mutation (existing)
- `notificationReceived` subscription (new — see backend changes)

### Notification Panel (Overlay)

- Opens from TopBar bell icon
- Slide from right on desktop, bottom sheet on mobile
- Shows last 5 notifications; new ones slide in via subscription
- "View All" link → `/notifications`
- "Mark all read" link

### UserProfileSheet (Overlay)

- Opens from tapping any user avatar/name
- Slide from bottom on mobile, centered modal on desktop
- Shows: avatar (72px), name, role badge, bio (2 lines), stats, activity snippet, action button, "View Full Profile" link

---

## Inline "Add Friend" Integration

Any user avatar/name across the app becomes tappable to open `UserProfileSheet`:

| Location | Component |
|----------|-----------|
| Group member lists | GroupCard expanded view |
| Announcement authors | Feed announcement cards |
| Search results | `/friends` search dropdown |
| Suggested friends | Suggested cards |
| Friend cards | Friends list |
| Mutual friends | `/users/[id]` profile page |

`UserAvatar` component gets an optional `userId` prop — when provided, tapping opens `UserProfileSheet`. When null (current user), no action.

---

## Navigation Changes

### BottomNav

Current: Feed · Groups · Books · Chat

New: **Feed · Groups · Friends · Books · Chat**

Icon: `group` (person icon), label: "Friends"

### TopBar

- Bell icon shows red badge with unread count (max "9+")
- Subscribes to `notificationReceived` via GraphQL subscription
- Updates `unreadNotificationCount` in Apollo cache

---

## Real-Time Notification Flow

1. Client subscribes to `notificationReceived(userId: currentUser.id)` on app load
2. When friend request is sent → backend creates notification → publishes to PubSub → subscription delivers to addressee
3. When friend request is accepted → backend creates notification → subscription delivers to requester
4. Bell badge updates in real-time
5. If NotificationPanel is open, new items slide in
6. If `/notifications` page is open, new items appear at top of "Today" group

---

## Friend Request Flow

1. User A taps "Add Friend" on User B → `sendFriendRequest` mutation
2. Toast: "Friend request sent to [Name]"
3. Button changes to "Pending" (disabled)
4. User B gets real-time notification + sees request on `/friends`
5. User B taps Accept → `acceptFriendRequest` mutation
6. User A gets real-time notification
7. Both see each other in "Your Friends" list
8. Action button updates to "Friends ✓" on both profiles

**Edge cases:**
- Duplicate request → backend returns error, toast
- Already friends → backend returns error, toast
- Request accepted/rejected while viewing → optimistic Apollo cache update
- Remove friend → confirmation modal

---

## State Management

No new global store needed. Apollo Client cache handles all server state. Local React state for:

- Search input + debounced results
- Modal/sheet open state
- Notification panel open state
- Pagination cursors

---

## Error Handling

- All mutations wrapped in try/catch with toast feedback
- Network errors → toast + Apollo error link handles retry
- Subscription reconnection → automatic via graphql-ws
- Optimistic updates with rollback on error

---

## Testing

- Unit tests for new UI components (`FriendCard`, `FriendRequestItem`, `SuggestedFriendCard`, `NotificationItem`)
- Integration tests for pages using Apollo `MockedProvider`
- E2E tests for friend request flow (Playwright)
- Subscription tests using graphql-ws test client

---

## Design References

Stitch mockups generated for:
- Friends Page (`friends-page.html`)
- Overlays & Modals (`overlays-modals.html`)
- User Profile (`user-profile.html`)
- Notification Center (`notification-center.html`)
