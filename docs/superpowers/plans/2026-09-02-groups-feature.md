# Groups Feature Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Complete the groups feature: group detail page, posts (text + image) with likes/comments, member management (approve/promote/remove/ban), owner settings, and a local/Azure image upload path.

**Architecture:** Extend the existing NestJS `groups` module (new `group-posts.service/resolver` + member-management methods on `GroupsService`) and add a small REST `uploads` module (multer multipart POST + local/Azure storage drivers, GET to serve local files). The web app replaces the `[slug]` placeholder with a client component tree (header, posts tab, members tab, settings tab) using the existing raw-`gql` + `apolloClient` pattern and the existing Tailwind token system.

**Tech Stack:** NestJS 11 (GraphQL code-first, REST controller), Prisma 7 (driver adapter), PostgreSQL, Next.js 16 App Router, React 19, Tailwind CSS v4, Apollo Client 4, Zustand, multer 2.x, `@azure/storage-blob`.

**Spec:** `docs/superpowers/specs/2026-09-02-groups-feature-design.md`

## Global Constraints

- API imports must use `.js` extension (NodeNext). Web imports must NOT.
- Prisma reads filter `deletedAt: null` for soft-deletable entities; posts/comments soft-delete.
- Prisma CLI needs env sourced first: `set -a; source apps/api/.env; set +a;` before every `prisma`/`db:` command.
- Enums live in `packages/shared/src/enums.ts` (single source of truth); API registers GraphQL enums from them.
- Authorization matrix (from spec): ACTIVE members post/comment/like/view feed; owner+moderator delete any post/comment and approve/remove/ban; owner only updates settings, deletes group, promotes/demotes moderators; nobody can modify/remove the OWNER.
- Uploads: image mimetypes only (`image/jpeg|png|webp|gif`), ≤ 10 MB, REST `POST /uploads` JWT-guarded; local files under `<repo>/images/uploads` (gitignored), Azure when `AZURE_STORAGE_CONNECTION_STRING` is set.
- DB stores `imageKey`: Azure → full blob URL; local → `uploads/<name>`. Web resolves: starts with `http` → as-is; else `${API_BASE}/${imageKey}`.
- Web design tokens to use: `bg-paper-warm`, `bg-surface-container`, `bg-primary-container`, `text-on-surface`, `text-on-surface-variant`, `text-primary`, `border-outline-variant`, `font-display text-headline-h3`, `font-small text-small`, `font-body text-body`, `material-symbols-outlined`, `rounded-xl`, `shadow-sm`.

---

### Task 1: Shared enum + Prisma models + migration

**Files:**
- Modify: `packages/shared/src/enums.ts` (GroupMemberRole)
- Modify: `apps/api/prisma/schema.prisma` (enum + 3 models + relations)
- Run: migration

**Interfaces:**
- Produces: `GroupMemberRole.MODERATOR` in shared; Prisma models `GroupPost`, `GroupPostLike`, `GroupPostComment`; `Group.posts` / `User.groupPosts` relations.

- [ ] **Step 1: Add MODERATOR to shared enum**

In `packages/shared/src/enums.ts` change:

```ts
export enum GroupMemberRole {
  OWNER = 'OWNER',
  MEMBER = 'MEMBER',
}
```

to:

```ts
export enum GroupMemberRole {
  OWNER = 'OWNER',
  MODERATOR = 'MODERATOR',
  MEMBER = 'MEMBER',
}
```

- [ ] **Step 2: Update Prisma enum**

In `apps/api/prisma/schema.prisma`:

```prisma
enum GroupMemberRole {
  OWNER
  MODERATOR
  MEMBER
}
```

- [ ] **Step 3: Add GroupPost, GroupPostLike, GroupPostComment models**

Insert after the `GroupMember` model block (before `// ── Friends`):

```prisma
// ── Group Posts ─────────────────────────────────────────────────────────────

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

  likes    GroupPostLike[]
  comments GroupPostComment[]

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

- [ ] **Step 4: Add relations to Group and User**

In `model Group` add inside the body (next to `members`):

```prisma
  posts         GroupPost[]
```

In `model User` add (find the User model's relation fields and append):

```prisma
  groupPosts        GroupPost[]
  groupPostLikes    GroupPostLike[]
  groupPostComments GroupPostComment[]
```

- [ ] **Step 5: Regenerate client and run migration**

```bash
set -a; source apps/api/.env; set +a; pnpm --filter @transformlit/api db:generate
set -a; source apps/api/.env; set +a; pnpm --filter @transformlit/api exec prisma migrate dev --name add_group_posts
```

Expected: migration created/applied, Prisma client regenerated with the new models.

- [ ] **Step 6: Build shared package (so API sees MODERATOR)**

```bash
pnpm --filter @transformlit/shared build
```

- [ ] **Step 7: Commit**

```bash
git add packages/shared/src/enums.ts apps/api/prisma && git commit -m "feat(groups): add group posts schema and MODERATOR role"
```

---

### Task 2: Uploads module (REST + storage drivers)

**Files:**
- Create: `apps/api/src/uploads/uploads.module.ts`
- Create: `apps/api/src/uploads/uploads.service.ts`
- Create: `apps/api/src/uploads/uploads.controller.ts`
- Modify: `apps/api/src/app.module.ts` (import UploadsModule)
- Modify: `.gitignore` (ignore `/images/uploads/`)

**Interfaces:**
- Produces: `UploadsService.saveImage(buffer: Buffer, mimetype: string): Promise<string>` (returns Azure blob URL or `uploads/<name>`); `UploadsService.resolveLocalPath(key: string): string | null`; REST `POST /uploads` → `{ key }`; `GET /uploads/:key` (local driver only).
- Consumes: `ConfigService` (`AZURE_STORAGE_CONNECTION_STRING`, `UPLOAD_DIR`), `AuthGuard('jwt')` from `@nestjs/passport`.

- [ ] **Step 1: Write the failing service test**

Create `apps/api/src/uploads/uploads.service.spec.ts`:

```ts
/// <reference types="jest" />
import { Test } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { UploadsService } from './uploads.service';

