# API Unit Tests — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Write comprehensive unit tests for all 8 API domain modules (services, resolvers, guards, strategies) to achieve 80%+ service coverage, 70%+ resolver coverage, and 90%+ guard/strategy coverage.

**Architecture:** All tests use Jest with mocked PrismaService. Each service test creates a mock Prisma client with the relevant model namespaces. Resolver tests verify delegation to services. Guard and strategy tests verify authentication/authorization logic.

**Tech Stack:** Jest 29, ts-jest, @nestjs/testing, @types/jest

## Global Constraints

- Use Jest (not Vitest) for all tests
- All test files use `*.spec.ts` naming convention
- Unit tests co-located with source files in `src/`
- Mock PrismaService — no real database for unit tests
- Coverage thresholds: services 80%, resolvers 70%, guards/strategies 90%
- PrismaService is mocked as a deep object with model namespaces (e.g., `prisma.user.findUnique`)
- All services inject `PrismaService` as `private readonly prisma`
- Auth service additionally uses `argon2`, `JwtService`, and `node:crypto`

---

## File Structure

### New Test Files

| File | Responsibility |
|------|---------------|
| `src/auth/auth.service.spec.ts` | Auth service: register, login, refresh, OAuth, validateUser |
| `src/auth/auth.resolver.spec.ts` | Auth resolver: mutation delegation |
| `src/auth/guards/jwt-auth.guard.spec.ts` | JWT guard: request extraction |
| `src/auth/guards/roles.guard.spec.ts` | Roles guard: role checking |
| `src/auth/strategies/jwt.strategy.spec.ts` | JWT strategy: user validation |
| `src/users/users.service.spec.ts` | Users service: findById, findByEmail, searchUsers, updateProfile, listUsers |
| `src/users/users.resolver.spec.ts` | Users resolver: query/mutation delegation |
| `src/groups/groups.service.spec.ts` | Groups service: CRUD, membership, visibility, search |
| `src/groups/groups.resolver.spec.ts` | Groups resolver: query/mutation delegation |
| `src/friends/friends.service.spec.ts` | Friends service: send/accept/reject/remove, validation |
| `src/friends/friends.resolver.spec.ts` | Friends resolver: query/mutation delegation |
| `src/chat/chat.service.spec.ts` | Chat service: conversations, messages, pagination, pubsub |
| `src/chat/chat.resolver.spec.ts` | Chat resolver: query/mutation/subscription delegation |
| `src/books/books.service.spec.ts` | Books service: CRUD, PDF, progress, bookmarks, highlights |
| `src/books/books.resolver.spec.ts` | Books resolver: query/mutation delegation |
| `src/feed/feed.service.spec.ts` | Feed service: announcements, verse of day, caching |
| `src/feed/feed.resolver.spec.ts` | Feed resolver: query/mutation delegation |
| `src/notifications/notifications.service.spec.ts` | Notifications service: list, count, mark read, create |
| `src/notifications/notifications.resolver.spec.ts` | Notifications resolver: query/mutation delegation |

---

### Task 1: Auth Service Unit Tests

**Files:**
- Test: `apps/api/src/auth/auth.service.spec.ts`

**Interfaces:**
- Consumes: `AuthService` from `./auth.service`
- Mocks: `PrismaService` (user, refreshToken models), `JwtService`, `argon2`, `node:crypto`
- Tests: registerLocal, loginLocal, refreshTokens, findOrCreateOAuthUser, validateUser

- [ ] **Step 1: Write the auth service tests**

Create `apps/api/src/auth/auth.service.spec.ts` with tests for:

**registerLocal:**
- Hashes password with argon2
- Normalizes email (lowercase, trim)
- Creates user in Prisma
- Generates access + refresh tokens
- Returns `{ accessToken, refreshToken, user }`
- Throws on duplicate email (Prisma unique constraint)

**loginLocal:**
- Normalizes email, finds user by emailNormalized
- Throws `UnauthorizedException` if user not found
- Throws `UnauthorizedException` if no passwordHash (OAuth user)
- Verifies password with argon2
- Throws `UnauthorizedException` if password invalid
- Updates lastLoginAt
- Generates tokens
- Returns `{ accessToken, refreshToken, user }`

