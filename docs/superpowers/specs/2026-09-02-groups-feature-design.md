# Groups Feature — Design Spec

**Date:** 2026-09-02
**Status:** Approved
**Scope:** Complete the groups feature — group detail page, group posts (text + images), likes/comments, member management (approve/promote/remove/ban), group settings. Facebook-groups-inspired but scoped to this slice.

---

## Overview

The app already has Group + GroupMember models, a groups browse page, and create/join/leave/search/discover mutations. This phase completes the feature:

1. **Group detail page** (`/groups/[slug]`) — cover header with join state, tabs (Posts / Members / Settings), replacing the current placeholder.
2. **Group posts** — text + single image per post, simple like, flat text comments. Members-only visibility (posts hidden behind join).
3. **Member management** — approval of pending requests, promote to Moderator, remove, ban/unban. New `MODERATOR` role between Owner and Member.
4. **Group settings (owner)** — edit name/description/visibility/category/cover, delete group.
5. **Image uploads** — new upload path storing to Azure Blob in production, local filesystem (`images/uploads/` in repo, gitignored) in dev/test.

Non-goals (future phases): events, polls, invites, notifications wiring, group chat UI, post images beyond one per post, nested comments, reactions beyond like.

## Design Decisions

- **Upload transport:** REST `POST /uploads` (multipart, multer memory storage, JWT-guarded). The web app has no GraphQL upload client (no createUploadLink), and adding one risks the shared Apollo client used by chat subscriptions. Multer is already pinned (`>=2.2.0`). Returns `{ key }`.
- **Storage abstraction:** `UploadsService` with two drivers selected by config: Azure Blob when `AZURE_STORAGE_CONNECTION_STRING` is set (container `uploads`, public blob URL), else local filesystem under `<repo>/images/uploads` served by the API at `GET /uploads/:key`. The DB stores the value the client can use directly: full blob URL (Azure) or `uploads/<filename>` (local). Client rule: value starting with `http` → use as-is; otherwise prefix with the API origin (web already derives `API_BASE` from `NEXT_PUBLIC_API_URL`, stripping `/graphql`).
- **Posts schema:** one optional image per post (`imageKey`), soft-delete with `deletedAt` per project convention, `@@index([groupId, createdAt])`.
- **Authorization matrix** (group membership drives everything):

| Action | Allowed for |
|---|---|
| View group detail (info) | Any authenticated user |
| View posts/comments | ACTIVE members (incl. owner/moderators) |
| Create post / comment / like | ACTIVE members |
| Delete own post/comment | Author |
| Delete any post/comment | Owner, Moderator |
| Approve pending member | Owner, Moderator |
| Remove member | Owner, Moderator (not owner/other moderators) |
| Ban / unban | Owner, Moderator (not owner) |
| Promote/demote Moderator | Owner only |
| Update group settings, delete group | Owner only |

- **`myStatus` field:** the existing `Group.myRole` cannot distinguish "not a member" from "pending" (PENDING members have role MEMBER). Add `myStatus?: GroupMemberStatus` to the Group GraphQL type so the UI can render Join / Request Pending / Joined states.
- **Slug-based lookup:** web route is `[slug]`; API currently finds by id. Add `groupBySlug(slug)` query.
- **Group feed ordering:** `createdAt DESC`; comments ordered `createdAt ASC` (flat threads). `memberCount` continues to use the existing `countActiveMembers` / `_count` pattern.

## Data Model (Prisma additions)

```prisma
enum GroupMemberRole {  // extend existing
  OWNER
  MODERATOR   // NEW
  MEMBER
}

model GroupPost {
  id        String   @id @default(uuid())
  groupId   String
  group     Group    @relation(fields: [groupId], references: [id], onDelete: Cascade)
  authorId  String
  author    User     @relation(fields: [authorId], references: [id], onDelete: Cascade)
  body      String
  imageKey  String?
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt
  deletedAt DateTime?

  likes     GroupPostLike[]
  comments  GroupPostComment[]

  @@index([groupId, createdAt])
  @@index([authorId])
  @@map("group_posts")
}

model GroupPostLike {
  id        String    @id @default(uuid())
  postId    String
  post      GroupPost @relation(fields: [postId], references: [id], onDelete: Cascade)
  userId    String
  user      User      @relation(fields: [userId], references: [id], onDelete: Cascade)
  createdAt DateTime  @default(now())

  @@unique([postId, userId])
  @@map("group_post_likes")
}

model GroupPostComment {
  id        String    @id @default(uuid())
  postId    String
  post      GroupPost @relation(fields: [postId], references: [id], onDelete: Cascade)
  authorId  String
  author    User      @relation(fields: [authorId], references: [id], onDelete: Cascade)
  body      String
  createdAt DateTime  @default(now())
  updatedAt DateTime  @updatedAt
  deletedAt DateTime?

  @@index([postId, createdAt])
  @@map("group_post_comments")
}
```

`GroupMemberRole.MODERATOR` is added to `packages/shared/src/enums.ts` (single source of truth for enums).

## API Surface

### New REST endpoints (UploadsController, JWT-guarded)

- `POST /uploads` — multipart `file` field; image mimetypes only (`image/jpeg`, `image/png`, `image/webp`, `image/gif`); ≤ 10 MB; returns `{ key: string }`.
- `GET /uploads/:key` — serves local-driver files from `images/uploads` (dev/test only; Azure mode stores URLs directly and never hits this route).