describe('UploadsService (local driver)', () => {
  let service: UploadsService;
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'uploads-test-'));
    const moduleRef = await Test.createTestingModule({
      providers: [
        UploadsService,
        {
          provide: ConfigService,
          useValue: {
            get: (key: string) => (key === 'UPLOAD_DIR' ? dir : undefined),
          },
        },
      ],
    }).compile();
    service = moduleRef.get(UploadsService);
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('saves a png buffer and returns an uploads/ key', async () => {
    const key = await service.saveImage(Buffer.from([1, 2, 3]), 'image/png');
    expect(key).toMatch(/^uploads\/[0-9a-f-]{36}\.png$/);
    const saved = await readFile(join(dir, key.replace('uploads/', '')));
    expect(saved).toEqual(Buffer.from([1, 2, 3]));
  });

  it('resolveLocalPath only accepts keys under uploads/', () => {
    expect(service.resolveLocalPath('uploads/x.png')).toContain('x.png');
    expect(service.resolveLocalPath('http://evil/x.png')).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
pnpm --filter @transformlit/api test uploads.service.spec
```

Expected: FAIL — module/file not found.

- [ ] **Step 3: Implement UploadsService**

Create `apps/api/src/uploads/uploads.service.ts`:

```ts
import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { randomUUID } from 'node:crypto';
import { mkdir, writeFile, existsSync } from 'node:fs';
import { join, basename, extname } from 'node:path';
import { promisify } from 'node:util';
import { BlobServiceClient } from '@azure/storage-blob';

const mkdirAsync = promisify(mkdir);
const writeFileAsync = promisify(writeFile);

const EXT_BY_MIME: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/gif': 'gif',
};

@Injectable()
export class UploadsService {
  private readonly azureClient: BlobServiceClient | null;
  private readonly localDir: string;

  constructor(private readonly config: ConfigService) {
    const connStr = this.config.get<string>('AZURE_STORAGE_CONNECTION_STRING');
    this.azureClient = connStr
      ? BlobServiceClient.fromConnectionString(connStr)
      : null;
    this.localDir =
      this.config.get<string>('UPLOAD_DIR') ??
      join(process.cwd(), '..', 'images', 'uploads');
  }

  async saveImage(buffer: Buffer, mimetype: string): Promise<string> {
    const ext = EXT_BY_MIME[mimetype];
    if (!ext) throw new Error(`Unsupported image type: ${mimetype}`);
    const name = `${randomUUID()}.${ext}`;

    if (this.azureClient) {
      const container = this.azureClient.getContainerClient('uploads');
      await container.createIfNotExists();
      const blob = container.getBlockBlobClient(name);
      await blob.uploadData(buffer, {
        blobHTTPHeaders: { blobContentType: mimetype },
      });
      return blob.url;
    }

    await mkdirAsync(this.localDir, { recursive: true });
    await writeFileAsync(join(this.localDir, name), buffer);
    return `uploads/${name}`;
  }

  /** Local-driver path for a key, or null if not a local uploads key */
  resolveLocalPath(key: string): string | null {
    if (!key.startsWith('uploads/')) return null;
    return join(this.localDir, basename(key));
  }

  localFileExists(key: string): boolean {
    const p = this.resolveLocalPath(key);
    return p !== null && existsSync(p);
  }

  extOf(mimetypeOrPath: string): string {
    return extname(mimetypeOrPath).replace('.', '') || 'bin';
  }
}
```

- [ ] **Step 4: Implement UploadsController**

Create `apps/api/src/uploads/uploads.controller.ts`:

```ts
import {
  BadRequestException,
  Controller,
  Get,
  NotFoundException,
  Param,
  Post,
  Res,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { FileInterceptor } from '@nestjs/platform-express';
import { memoryStorage } from 'multer';
import { createReadStream } from 'node:fs';
import type { Response } from 'express';
import { UploadsService } from './uploads.service.js';

const ALLOWED_MIMETYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];
const CONTENT_TYPE_BY_EXT: Record<string, string> = {
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
  gif: 'image/gif',
};

@Controller('uploads')
export class UploadsController {
  constructor(private readonly uploads: UploadsService) {}

  @Post()
  @UseGuards(AuthGuard('jwt'))
  @UseInterceptors(
    FileInterceptor('file', {
      storage: memoryStorage(),
      limits: { fileSize: 10 * 1024 * 1024 },
    }),
  )
  async upload(@UploadedFile() file?: Express.Multer.File) {
    if (!file) throw new BadRequestException('file field is required');
    if (!ALLOWED_MIMETYPES.includes(file.mimetype)) {
      throw new BadRequestException('Only jpeg, png, webp and gif images are allowed');
    }
    const key = await this.uploads.saveImage(file.buffer, file.mimetype);
    return { key };
  }

  @Get(':key')
  async serve(@Param('key') key: string, @Res() res: Response) {
    if (!this.uploads.localFileExists(key)) throw new NotFoundException();
    const ext = this.uploads.extOf(key);
    res.type(CONTENT_TYPE_BY_EXT[ext] ?? 'application/octet-stream');
    createReadStream(this.uploads.resolveLocalPath(key)!).pipe(res);
  }
}
```

- [ ] **Step 5: Create UploadsModule and register it**

Create `apps/api/src/uploads/uploads.module.ts`:

```ts
import { Module } from '@nestjs/common';
import { UploadsController } from './uploads.controller.js';
import { UploadsService } from './uploads.service.js';

@Module({
  controllers: [UploadsController],
  providers: [UploadsService],
  exports: [UploadsService],
})
export class UploadsModule {}
```

In `apps/api/src/app.module.ts`, add `UploadsModule` to the `imports` array (import `./uploads/uploads.module.js`).

- [ ] **Step 6: Gitignore local uploads**

In root `.gitignore` add:

```
/images/uploads/
```

- [ ] **Step 7: Run tests, build, commit**

```bash
pnpm --filter @transformlit/api test uploads.service.spec
pnpm --filter @transformlit/api build
git add apps/api/src/uploads .gitignore apps/api/src/app.module.ts && git commit -m "feat(api): add image uploads module with local/azure storage"
```

Expected: tests PASS; build succeeds.

---

### Task 3: API — Group model fields (myStatus, user, groupBySlug)

**Files:**
- Modify: `apps/api/src/groups/models/group.model.ts`
- Modify: `apps/api/src/groups/groups.service.ts`
- Modify: `apps/api/src/groups/groups.resolver.ts`
- Modify: `packages/shared/src/types/graphql.ts` (web-facing types)

**Interfaces:**
- Produces: `Group.myStatus: GroupMemberStatus | null`; `GroupMember.user: User`; query `groupBySlug(slug: string): Group`; `GroupsService.findBySlug(slug, userId)`, `GroupsService.attachMembership` internals; shared `GraphQLGroup.myStatus`, `GraphQLGroupPost`, `GraphQLGroupPostComment`.
- Consumes: `User` from `../auth/models/auth.model.js`.

- [ ] **Step 0: Update web-facing shared types**

In `packages/shared/src/types/graphql.ts`:
- Add `myStatus?: string | null;` to `GraphQLGroup` (after `myRole`).
- Add after the `GraphQLGroupMember` interface:

```ts
export interface GraphQLGroupPost {
  id: string;
  groupId: string;
  body: string;
  imageKey?: string | null;
  createdAt: string;
  likeCount: number;
  commentCount: number;
  likedByMe: boolean;
  author?: GraphQLUser | null;
}

export interface GraphQLGroupPostComment {
  id: string;
  postId: string;
  body: string;
  createdAt: string;
  author?: GraphQLUser | null;
}
```

- Rebuild shared: `pnpm --filter @transformlit/shared build`

- [ ] **Step 1: Add myStatus + user to GraphQL models**

In `apps/api/src/groups/models/group.model.ts`:
- Import `User` from `../../auth/models/auth.model.js`.
- In `class Group`, after `myRole`, add:

```ts
  @Field(() => GroupMemberStatus, { nullable: true })
  myStatus?: GroupMemberStatus;
```

- In `class GroupMember`, after `joinedAt`, add:

```ts
  @Field(() => User, { nullable: true })
  user?: User;
```

- [ ] **Step 2: Extend service helpers to expose myStatus**

In `apps/api/src/groups/groups.service.ts`, replace `mapGroup` with:

```ts
/** Map raw Prisma result → Group shape (memberCount, myRole, myStatus from members) */
function mapGroup(g: any, userId?: string) {
  return {
    ...g,
    memberCount: g._count?.members ?? 0,
    myRole: g.members?.[0]?.role ?? null,
    myStatus: g.members?.[0]?.status ?? null,
  };
}
```

- [ ] **Step 3: Add findBySlug**

In `GroupsService` (after `findById`):

```ts
  async findBySlug(slug: string, userId?: string) {
    const g = await this.prisma.group.findUnique({
      where: { slug, deletedAt: null },
      include: groupInclude(userId),
    });
    if (!g) return null;
    return mapGroup(g, userId);
  }
```

- [ ] **Step 4: Add groupBySlug resolver**

In `apps/api/src/groups/groups.resolver.ts`, after `group` query:

```ts
  @Query(() => Group, { name: 'groupBySlug', nullable: true })
  @UseGuards(JwtAuthGuard)
  async groupBySlug(
    @Args('slug') slug: string,
    @CurrentUser() user: { id: string },
  ) {
    return this.groupsService.findBySlug(slug, user.id);
  }
```

- [ ] **Step 5: Run existing groups tests + build + commit**

```bash
pnpm --filter @transformlit/api test groups.service.spec groups.resolver.spec
pnpm --filter @transformlit/api build
git add apps/api/src/groups && git commit -m "feat(api): expose myStatus, member user, and groupBySlug"
```

Expected: existing specs still PASS (they construct expected objects — update any assertion that does a strict deep-equal on mapped groups to include `myStatus`).

---

### Task 4: API — member management mutations

**Files:**
- Modify: `apps/api/src/groups/groups.service.ts`
- Modify: `apps/api/src/groups/groups.resolver.ts`

**Interfaces:**
- Produces (GroupsService): `approveMember(groupId, actorId, userId)`, `removeMember(groupId, actorId, userId)`, `banMember(groupId, actorId, userId)`, `unbanMember(groupId, actorId, userId)`, `updateMemberRole(groupId, actorId, userId, role)`, and private helpers `getMembership(groupId, userId)` / `assertCanModerate(groupId, actorId)`.
- Consumes: `ForbiddenException, NotFoundException` from `@nestjs/common`.

- [ ] **Step 1: Add helper + methods to GroupsService**

In `apps/api/src/groups/groups.service.ts` add private helpers and public methods (after `listMembers`):

```ts
  private async getMembership(groupId: string, userId: string) {
    return this.prisma.groupMember.findUnique({
      where: { groupId_userId: { groupId, userId } },
    });
  }

  private async assertCanModerate(groupId: string, actorId: string) {
    const membership = await this.getMembership(groupId, actorId);
    if (
      !membership ||
      membership.status !== 'ACTIVE' ||
      (membership.role !== 'OWNER' && membership.role !== 'MODERATOR')
    ) {
      throw new ForbiddenException('You need to be an owner or moderator');
    }
    return membership;
  }

  async approveMember(groupId: string, actorId: string, userId: string) {
    await this.assertCanModerate(groupId, actorId);
    const target = await this.getMembership(groupId, userId);
    if (!target) throw new NotFoundException('Member not found');
    if (target.status !== 'PENDING') {
      throw new BadRequestException('Only pending members can be approved');
    }
    return this.prisma.groupMember.update({
      where: { id: target.id },
      data: { status: 'ACTIVE' },
    });
  }

  async removeMember(groupId: string, actorId: string, userId: string) {
    const actor = await this.assertCanModerate(groupId, actorId);
    const target = await this.getMembership(groupId, userId);
    if (!target) throw new NotFoundException('Member not found');
    if (target.role === 'OWNER') {
      throw new ForbiddenException('Cannot remove the group owner');
    }
    if (
      actor.role === 'MODERATOR' &&
      target.role === 'MODERATOR'
    ) {
      throw new ForbiddenException('Moderators cannot remove other moderators');
    }
    await this.prisma.groupMember.delete({ where: { id: target.id } });
    return true;
  }

  async banMember(groupId: string, actorId: string, userId: string) {
    await this.assertCanModerate(groupId, actorId);
    const target = await this.getMembership(groupId, userId);
    if (!target) throw new NotFoundException('Member not found');
    if (target.role === 'OWNER') {
      throw new ForbiddenException('Cannot ban the group owner');
    }
    return this.prisma.groupMember.update({
      where: { id: target.id },
      data: { status: 'BANNED' },
    });
  }

  async unbanMember(groupId: string, actorId: string, userId: string) {
    await this.assertCanModerate(groupId, actorId);
    const target = await this.getMembership(groupId, userId);
    if (!target) throw new NotFoundException('Member not found');
    if (target.status !== 'BANNED') {
      throw new BadRequestException('Member is not banned');
    }
    return this.prisma.groupMember.update({
      where: { id: target.id },
      data: { status: 'ACTIVE' },
    });
  }

  async updateMemberRole(
    groupId: string,
    actorId: string,
    userId: string,
    role: 'MEMBER' | 'MODERATOR',
  ) {
    const actor = await this.assertCanModerate(groupId, actorId);
    if (actor.role !== 'OWNER') {
      throw new ForbiddenException('Only the owner can change roles');
    }
    const target = await this.getMembership(groupId, userId);
    if (!target) throw new NotFoundException('Member not found');
    if (target.role === 'OWNER') {
      throw new ForbiddenException('Cannot change the owner role');
    }
    if (role !== 'MEMBER' && role !== 'MODERATOR') {
      throw new BadRequestException('Role must be MEMBER or MODERATOR');
    }
    return this.prisma.groupMember.update({
      where: { id: target.id },
      data: { role },
    });
  }
```

Add imports: `ForbiddenException, NotFoundException, BadRequestException` to the `@nestjs/common` import in `groups.service.ts`.

- [ ] **Step 2: Add resolver mutations**

In `apps/api/src/groups/groups.resolver.ts`, after `deleteGroup`:

```ts
  @Mutation(() => GroupMember, { name: 'approveGroupMember' })
  @UseGuards(JwtAuthGuard)
  async approveGroupMember(
    @CurrentUser() user: { id: string },
    @Args('groupId') groupId: string,
    @Args('userId') userId: string,
  ) {
    return this.groupsService.approveMember(groupId, user.id, userId);
  }

  @Mutation(() => Boolean, { name: 'removeGroupMember' })
  @UseGuards(JwtAuthGuard)
  async removeGroupMember(
    @CurrentUser() user: { id: string },
    @Args('groupId') groupId: string,
    @Args('userId') userId: string,
  ) {
    return this.groupsService.removeMember(groupId, user.id, userId);
  }

  @Mutation(() => GroupMember, { name: 'banGroupMember' })
  @UseGuards(JwtAuthGuard)
  async banGroupMember(
    @CurrentUser() user: { id: string },
    @Args('groupId') groupId: string,
    @Args('userId') userId: string,
  ) {
    return this.groupsService.banMember(groupId, user.id, userId);
  }

  @Mutation(() => GroupMember, { name: 'unbanGroupMember' })
  @UseGuards(JwtAuthGuard)
  async unbanGroupMember(
    @CurrentUser() user: { id: string },
    @Args('groupId') groupId: string,
    @Args('userId') userId: string,
  ) {
    return this.groupsService.unbanMember(groupId, user.id, userId);
  }

  @Mutation(() => GroupMember, { name: 'updateGroupMemberRole' })
  @UseGuards(JwtAuthGuard)
  async updateGroupMemberRole(
    @CurrentUser() user: { id: string },
    @Args('groupId') groupId: string,
    @Args('userId') userId: string,
    @Args('role', { type: () => GroupMemberRole }) role: GroupMemberRole,
  ) {
    return this.groupsService.updateMemberRole(
      groupId,
      user.id,
      userId,
      role === 'MODERATOR' ? 'MODERATOR' : 'MEMBER',
    );
  }
```

Import `GroupMemberRole` from `@transformlit/shared` (already imported `GroupCategory` from there).

- [ ] **Step 3: Run groups tests + build + commit**

```bash
pnpm --filter @transformlit/api test groups.service.spec groups.resolver.spec
pnpm --filter @transformlit/api build
git add apps/api/src/groups && git commit -m "feat(api): add group member management mutations"
```

---

### Task 5: API — group posts, likes, comments

**Files:**
- Create: `apps/api/src/groups/models/group-post.model.ts`
- Create: `apps/api/src/groups/group-posts.service.ts`
- Create: `apps/api/src/groups/group-posts.resolver.ts`
- Modify: `apps/api/src/groups/groups.module.ts` (providers + imports)

**Interfaces:**
- Produces: GraphQL types `GroupPost { id, body, imageKey, createdAt, author, likeCount, commentCount, likedByMe }`, `GroupPostComment { id, body, createdAt, author }`, `CreateGroupPostInput { body, imageKey? }`; service methods `listPosts(groupId, actorId, offset, limit)`, `createPost(groupId, actorId, input)`, `deletePost(postId, actorId)`, `toggleLike(postId, actorId): Promise<boolean>`, `listComments(postId, actorId)`, `createComment(postId, actorId, body)`, `deleteComment(commentId, actorId)`.
- Consumes: `GroupsService` (via same-module helper — use PrismaService directly here + duplicate membership logic in a small shared helper exported from `groups.service.ts`), `ForbiddenException`, `NotFoundException`.

- [ ] **Step 1: Create post models**

Create `apps/api/src/groups/models/group-post.model.ts`:

```ts
import { Field, ObjectType, InputType, ID, Int } from '@nestjs/graphql';
import { User } from '../../auth/models/auth.model.js';

@ObjectType()
export class GroupPost {
  @Field(() => ID)
  id: string;

  @Field(() => ID)
  groupId: string;

  @Field()
  body: string;

  @Field({ nullable: true })
  imageKey?: string;

  @Field()
  createdAt: Date;

  @Field(() => User, { nullable: true })
  author?: User;

  @Field(() => Int)
  likeCount: number;

  @Field(() => Int)
  commentCount: number;

  @Field()
  likedByMe: boolean;
}

@ObjectType()
export class GroupPostComment {
  @Field(() => ID)
  id: string;

  @Field(() => ID)
  postId: string;

  @Field()
  body: string;

  @Field()
  createdAt: Date;

  @Field(() => User, { nullable: true })
  author?: User;
}

@InputType()
export class CreateGroupPostInput {
  @Field()
  body: string;

  @Field({ nullable: true })
  imageKey?: string;
}
```

- [ ] **Step 2: Export membership gate helper from GroupsService**

In `groups.service.ts`, change `assertCanModerate` and `getMembership` from `private` to `async getMembershipFor(groupId, userId)` public (rename) so the posts service can reuse them:

```ts
  async getMembershipFor(groupId: string, userId: string) {
    return this.prisma.groupMember.findUnique({
      where: { groupId_userId: { groupId, userId } },
    });
  }
```

(Update Task 4 code accordingly: `getMembership` → `getMembershipFor` throughout.)

- [ ] **Step 3: Create GroupPostsService**

Create `apps/api/src/groups/group-posts.service.ts`:

```ts
import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import { GroupsService } from './groups.service.js';
import { CreateGroupPostInput } from './models/group-post.model.js';

const MAX_COMMENT_LENGTH = 2000;

const postInclude = (actorId: string) => ({
  author: { select: { id: true, displayName: true, avatarUrl: true } },
  _count: { select: { likes: true, comments: { where: { deletedAt: null } } } },
  likes: { where: { userId: actorId }, select: { id: true } },
} as const);

@Injectable()
export class GroupPostsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly groups: GroupsService,
  ) {}

  private mapPost(p: any, actorId: string) {
    return {
      ...p,
      likeCount: p._count?.likes ?? 0,
      commentCount: p._count?.comments ?? 0,
      likedByMe: (p.likes?.length ?? 0) > 0,
      likes: undefined,
      _count: undefined,
    };
  }

  async listPosts(groupId: string, actorId: string, offset = 0, limit = 20) {
    await this.assertActiveMember(groupId, actorId);
    const posts = await this.prisma.groupPost.findMany({
      where: { groupId, deletedAt: null },
      include: postInclude(actorId),
      orderBy: { createdAt: 'desc' },
      skip: offset,
      take: Math.min(limit, 50),
    });
    return posts.map((p) => this.mapPost(p, actorId));
  }

  async createPost(groupId: string, actorId: string, input: CreateGroupPostInput) {
    await this.assertActiveMember(groupId, actorId);
    const body = input.body.trim();
    if (!body) throw new BadRequestException('Post body is required');
    const post = await this.prisma.groupPost.create({
      data: {
        groupId,
        authorId: actorId,
        body,
        imageKey: input.imageKey ?? null,
      },
      include: postInclude(actorId),
    });
    return this.mapPost(post, actorId);
  }

  async deletePost(postId: string, actorId: string) {
    const post = await this.prisma.groupPost.findUnique({ where: { id: postId } });
    if (!post) throw new NotFoundException('Post not found');
    const membership = await this.groups.getMembershipFor(post.groupId, actorId);
    const canModerate =
      membership?.status === 'ACTIVE' &&
      (membership.role === 'OWNER' || membership.role === 'MODERATOR');
    if (post.authorId !== actorId && !canModerate) {
      throw new ForbiddenException('Not allowed to delete this post');
    }
    await this.prisma.groupPost.update({
      where: { id: postId },
      data: { deletedAt: new Date() },
    });
    return true;
  }

  async toggleLike(postId: string, actorId: string): Promise<boolean> {
    const post = await this.prisma.groupPost.findUnique({ where: { id: postId } });
    if (!post) throw new NotFoundException('Post not found');
    await this.assertActiveMember(post.groupId, actorId);
    const existing = await this.prisma.groupPostLike.findUnique({
      where: { postId_userId: { postId, userId: actorId } },
    });
    if (existing) {
      await this.prisma.groupPostLike.delete({ where: { id: existing.id } });
      return false;
    }
    await this.prisma.groupPostLike.create({
      data: { postId, userId: actorId },
    });
    return true;
  }

  async listComments(postId: string, actorId: string) {
    const post = await this.prisma.groupPost.findUnique({ where: { id: postId } });
    if (!post) throw new NotFoundException('Post not found');
    await this.assertActiveMember(post.groupId, actorId);
    return this.prisma.groupPostComment.findMany({
      where: { postId, deletedAt: null },
      include: { author: { select: { id: true, displayName: true, avatarUrl: true } } },
      orderBy: { createdAt: 'asc' },
    });
  }

  async createComment(postId: string, actorId: string, body: string) {
    const post = await this.prisma.groupPost.findUnique({ where: { id: postId } });
    if (!post) throw new NotFoundException('Post not found');
    await this.assertActiveMember(post.groupId, actorId);
    const trimmed = body.trim();
    if (!trimmed) throw new BadRequestException('Comment body is required');
    if (trimmed.length > MAX_COMMENT_LENGTH) {
      throw new BadRequestException('Comment is too long');
    }
    return this.prisma.groupPostComment.create({
      data: { postId, authorId: actorId, body: trimmed },
      include: { author: { select: { id: true, displayName: true, avatarUrl: true } } },
    });
  }

  async deleteComment(commentId: string, actorId: string) {
    const comment = await this.prisma.groupPostComment.findUnique({
      where: { id: commentId },
    });
    if (!comment) throw new NotFoundException('Comment not found');
    const post = await this.prisma.groupPost.findUnique({
      where: { id: comment.postId },
    });
    const membership = await this.groups.getMembershipFor(post!.groupId, actorId);
    const canModerate =
      membership?.status === 'ACTIVE' &&
      (membership.role === 'OWNER' || membership.role === 'MODERATOR');
    if (comment.authorId !== actorId && !canModerate) {
      throw new ForbiddenException('Not allowed to delete this comment');
    }
    await this.prisma.groupPostComment.update({
      where: { id: commentId },
      data: { deletedAt: new Date() },
    });
    return true;
  }

  private async assertActiveMember(groupId: string, userId: string) {
    const membership = await this.groups.getMembershipFor(groupId, userId);
    if (!membership || membership.status !== 'ACTIVE') {
      throw new ForbiddenException('Only active members can do this');
    }
  }
}
```

- [ ] **Step 4: Create GroupPostsResolver**

Create `apps/api/src/groups/group-posts.resolver.ts`:

```ts
import { Args, Int, Mutation, Query, Resolver } from '@nestjs/graphql';
import { UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard.js';
import { CurrentUser } from '../common/decorators/current-user.decorator.js';
import { GroupPostsService } from './group-posts.service.js';
import {
  GroupPost,
  GroupPostComment,
  CreateGroupPostInput,
} from './models/group-post.model.js';

@Resolver()
export class GroupPostsResolver {
  constructor(private readonly groupPostsService: GroupPostsService) {}

  @Query(() => [GroupPost], { name: 'groupPosts' })
  @UseGuards(JwtAuthGuard)
  async groupPosts(
    @CurrentUser() user: { id: string },
    @Args('groupId') groupId: string,
    @Args('offset', { type: () => Int, defaultValue: 0 }) offset: number,
    @Args('limit', { type: () => Int, defaultValue: 20 }) limit: number,
  ) {
    return this.groupPostsService.listPosts(groupId, user.id, offset, limit);
  }

  @Query(() => [GroupPostComment], { name: 'groupPostComments' })
  @UseGuards(JwtAuthGuard)
  async groupPostComments(
    @CurrentUser() user: { id: string },
    @Args('postId') postId: string,
  ) {
    return this.groupPostsService.listComments(postId, user.id);
  }

  @Mutation(() => GroupPost, { name: 'createGroupPost' })
  @UseGuards(JwtAuthGuard)
  async createGroupPost(
    @CurrentUser() user: { id: string },
    @Args('groupId') groupId: string,
    @Args('input') input: CreateGroupPostInput,
  ) {
    return this.groupPostsService.createPost(groupId, user.id, input);
  }

  @Mutation(() => Boolean, { name: 'deleteGroupPost' })
  @UseGuards(JwtAuthGuard)
  async deleteGroupPost(
    @CurrentUser() user: { id: string },
    @Args('postId') postId: string,
  ) {
    return this.groupPostsService.deletePost(postId, user.id);
  }

  @Mutation(() => Boolean, { name: 'toggleGroupPostLike' })
  @UseGuards(JwtAuthGuard)
  async toggleGroupPostLike(
    @CurrentUser() user: { id: string },
    @Args('postId') postId: string,
  ) {
    return this.groupPostsService.toggleLike(postId, user.id);
  }

  @Mutation(() => GroupPostComment, { name: 'createGroupPostComment' })
  @UseGuards(JwtAuthGuard)
  async createGroupPostComment(
    @CurrentUser() user: { id: string },
    @Args('postId') postId: string,
    @Args('body') body: string,
  ) {
    return this.groupPostsService.createComment(postId, user.id, body);
  }

  @Mutation(() => Boolean, { name: 'deleteGroupPostComment' })
  @UseGuards(JwtAuthGuard)
  async deleteGroupPostComment(
    @CurrentUser() user: { id: string },
    @Args('commentId') commentId: string,
  ) {
    return this.groupPostsService.deleteComment(commentId, user.id);
  }
}
```

- [ ] **Step 5: Wire into GroupsModule**

In `apps/api/src/groups/groups.module.ts`, add providers `GroupPostsService`, `GroupPostsResolver` and keep `GroupsModule` exported (import it as-is from `./groups.module.js` — `GroupsService` is already provided in the same module so `getMembershipFor` injection resolves).

- [ ] **Step 6: Build + commit**

```bash
pnpm --filter @transformlit/api build
git add apps/api/src/groups && git commit -m "feat(api): add group posts, likes, and comments"
```

---

### Task 6: API — tests for posts and member management

**Files:**
- Modify: `apps/api/src/groups/groups.service.spec.ts`
- Modify: `apps/api/src/groups/groups.resolver.spec.ts`

**Interfaces:** Follows the existing mock-based spec style (`mockGroup`, `mockMember`, mocked `PrismaService` with `findUnique/update/delete/deleteMany/create/findMany`).

- [ ] **Step 1: Extend groups.service.spec.ts**

Add a `describe('member management')` block mocking `prisma.groupMember`:

```ts
describe('member management', () => {
  const prisma = {
    groupMember: {
      findUnique: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
    },
  };

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('approveMember activates a pending member for an owner', async () => {
    prisma.groupMember.findUnique
      .mockResolvedValueOnce({ role: 'OWNER', status: 'ACTIVE' }) // actor
      .mockResolvedValueOnce({ id: 'm2', status: 'PENDING' }); // target
    prisma.groupMember.update.mockResolvedValue({ id: 'm2', status: 'ACTIVE' });
    const result = await service.approveMember('g1', 'u1', 'u2');
    expect(result.status).toBe('ACTIVE');
    expect(prisma.groupMember.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: { status: 'ACTIVE' } }),
    );
  });

  it('blocks non-moderators from approving', async () => {
    prisma.groupMember.findUnique.mockResolvedValueOnce({
      role: 'MEMBER',
      status: 'ACTIVE',
    });
    await expect(service.approveMember('g1', 'u1', 'u2')).rejects.toThrow();
  });

  it('prevents removing the owner', async () => {
    prisma.groupMember.findUnique
      .mockResolvedValueOnce({ role: 'OWNER', status: 'ACTIVE' })
      .mockResolvedValueOnce({ role: 'OWNER', status: 'ACTIVE' });
    await expect(service.removeMember('g1', 'u1', 'u2')).rejects.toThrow(
      'Cannot remove the group owner',
    );
  });

  it('promotes a member to MODERATOR only for the owner', async () => {
    prisma.groupMember.findUnique
      .mockResolvedValueOnce({ role: 'OWNER', status: 'ACTIVE' })
      .mockResolvedValueOnce({ role: 'MEMBER', status: 'ACTIVE' });
    prisma.groupMember.update.mockResolvedValue({ role: 'MODERATOR' });
    const result = await service.updateMemberRole('g1', 'u1', 'u2', 'MODERATOR');
    expect(result.role).toBe('MODERATOR');
  });
});
```

(Ensure the spec's existing `service` is constructed with the mocked PrismaService object that includes `groupMember`.)

- [ ] **Step 2: Add resolver tests**

In `apps/api/src/groups/groups.resolver.spec.ts`, add cases that the five member mutations call the service with the current user id (mirror the existing mutation test style).

- [ ] **Step 3: Run and commit**

```bash
pnpm --filter @transformlit/api test groups.service.spec groups.resolver.spec
git add apps/api/src/groups && git commit -m "test(api): cover member management mutations"
```

---

### Task 7: Web — group detail page (header + join states)

**Files:**
- Modify: `apps/web/src/app/(app)/groups/[slug]/page.tsx` (server wrapper)
- Create: `apps/web/src/components/groups/group-detail-client.tsx`
- Create: `apps/web/src/components/groups/group-header.tsx`
- Create: `apps/web/src/lib/groups.ts` (queries/mutations + image URL + upload helpers)

**Interfaces:**
- Produces: client component `<GroupDetailClient slug: string>`; `fetchGroupBySlug(slug)`, `fetchGroupPosts(groupId)`, `joinGroup(groupId)`, `leaveGroup(groupId)`, `uploadImage(file): Promise<string>` (returns key), `resolveImageUrl(key): string`.
- Consumes: `apolloClient` from `../../../lib/apollo-client` (web-relative), `useRequireAuth`, `useAuthStore` (`token`), `API_BASE` from `lib/constants`.

- [ ] **Step 1: Server wrapper**

Replace `apps/web/src/app/(app)/groups/[slug]/page.tsx` body with:

```tsx
import type { Metadata } from 'next';
import { GroupDetailClient } from '../../../../components/groups/group-detail-client';

