# Transformlit Database Design

Date: 2026-06-25

## Overview

Single-instance PostgreSQL schema for Transformlit. UUID primary keys, audit fields on core tables, soft deletes. GraphQL subscriptions backed by Postgres `LISTEN`/`NOTIFY` — no Redis at MVP.

## Conventions

- **Database**: PostgreSQL (Azure Flexible Server Burstable B1ms)
- **ORM**: Prisma 7
- **Primary keys**: UUID (`@default(uuid())`)
- **Timestamps**: `createdAt`, `updatedAt` (UTC, auto-handled by Prisma)
- **Soft deletes**: `deletedAt` (nullable `DateTime`)
- **Audit**: `createdById`, `updatedById` (nullable, reference `User`)
- **Tenancy**: Single-instance — **no `tenantId` columns**
- **Casing**: `camelCase` in Prisma, `snake_case` in Postgres via `@map`

## Enums

### UserRole
- `ADMIN` — full platform access, manage users, upload books, publish announcements
- `MODERATOR` — moderate groups/chat, manage announcements
- `MEMBER` — standard member

### GroupVisibility
- `PUBLIC` — visible to all, joinable by anyone
- `PRIVATE` — visible to members, join by request

### GroupMemberRole
- `OWNER` — group creator, full group management
- `MEMBER` — standard group member

### GroupMemberStatus
- `ACTIVE` — active member
- `PENDING` — awaiting approval (private groups)
- `BANNED` — removed by owner

### FriendshipStatus
- `PENDING` — request sent, awaiting response
- `ACCEPTED` — friends
- `REJECTED` — declined
- `BLOCKED` — blocked by addressee

### ConversationType
- `DIRECT` — one-to-one chat
- `GROUP` — group conversation

### BookAccessLevel
- `FREE` — available to all authenticated users
- `RESTRICTED` — requires explicit access grant

### BookStatus
- `DRAFT` — not yet published
- `PUBLISHED` — visible to eligible users
- `COMING_SOON` — shown as teaser, no content

### AnnouncementStatus
- `DRAFT` — editing
- `PUBLISHED` — live
- `ARCHIVED` — expired / manually archived

### NotificationType
- `FRIEND_REQUEST` — someone sent a friend request
- `FRIEND_ACCEPTED` — request accepted
- `GROUP_INVITE` — invited to join a group
- `GROUP_UPDATE` — role change, member event
- `ANNOUNCEMENT` — new published announcement
- `SYSTEM` — admin message, maintenance

## Tables

### User
```
model User {
  id            String    @id @default(uuid())
  email         String    @unique
  emailNormalized String  @unique
  passwordHash  String?              // null for SSO-only users
  displayName   String
  avatarUrl     String?
  bio           String?
  role          UserRole  @default(MEMBER)
  status        String    @default("active")
  lastLoginAt   DateTime?
  createdAt     DateTime  @default(now())
  updatedAt     DateTime  @updatedAt
  deletedAt     DateTime?

  identities       Identity[]
  refreshTokens    RefreshToken[]
  friendshipsAs   Friendship[]  @relation("Requester")
  friendshipsTo   Friendship[]  @relation("Addressee")
  groupMemberships GroupMember[]
  sentMessages    Message[]
  conversationMembers ConversationMember[]
  bookAccess      BookAccess[]
  readProgress    BookProgress[]
  bookmarks       Bookmark[]
  highlights      Highlight[]
  notifications   Notification[]
  notificationsCreated Notification[] @relation("CreatedNotifications")
  announcements    Announcement[]       // authored by
  auditLogs       AuditLog[]

  @@index([emailNormalized])
  @@index([role, status])
  @@map("users")
}
```

### Identity (SSO)
```
model Identity {
  id         String   @id @default(uuid())
  userId     String
  user       User     @relation(fields: [userId], references: [id], onDelete: Cascade)
  provider   String            // "google", "microsoft", "facebook"
  providerId String            // subject / sub from provider
  email      String
  createdAt  DateTime @default(now())

  @@unique([provider, providerId])
  @@index([userId])
  @@map("identities")
}
```