**refreshTokens:**
- Hashes token with SHA-256
- Finds refresh token by hash
- Throws `UnauthorizedException` if not found
- Throws `UnauthorizedException` if revoked
- Throws `UnauthorizedException` if expired
- Revokes entire family if token is revoked
- In transaction: revokes old token, creates new tokens
- Returns new `{ accessToken, refreshToken, user }`

**findOrCreateOAuthUser:**
- Finds existing identity by provider + providerId
- If found: updates lastLoginAt, generates tokens
- If not found: creates user + identity, generates tokens

**validateUser:**
- Finds user by id where deletedAt is null
- Returns null if not found

- [ ] **Step 2: Run tests**

Run: `pnpm --filter @transformlit/api test -- auth.service.spec`
Expected: All tests pass

- [ ] **Step 3: Commit**

```bash
git add apps/api/src/auth/auth.service.spec.ts
git commit -m "test: add auth service unit tests"
```

---

### Task 2: Auth Resolver + Guards + Strategies Unit Tests

**Files:**
- Test: `apps/api/src/auth/auth.resolver.spec.ts`
- Test: `apps/api/src/auth/guards/jwt-auth.guard.spec.ts`
- Test: `apps/api/src/auth/guards/roles.guard.spec.ts`
- Test: `apps/api/src/auth/strategies/jwt.strategy.spec.ts`

- [ ] **Step 1: Write auth resolver tests**

Create `apps/api/src/auth/auth.resolver.spec.ts`:
- Mock AuthService
- Test registerLocal mutation delegates to service
- Test loginLocal mutation delegates to service
- Test refreshToken mutation delegates to service
- Verify return types match AuthPayload

- [ ] **Step 2: Write JWT auth guard tests**

Create `apps/api/src/auth/guards/jwt-auth.guard.spec.ts`:
- Test getRequest extracts request from GraphQL context
- Test it extends AuthGuard('jwt')

- [ ] **Step 3: Write roles guard tests**

Create `apps/api/src/auth/guards/roles.guard.spec.ts`:
- Mock Reflector
- Test canActivate returns true when no roles required
- Test canActivate returns true when user has required role
- Test canActivate returns false when user lacks required role
- Test canActivate returns false when no user in context

- [ ] **Step 4: Write JWT strategy tests**

Create `apps/api/src/auth/strategies/jwt.strategy.spec.ts`:
- Mock PrismaService
- Test validate finds user by id where deletedAt is null
- Test validate throws UnauthorizedException if user not found
- Test validate returns `{ id, role }` from user

- [ ] **Step 5: Run tests**