export const metadata: Metadata = { title: 'Group — Transformlit' };

export default async function GroupDetailPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  return <GroupDetailClient slug={slug} />;
}
```

- [ ] **Step 2: lib helpers**

Create `apps/web/src/lib/groups.ts`:

```ts
import { gql } from '@apollo/client';
import { apolloClient } from './apollo-client';
import { API_BASE } from './constants';
import type { GraphQLGroup } from '@transformlit/shared';

export const GROUP_BY_SLUG_QUERY = gql`
  query GroupBySlug($slug: String!) {
    groupBySlug(slug: $slug) {
      id
      name
      slug
      description
      visibility
      category
      coverImageUrl
      memberCount
      myRole
      myStatus
    }
  }
`;

export const JOIN_GROUP_MUTATION = gql`
  mutation JoinGroup($groupId: ID!) {
    joinGroup(groupId: $groupId) {
      id
      status
    }
  }
`;

export const LEAVE_GROUP_MUTATION = gql`
  mutation LeaveGroup($groupId: ID!) {
    leaveGroup(groupId: $groupId)
  }
`;

export async function fetchGroupBySlug(slug: string): Promise<GraphQLGroup | null> {
  const { data } = await apolloClient.query({
    query: GROUP_BY_SLUG_QUERY,
    variables: { slug },
    fetchPolicy: 'network-only',
  });
  return data?.groupBySlug ?? null;
}