### RefreshToken
```
model RefreshToken {
  id          String    @id @default(uuid())
  userId      String
  user        User      @relation(fields: [userId], references: [id], onDelete: Cascade)
  tokenHash   String    @unique            // SHA-256 of raw token
  familyId    String                       // all tokens in a rotation family share this
  expiresAt   DateTime
  revokedAt   DateTime?                    // rotation: mark old one revoked
  replacedById String?                     // points to the new token that replaced this
  createdAt   DateTime  @default(now())

  @@index([userId, familyId])
  @@map("refresh_tokens")
}
```

### Group
```
model Group {
  id          String          @id @default(uuid())
  name        String
  slug        String          @unique
  description String?
  visibility  GroupVisibility @default(PUBLIC)
  createdById String?
  createdBy   User?           @relation(fields: [createdById], references: [id])
  createdAt   DateTime        @default(now())
  updatedAt   DateTime        @updatedAt
  deletedAt   DateTime?

  members     GroupMember[]
  conversations Conversation[]

  @@index([visibility])
  @@index([name])
  @@map("groups")
}
```

### GroupMember
```
model GroupMember {
  id        String            @id @default(uuid())
  groupId   String
  group     Group             @relation(fields: [groupId], references: [id], onDelete: Cascade)
  userId    String
  user      User              @relation(fields: [userId], references: [id], onDelete: Cascade)
  role      GroupMemberRole   @default(MEMBER)
  status    GroupMemberStatus @default(PENDING)
  joinedAt  DateTime          @default(now())
  createdAt DateTime          @default(now())
  updatedAt DateTime          @updatedAt

  @@unique([groupId, userId])
  @@index([userId])
  @@index([groupId, status])
  @@map("group_members")
}
```

### Friendship
```
model Friendship {
  id          String           @id @default(uuid())
  requesterId String
  requester   User             @relation("Requester", fields: [requesterId], references: [id], onDelete: Cascade)
  addresseeId String
  addressee   User             @relation("Addressee", fields: [addresseeId], references: [id], onDelete: Cascade)
  status      FriendshipStatus @default(PENDING)
  createdAt   DateTime         @default(now())
  updatedAt   DateTime         @updatedAt

  @@unique([requesterId, addresseeId])
  @@index([requesterId, status])
  @@index([addresseeId, status])
  @@map("friendships")
}
```

### Conversation
```
model Conversation {
  id        String           @id @default(uuid())
  type      ConversationType
  groupId   String?
  group     Group?           @relation(fields: [groupId], references: [id])
  createdAt DateTime         @default(now())
  updatedAt DateTime         @updatedAt
  deletedAt DateTime?

  members   ConversationMember[]
  messages  Message[]

  @@index([type])
  @@map("conversations")
}
```

### ConversationMember
```
model ConversationMember {
  id             String    @id @default(uuid())
  conversationId String
  conversation   Conversation @relation(fields: [conversationId], references: [id], onDelete: Cascade)
  userId         String
  user           User      @relation(fields: [userId], references: [id], onDelete: Cascade)
  lastReadAt    DateTime?
  joinedAt      DateTime  @default(now())
  createdAt     DateTime  @default(now())
  updatedAt     DateTime  @updatedAt

  @@unique([conversationId, userId])
  @@index([userId])
  @@map("conversation_members")
}
```

### Message
```
model Message {
  id             String   @id @default(uuid())
  conversationId String
  conversation   Conversation @relation(fields: [conversationId], references: [id], onDelete: Cascade)
  senderId       String
  sender         User     @relation(fields: [senderId], references: [id])
  body           String
  editedAt       DateTime?
  createdAt      DateTime @default(now())
  updatedAt      DateTime @updatedAt
  deletedAt      DateTime?

  @@index([conversationId, createdAt(sort: Desc)])
  @@index([senderId])
  @@map("messages")
}
```