Run: `pnpm --filter @transformlit/api test -- auth.resolver.spec guards roles jwt.strategy`
Expected: All tests pass

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/auth/auth.resolver.spec.ts apps/api/src/auth/guards/ apps/api/src/auth/strategies/
git commit -m "test: add auth resolver, guards, and strategy unit tests"
```

---

### Task 3: Users Service + Resolver Unit Tests

**Files:**
- Test: `apps/api/src/users/users.service.spec.ts`
- Test: `apps/api/src/users/users.resolver.spec.ts`

- [ ] **Step 1: Write users service tests**

Create `apps/api/src/users/users.service.spec.ts`:

**findById:**
- Finds user by id where deletedAt is null
- Returns null if not found

**findByEmail:**
- Normalizes email (lowercase, trim)
- Finds user by emailNormalized
- Returns null if not found

**searchUsers:**
- Searches by displayName or email (case-insensitive)
- Excludes deleted users
- Limits results (default 20)
- Orders by displayName ascending

**updateProfile:**
- Updates user with provided fields
- Returns updated user

**listUsers:**
- Lists non-deleted users
- Limits results (default 50)
- Orders by createdAt descending

- [ ] **Step 2: Write users resolver tests**

Create `apps/api/src/users/users.resolver.spec.ts`:
- Mock UsersService
- Test me query delegates to findById with current user id
- Test users query delegates to listUsers
- Test searchUsers query delegates to searchUsers
- Test updateProfile mutation delegates to updateProfile

- [ ] **Step 3: Run tests**

Run: `pnpm --filter @transformlit/api test -- users.service.spec users.resolver.spec`
Expected: All tests pass

- [ ] **Step 4: Commit**

```bash
git add apps/api/src/users/*.spec.ts
git commit -m "test: add users service and resolver unit tests"
```

---

### Task 4: Groups Service Unit Tests

**Files:**
- Test: `apps/api/src/groups/groups.service.spec.ts`

- [ ] **Step 1: Write groups service tests**

Create `apps/api/src/groups/groups.service.spec.ts`:

**listGroups:**
- Finds non-deleted groups
- Includes ACTIVE member count
- Includes user's role if userId provided
- Maps via mapGroup helper

**myGroups:**
- Finds groups where user is ACTIVE member
- Orders by updatedAt descending

**discoverGroups:**
- Finds PUBLIC groups user is NOT a member of
- Filters by category if provided
- Orders by featured desc, createdAt desc

**countActiveMembers:**
- Counts ACTIVE members for a group

**findById:**
- Finds group by id where deletedAt is null
- Returns null if not found
- Includes member count and user's role

**create:**
- Generates slug from name (lowercase, hyphens, timestamp)
- Creates group in Prisma
- Creates OWNER membership with ACTIVE status
- Returns group with memberCount: 1, myRole: 'OWNER'

**join:**
- Throws Error if group not found
- For PUBLIC groups: upserts membership with ACTIVE status
- For PRIVATE groups: upserts membership with PENDING status

**leave:**
- Deletes membership
- Returns true

**updateGroup:**
- Updates group with provided fields
- Returns updated group

**deleteGroup:**
- Soft deletes: sets deletedAt
- Returns updated group

**searchGroups:**
- Case-insensitive name search
- Limits to 20 results
- Includes ACTIVE member count

**listMembers:**
- Finds all members for a group
- Includes user objects
- Orders by joinedAt ascending

- [ ] **Step 2: Run tests**

Run: `pnpm --filter @transformlit/api test -- groups.service.spec`
Expected: All tests pass

- [ ] **Step 3: Commit**

```bash
git add apps/api/src/groups/groups.service.spec.ts
git commit -m "test: add groups service unit tests"
```

---

### Task 5: Groups Resolver Unit Tests

**Files:**
- Test: `apps/api/src/groups/groups.resolver.spec.ts`

- [ ] **Step 1: Write groups resolver tests**

Create `apps/api/src/groups/groups.resolver.spec.ts`:
- Mock GroupsService
- Test memberCount field resolver delegates to countActiveMembers
- Test groups query delegates to listGroups
- Test myGroups query delegates to myGroups
- Test discoverGroups query delegates to discoverGroups
- Test group query delegates to findById
- Test searchGroups query delegates to searchGroups
- Test groupMembers query delegates to listMembers
- Test createGroup mutation delegates to create
- Test joinGroup mutation delegates to join
- Test leaveGroup mutation delegates to leave
- Test updateGroup mutation delegates to updateGroup
- Test deleteGroup mutation delegates to deleteGroup

- [ ] **Step 2: Run tests**

Run: `pnpm --filter @transformlit/api test -- groups.resolver.spec`
Expected: All tests pass

- [ ] **Step 3: Commit**

```bash
git add apps/api/src/groups/groups.resolver.spec.ts
git commit -m "test: add groups resolver unit tests"
```

---

### Task 6: Friends Service + Resolver Unit Tests

**Files:**
- Test: `apps/api/src/friends/friends.service.spec.ts`
- Test: `apps/api/src/friends/friends.resolver.spec.ts`

- [ ] **Step 1: Write friends service tests**

Create `apps/api/src/friends/friends.service.spec.ts`:

**listFriends:**
- Finds friendships where user is requester OR addressee
- Filters by status = ACCEPTED
- Includes requester and addressee user objects
- Orders by createdAt descending

**listRequests:**
- Finds friendships where addresseeId = userId
- Filters by status = PENDING
- Includes requester user object
- Orders by createdAt descending

**sendRequest:**
- Throws Error if requesterId === addresseeId (cannot friend yourself)
- Throws Error if friendship already exists (composite key)
- Creates friendship with status PENDING
- Returns created friendship

**acceptRequest:**
- Throws Error if friendship not found
- Throws Error if addresseeId !== userId (not authorized)
- Updates status to ACCEPTED
- Returns updated friendship

**rejectRequest:**
- Throws Error if friendship not found
- Throws Error if addresseeId !== userId (not authorized)
- Updates status to REJECTED
- Returns updated friendship

**removeFriend:**
- Deletes friendship by id
- Returns deleted friendship

- [ ] **Step 2: Write friends resolver tests**

Create `apps/api/src/friends/friends.resolver.spec.ts`:
- Mock FriendsService
- Test friends query delegates to listFriends
- Test friendRequests query delegates to listRequests
- Test sendFriendRequest mutation delegates to sendRequest
- Test acceptFriendRequest mutation delegates to acceptRequest
- Test rejectFriendRequest mutation delegates to rejectRequest
- Test removeFriend mutation delegates to removeFriend

- [ ] **Step 3: Run tests**

Run: `pnpm --filter @transformlit/api test -- friends.service.spec friends.resolver.spec`
Expected: All tests pass

- [ ] **Step 4: Commit**

```bash
git add apps/api/src/friends/*.spec.ts
git commit -m "test: add friends service and resolver unit tests"
```

---

### Task 7: Chat Service Unit Tests

**Files:**
- Test: `apps/api/src/chat/chat.service.spec.ts`

- [ ] **Step 1: Write chat service tests**

Create `apps/api/src/chat/chat.service.spec.ts`:
- Mock PrismaService and PubSubService

**listConversations:**
- Finds conversations where user is a member
- Filters by deletedAt: null
- Includes members (with user), last message
- Orders by updatedAt descending

**getOrCreateDirectConversation:**
- Finds existing DIRECT conversation where both users are members
- If not found: creates new DIRECT conversation with both as members
- Returns conversation

**getOrCreateGroupConversation:**
- Finds existing GROUP conversation for groupId
- If not found: creates new GROUP conversation linked to groupId
- Returns conversation

**sendMessage:**
- Creates message via prisma.message.create
- Updates conversation updatedAt timestamp
- Publishes via pubSub.publish('messageAdded', { messageAdded: msg })
- Returns the message

**getMessages:**
- Cursor-based pagination: if cursor provided, filters createdAt < new Date(cursor)
- Fetches limit + 1 to determine hasNextPage
- Returns { edges: [{ node, cursor }], totalCount: 0, hasNextPage: boolean }

**markRead:**
- Updates conversationMember.lastReadAt to now
- Returns true

- [ ] **Step 2: Run tests**

Run: `pnpm --filter @transformlit/api test -- chat.service.spec`
Expected: All tests pass

- [ ] **Step 3: Commit**

```bash
git add apps/api/src/chat/chat.service.spec.ts
git commit -m "test: add chat service unit tests"
```

---

### Task 8: Chat Resolver Unit Tests

**Files:**
- Test: `apps/api/src/chat/chat.resolver.spec.ts`

- [ ] **Step 1: Write chat resolver tests**

Create `apps/api/src/chat/chat.resolver.spec.ts`:
- Mock ChatService and PubSubService
- Test conversations query delegates to listConversations
- Test messages query delegates to getMessages
- Test startDirectConversation mutation delegates to getOrCreateDirectConversation
- Test sendMessage mutation delegates to sendMessage
- Test markConversationRead mutation delegates to markRead
- Test messageAdded subscription returns asyncIterator from pubSub

- [ ] **Step 2: Run tests**

Run: `pnpm --filter @transformlit/api test -- chat.resolver.spec`
Expected: All tests pass

- [ ] **Step 3: Commit**

```bash
git add apps/api/src/chat/chat.resolver.spec.ts
git commit -m "test: add chat resolver unit tests"
```

---

### Task 9: Books Service Unit Tests

**Files:**
- Test: `apps/api/src/books/books.service.spec.ts`

- [ ] **Step 1: Write books service tests**

Create `apps/api/src/books/books.service.spec.ts`:
- Mock PrismaService and BlobService

**listBooks:**
- Finds non-deleted books
- Orders by createdAt descending

**findById:**
- Finds book by id where deletedAt is null
- Throws NotFoundException if not found or deleted

**uploadBook:**
- Creates book with input data and createdById
- Returns created book

**updateBook:**
- Updates book with provided fields
- Returns updated book

**uploadPdf:**
- Uploads to blob at path `books/${bookId}/${filename}`
- Updates book: sets blobPath, status: 'PUBLISHED', publishedAt
- Returns updated book

**streamPdf:**
- Finds book
- Throws NotFoundException if no blobPath
- Returns blob.streamPdf(book.blobPath)

**getProgress:**
- Finds progress by composite key userId_bookId
- Returns null if not found

**saveProgress:**
- Upserts on composite key userId_bookId
- Update: { currentPage, scrollY, lastReadAt }
- Create: { userId, bookId, currentPage, scrollY }
- Returns progress

**listBookmarks:**
- Finds bookmarks by userId and bookId
- Orders by page ascending

**addBookmark:**
- Creates bookmark with userId and input data
- Returns created bookmark

**removeBookmark:**
- Deletes bookmark by id
- Returns deleted bookmark

**listHighlights:**
- Finds highlights by userId and bookId
- Orders by page ascending

**addHighlight:**
- Creates highlight with userId and input data
- Returns created highlight

**removeHighlight:**
- Deletes highlight by id
- Returns deleted highlight

**deleteBook:**
- Soft deletes: sets deletedAt
- Returns updated book

- [ ] **Step 2: Run tests**

Run: `pnpm --filter @transformlit/api test -- books.service.spec`
Expected: All tests pass

- [ ] **Step 3: Commit**

```bash
git add apps/api/src/books/books.service.spec.ts
git commit -m "test: add books service unit tests"
```

---

### Task 10: Books Resolver Unit Tests

**Files:**
- Test: `apps/api/src/books/books.resolver.spec.ts`

- [ ] **Step 1: Write books resolver tests**

Create `apps/api/src/books/books.resolver.spec.ts`:
- Mock BooksService
- Test books query delegates to listBooks
- Test book query delegates to findById
- Test readProgress query delegates to getProgress
- Test bookmarks query delegates to listBookmarks
- Test highlights query delegates to listHighlights
- Test uploadBook mutation delegates to uploadBook
- Test updateBook mutation delegates to updateBook
- Test deleteBook mutation delegates to deleteBook
- Test saveProgress mutation delegates to saveProgress
- Test addBookmark mutation delegates to addBookmark
- Test removeBookmark mutation delegates to removeBookmark
- Test addHighlight mutation delegates to addHighlight
- Test removeHighlight mutation delegates to removeHighlight

- [ ] **Step 2: Run tests**

Run: `pnpm --filter @transformlit/api test -- books.resolver.spec`
Expected: All tests pass

- [ ] **Step 3: Commit**

```bash
git add apps/api/src/books/books.resolver.spec.ts
git commit -m "test: add books resolver unit tests"
```

---

### Task 11: Feed Service + Resolver Unit Tests

**Files:**
- Test: `apps/api/src/feed/feed.service.spec.ts`
- Test: `apps/api/src/feed/feed.resolver.spec.ts`

- [ ] **Step 1: Write feed service tests**

Create `apps/api/src/feed/feed.service.spec.ts`:

**getAnnouncements:**
- Finds where deletedAt: null, status: 'PUBLISHED'
- Filters by expiresAt: null OR expiresAt > now
- Orders by publishAt desc (nulls last)
- Limits to 50

**getAnnouncement:**
- Finds by id
- Returns null if not found

**createAnnouncement:**
- Converts publishAt and expiresAt from string to Date
- Sets createdById
- Returns created announcement

**updateAnnouncement:**
- Converts date strings to Date objects
- Updates announcement
- Returns updated announcement

**publishAnnouncement:**
- Updates: status: 'PUBLISHED', publishedAt: new Date(), publishedById: userId
- Returns updated announcement

**unpublishAnnouncement:**
- Updates: status: 'DRAFT', publishedAt: null
- Returns updated announcement

**deleteAnnouncement:**
- Soft deletes: sets deletedAt
- Returns updated announcement

**getVerseOfDay:**
- Computes today in UTC+8 timezone
- Checks cache in prisma.verseOfTheDay by date
- If cached: returns it
- If not cached: fetches from external API (mock global.fetch)
- Caches result in DB
- On fetch failure: returns static fallback (Proverbs 16:9 ESV)

- [ ] **Step 2: Write feed resolver tests**

Create `apps/api/src/feed/feed.resolver.spec.ts`:
- Mock FeedService
- Test announcements query delegates to getAnnouncements
- Test announcement query delegates to getAnnouncement
- Test verseOfDay query delegates to getVerseOfDay (no @UseGuards — public)
- Test createAnnouncement mutation delegates to createAnnouncement
- Test updateAnnouncement mutation delegates to updateAnnouncement
- Test publishAnnouncement mutation delegates to publishAnnouncement
- Test unpublishAnnouncement mutation delegates to unpublishAnnouncement
- Test deleteAnnouncement mutation delegates to deleteAnnouncement

- [ ] **Step 3: Run tests**

Run: `pnpm --filter @transformlit/api test -- feed.service.spec feed.resolver.spec`
Expected: All tests pass

- [ ] **Step 4: Commit**

```bash
git add apps/api/src/feed/*.spec.ts
git commit -m "test: add feed service and resolver unit tests"
```

---

### Task 12: Notifications Service + Resolver Unit Tests

**Files:**
- Test: `apps/api/src/notifications/notifications.service.spec.ts`
- Test: `apps/api/src/notifications/notifications.resolver.spec.ts`

- [ ] **Step 1: Write notifications service tests**

Create `apps/api/src/notifications/notifications.service.spec.ts`:

**listNotifications:**
- Finds notifications by userId
- Limits results (default 50)
- Orders by createdAt descending

**getUnreadCount:**
- Counts notifications where userId and readAt: null

**markRead:**
- Updates notification where id, userId, readAt: null
- Sets readAt to new Date()
- Returns true

**markAllRead:**
- Updates all notifications where userId and readAt: null
- Sets readAt to new Date()
- Returns true

**createNotification:**
- Creates notification with userId, type, payload, createdById
- Returns created notification

- [ ] **Step 2: Write notifications resolver tests**

Create `apps/api/src/notifications/notifications.resolver.spec.ts`:
- Mock NotificationsService
- Test notifications query delegates to listNotifications
- Test unreadNotificationCount query delegates to getUnreadCount
- Test markNotificationRead mutation delegates to markRead
- Test markAllNotificationsRead mutation delegates to markAllRead

- [ ] **Step 3: Run tests**

Run: `pnpm --filter @transformlit/api test -- notifications.service.spec notifications.resolver.spec`
Expected: All tests pass

- [ ] **Step 4: Commit**

```bash
git add apps/api/src/notifications/*.spec.ts
git commit -m "test: add notifications service and resolver unit tests"
```

---

### Task 13: Coverage Configuration + Final Verification

**Files:**
- Modify: `apps/api/jest.config.ts`

- [ ] **Step 1: Add coverage thresholds to jest.config.ts**

Update `apps/api/jest.config.ts` to add coverage thresholds:

```typescript
coverageThreshold: {
  global: {
    lines: 70,
    branches: 60,
    functions: 70,
    statements: 70,
  },
},
```

- [ ] **Step 2: Run full test suite with coverage**

Run: `pnpm --filter @transformlit/api test:cov`
Expected: All tests pass, coverage meets thresholds

- [ ] **Step 3: Run monorepo-wide tests**

Run: `pnpm test`
Expected: All packages pass (shared 127 tests, api all tests, web passWithNoTests)

- [ ] **Step 4: Commit**

```bash
git add apps/api/jest.config.ts
git commit -m "chore: add API coverage thresholds and verify all tests pass"
```

---

## Summary

This plan produces **19 test files** covering all 8 API modules:
- 8 service test files (business logic)
- 8 resolver test files (delegation)
- 3 guard/strategy test files (auth infrastructure)

Expected test count: **200-300 tests** across all files.

Coverage targets:
- Services: 80%+
- Resolvers: 70%+
- Guards/Strategies: 90%+