/** Resolve a stored image key to a displayable URL */
export function resolveImageUrl(key?: string | null): string | undefined {
  if (!key) return undefined;
  if (key.startsWith('http')) return key;
  return `${API_BASE}/${key}`;
}

/** Upload an image via the REST endpoint; returns the storage key */
export async function uploadImage(file: File): Promise<string> {
  const token = useAuthStore.getState().token;
  const form = new FormData();
  form.append('file', file);
  const res = await fetch(`${API_BASE}/uploads`, {
    method: 'POST',
    headers: token ? { Authorization: `Bearer ${token}` } : undefined,
    body: form,
  });
  if (!res.ok) throw new Error('Upload failed');
  const { key } = (await res.json()) as { key: string };
  return key;
}
```

(Add `import { useAuthStore } from '../store/auth';` at the top.)

- [ ] **Step 3: GroupDetailClient**

Create `apps/web/src/components/groups/group-detail-client.tsx`:

```tsx
'use client';

import { useCallback, useEffect, useState } from 'react';
import type { GraphQLGroup } from '@transformlit/shared';
import { useRequireAuth } from '../../lib/hooks/use-require-auth';
import { LoadingSpinner } from '../ui';
import { fetchGroupBySlug } from '../../lib/groups';
import { GroupHeader } from './group-header';
import { GroupPosts } from './group-posts';
import { GroupMembers } from './group-members';
import { GroupSettings } from './group-settings';