### Book
```
model Book {
  id            String         @id @default(uuid())
  title         String
  author        String?
  description   String?
  blobPath      String?                           // PDF path in Azure Blob (null for coming-soon)
  coverUrl      String?                           // cover image blob URL
  price         Decimal?       @db.Decimal(10, 2) // null = free
  currency      String?        @default("USD")
  accessLevel   BookAccessLevel @default(FREE)
  status        BookStatus     @default(DRAFT)
  totalPages    Int?                               // populated on upload
  createdById   String?
  createdBy     User?          @relation(fields: [createdById], references: [id])
  publishedAt   DateTime?
  createdAt     DateTime       @default(now())
  updatedAt     DateTime       @updatedAt
  deletedAt     DateTime?

  access         BookAccess[]
  progress       BookProgress[]
  bookmarks      Bookmark[]
  highlights     Highlight[]

  @@index([status])
  @@index([title])
  @@map("books")
}
```

### BookAccess
```
model BookAccess {
  id       String   @id @default(uuid())
  bookId   String
  book     Book     @relation(fields: [bookId], references: [id], onDelete: Cascade)
  userId   String
  user     User     @relation(fields: [userId], references: [id], onDelete: Cascade)
  role     String?  // group role for group-scoped access
  grantedAt DateTime @default(now())
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt

  @@unique([bookId, userId])
  @@index([userId])
  @@map("book_access")
}
```

### BookProgress
```
model BookProgress {
  id          String    @id @default(uuid())
  userId      String
  user        User      @relation(fields: [userId], references: [id], onDelete: Cascade)
  bookId      String
  book        Book      @relation(fields: [bookId], references: [id], onDelete: Cascade)
  currentPage Int       @default(1)
  scrollY     Float?                  // restore scroll position
  completedAt DateTime?
  lastReadAt  DateTime  @default(now())
  createdAt   DateTime  @default(now())
  updatedAt   DateTime  @updatedAt

  @@unique([userId, bookId])
  @@index([bookId])
  @@map("book_progress")
}
```

### Bookmark
```
model Bookmark {
  id         String   @id @default(uuid())
  userId     String
  user       User     @relation(fields: [userId], references: [id], onDelete: Cascade)
  bookId     String
  book       Book     @relation(fields: [bookId], references: [id], onDelete: Cascade)
  page       Int
  label      String?
  color      String?               // optional color tag
  createdAt  DateTime @default(now())

  @@index([userId, bookId])
  @@map("bookmarks")
}
```

### Highlight
```
model Highlight {
  id         String   @id @default(uuid())
  userId     String
  user       User     @relation(fields: [userId], references: [id], onDelete: Cascade)
  bookId     String
  book       Book     @relation(fields: [bookId], references: [id], onDelete: Cascade)
  page       Int
  text       String                  // the highlighted text excerpt
  note       String?                 // user's annotation
  color      String?                 // highlight color
  createdAt  DateTime @default(now())
  updatedAt  DateTime @updatedAt

  @@index([userId, bookId])
  @@map("highlights")
}
```

### Announcement
```
model Announcement {
  id                String             @id @default(uuid())
  title             String
  body              String
  status            AnnouncementStatus @default(DRAFT)
  publishAt         DateTime?          // scheduled publication
  expiresAt         DateTime?          // auto-archive after
  publishedAt       DateTime?
  publishedById     String?
  publishedBy       User?              @relation(fields: [publishedById], references: [id])
  createdById       String?
  createdBy         User?              @relation(fields: [createdById], references: [id])
  createdAt         DateTime           @default(now())
  updatedAt         DateTime           @updatedAt
  deletedAt         DateTime?

  @@index([status, publishAt(sort: Desc)])
  @@index([expiresAt])
  @@map("announcements")
}
```