### New/changed GraphQL (groups module)

Queries:
- `groupBySlug(slug: String!): Group` (null-safe; info visible to any authenticated user)
- `groupPosts(groupId: ID!, offset: Int, limit: Int): [GroupPost!]!` (ACTIVE members only)
- `groupPostComments(postId: ID!): [GroupPostComment!]!` (ACTIVE members of the post's group)

Mutations:
- `createGroupPost(groupId: ID!, input: CreateGroupPostInput!): GroupPost!` — `CreateGroupPostInput { body: String!, imageKey: String }`
- `deleteGroupPost(postId: ID!): Boolean!` (author, owner, or moderator)
- `toggleGroupPostLike(postId: ID!): Boolean!` (returns whether liked after toggle)
- `createGroupPostComment(postId: ID!, body: String!): GroupPostComment!`
- `deleteGroupPostComment(commentId: ID!): Boolean!` (author, owner, or moderator)
- `approveGroupMember(groupId: ID!, userId: ID!): GroupMember!`
- `removeGroupMember(groupId: ID!, userId: ID!): Boolean!`
- `banGroupMember(groupId: ID!, userId: ID!): GroupMember!`
- `unbanGroupMember(groupId: ID!, userId: ID!): GroupMember!`
- `updateGroupMemberRole(groupId: ID!, userId: ID!, role: GroupMemberRole!): GroupMember!` (owner only; role must be MEMBER or MODERATOR)

Types: `GroupPost { id, body, imageKey (raw), createdAt, author { id, displayName, avatarUrl }, likeCount, commentCount, likedByMe }`, `GroupPostComment { id, body, createdAt, author }`, `GroupMember` gains `user { id, displayName, avatarUrl }` for rendering. `Group` gains `myStatus: GroupMemberStatus`.

`imageKey` resolution is client-side: if the value starts with `http` → use as-is (Azure); otherwise (local mode, `uploads/…`) prefix with the web `API_BASE` constant (already derived from `NEXT_PUBLIC_API_URL` by stripping `/graphql`). No per-field resolver — the server never needs to know its public origin.

### Service behavior details

- `createGroupPost`: require ACTIVE membership; `deleteGroupPost`: author check via `authorId === userId` or group role OWNER/MODERATOR.
- `approveGroupMember`: target must be PENDING; owner/moderator gate.
- `banGroupMember`: target must not be OWNER; sets status BANNED. `unbanGroupMember`: BANNED → ACTIVE.
- `removeGroupMember`: hard-delete membership row (matches existing `leave` semantics); guarded so moderators cannot remove OWNER or other MODERATORs; owner cannot be removed by anyone.
- `updateGroupMemberRole`: owner only; cannot change OWNER role; setting MODERATOR requires target ACTIVE.
- Join behavior stays as-is (PUBLIC → ACTIVE immediately, PRIVATE → PENDING).
- All reads filter `deletedAt: null` for posts/comments.

## Web UI (per approved Stitch screens, project 10935178473689115895)

Design system: warm cream/amber — `#FFF6E8` paper, `#845400`/`#f4a11c` amber primary, teal `#006b5e` secondary, Space Grotesk headlines, Newsreader body, Manrope small labels, `rounded-md` cards with `outline-variant` borders, left sidebar + top bar app shell, 1200px max content.

### `(app)/groups/[slug]/page.tsx` (replaces placeholder)

Client component tree:
- **GroupHeader** — bounded cover image (`rounded-md`, no overlay text); below it: meta row (category chip, visibility badge, member count) → group name (display font) → description → CTA row: `Share` (copies link) + join-state button (`Join Group` / `Request Pending` disabled / `Joined` with leave confirm) → tabs row (Posts / Members / Settings-if-owner). Mobile: CTA stacked below header content, single column.
- **PostsTab** — composer (textarea + image attach with thumbnail preview + Post button, disabled for non-members) + post cards (author avatar/name, relative time, body, image, like toggle with count, comment count, comment section with inline composer). Delete menu on own/moderatable posts.
- **MembersTab** — pending requests section (Approve/Reject) for owner/moderators; member list with role badges; three-dot admin menu (Promote/Demote, Remove, Ban) on member rows for owner/moderators; ≥44px touch targets on mobile.
- **SettingsTab** (owner) — form: name, description, visibility toggle (active state clearly `primary`, not red), category select, cover upload; Save; Delete Group in a red danger zone with confirm.

States: non-member (locked composer, Join CTA), pending (Request Pending), active member (full feed), owner/moderator (admin actions visible).

## Verification

- API: extend `groups.service.spec.ts` (existing mock-based pattern) and `groups.resolver.spec.ts` with posts, comments, likes, and member-management coverage — authorization matrix cases (non-member blocked, moderator can moderate, owner-only role changes).
- Uploads: unit-test the local driver + controller guard/mimetype/size rules; integration via existing Testcontainers suite if one exists for uploads (otherwise unit-level).
- Web: component specs for header states, posts feed (render, like toggle, comment add), members admin actions, settings save — mirroring `groups.spec.tsx` style.
- Run: `pnpm test`, `pnpm lint`, `pnpm build` (typecheck) via turbo; confirm existing groups specs still pass.
- Runtime: dev server smoke check — upload an image locally, confirm it lands in `images/uploads` and renders on a post.