export function GroupDetailClient({ slug }: { slug: string }) {
  const { user } = useRequireAuth();
  const [group, setGroup] = useState<GraphQLGroup | null>(null);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<'posts' | 'members' | 'settings'>('posts');

  const load = useCallback(async () => {
    setLoading(true);
    const g = await fetchGroupBySlug(slug);
    setGroup(g);
    setLoading(false);
  }, [slug]);

  useEffect(() => {
    load();
  }, [load]);

  if (loading || !group) {
    return (
      <div className="flex justify-center py-16">
        <LoadingSpinner />
      </div>
    );
  }

  const isOwner = group.myRole === 'OWNER';
  const canModerate = group.myRole === 'OWNER' || group.myRole === 'MODERATOR';
  const isActiveMember = group.myStatus === 'ACTIVE';

  return (
    <div className="space-y-6">
      <GroupHeader
        group={group}
        onChanged={load}
        onTabChange={setTab}
        activeTab={tab}
      />
      {tab === 'posts' &&
        (isActiveMember ? (
          <GroupPosts group={group} onChanged={load} />
        ) : (
          <div className="bg-paper-warm rounded-xl shadow-sm border border-outline-variant p-8 text-center">
            <span className="material-symbols-outlined text-4xl text-on-surface-variant mb-2">lock</span>
            <p className="font-body text-body text-on-surface-variant">
              Join this group to see posts and join the conversation.
            </p>
          </div>
        ))}
      {tab === 'members' && canModerate && (
        <GroupMembers groupId={group.id} canModerate={canModerate} isOwner={isOwner} />
      )}
      {tab === 'settings' && isOwner && (
        <GroupSettings group={group} onChanged={load} />
      )}
    </div>
  );
}
```

(Note: members tab visible only to moderators for now; the spec's "any member sees member list" is covered later by reusing `groupMembers` — keep this scope per approved screens.)

- [ ] **Step 4: GroupHeader**

Create `apps/web/src/components/groups/group-header.tsx` implementing the approved Stitch layout: cover block (`h-40 md:h-56 rounded-xl overflow-hidden`, image or `bg-primary-container` placeholder icon), then meta row (category chip `bg-surface-container rounded-full px-3 py-1 font-small text-small text-on-surface-variant`, visibility badge, member count with `group` icon), group name (`font-display text-headline-h2 text-on-surface`), description (`font-body text-body text-on-surface-variant`), CTA row (Share button copies `window.location.href`; join-state button: `bg-primary-container text-on-primary-container rounded-xl px-4 py-2 font-small` for Join, disabled `Request Pending`, `Joined` outline variant with leave confirm), tabs row (`bg-surface-container rounded-full p-1` pill tabs). Mobile: CTA row stacks (`flex-col md:flex-row`). Use `JOIN_GROUP_MUTATION`/`LEAVE_GROUP_MUTATION` via `apolloClient.mutate`; call `onChanged()` after join/leave; render toast on error via `useToast`.

- [ ] **Step 5: Build + commit**

```bash
pnpm --filter @transformlit/web build
git add apps/web/src/app/'(app)'/groups apps/web/src/components/groups apps/web/src/lib/groups.ts
git commit -m "feat(web): add group detail header and navigation"
```

---

### Task 8: Web — posts tab (composer, feed, likes, comments)

**Files:**
- Create: `apps/web/src/components/groups/group-posts.tsx`
- Create: `apps/web/src/components/groups/post-composer.tsx`
- Create: `apps/web/src/components/groups/post-card.tsx`
- Modify: `apps/web/src/lib/groups.ts` (posts queries/mutations)

**Interfaces:**
- Consumes: `fetchGroupPosts(groupId)`, `createPost(groupId, body, imageKey?)`, `deletePost(postId)`, `toggleLike(postId)`, `createComment(postId, body)`, `deleteComment(commentId)`, `uploadImage(file)`, `resolveImageUrl(key)`.
- Produces: `<GroupPosts group onChanged>`; `<PostComposer groupId onPosted>`; `<PostCard post canModerate onChanged>`.

- [ ] **Step 1: Add post operations to lib/groups.ts**

```ts
export const GROUP_POSTS_QUERY = gql`
  query GroupPosts($groupId: ID!, $offset: Int!, $limit: Int!) {
    groupPosts(groupId: $groupId, offset: $offset, limit: $limit) {
      id
      body
      imageKey
      createdAt
      likeCount
      commentCount
      likedByMe
      author { id displayName avatarUrl }
    }
  }
`;