### VerseOfTheDay
```
model VerseOfTheDay {
  id        String   @id @default(uuid())
  date      DateTime @unique          // day this verse is for (UTC)
  text      String                    // the verse text
  reference String                    // "John 3:16"
  version   String   @default("KJV") // Bible version
  fetchedAt DateTime @default(now())  // when Our Manna API was called

  @@index([date(sort: Desc)])
  @@map("verse_of_day")
}
```

### Notification
```
model Notification {
  id        String           @id @default(uuid())
  userId    String
  user      User             @relation(fields: [userId], references: [id], onDelete: Cascade)
  type      NotificationType
  payload   Json?                       // flexible: { friendRequestId, groupId, announcementId, ... }
  readAt    DateTime?
  createdById String?
  createdBy User?              @relation("CreatedNotifications", fields: [createdById], references: [id])
  createdAt DateTime          @default(now())

  @@index([userId, readAt, createdAt(sort: Desc)])
  @@map("notifications")
}
```

### AuditLog
```
model AuditLog {
  id         String   @id @default(uuid())
  userId     String
  user       User     @relation(fields: [userId], references: [id])
  action     String                  // "USER_CREATED", "BOOK_UPLOADED", "GROUP_JOINED", etc.
  targetType String?                 // "Book", "Group", "User"
  targetId   String?
  payload    Json?
  ipAddress  String?
  userAgent  String?
  createdAt  DateTime @default(now())

  @@index([userId, createdAt(sort: Desc)])
  @@index([action, createdAt(sort: Desc)])
  @@map("audit_logs")
}
```

## Relationship Notes

- `User` is the central entity. All domain tables reference it.
- `Identity` allows multiple SSO providers per user (e.g., same email via Google AND Microsoft).
- `RefreshToken` uses a **token family** pattern — rotating refresh. Each rotation revokes the previous and creates a new token linked via `replacedById`. Reuse of a revoked token invalidates the entire family (detected by querying `familyId` where `revokedAt IS NOT NULL`).
- `Conversation` can be `DIRECT` (1-to-1, no group) or `GROUP` (linked to a Group). Direct conversations have exactly 2 members.
- `Book` with `status: COMING_SOON` has no `blobPath` — teaser listing only.
- `BookAccess` grants individual user-level access. Group-level access via `Book.role` check against `GroupMember.role`.
- `VerseOfTheDay` is a cache table. The NestJS feed service calls Our Manna API once per day, writes the result, and serves subsequent requests from this table.
- `Notification` uses a `Json` payload for flexibility. The client reads `type` to render the correct notification card.
- `AuditLog` is append-only. Write-heavy operations (chat messages) do NOT create audit entries — only sensitive actions (auth, admin operations, access grants).

## Indexing Strategy

- All foreign keys indexed for JOIN performance.
- Read-heavy query paths (messages by conversation, notifications by user, announcements by status) have composite covering indexes.
- `createdAt DESC` sort on feed/chat indexes avoids explicit sort operations.
- UUID primary keys use B-tree default indexes.

## Soft Delete Behavior

- Core tables (`User`, `Group`, `Book`, `Announcement`, `Message`) support soft deletes via `deletedAt`.
- All GraphQL queries default to `WHERE "deletedAt" IS NULL`. Admin resolvers can include soft-deleted rows for audit/recovery.
- Child records (messages in a deleted conversation, members in a deleted group) cascade or are separately soft-deleted in service logic.
- Hard-deletes: only for non-critical data (`RefreshToken` on rotation, old `Notification` rows via scheduled cleanup).

## Migrations

- Prisma Migrate via `npx prisma migrate dev` / `npx prisma migrate deploy`
- Tracked in version control under `apps/api/prisma/migrations/`
- Migration applied in CI/CD: GitHub Actions runs `prisma migrate deploy` against the target database before deploying a new API revision
- Down migrations handled by creating a new migration that reverses the previous change — Prisma does not natively support rollback