export const GROUP_POST_COMMENTS_QUERY = gql`
  query GroupPostComments($postId: ID!) {
    groupPostComments(postId: $postId) {
      id
      body
      createdAt
      author { id displayName avatarUrl }
    }
  }
`;

export const CREATE_GROUP_POST_MUTATION = gql`
  mutation CreateGroupPost($groupId: ID!, $input: CreateGroupPostInput!) {
    createGroupPost(groupId: $groupId, input: $input) {
      id
      body
      imageKey
      createdAt
      likeCount
      commentCount
      likedByMe
      author { id displayName avatarUrl }
    }
  }
`;

export const DELETE_GROUP_POST_MUTATION = gql`
  mutation DeleteGroupPost($postId: ID!) {
    deleteGroupPost(postId: $postId)
  }
`;

export const TOGGLE_GROUP_POST_LIKE_MUTATION = gql`
  mutation ToggleGroupPostLike($postId: ID!) {
    toggleGroupPostLike(postId: $postId)
  }
`;

export const CREATE_GROUP_POST_COMMENT_MUTATION = gql`
  mutation CreateGroupPostComment($postId: ID!, $body: String!) {
    createGroupPostComment(postId: $postId, body: $body) {
      id
      body
      createdAt
      author { id displayName avatarUrl }
    }
  }
`;

export const DELETE_GROUP_POST_COMMENT_MUTATION = gql`
  mutation DeleteGroupPostComment($commentId: ID!) {
    deleteGroupPostComment(commentId: $commentId)
  }
`;
```

- [ ] **Step 2: GroupPosts + PostComposer + PostCard**

Implement per the approved screens and existing UI conventions:

- `group-posts.tsx`: state `posts: GraphQLGroupPost[]`; `loadPosts()` via `GROUP_POSTS_QUERY`; renders `<PostComposer>` (only when `group.myStatus === 'ACTIVE'`, else a locked composer placeholder `bg-surface-container rounded-xl p-4 text-on-surface-variant` with lock icon and "Join the group to post") and the post list; empty state ("No posts yet — be the first to share."). `onChanged` refresh.
- `post-composer.tsx`: textarea (`bg-surface-container rounded-xl p-3 font-body text-body text-on-surface`), image attach button (`material-symbols-outlined` `image` icon) driving a hidden `<input type="file" accept="image/jpeg,image/png,image/webp,image/gif">`, thumbnail preview with remove (×), Post button (`bg-primary-container text-on-primary-container rounded-xl px-4 py-2 font-small`), disabled while submitting; `uploadImage` → `createPost` → clear + `onPosted`.
- `post-card.tsx`: card (`bg-paper-warm rounded-xl shadow-sm border border-outline-variant p-4`); header row (avatar `w-10 h-10 rounded-full bg-primary-container` with initial or `avatarUrl` img, name `font-small text-small font-medium text-on-surface`, relative time `text-small text-on-surface-variant`), body (`font-body text-body text-on-surface`), image (`rounded-xl w-full object-cover max-h-96` via `resolveImageUrl`), actions row (like button with `favorite`/`favorite_border` icon + count, comment button `chat_bubble_outline` + count), comments section (list of comments with avatar+name+body+time and a delete icon for own/moderatable comments), inline comment input (input + send icon). Delete post: three-dot menu → `Delete` with `window.confirm` → `deleteGroupPost`. Like: optimistic `likedByMe`/`likeCount` flip, then `toggleLike`.
- Relative time: reuse any existing time-ago util in the app (search `timeAgo`/`time-ago`/`relative` in `apps/web/src/lib`); if none exists, add `formatRelativeTime(iso: string): string` in `lib/groups.ts` (e.g. "just now", "5m", "2h", "3d", else short date).

- [ ] **Step 3: Build + commit**

```bash
pnpm --filter @transformlit/web build
git add apps/web/src/components/groups apps/web/src/lib/groups.ts
git commit -m "feat(web): add group posts feed with composer, likes, comments"
```

---

### Task 9: Web — members tab and settings tab

**Files:**
- Create: `apps/web/src/components/groups/group-members.tsx`
- Create: `apps/web/src/components/groups/group-settings.tsx`
- Modify: `apps/web/src/lib/groups.ts` (member/settings operations)

**Interfaces:**
- Consumes: `fetchGroupMembers(groupId)`, `approveMember(groupId, userId)`, `removeMember(groupId, userId)`, `banMember(groupId, userId)`, `unbanMember(groupId, userId)`, `updateMemberRole(groupId, userId, role)`, `updateGroup(groupId, input)`, `deleteGroup(groupId)`.
- Produces: `<GroupMembers groupId canModerate isOwner>`, `<GroupSettings group onChanged>`.

- [ ] **Step 1: Add operations to lib/groups.ts**

```ts
export const GROUP_MEMBERS_QUERY = gql`
  query GroupMembers($groupId: ID!) {
    groupMembers(groupId: $groupId) {
      id
      userId
      role
      status
      joinedAt
      user { id displayName avatarUrl }
    }
  }
`;

export const APPROVE_GROUP_MEMBER_MUTATION = gql`
  mutation ApproveGroupMember($groupId: ID!, $userId: ID!) {
    approveGroupMember(groupId: $groupId, userId: $userId) { id status }
  }
`;

export const REMOVE_GROUP_MEMBER_MUTATION = gql`
  mutation RemoveGroupMember($groupId: ID!, $userId: ID!) {
    removeGroupMember(groupId: $groupId, userId: $userId)
  }
`;

export const BAN_GROUP_MEMBER_MUTATION = gql`
  mutation BanGroupMember($groupId: ID!, $userId: ID!) {
    banGroupMember(groupId: $groupId, userId: $userId) { id status }
  }
`;

export const UNBAN_GROUP_MEMBER_MUTATION = gql`
  mutation UnbanGroupMember($groupId: ID!, $userId: ID!) {
    unbanGroupMember(groupId: $groupId, userId: $userId) { id status }
  }
`;

export const UPDATE_GROUP_MEMBER_ROLE_MUTATION = gql`
  mutation UpdateGroupMemberRole($groupId: ID!, $userId: ID!, $role: GroupMemberRole!) {
    updateGroupMemberRole(groupId: $groupId, userId: $userId, role: $role) { id role }
  }
`;

export const UPDATE_GROUP_MUTATION = gql`
  mutation UpdateGroup($groupId: ID!, $input: UpdateGroupInput!) {
    updateGroup(groupId: $groupId, input: $input) {
      id name slug description visibility category coverImageUrl
    }
  }
`;

export const DELETE_GROUP_MUTATION = gql`
  mutation DeleteGroup($groupId: ID!) {
    deleteGroup(groupId: $groupId) { id }
  }
`;
```

- [ ] **Step 2: GroupMembers**

Per approved screens: pending requests section (only for moderators — list members with `status === 'PENDING'`, each row avatar + name + `Approve` / `Reject` buttons; Reject = `removeMember`), then member list (rows: avatar, name, role badge `bg-surface-container rounded-full px-2 py-0.5 font-micro uppercase` showing Owner/Moderator/Member, joined date). For moderators: three-dot menu per row (except self and owner) with `Promote to Moderator` / `Demote to Member` (owner only), `Remove`, `Ban` / `Unban` (BANNED rows show `Unban`). Touch targets `min-h-11` on mobile. After each action, refetch members.

- [ ] **Step 3: GroupSettings**

Form (React Hook Form + Zod per project convention — mirror `register-form.tsx` patterns): fields name (required), description (textarea), visibility (`select` PUBLIC/PRIVATE with `bg-surface-container` styling; active selection shows `text-primary`), category (`select` from `GROUP_CATEGORIES`), cover upload (image button + preview via `resolveImageUrl` + `uploadImage`), Save button (`bg-primary-container text-on-primary-container rounded-xl px-4 py-2 font-small`) → `UPDATE_GROUP_MUTATION` → `onChanged`. Danger zone at bottom: red outline button (`border border-red-500 text-red-600 rounded-xl px-4 py-2 font-small`) `Delete Group` → `window.confirm('Delete this group permanently?')` → `DELETE_GROUP_MUTATION` → `router.push('/groups')`.

- [ ] **Step 4: Build + commit**

```bash
pnpm --filter @transformlit/web build
git add apps/web/src/components/groups apps/web/src/lib/groups.ts
git commit -m "feat(web): add group members management and settings tabs"
```

---

### Task 10: Web — component tests

**Files:**
- Create: `apps/web/src/components/groups/group-posts.spec.tsx`
- Create: `apps/web/src/components/groups/group-members.spec.tsx`

**Interfaces:** Follow `apps/web/src/app/(app)/groups/groups.spec.tsx` patterns (mock `apolloClient`, render, act, assertions).

- [ ] **Step 1: group-posts.spec.tsx**

Mock `apolloClient.query` to return a fixture post list; assert: composer renders for ACTIVE member; post body/image render; clicking like calls the mutation and flips count; adding a comment calls mutation. Use `@testing-library/react` `render`, `fireEvent`, `waitFor`.

- [ ] **Step 2: group-members.spec.tsx**

Mock query returning one PENDING + one ACTIVE member; assert Approve button calls `approveGroupMember`; admin menu shows for moderator actor; Ban/Remove buttons call respective mutations.

- [ ] **Step 3: Run web tests + commit**

```bash
pnpm --filter @transformlit/web test group-posts.spec group-members.spec
git add apps/web/src/components/groups && git commit -m "test(web): cover group posts and members components"
```

---

### Task 11: Full verification

- [ ] **Step 1: API unit tests**

```bash
pnpm --filter @transformlit/api test
```

Expected: all pass (including existing groups, uploads specs).

- [ ] **Step 2: Web unit tests + lint + typecheck**

```bash
pnpm --filter @transformlit/web test
pnpm lint
```

- [ ] **Step 3: Full build**

```bash
pnpm build
```

Expected: api + web + shared all build.

- [ ] **Step 4: Runtime smoke check (local dev)**

```bash
pnpm dev
```

- Open `http://localhost:3000/groups` → open any group → verify header, join flow, posts composer.
- Upload an image in the composer; verify file appears under `images/uploads/` and renders in the post.
- As owner: approve a pending member (create second account or seed a PENDING membership), promote to moderator, ban/unban.
- Verify existing groups browse page still works.
- If a group has `coverImageUrl` uploaded, verify `GET /uploads/:key` serves it.

- [ ] **Step 5: Final commit**

```bash
git add -A && git commit -m "feat(groups): complete groups feature" || true
```