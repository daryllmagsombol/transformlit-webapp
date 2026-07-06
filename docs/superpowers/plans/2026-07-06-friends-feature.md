# Friends Feature Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement full friend management with real-time notifications, user profiles, and contextual friending interactions across the frontend, plus backend notification wiring.

**Architecture:** Backend changes are minimal — wire `NotificationsService` into `FriendsService`, add a `notificationReceived` subscription using the existing `PubSubService`, and add a `userProfile` query. Frontend follows existing patterns: Next.js App Router pages with `page.tsx` (server) + `*-client.tsx` (client), imperative Apollo Client calls, and UI components in `src/components/ui/`.

**Tech Stack:** NestJS 11 (Apollo GraphQL), Next.js 16 (App Router), Apollo Client 4.2, React 19, Tailwind CSS v4, Zustand, Jest + Playwright

## Global Constraints

- All new pages use `AuthenticatedLayout` wrapper in `page.tsx` (Server Component)
- All client components use `'use client'` directive and `useRequireAuth()` for auth gating
- GraphQL operations use imperative `apolloClient.query()/mutate()/subscribe()` (not hooks)
- Toasts via `useToast()` hook: `addToast('message', 'success' | 'error' | 'info')`
- Existing `Modal` component for dialogs: `<Modal open={bool} onClose={fn} title="...">{children}</Modal>`
- Existing `UserAvatar` component for avatars; add optional `userId` prop for tappable behavior
- PubSub pattern: `PubSubService` (PostgreSQL NOTIFY/LISTEN), channel registration in `onModuleInit`
- Backend models use `@ObjectType()` decorators from `@nestjs/graphql`
- TypeScript strict mode, no `any` unless explicitly needed
- Jest for unit/integration, Playwright for e2e
- Commit after each task with conventional commit messages

---

### Task 1: Wire Notifications into FriendsModule (Backend)

**Files:**
- Modify: `apps/api/src/friends/friends.module.ts`
- Modify: `apps/api/src/friends/friends.service.ts`
- Modify: `apps/api/src/notifications/notifications.module.ts`
- Create: `apps/api/src/notifications/notifications.pubsub.ts`

**Interfaces:**
- Consumes: `NotificationsService.createNotification(userId, type, payload?, createdById?)`
- Produces: FriendsService now publishes after `sendRequest` and `acceptRequest`

- [ ] **Step 1: Extract PubSubService to shared module**

Currently `PubSubService` lives in `ChatModule`. Since both `FriendsModule` and `NotificationsModule` need it, create a thin re-export from notifications. Write the file:

```typescript
// apps/api/src/notifications/notifications.pubsub.ts
export { PubSubService } from '../chat/pubsub.service.js';
```

- [ ] **Step 2: Create test for notification creation on friend request**

```typescript
// apps/api/src/friends/friends.service.spec.ts (append to existing or create new)
import { Test, TestingModule } from '@nestjs/testing';
import { FriendsService } from './friends.service.js';
import { NotificationsService } from '../notifications/notifications.service.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { PubSubService } from '../chat/pubsub.service.js';

describe('FriendsService - notifications', () => {
  let service: FriendsService;
  let notificationsService: NotificationsService;
  let prisma: PrismaService;

  const mockPrisma = {
    friendship: {
      findMany: jest.fn(),
      findUnique: jest.fn(),
      findFirst: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
    },
    notification: {
      create: jest.fn(),
    },
  };

  const mockPubSub = {
    publish: jest.fn(),
    asyncIterator: jest.fn(),
    onModuleInit: jest.fn(),
    onModuleDestroy: jest.fn(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        FriendsService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: NotificationsService, useValue: { createNotification: jest.fn() } },
        { provide: PubSubService, useValue: mockPubSub },
      ],
    }).compile();

    service = module.get<FriendsService>(FriendsService);
    notificationsService = module.get<NotificationsService>(NotificationsService);
    prisma = module.get<PrismaService>(PrismaService);
  });

  it('should create a FRIEND_REQUEST notification after sending a request', async () => {
    const friendship = { id: 'f1', requesterId: 'u1', addresseeId: 'u2', status: 'PENDING' };
    mockPrisma.friendship.findUnique.mockResolvedValue(null);
    mockPrisma.friendship.create.mockResolvedValue(friendship);
    (notificationsService.createNotification as jest.Mock).mockResolvedValue({});

    await service.sendRequest('u1', 'u2');

    expect(notificationsService.createNotification).toHaveBeenCalledWith(
      'u2', 'FRIEND_REQUEST', { friendshipId: 'f1', requesterName: undefined }, 'u1'
    );
  });

  it('should create a FRIEND_ACCEPTED notification after accepting a request', async () => {
    const friendship = { id: 'f1', requesterId: 'u1', addresseeId: 'u2', status: 'PENDING' };
    mockPrisma.friendship.findUnique.mockResolvedValue(friendship);
    mockPrisma.friendship.update.mockResolvedValue({ ...friendship, status: 'ACCEPTED' });
    (notificationsService.createNotification as jest.Mock).mockResolvedValue({});

    await service.acceptRequest('f1', 'u2');

    expect(notificationsService.createNotification).toHaveBeenCalledWith(
      'u1', 'FRIEND_ACCEPTED', { friendshipId: 'f1', addresseeName: undefined }, 'u2'
    );
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `cd apps/api && npx jest --testPathPattern='friends/friends.service.spec' --no-coverage`
Expected: FAIL — `createNotification` not called (not yet wired)

- [ ] **Step 4: Import NotificationsModule into FriendsModule**

```typescript
// apps/api/src/friends/friends.module.ts
import { Module, forwardRef } from '@nestjs/common';
import { FriendsService } from './friends.service.js';
import { FriendsResolver } from './friends.resolver.js';
import { AuthModule } from '../auth/auth.module.js';
import { NotificationsModule } from '../notifications/notifications.module.js';

@Module({
  imports: [AuthModule, forwardRef(() => NotificationsModule)],
  providers: [FriendsService, FriendsResolver],
  exports: [FriendsService],
})
export class FriendsModule {}
```

- [ ] **Step 5: Wire createNotification into FriendsService**

```typescript
// apps/api/src/friends/friends.service.ts
import { Injectable, Inject, forwardRef } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import { NotificationsService } from '../notifications/notifications.service.js';
import { PubSubService } from '../notifications/notifications.pubsub.js';

@Injectable()
export class FriendsService {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(forwardRef(() => NotificationsService))
    private readonly notifications: NotificationsService,
    private readonly pubSub: PubSubService,
  ) {}

  // ... existing methods unchanged ...

  async sendRequest(requesterId: string, addresseeId: string) {
    if (requesterId === addresseeId) throw new Error('Cannot friend yourself');
    const existing = await this.prisma.friendship.findUnique({
      where: { requesterId_addresseeId: { requesterId, addresseeId } },
    });
    if (existing) throw new Error('Friendship already exists');

    const friendship = await this.prisma.friendship.create({
      data: { requesterId, addresseeId, status: 'PENDING' },
    });

    // Create notification for the addressee
    const notification = await this.notifications.createNotification(
      addresseeId,
      'FRIEND_REQUEST',
      { friendshipId: friendship.id },
      requesterId,
    );

    // Publish to PubSub so subscribers get real-time update
    await this.pubSub.publish('notificationReceived', {
      notificationReceived: notification,
      userId: addresseeId,
    });

    return friendship;
  }

  async acceptRequest(friendshipId: string, userId: string) {
    const friendship = await this.prisma.friendship.findUnique({
      where: { id: friendshipId },
    });
    if (!friendship || friendship.addresseeId !== userId) throw new Error('Not authorized');
    const updated = await this.prisma.friendship.update({
      where: { id: friendshipId },
      data: { status: 'ACCEPTED' },
    });

    // Create notification for the original requester
    const notification = await this.notifications.createNotification(
      friendship.requesterId,
      'FRIEND_ACCEPTED',
      { friendshipId: friendship.id },
      userId,
    );

    await this.pubSub.publish('notificationReceived', {
      notificationReceived: notification,
      userId: friendship.requesterId,
    });

    return updated;
  }

  // ... rest of existing methods unchanged ...
}
```

- [ ] **Step 6: Update NotificationsModule to import FriendsModule (resolve circular dep)**

```typescript
// apps/api/src/notifications/notifications.module.ts
import { Module, forwardRef } from '@nestjs/common';
import { NotificationsService } from './notifications.service.js';
import { NotificationsResolver } from './notifications.resolver.js';
import { AuthModule } from '../auth/auth.module.js';
import { FriendsModule } from '../friends/friends.module.js';

@Module({
  imports: [AuthModule, forwardRef(() => FriendsModule)],
  providers: [NotificationsService, NotificationsResolver],
  exports: [NotificationsService],
})
export class NotificationsModule {}
```

- [ ] **Step 7: Add LISTEN for notificationReceived channel in PubSubService**

Modify `apps/api/src/chat/pubsub.service.ts` — in `onModuleInit`, after the existing `LISTEN "messageAdded"` line, add:

```typescript
await client.query('LISTEN "notificationReceived"');
```

- [ ] **Step 8: Run tests to verify**

Run: `cd apps/api && npx jest --testPathPattern='friends/friends.service.spec' --no-coverage`
Expected: PASS — both notification assertions pass

- [ ] **Step 9: Commit**

```bash
git add apps/api/src/friends/ apps/api/src/notifications/ apps/api/src/chat/pubsub.service.ts
git commit -m "feat(friends): wire notifications on friend request and acceptance"
```

---

### Task 2: Add Notification Subscription Resolver (Backend)

**Files:**
- Modify: `apps/api/src/notifications/notifications.resolver.ts`
- Create: `apps/api/src/notifications/notifications.resolver.spec.ts`

**Interfaces:**
- Consumes: `PubSubService.asyncIterator('notificationReceived')`, `NotificationsService`
- Produces: `notificationReceived(userId: String!)` subscription

- [ ] **Step 1: Write failing test for subscription resolver**

```typescript
// apps/api/src/notifications/notifications.resolver.spec.ts
import { Test, TestingModule } from '@nestjs/testing';
import { NotificationsResolver } from './notifications.resolver.js';
import { NotificationsService } from './notifications.service.js';
import { PubSubService } from './notifications.pubsub.js';

describe('NotificationsResolver - subscription', () => {
  let resolver: NotificationsResolver;
  let pubSub: PubSubService;

  const mockNotificationsService = {
    listNotifications: jest.fn(),
    getUnreadCount: jest.fn(),
    markRead: jest.fn(),
    markAllRead: jest.fn(),
  };

  const mockPubSub = {
    asyncIterator: jest.fn(),
    publish: jest.fn(),
    onModuleInit: jest.fn(),
    onModuleDestroy: jest.fn(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        NotificationsResolver,
        { provide: NotificationsService, useValue: mockNotificationsService },
        { provide: PubSubService, useValue: mockPubSub },
      ],
    }).compile();

    resolver = module.get<NotificationsResolver>(NotificationsResolver);
    pubSub = module.get<PubSubService>(PubSubService);
  });

  it('should return asyncIterator for notificationReceived', () => {
    const mockIterator = { next: jest.fn(), return: jest.fn(), throw: jest.fn() };
    mockPubSub.asyncIterator.mockReturnValue(mockIterator);

    const result = resolver.notificationReceived('user-1');

    expect(mockPubSub.asyncIterator).toHaveBeenCalledWith('notificationReceived');
    expect(result).toBe(mockIterator);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/api && npx jest --testPathPattern='notifications/notifications.resolver.spec' --no-coverage`
Expected: FAIL — `notificationReceived` method not defined on resolver

- [ ] **Step 3: Add subscription to NotificationsResolver**

```typescript
// apps/api/src/notifications/notifications.resolver.ts
import { Resolver, Query, Mutation, Args, Int, Subscription } from '@nestjs/graphql';
import { UseGuards } from '@nestjs/common';
import { NotificationsService } from './notifications.service.js';
import { PubSubService } from './notifications.pubsub.js';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard.js';
import { CurrentUser } from '../common/decorators/current-user.decorator.js';
import { Notification } from './models/notification.model.js';

@Resolver()
export class NotificationsResolver {
  constructor(
    private readonly notificationsService: NotificationsService,
    private readonly pubSub: PubSubService,
  ) {}

  // ... existing queries and mutations unchanged ...

  @Subscription(() => Notification, {
    name: 'notificationReceived',
    filter: (payload: { notificationReceived: any; userId: string }, variables: { userId: string }) =>
      payload.userId === variables.userId,
    resolve: (payload: { notificationReceived: any }) => payload.notificationReceived,
  })
  @UseGuards(JwtAuthGuard)
  notificationReceived(@Args('userId') userId: string) {
    return this.pubSub.asyncIterator('notificationReceived');
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd apps/api && npx jest --testPathPattern='notifications/notifications.resolver.spec' --no-coverage`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/notifications/
git commit -m "feat(notifications): add notificationReceived subscription"
```

---

### Task 3: Add User Profile Query (Backend)

**Files:**
- Modify: `apps/api/src/users/users.resolver.ts`
- Modify: `apps/api/src/users/users.service.ts`

**Interfaces:**
- Produces: `userProfile(id: ID!)` query returning `UserProfile` type with user, groups, bookProgress

- [ ] **Step 1: Create UserProfile GraphQL model**

Create `apps/api/src/users/models/user-profile.model.ts`:

```typescript
import { Field, ObjectType, Int } from '@nestjs/graphql';
import { User } from './user.model.js';
import { Group } from '../../groups/models/group.model.js';
import { BookProgress } from '../../books/models/book-progress.model.js';

@ObjectType()
export class UserProfile {
  @Field(() => User)
  user: User;

  @Field(() => [Group])
  groups: Group[];

  @Field(() => [BookProgress])
  bookProgress: BookProgress[];

  @Field(() => Int)
  friendCount: number;

  @Field(() => Int)
  groupCount: number;

  @Field(() => Int)
  bookCount: number;
}
```

- [ ] **Step 2: Add userProfile method to UsersService**

```typescript
// Add to apps/api/src/users/users.service.ts
async getProfile(userId: string) {
  const user = await this.prisma.user.findUnique({
    where: { id: userId },
    select: {
      id: true,
      email: true,
      displayName: true,
      avatarUrl: true,
      bio: true,
      role: true,
      status: true,
      createdAt: true,
    },
  });

  if (!user) throw new Error('User not found');

  const [groups, bookProgress, friendCount, groupCount, bookCount] = await Promise.all([
    this.prisma.groupMember.findMany({
      where: { userId, status: 'ACTIVE', group: { visibility: 'PUBLIC' } },
      include: { group: true },
      take: 20,
    }),
    this.prisma.bookProgress.findMany({
      where: { userId },
      include: { book: true },
      orderBy: { lastReadAt: 'desc' },
      take: 10,
    }),
    this.prisma.friendship.count({
      where: {
        OR: [{ requesterId: userId }, { addresseeId: userId }],
        status: 'ACCEPTED',
      },
    }),
    this.prisma.groupMember.count({
      where: { userId, status: 'ACTIVE' },
    }),
    this.prisma.bookProgress.count({
      where: { userId },
    }),
  ]);

  return {
    user,
    groups: groups.map((gm) => gm.group),
    bookProgress,
    friendCount,
    groupCount,
    bookCount,
  };
}
```

- [ ] **Step 3: Add userProfile query to UsersResolver**

```typescript
// Add to apps/api/src/users/users.resolver.ts
import { UserProfile } from './models/user-profile.model.js';

@Query(() => UserProfile, { name: 'userProfile' })
@UseGuards(JwtAuthGuard)
async userProfile(@Args('id') id: string) {
  return this.usersService.getProfile(id);
}
```

- [ ] **Step 4: Commit**

```bash
git add apps/api/src/users/
git commit -m "feat(users): add userProfile query with groups, books, and counts"
```

---

### Task 4: Create FriendCard Component (Frontend)

**Files:**
- Create: `apps/web/src/components/ui/friend-card.tsx`
- Create: `apps/web/src/components/ui/__tests__/friend-card.test.tsx`
- Modify: `apps/web/src/components/ui/index.ts`

**Interfaces:**
- Produces: `<FriendCard name={string} bio={string} avatarUrl={string} mutualGroups={number} onPress={() => void} />`

- [ ] **Step 1: Write the failing test**

```tsx
// apps/web/src/components/ui/__tests__/friend-card.test.tsx
import { render, screen, fireEvent } from '@testing-library/react';
import { FriendCard } from '../friend-card';

describe('FriendCard', () => {
  it('renders name and bio', () => {
    render(
      <FriendCard
        name="Alice"
        bio="Book lover"
        avatarUrl={null}
        mutualGroups={3}
        onPress={jest.fn()}
      />
    );

    expect(screen.getByText('Alice')).toBeInTheDocument();
    expect(screen.getByText('Book lover')).toBeInTheDocument();
    expect(screen.getByText('3 mutual groups')).toBeInTheDocument();
  });

  it('calls onPress when clicked', () => {
    const onPress = jest.fn();
    render(
      <FriendCard
        name="Alice"
        bio="Book lover"
        avatarUrl={null}
        mutualGroups={0}
        onPress={onPress}
      />
    );

    fireEvent.click(screen.getByText('Alice').closest('div')!);
    expect(onPress).toHaveBeenCalled();
  });

  it('renders avatar with initial when no avatarUrl', () => {
    render(
      <FriendCard
        name="Alice"
        bio="Book lover"
        avatarUrl={null}
        mutualGroups={1}
        onPress={jest.fn()}
      />
    );

    expect(screen.getByText('A')).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/web && npx jest --testPathPattern='friend-card' --no-coverage`
Expected: FAIL — module not found

- [ ] **Step 3: Create FriendCard component**

```tsx
// apps/web/src/components/ui/friend-card.tsx
'use client';

import { UserAvatar } from './user-avatar';
import { ChevronRightIcon } from './icons';

interface FriendCardProps {
  name: string;
  bio?: string;
  avatarUrl?: string | null;
  mutualGroups?: number;
  onPress: () => void;
}

export function FriendCard({ name, bio, avatarUrl, mutualGroups, onPress }: FriendCardProps) {
  return (
    <button
      onClick={onPress}
      className="group flex items-center p-4 bg-surface-container-lowest border border-outline-variant rounded-xl hover:border-primary transition-all cursor-pointer w-full text-left"
    >
      <UserAvatar avatarUrl={avatarUrl} displayName={name} size="md" />
      <div className="ml-4 flex-1 min-w-0">
        <p className="font-headline-h4 text-on-surface group-hover:text-primary transition-colors truncate">
          {name}
        </p>
        {bio && (
          <p className="font-body-mobile text-sm text-on-surface-variant line-clamp-1">{bio}</p>
        )}
        {mutualGroups !== undefined && mutualGroups > 0 && (
          <span className="inline-block mt-1 px-2 py-0.5 bg-secondary-container/50 text-on-secondary-container text-[10px] font-bold rounded-full uppercase font-micro">
            {mutualGroups} mutual group{mutualGroups !== 1 ? 's' : ''}
          </span>
        )}
      </div>
      <ChevronRightIcon className="w-5 h-5 text-on-surface-variant group-hover:text-primary flex-shrink-0" />
    </button>
  );
}
```

- [ ] **Step 4: Add ChevronRightIcon to icons**

In `apps/web/src/components/ui/icons.tsx`, add:

```tsx
export function ChevronRightIcon({ className }: IconProps) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M9 18l6-6-6-6" />
    </svg>
  );
}
```

- [ ] **Step 5: Export from barrel**

In `apps/web/src/components/ui/index.ts`, add:

```typescript
export { FriendCard } from './friend-card';
```

- [ ] **Step 6: Run tests**

Run: `cd apps/web && npx jest --testPathPattern='friend-card' --no-coverage`
Expected: PASS

- [ ] **Step 7: Commit**

```bash
git add apps/web/src/components/ui/friend-card.tsx apps/web/src/components/ui/__tests__/friend-card.test.tsx apps/web/src/components/ui/icons.tsx apps/web/src/components/ui/index.ts
git commit -m "feat(ui): add FriendCard component"
```

---

### Task 5: Create FriendRequestItem Component

**Files:**
- Create: `apps/web/src/components/ui/friend-request-item.tsx`
- Create: `apps/web/src/components/ui/__tests__/friend-request-item.test.tsx`
- Modify: `apps/web/src/components/ui/index.ts`

**Interfaces:**
- Produces: `<FriendRequestItem name={string} bio={string} avatarUrl={string} onAccept={() => void} onDecline={() => void} />`

- [ ] **Step 1: Write failing test**

```tsx
// apps/web/src/components/ui/__tests__/friend-request-item.test.tsx
import { render, screen, fireEvent } from '@testing-library/react';
import { FriendRequestItem } from '../friend-request-item';

describe('FriendRequestItem', () => {
  it('renders name, bio, and accept/decline buttons', () => {
    render(
      <FriendRequestItem
        name="Bob"
        bio="Sci-fi fan"
        avatarUrl={null}
        onAccept={jest.fn()}
        onDecline={jest.fn()}
      />
    );

    expect(screen.getByText('Bob')).toBeInTheDocument();
    expect(screen.getByText('Sci-fi fan')).toBeInTheDocument();
    expect(screen.getByText('Accept')).toBeInTheDocument();
    expect(screen.getByText('Decline')).toBeInTheDocument();
  });

  it('calls onAccept when accept is clicked', () => {
    const onAccept = jest.fn();
    render(
      <FriendRequestItem
        name="Bob"
        avatarUrl={null}
        onAccept={onAccept}
        onDecline={jest.fn()}
      />
    );

    fireEvent.click(screen.getByText('Accept'));
    expect(onAccept).toHaveBeenCalled();
  });

  it('calls onDecline when decline is clicked', () => {
    const onDecline = jest.fn();
    render(
      <FriendRequestItem
        name="Bob"
        avatarUrl={null}
        onAccept={jest.fn()}
        onDecline={onDecline}
      />
    );

    fireEvent.click(screen.getByText('Decline'));
    expect(onDecline).toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run test to verify fail**

Run: `cd apps/web && npx jest --testPathPattern='friend-request-item' --no-coverage`
Expected: FAIL

- [ ] **Step 3: Create FriendRequestItem component**

```tsx
// apps/web/src/components/ui/friend-request-item.tsx
'use client';

import { UserAvatar } from './user-avatar';

interface FriendRequestItemProps {
  name: string;
  bio?: string;
  avatarUrl?: string | null;
  onAccept: () => void;
  onDecline: () => void;
}

export function FriendRequestItem({
  name,
  bio,
  avatarUrl,
  onAccept,
  onDecline,
}: FriendRequestItemProps) {
  return (
    <div className="bg-paper-warm p-4 rounded-xl shadow-sm flex flex-col sm:flex-row items-center gap-4 border border-outline-variant/30">
      <UserAvatar avatarUrl={avatarUrl} displayName={name} size="md" />
      <div className="text-center sm:text-left flex-1">
        <p className="font-headline-h4 text-on-surface">{name}</p>
        {bio && (
          <p className="font-body-mobile text-on-surface-variant text-sm italic">{bio}</p>
        )}
      </div>
      <div className="flex gap-2 w-full sm:w-auto">
        <button
          onClick={onAccept}
          className="flex-1 sm:flex-none bg-primary text-on-primary px-4 py-2 rounded-lg font-small font-bold hover:brightness-110 active:scale-95 transition-all"
        >
          Accept
        </button>
        <button
          onClick={onDecline}
          className="flex-1 sm:flex-none bg-surface-container-highest text-on-surface-variant px-4 py-2 rounded-lg font-small font-bold hover:bg-outline-variant/20 active:scale-95 transition-all"
        >
          Decline
        </button>
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Export from barrel**

In `apps/web/src/components/ui/index.ts`, add:

```typescript
export { FriendRequestItem } from './friend-request-item';
```

- [ ] **Step 5: Run tests**

Run: `cd apps/web && npx jest --testPathPattern='friend-request-item' --no-coverage`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/components/ui/friend-request-item.tsx apps/web/src/components/ui/__tests__/friend-request-item.test.tsx apps/web/src/components/ui/index.ts
git commit -m "feat(ui): add FriendRequestItem component"
```

---

### Task 6: Create SuggestedFriendCard Component

**Files:**
- Create: `apps/web/src/components/ui/suggested-friend-card.tsx`
- Create: `apps/web/src/components/ui/__tests__/suggested-friend-card.test.tsx`
- Modify: `apps/web/src/components/ui/index.ts`

- [ ] **Step 1: Write failing test**

```tsx
// apps/web/src/components/ui/__tests__/suggested-friend-card.test.tsx
import { render, screen, fireEvent } from '@testing-library/react';
import { SuggestedFriendCard } from '../suggested-friend-card';

describe('SuggestedFriendCard', () => {
  it('renders name, tag, and add button', () => {
    render(
      <SuggestedFriendCard
        name="Charlie"
        tag="Poetry Lover"
        avatarUrl={null}
        onAdd={jest.fn()}
      />
    );

    expect(screen.getByText('Charlie')).toBeInTheDocument();
    expect(screen.getByText('Poetry Lover')).toBeInTheDocument();
    expect(screen.getByText('Add Friend')).toBeInTheDocument();
  });

  it('calls onAdd when button is clicked', () => {
    const onAdd = jest.fn();
    render(
      <SuggestedFriendCard
        name="Charlie"
        tag="Poetry Lover"
        avatarUrl={null}
        onAdd={onAdd}
      />
    );

    fireEvent.click(screen.getByText('Add Friend'));
    expect(onAdd).toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run test to verify fail**

Run: `cd apps/web && npx jest --testPathPattern='suggested-friend-card' --no-coverage`
Expected: FAIL

- [ ] **Step 3: Create SuggestedFriendCard component**

```tsx
// apps/web/src/components/ui/suggested-friend-card.tsx
'use client';

import { UserAvatar } from './user-avatar';

interface SuggestedFriendCardProps {
  name: string;
  tag: string;
  avatarUrl?: string | null;
  onAdd: () => void;
}

export function SuggestedFriendCard({ name, tag, avatarUrl, onAdd }: SuggestedFriendCardProps) {
  return (
    <div className="snap-start min-w-[200px] bg-surface-container-low border border-outline-variant p-5 rounded-xl flex flex-col items-center text-center shadow-sm hover:shadow-md transition-shadow">
      <div className="mb-3 ring-4 ring-white dark:ring-surface-dark shadow-inner rounded-full">
        <UserAvatar avatarUrl={avatarUrl} displayName={name} size="md" />
      </div>
      <p className="font-headline-h4 text-on-surface truncate w-full">{name}</p>
      <p className="font-small text-on-surface-variant mb-4 truncate w-full">{tag}</p>
      <button
        onClick={onAdd}
        className="w-full bg-secondary text-on-secondary py-2 rounded-lg font-small font-bold hover:opacity-90 active:scale-95 transition-all"
      >
        Add Friend
      </button>
    </div>
  );
}
```

- [ ] **Step 4: Export from barrel**

In `apps/web/src/components/ui/index.ts`, add:

```typescript
export { SuggestedFriendCard } from './suggested-friend-card';
```

- [ ] **Step 5: Run tests**

Run: `cd apps/web && npx jest --testPathPattern='suggested-friend-card' --no-coverage`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/components/ui/suggested-friend-card.tsx apps/web/src/components/ui/__tests__/suggested-friend-card.test.tsx apps/web/src/components/ui/index.ts
git commit -m "feat(ui): add SuggestedFriendCard component"
```

---

### Task 7: Create UserSearchInput Component

**Files:**
- Create: `apps/web/src/components/ui/user-search-input.tsx`
- Create: `apps/web/src/components/ui/__tests__/user-search-input.test.tsx`
- Modify: `apps/web/src/components/ui/index.ts`

**Interfaces:**
- Consumes: `apolloClient.query({ query: SEARCH_USERS, variables: { query } })`
- Produces: `<UserSearchInput onSelectUser={(userId) => void} />`

- [ ] **Step 1: Write failing test**

```tsx
// apps/web/src/components/ui/__tests__/user-search-input.test.tsx
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { UserSearchInput } from '../user-search-input';

// Mock apolloClient
jest.mock('../../../lib/apollo-client', () => ({
  apolloClient: {
    query: jest.fn(),
  },
}));

import { apolloClient } from '../../../lib/apollo-client';

describe('UserSearchInput', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('renders search input', () => {
    render(<UserSearchInput onSelectUser={jest.fn()} currentUserId="u1" />);
    expect(screen.getByPlaceholderText('Search users...')).toBeInTheDocument();
  });

  it('shows "No users found" when search returns empty', async () => {
    (apolloClient.query as jest.Mock).mockResolvedValue({
      data: { searchUsers: [] },
    });

    render(<UserSearchInput onSelectUser={jest.fn()} currentUserId="u1" />);
    const input = screen.getByPlaceholderText('Search users...');
    fireEvent.change(input, { target: { value: 'xyz' } });

    await waitFor(() => {
      expect(screen.getByText(/No users found/)).toBeInTheDocument();
    });
  });

  it('renders search results and calls onSelectUser when result is clicked', async () => {
    const onSelectUser = jest.fn();
    (apolloClient.query as jest.Mock).mockResolvedValue({
      data: {
        searchUsers: [
          { id: 'u2', displayName: 'Diana', avatarUrl: null, bio: 'Reader' },
        ],
      },
    });

    render(<UserSearchInput onSelectUser={onSelectUser} currentUserId="u1" />);
    const input = screen.getByPlaceholderText('Search users...');
    fireEvent.change(input, { target: { value: 'diana' } });

    await waitFor(() => {
      expect(screen.getByText('Diana')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByText('Diana'));
    expect(onSelectUser).toHaveBeenCalledWith('u2');
  });
});
```

- [ ] **Step 2: Run test to verify fail**

Run: `cd apps/web && npx jest --testPathPattern='user-search-input' --no-coverage`
Expected: FAIL

- [ ] **Step 3: Create UserSearchInput component**

```tsx
// apps/web/src/components/ui/user-search-input.tsx
'use client';

import { useState, useCallback, useRef, useEffect } from 'react';
import { gql } from '@apollo/client';
import { apolloClient } from '../../lib/apollo-client';
import { UserAvatar } from './user-avatar';

const SEARCH_USERS_QUERY = gql`
  query SearchUsers($query: String!) {
    searchUsers(query: $query) {
      id
      displayName
      avatarUrl
      bio
    }
  }
`;

interface SearchUser {
  id: string;
  displayName: string;
  avatarUrl?: string | null;
  bio?: string;
}

interface UserSearchInputProps {
  onSelectUser: (userId: string) => void;
  currentUserId: string;
}

export function UserSearchInput({ onSelectUser, currentUserId }: UserSearchInputProps) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<SearchUser[]>([]);
  const [loading, setLoading] = useState(false);
  const [open, setOpen] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout>>();
  const containerRef = useRef<HTMLDivElement>(null);

  const search = useCallback(async (q: string) => {
    if (q.trim().length < 2) {
      setResults([]);
      setOpen(false);
      return;
    }
    setLoading(true);
    try {
      const { data } = await apolloClient.query({
        query: SEARCH_USERS_QUERY,
        variables: { query: q.trim() },
      });
      const filtered = (data.searchUsers ?? []).filter((u: SearchUser) => u.id !== currentUserId);
      setResults(filtered);
      setOpen(true);
    } catch {
      setResults([]);
    } finally {
      setLoading(false);
    }
  }, [currentUserId]);

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const value = e.target.value;
    setQuery(value);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => search(value), 300);
  };

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  return (
    <div ref={containerRef} className="relative">
      <div className="relative">
        <span className="material-symbols-outlined absolute left-4 top-1/2 -translate-y-1/2 text-on-surface-variant">
          search
        </span>
        <input
          type="text"
          placeholder="Search users..."
          value={query}
          onChange={handleChange}
          onFocus={() => results.length > 0 && setOpen(true)}
          className="w-full pl-12 pr-4 py-3 bg-surface-container-lowest border-outline border rounded-xl focus:ring-2 focus:ring-primary focus:border-primary outline-none transition-all font-body"
        />
      </div>

      {open && (
        <div className="absolute top-full mt-2 w-full bg-surface border border-outline-variant rounded-xl shadow-lg z-40 max-h-80 overflow-y-auto">
          {loading && (
            <div className="p-4 text-center text-on-surface-variant font-small">Searching...</div>
          )}
          {!loading && results.length === 0 && query.trim().length >= 2 && (
            <div className="p-4 text-center text-on-surface-variant font-body-mobile">
              No users found matching &ldquo;{query}&rdquo;
            </div>
          )}
          {results.map((user) => (
            <button
              key={user.id}
              onClick={() => {
                onSelectUser(user.id);
                setOpen(false);
                setQuery('');
              }}
              className="w-full flex items-center gap-3 p-3 hover:bg-surface-container transition-colors text-left"
            >
              <UserAvatar avatarUrl={user.avatarUrl} displayName={user.displayName} size="sm" />
              <div className="flex-1 min-w-0">
                <p className="font-headline-h4 text-on-surface text-sm truncate">{user.displayName}</p>
                {user.bio && (
                  <p className="font-micro text-on-surface-variant truncate">{user.bio}</p>
                )}
              </div>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 4: Export from barrel**

Add to `apps/web/src/components/ui/index.ts`:

```typescript
export { UserSearchInput } from './user-search-input';
```

- [ ] **Step 5: Run tests**

Run: `cd apps/web && npx jest --testPathPattern='user-search-input' --no-coverage`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/components/ui/user-search-input.tsx apps/web/src/components/ui/__tests__/user-search-input.test.tsx apps/web/src/components/ui/index.ts
git commit -m "feat(ui): add UserSearchInput component"
```

---

### Task 8: Create NotificationItem Component

**Files:**
- Create: `apps/web/src/components/ui/notification-item.tsx`
- Create: `apps/web/src/components/ui/__tests__/notification-item.test.tsx`
- Modify: `apps/web/src/components/ui/index.ts`

- [ ] **Step 1: Write failing test**

```tsx
// apps/web/src/components/ui/__tests__/notification-item.test.tsx
import { render, screen, fireEvent } from '@testing-library/react';
import { NotificationItem } from '../notification-item';

describe('NotificationItem', () => {
  it('renders notification text and timestamp', () => {
    render(
      <NotificationItem
        type="FRIEND_REQUEST"
        body="Alice sent you a friend request"
        timestamp="2h ago"
        read={false}
        onPress={jest.fn()}
      />
    );

    expect(screen.getByText('Alice sent you a friend request')).toBeInTheDocument();
    expect(screen.getByText('2h ago')).toBeInTheDocument();
  });

  it('shows unread dot when not read', () => {
    render(
      <NotificationItem
        type="FRIEND_REQUEST"
        body="Test notification"
        timestamp="1m ago"
        read={false}
        onPress={jest.fn()}
      />
    );

    const dot = document.querySelector('.bg-info') || document.querySelector('[class*="bg-info"]');
    expect(dot).toBeInTheDocument();
  });

  it('does not show unread dot when read', () => {
    render(
      <NotificationItem
        type="FRIEND_ACCEPTED"
        body="Test notification"
        timestamp="1d ago"
        read={true}
        onPress={jest.fn()}
      />
    );

    const dots = document.querySelectorAll('[class*="bg-info"]');
    // The icon background also uses bg-info/10 — check specifically for the unread dot
    const unreadDot = document.querySelector('.absolute.top-4.right-4');
    expect(unreadDot).toBeNull();
  });

  it('calls onPress when clicked', () => {
    const onPress = jest.fn();
    render(
      <NotificationItem
        type="FRIEND_REQUEST"
        body="Test"
        timestamp="now"
        read={false}
        onPress={onPress}
      />
    );

    fireEvent.click(screen.getByText('Test').closest('div[role="button"]')!);
    expect(onPress).toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run test to verify fail**

Run: `cd apps/web && npx jest --testPathPattern='notification-item' --no-coverage`
Expected: FAIL

- [ ] **Step 3: Create NotificationItem component**

```tsx
// apps/web/src/components/ui/notification-item.tsx
'use client';

const ICON_MAP: Record<string, { icon: string; bgClass: string; textClass: string }> = {
  FRIEND_REQUEST: { icon: 'person_add', bgClass: 'bg-info/10', textClass: 'text-info' },
  FRIEND_ACCEPTED: { icon: 'person_add', bgClass: 'bg-info/10', textClass: 'text-info' },
  GROUP_INVITE: { icon: 'groups', bgClass: 'bg-success/10', textClass: 'text-success' },
  GROUP_UPDATE: { icon: 'forum', bgClass: 'bg-success/10', textClass: 'text-success' },
  ANNOUNCEMENT: { icon: 'campaign', bgClass: 'bg-warning/10', textClass: 'text-warning' },
  SYSTEM: { icon: 'update', bgClass: 'bg-error/10', textClass: 'text-error' },
};

interface NotificationItemProps {
  type: string;
  body: string;
  timestamp: string;
  read: boolean;
  onPress: () => void;
}

export function NotificationItem({ type, body, timestamp, read, onPress }: NotificationItemProps) {
  const config = ICON_MAP[type] ?? { icon: 'notifications', bgClass: 'bg-surface-container', textClass: 'text-on-surface-variant' };

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onPress}
      onKeyDown={(e) => e.key === 'Enter' && onPress()}
      className={`p-4 rounded-xl hover:bg-surface-container transition-colors cursor-pointer border border-transparent hover:border-outline-variant relative ${
        !read ? 'bg-white' : 'bg-paper'
      }`}
    >
      {!read && <span className="absolute top-4 right-4 w-2 h-2 bg-info rounded-full" />}
      <div className="flex gap-3">
        <div className={`w-10 h-10 rounded-full ${config.bgClass} flex items-center justify-center flex-shrink-0`}>
          <span className={`material-symbols-outlined ${config.textClass} text-[20px]`}>
            {config.icon}
          </span>
        </div>
        <div className="flex-1 min-w-0">
          <p className="font-body text-body text-on-surface leading-snug">{body}</p>
          <p className="font-micro text-micro text-on-surface-variant mt-1">{timestamp}</p>
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Export from barrel**

Add to `apps/web/src/components/ui/index.ts`:

```typescript
export { NotificationItem } from './notification-item';
```

- [ ] **Step 5: Run tests**

Run: `cd apps/web && npx jest --testPathPattern='notification-item' --no-coverage`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/components/ui/notification-item.tsx apps/web/src/components/ui/__tests__/notification-item.test.tsx apps/web/src/components/ui/index.ts
git commit -m "feat(ui): add NotificationItem component"
```

---

### Task 9: Create BellIconWithBadge + Wire TopBar

**Files:**
- Create: `apps/web/src/components/ui/bell-icon.tsx`
- Modify: `apps/web/src/components/layout/topbar.tsx`
- Modify: `apps/web/src/components/ui/index.ts`

- [ ] **Step 1: Create BellIcon component**

```tsx
// apps/web/src/components/ui/bell-icon.tsx
'use client';

import { useState, useEffect, useCallback } from 'react';
import { gql } from '@apollo/client';
import { apolloClient } from '../../lib/apollo-client';

const UNREAD_COUNT_QUERY = gql`
  query UnreadNotificationCount {
    unreadNotificationCount
  }
`;

const NOTIFICATION_SUBSCRIPTION = gql`
  subscription NotificationReceived($userId: String!) {
    notificationReceived(userId: $userId) {
      id
      type
      payload
      createdAt
    }
  }
`;

interface BellIconProps {
  userId: string;
  onClick: () => void;
}

export function BellIcon({ userId, onClick }: BellIconProps) {
  const [count, setCount] = useState(0);
  const [isSubscribed, setIsSubscribed] = useState(false);

  const fetchCount = useCallback(async () => {
    try {
      const { data } = await apolloClient.query({ query: UNREAD_COUNT_QUERY });
      setCount(data.unreadNotificationCount ?? 0);
    } catch {
      // Silently fail — badge just won't show
    }
  }, []);

  useEffect(() => {
    fetchCount();
  }, [fetchCount]);

  useEffect(() => {
    if (!userId || isSubscribed) return;

    setIsSubscribed(true);
    const observable = apolloClient.subscribe({
      query: NOTIFICATION_SUBSCRIPTION,
      variables: { userId },
    });

    const subscription = observable.subscribe({
      next: () => {
        setCount((prev) => prev + 1);
      },
      error: () => {
        // Subscription error — bell still works, just no real-time updates
      },
    });

    return () => {
      subscription.unsubscribe();
    };
  }, [userId, isSubscribed]);

  return (
    <button
      onClick={onClick}
      className="material-symbols-outlined text-on-surface-variant cursor-pointer p-2 hover:bg-surface-container rounded-full transition-colors relative"
      aria-label="Notifications"
    >
      notifications
      {count > 0 && (
        <span className="absolute top-1.5 right-1.5 min-w-[16px] h-4 bg-error text-white text-[10px] font-bold rounded-full flex items-center justify-center px-1 leading-none">
          {count > 9 ? '9+' : count}
        </span>
      )}
    </button>
  );
}
```

- [ ] **Step 2: Wire into TopBar**

In `apps/web/src/components/layout/topbar.tsx`, replace the static notifications button:

```tsx
// Replace the existing notifications button:
// <button
//   className="material-symbols-outlined text-on-surface-variant cursor-pointer p-2 hover:bg-surface-container rounded-full transition-colors"
//   aria-label="Notifications"
// >
//   notifications
// </button>

// With:
import { BellIcon } from '../ui/bell-icon';

// In the component, add userId from auth store:
const userId = useAuthStore((s) => s.user?.id);

// Replace the notifications button with:
<BellIcon userId={userId ?? ''} onClick={handleNotificationClick} />
```

Add a state and handler for the notification panel (will be wired in Task 11):

At the top of the TopBar component, add:

```typescript
const [notificationPanelOpen, setNotificationPanelOpen] = useState(false);
const handleNotificationClick = () => setNotificationPanelOpen(true);
```

- [ ] **Step 3: Export from barrel**

Add to `apps/web/src/components/ui/index.ts`:

```typescript
export { BellIcon } from './bell-icon';
```

- [ ] **Step 4: Verify the app compiles**

Run: `cd apps/web && npx next build --no-lint 2>&1 | head -30`
Expected: Should compile (may have warnings about unused state — fine, will be used in Task 11)

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/components/ui/bell-icon.tsx apps/web/src/components/layout/topbar.tsx apps/web/src/components/ui/index.ts
git commit -m "feat(notifications): add BellIcon with real-time badge and wire into TopBar"
```

---

### Task 10: Create UserProfileSheet Component

**Files:**
- Create: `apps/web/src/components/friends/user-profile-sheet.tsx`
- Create: `apps/web/src/components/friends/index.ts`

**Interfaces:**
- Consumes: `apolloClient.query({ query: USER_PROFILE_QUERY, variables: { id } })`
- Produces: `<UserProfileSheet userId={string} open={boolean} onClose={() => void} currentUserId={string} />`

- [ ] **Step 1: Create friends component directory barrel**

```typescript
// apps/web/src/components/friends/index.ts
export { UserProfileSheet } from './user-profile-sheet';
```

- [ ] **Step 2: Create UserProfileSheet component**

```tsx
// apps/web/src/components/friends/user-profile-sheet.tsx
'use client';

import { useState, useEffect, useCallback } from 'react';
import { gql } from '@apollo/client';
import { useRouter } from 'next/navigation';
import { apolloClient } from '../../lib/apollo-client';
import { useToast, UserAvatar, Modal } from '../ui';

const USER_PROFILE_QUERY = gql`
  query UserProfile($id: String!) {
    userProfile(id: $id) {
      user {
        id
        displayName
        avatarUrl
        bio
        role
      }
      friendCount
      groupCount
      bookCount
      bookProgress {
        book {
          title
        }
        currentPage
      }
      groups {
        name
      }
    }
  }
`;

const SEND_FRIEND_REQUEST = gql`
  mutation SendFriendRequest($addresseeId: String!) {
    sendFriendRequest(addresseeId: $addresseeId) {
      id
      status
    }
  }
`;

interface UserProfileData {
  userProfile: {
    user: { id: string; displayName: string; avatarUrl?: string | null; bio?: string; role: string };
    friendCount: number;
    groupCount: number;
    bookCount: number;
    bookProgress: Array<{ book: { title: string }; currentPage: number }>;
    groups: Array<{ name: string }>;
  };
}

interface UserProfileSheetProps {
  userId: string;
  open: boolean;
  onClose: () => void;
  currentUserId: string;
}

export function UserProfileSheet({ userId, open, onClose, currentUserId }: UserProfileSheetProps) {
  const [profile, setProfile] = useState<UserProfileData['userProfile'] | null>(null);
  const [loading, setLoading] = useState(false);
  const [sending, setSending] = useState(false);
  const { addToast } = useToast();
  const router = useRouter();

  const fetchProfile = useCallback(async () => {
    if (!userId) return;
    setLoading(true);
    try {
      const { data } = await apolloClient.query<UserProfileData>({
        query: USER_PROFILE_QUERY,
        variables: { id: userId },
      });
      setProfile(data.userProfile);
    } catch {
      addToast('Failed to load profile.', 'error');
    } finally {
      setLoading(false);
    }
  }, [userId, addToast]);

  useEffect(() => {
    if (open && userId) fetchProfile();
  }, [open, userId, fetchProfile]);

  const handleAddFriend = async () => {
    setSending(true);
    try {
      await apolloClient.mutate({
        mutation: SEND_FRIEND_REQUEST,
        variables: { addresseeId: userId },
      });
      addToast('Friend request sent!', 'success');
    } catch {
      addToast('Failed to send friend request.', 'error');
    } finally {
      setSending(false);
    }
  };

  const isOwnProfile = userId === currentUserId;
  const user = profile?.user;

  return (
    <Modal open={open} onClose={onClose} title={null}>
      <div className="flex flex-col items-center">
        {/* Close button */}
        <button
          onClick={onClose}
          className="absolute top-4 right-4 bg-white/20 hover:bg-white/40 p-1 rounded-full text-on-surface transition-colors"
        >
          <span className="material-symbols-outlined">close</span>
        </button>

        {loading ? (
          <div className="w-full space-y-4 py-8">
            <div className="w-[72px] h-[72px] rounded-full bg-surface-container-high animate-pulse mx-auto" />
            <div className="h-6 bg-surface-container-high rounded w-1/3 mx-auto animate-pulse" />
            <div className="h-4 bg-surface-container-high rounded w-2/3 mx-auto animate-pulse" />
          </div>
        ) : user ? (
          <>
            <div className="w-[72px] h-[72px] rounded-full border-4 border-paper bg-surface overflow-hidden shadow-md -mt-16">
              <UserAvatar avatarUrl={user.avatarUrl} displayName={user.displayName} size="md" />
            </div>
            <h3 className="mt-4 font-display text-headline-h2 text-on-surface">{user.displayName}</h3>
            {user.bio && (
              <p className="font-body text-small text-on-surface-variant mt-2 text-center line-clamp-2">
                {user.bio}
              </p>
            )}
            {user.role && user.role !== 'MEMBER' && (
              <span className="mt-2 px-2 py-0.5 bg-primary-container text-on-primary-container text-[10px] font-bold rounded-full uppercase tracking-wide">
                {user.role}
              </span>
            )}

            {/* Stats */}
            <div className="grid grid-cols-3 w-full gap-2 mt-6 mb-4 border-y border-outline-variant/30 py-4">
              <div className="text-center">
                <p className="font-display text-headline-h4 text-primary">{profile.friendCount}</p>
                <p className="font-micro text-[10px] uppercase text-on-surface-variant">Friends</p>
              </div>
              <div className="text-center border-x border-outline-variant/30">
                <p className="font-display text-headline-h4 text-primary">{profile.groupCount}</p>
                <p className="font-micro text-[10px] uppercase text-on-surface-variant">Groups</p>
              </div>
              <div className="text-center">
                <p className="font-display text-headline-h4 text-primary">{profile.bookCount}</p>
                <p className="font-micro text-[10px] uppercase text-on-surface-variant">Books</p>
              </div>
            </div>

            {/* Currently reading snippet */}
            {profile.bookProgress.length > 0 && (
              <div className="w-full bg-surface-container-low p-4 rounded-lg mb-4">
                <div className="flex items-center gap-1 mb-1">
                  <span className="material-symbols-outlined text-brand-orange-dark text-sm">auto_stories</span>
                  <span className="font-micro text-[11px] uppercase font-bold text-brand-orange-dark">Currently reading</span>
                </div>
                <p className="font-body text-small italic text-on-surface leading-tight">
                  &ldquo;{profile.bookProgress[0].book.title}&rdquo;
                </p>
              </div>
            )}

            {/* Actions */}
            <div className="w-full flex flex-col gap-3">
              {!isOwnProfile && (
                <button
                  onClick={handleAddFriend}
                  disabled={sending}
                  className="w-full py-3 bg-brand-orange-dark text-white rounded-lg font-bold shadow-sm flex items-center justify-center gap-2 hover:brightness-110 active:scale-[0.98] transition-all disabled:opacity-50"
                >
                  <span className="material-symbols-outlined">person_add</span>
                  {sending ? 'Sending...' : 'Add Friend'}
                </button>
              )}
              <button
                onClick={() => { onClose(); router.push(`/users/${userId}`); }}
                className="w-full text-center py-2 text-primary font-bold text-small hover:underline"
              >
                View Full Profile
              </button>
            </div>
          </>
        ) : (
          <p className="py-8 text-on-surface-variant">User not found.</p>
        )}
      </div>
    </Modal>
  );
}
```

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/components/friends/
git commit -m "feat(friends): add UserProfileSheet modal component"
```

---

### Task 11: Create NotificationPanel Component

**Files:**
- Create: `apps/web/src/components/notifications/notification-panel.tsx`
- Create: `apps/web/src/components/notifications/index.ts`
- Modify: `apps/web/src/components/layout/topbar.tsx`

- [ ] **Step 1: Create notifications component directory barrel**

```typescript
// apps/web/src/components/notifications/index.ts
export { NotificationPanel } from './notification-panel';
```

- [ ] **Step 2: Create NotificationPanel component**

```tsx
// apps/web/src/components/notifications/notification-panel.tsx
'use client';

import { useState, useEffect, useCallback } from 'react';
import { gql } from '@apollo/client';
import { useRouter } from 'next/navigation';
import { apolloClient } from '../../lib/apollo-client';
import { NotificationItem } from '../ui/notification-item';
import { useToast } from '../ui/toast';

const NOTIFICATIONS_QUERY = gql`
  query Notifications($limit: Int!) {
    notifications(limit: $limit) {
      id
      type
      payload
      readAt
      createdAt
    }
  }
`;

const MARK_ALL_READ = gql`
  mutation MarkAllNotificationsRead {
    markAllNotificationsRead
  }
`;

interface Notification {
  id: string;
  type: string;
  payload?: Record<string, unknown>;
  readAt?: string | null;
  createdAt: string;
}

interface NotificationPanelProps {
  open: boolean;
  onClose: () => void;
  userId: string;
}

function getNotificationBody(notification: Notification): string {
  switch (notification.type) {
    case 'FRIEND_REQUEST':
      return 'sent you a friend request';
    case 'FRIEND_ACCEPTED':
      return 'accepted your friend request';
    case 'GROUP_INVITE':
      return 'invited you to join a group';
    case 'GROUP_UPDATE':
      return 'New discussion in your group';
    default:
      return 'You have a new notification';
  }
}

function relativeTime(dateString: string): string {
  const now = Date.now();
  const then = new Date(dateString).getTime();
  const diff = now - then;
  const mins = Math.floor(diff / 60000);
  const hours = Math.floor(diff / 3600000);
  const days = Math.floor(diff / 86400000);

  if (mins < 1) return 'Just now';
  if (mins < 60) return `${mins}m ago`;
  if (hours < 24) return `${hours}h ago`;
  if (days === 1) return 'Yesterday';
  if (days < 7) return `${days}d ago`;
  return new Date(dateString).toLocaleDateString();
}

export function NotificationPanel({ open, onClose, userId }: NotificationPanelProps) {
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [loading, setLoading] = useState(false);
  const { addToast } = useToast();
  const router = useRouter();

  const fetchNotifications = useCallback(async () => {
    setLoading(true);
    try {
      const { data } = await apolloClient.query({
        query: NOTIFICATIONS_QUERY,
        variables: { limit: 5 },
      });
      setNotifications(data.notifications ?? []);
    } catch {
      addToast('Failed to load notifications.', 'error');
    } finally {
      setLoading(false);
    }
  }, [addToast]);

  useEffect(() => {
    if (open) fetchNotifications();
  }, [open, fetchNotifications]);

  const handleMarkAllRead = async () => {
    try {
      await apolloClient.mutate({ mutation: MARK_ALL_READ });
      setNotifications((prev) => prev.map((n) => ({ ...n, readAt: new Date().toISOString() })));
    } catch {
      addToast('Failed to mark all as read.', 'error');
    }
  };

  const handleNotificationPress = (notification: Notification) => {
    onClose();
    if (notification.type === 'FRIEND_REQUEST' || notification.type === 'FRIEND_ACCEPTED') {
      router.push('/friends');
    } else {
      router.push('/notifications');
    }
  };

  if (!open) return null;

  return (
    <>
      {/* Backdrop */}
      <div className="fixed inset-0 bg-ink-black/60 backdrop-blur-[2px] z-[60]" onClick={onClose} />

      {/* Panel */}
      <div className="fixed top-0 right-0 h-full w-[320px] md:w-[400px] bg-surface shadow-2xl z-[70] border-l border-outline-variant transform transition-transform duration-300 ease-in-out">
        <div className="flex flex-col h-full">
          {/* Header */}
          <div className="p-4 border-b border-outline-variant flex justify-between items-center bg-surface-container-low">
            <h2 className="font-display text-headline-h3 font-bold text-primary">Notifications</h2>
            <button
              onClick={onClose}
              className="material-symbols-outlined text-on-surface-variant hover:text-primary transition-colors"
            >
              close
            </button>
          </div>

          {/* List */}
          <div className="flex-1 overflow-y-auto p-3 space-y-2">
            {loading ? (
              Array.from({ length: 3 }).map((_, i) => (
                <div key={i} className="p-4 rounded-lg bg-surface-container-high animate-pulse">
                  <div className="flex gap-3">
                    <div className="w-10 h-10 rounded-full bg-surface-container-highest" />
                    <div className="flex-1 space-y-2">
                      <div className="h-4 bg-surface-container-highest rounded w-3/4" />
                      <div className="h-3 bg-surface-container-highest rounded w-1/4" />
                    </div>
                  </div>
                </div>
              ))
            ) : notifications.length > 0 ? (
              notifications.map((n) => (
                <NotificationItem
                  key={n.id}
                  type={n.type}
                  body={getNotificationBody(n)}
                  timestamp={relativeTime(n.createdAt)}
                  read={!!n.readAt}
                  onPress={() => handleNotificationPress(n)}
                />
              ))
            ) : (
              <div className="flex flex-col items-center justify-center py-12 text-on-surface-variant">
                <span className="material-symbols-outlined text-4xl mb-2">notifications_off</span>
                <p className="font-body-mobile">No notifications yet.</p>
              </div>
            )}
          </div>

          {/* Footer */}
          <div className="p-4 border-t border-outline-variant text-center bg-surface-container-lowest space-y-2">
            {notifications.some((n) => !n.readAt) && (
              <button
                onClick={handleMarkAllRead}
                className="text-info font-bold text-small hover:underline block w-full"
              >
                Mark all read
              </button>
            )}
            <button
              onClick={() => { onClose(); router.push('/notifications'); }}
              className="text-primary font-bold hover:underline"
            >
              View All Notifications
            </button>
          </div>
        </div>
      </div>
    </>
  );
}
```

- [ ] **Step 3: Wire NotificationPanel into TopBar**

In `apps/web/src/components/layout/topbar.tsx`, add after the existing JSX (before the closing `</header>`):

```tsx
import { NotificationPanel } from '../notifications/notification-panel';

// ... inside the component, add after the existing header content:
{notificationPanelOpen && (
  <NotificationPanel
    open={notificationPanelOpen}
    onClose={() => setNotificationPanelOpen(false)}
    userId={userId ?? ''}
  />
)}
```

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/components/notifications/ apps/web/src/components/layout/topbar.tsx
git commit -m "feat(notifications): add NotificationPanel slide-out drawer and wire into TopBar"
```

---

### Task 12: Implement /friends Page

**Files:**
- Modify: `apps/web/src/app/friends/page.tsx`
- Modify: `apps/web/src/app/friends/friends-client.tsx`

- [ ] **Step 1: Update page.tsx to match groups pattern**

```tsx
// apps/web/src/app/friends/page.tsx
import type { Metadata } from 'next';
import { AuthenticatedLayout } from '../../components/layout/authenticated-layout';
import FriendsClient from './friends-client';

export const metadata: Metadata = {
  title: 'Friends — Transformlit',
};

export default function Route() {
  return (
    <AuthenticatedLayout>
      <FriendsClient />
    </AuthenticatedLayout>
  );
}
```

- [ ] **Step 2: Implement friends-client.tsx**

```tsx
// apps/web/src/app/friends/friends-client.tsx
'use client';

import { useState, useEffect, useCallback } from 'react';
import { gql } from '@apollo/client';
import { useRouter } from 'next/navigation';
import { apolloClient } from '../../lib/apollo-client';
import { useRequireAuth } from '../../lib/hooks/use-require-auth';
import { useAuthStore } from '../../store';
import {
  useToast,
  FriendCard,
  FriendRequestItem,
  SuggestedFriendCard,
  UserSearchInput,
  LoadingSpinner,
} from '../../components/ui';
import { UserProfileSheet } from '../../components/friends/user-profile-sheet';

const FRIENDS_QUERY = gql`
  query Friends {
    friends {
      id
      requesterId
      addresseeId
      requester { id displayName avatarUrl bio }
      addressee { id displayName avatarUrl bio }
      status
    }
  }
`;

const REQUESTS_QUERY = gql`
  query FriendRequests {
    friendRequests {
      id
      requester { id displayName avatarUrl bio }
      status
    }
  }
`;

const ACCEPT_REQUEST = gql`
  mutation AcceptFriendRequest($friendshipId: String!) {
    acceptFriendRequest(friendshipId: $friendshipId) {
      id
      status
    }
  }
`;

const REJECT_REQUEST = gql`
  mutation RejectFriendRequest($friendshipId: String!) {
    rejectFriendRequest(friendshipId: $friendshipId) {
      id
      status
    }
  }
`;

const SEND_REQUEST = gql`
  mutation SendFriendRequest($addresseeId: String!) {
    sendFriendRequest(addresseeId: $addresseeId) {
      id
      status
    }
  }
`;

const REMOVE_FRIEND = gql`
  mutation RemoveFriend($friendshipId: String!) {
    removeFriend(friendshipId: $friendshipId)
  }
`;

interface FriendData {
  id: string;
  requesterId: string;
  addresseeId: string;
  requester: { id: string; displayName: string; avatarUrl?: string | null; bio?: string };
  addressee: { id: string; displayName: string; avatarUrl?: string | null; bio?: string };
  status: string;
}

interface RequestData {
  id: string;
  requester: { id: string; displayName: string; avatarUrl?: string | null; bio?: string };
  status: string;
}

export default function FriendsClient() {
  const { isReady } = useRequireAuth();
  const currentUserId = useAuthStore((s) => s.user?.id);
  const { addToast } = useToast();
  const router = useRouter();

  const [friends, setFriends] = useState<FriendData[]>([]);
  const [requests, setRequests] = useState<RequestData[]>([]);
  const [loading, setLoading] = useState(true);
  const [requestsOpen, setRequestsOpen] = useState(true);
  const [profileSheetUserId, setProfileSheetUserId] = useState<string | null>(null);

  const loadData = useCallback(async () => {
    try {
      const [friendsResult, requestsResult] = await Promise.all([
        apolloClient.query({ query: FRIENDS_QUERY }),
        apolloClient.query({ query: REQUESTS_QUERY }),
      ]);
      setFriends(friendsResult.data.friends ?? []);
      setRequests(requestsResult.data.friendRequests ?? []);
    } catch {
      addToast('Failed to load friends.', 'error');
    } finally {
      setLoading(false);
    }
  }, [addToast]);

  useEffect(() => {
    if (isReady) loadData();
  }, [isReady, loadData]);

  const handleAccept = async (friendshipId: string) => {
    try {
      await apolloClient.mutate({ mutation: ACCEPT_REQUEST, variables: { friendshipId } });
      addToast('Friend request accepted!', 'success');
      loadData();
    } catch {
      addToast('Failed to accept request.', 'error');
    }
  };

  const handleReject = async (friendshipId: string) => {
    try {
      await apolloClient.mutate({ mutation: REJECT_REQUEST, variables: { friendshipId } });
      addToast('Friend request declined.', 'info');
      loadData();
    } catch {
      addToast('Failed to decline request.', 'error');
    }
  };

  const handleSendRequest = async (userId: string) => {
    try {
      await apolloClient.mutate({ mutation: SEND_REQUEST, variables: { addresseeId: userId } });
      addToast('Friend request sent!', 'success');
    } catch {
      addToast('Failed to send request.', 'error');
    }
  };

  const handleSelectUser = (userId: string) => {
    setProfileSheetUserId(userId);
  };

  if (!isReady) return <LoadingSpinner />;

  // Derive friend name from friendship (other side of the relationship)
  const getFriendInfo = (f: FriendData) => {
    if (f.requesterId === currentUserId) return f.addressee;
    return f.requester;
  };

  return (
    <div className="space-y-8">
      {/* Search */}
      <div className="sticky top-16 bg-background/80 backdrop-blur-md z-30 py-4 -mx-4 px-4">
        <UserSearchInput onSelectUser={handleSelectUser} currentUserId={currentUserId ?? ''} />
      </div>

      {/* Friend Requests */}
      {requests.length > 0 && (
        <section>
          <button
            onClick={() => setRequestsOpen(!requestsOpen)}
            className="flex items-center justify-between w-full mb-4 group"
          >
            <h3 className="font-display text-headline-h3 text-on-surface">
              Friend Requests ({requests.length})
            </h3>
            <span
              className="material-symbols-outlined text-on-surface-variant transition-transform duration-300"
              style={{ transform: requestsOpen ? 'rotate(0deg)' : 'rotate(180deg)' }}
            >
              expand_less
            </span>
          </button>
          {requestsOpen && (
            <div className="space-y-3">
              {requests.map((req) => (
                <FriendRequestItem
                  key={req.id}
                  name={req.requester.displayName}
                  bio={req.requester.bio}
                  avatarUrl={req.requester.avatarUrl}
                  onAccept={() => handleAccept(req.id)}
                  onDecline={() => handleReject(req.id)}
                />
              ))}
            </div>
          )}
        </section>
      )}

      {/* Suggested Friends (placeholder — real suggestions come later via group overlap) */}
      <section>
        <h3 className="font-display text-headline-h3 text-on-surface mb-4">Suggested Friends</h3>
        {loading ? (
          <div className="flex gap-4 overflow-x-auto pb-4">
            {Array.from({ length: 3 }).map((_, i) => (
              <div key={i} className="min-w-[200px] h-48 bg-surface-container-high rounded-xl animate-pulse flex-shrink-0" />
            ))}
          </div>
        ) : (
          <div className="flex gap-4 overflow-x-auto pb-4 -mx-4 px-4 snap-x">
            <SuggestedFriendCard name="Leo T." tag="Classic Literature Fan" onAdd={() => {}} />
            <SuggestedFriendCard name="Emma G." tag="Sci-Fi Enthusiast" onAdd={() => {}} />
            <SuggestedFriendCard name="Oliver K." tag="Poetry Lover" onAdd={() => {}} />
          </div>
        )}
      </section>

      {/* Friends List */}
      <section>
        <h3 className="font-display text-headline-h3 text-on-surface mb-4">
          Your Friends ({friends.length})
        </h3>
        {loading ? (
          <div className="space-y-3">
            {Array.from({ length: 3 }).map((_, i) => (
              <div key={i} className="h-16 bg-surface-container-high rounded-xl animate-pulse" />
            ))}
          </div>
        ) : friends.length > 0 ? (
          <div className="space-y-3">
            {friends.map((f) => {
              const friend = getFriendInfo(f);
              return (
                <FriendCard
                  key={f.id}
                  name={friend.displayName}
                  bio={friend.bio}
                  avatarUrl={friend.avatarUrl}
                  onPress={() => setProfileSheetUserId(friend.id)}
                />
              );
            })}
          </div>
        ) : (
          <div className="flex flex-col items-center justify-center py-20 text-center">
            <span className="material-symbols-outlined text-[120px] text-primary opacity-40">person_search</span>
            <h3 className="font-display text-headline-h2 text-on-surface-variant mb-2">Finding your circle?</h3>
            <p className="font-body max-w-sm text-on-surface-variant mb-8">
              Your friends list is empty. Search for fellow readers to connect!
            </p>
          </div>
        )}
      </section>

      {/* User Profile Sheet */}
      {profileSheetUserId && (
        <UserProfileSheet
          userId={profileSheetUserId}
          open={!!profileSheetUserId}
          onClose={() => setProfileSheetUserId(null)}
          currentUserId={currentUserId ?? ''}
        />
      )}
    </div>
  );
}
```

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/app/friends/
git commit -m "feat(friends): implement friends page with requests, search, and friend list"
```

---

### Task 13: Implement /users/[id] Page

**Files:**
- Create: `apps/web/src/app/users/[id]/page.tsx`
- Create: `apps/web/src/app/users/[id]/user-profile-client.tsx`

- [ ] **Step 1: Create user profile page.tsx**

```tsx
// apps/web/src/app/users/[id]/page.tsx
import type { Metadata } from 'next';
import { AuthenticatedLayout } from '../../../components/layout/authenticated-layout';
import UserProfileClient from './user-profile-client';

export const metadata: Metadata = {
  title: 'User Profile — Transformlit',
};

export default function Route() {
  return (
    <AuthenticatedLayout>
      <UserProfileClient />
    </AuthenticatedLayout>
  );
}
```

- [ ] **Step 2: Create UserProfileClient**

```tsx
// apps/web/src/app/users/[id]/user-profile-client.tsx
'use client';

import { useState, useEffect, useCallback } from 'react';
import { gql } from '@apollo/client';
import { useParams, useRouter } from 'next/navigation';
import { apolloClient } from '../../../lib/apollo-client';
import { useRequireAuth } from '../../../lib/hooks/use-require-auth';
import { useAuthStore } from '../../../store';
import { useToast, UserAvatar, BookCard, LoadingSpinner } from '../../../components/ui';

const USER_PROFILE_QUERY = gql`
  query UserProfile($id: String!) {
    userProfile(id: $id) {
      user { id displayName avatarUrl bio role }
      friendCount groupCount bookCount
      bookProgress {
        book { id title author coverUrl }
        currentPage
      }
      groups { id name slug description category coverImageUrl memberCount }
    }
  }
`;

const SEND_REQUEST = gql`
  mutation SendFriendRequest($addresseeId: String!) {
    sendFriendRequest(addresseeId: $addresseeId) { id status }
  }
`;

interface ProfileData {
  userProfile: {
    user: { id: string; displayName: string; avatarUrl?: string | null; bio?: string; role: string };
    friendCount: number;
    groupCount: number;
    bookCount: number;
    bookProgress: Array<{ book: { id: string; title: string; author?: string; coverUrl?: string }; currentPage: number }>;
    groups: Array<{ id: string; name: string; slug: string; description: string; category?: string; coverImageUrl?: string; memberCount: number }>;
  };
}

export default function UserProfileClient() {
  const { isReady } = useRequireAuth();
  const currentUserId = useAuthStore((s) => s.user?.id);
  const { addToast } = useToast();
  const router = useRouter();
  const params = useParams();
  const userId = params.id as string;

  const [profile, setProfile] = useState<ProfileData['userProfile'] | null>(null);
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);

  const fetchProfile = useCallback(async () => {
    try {
      const { data } = await apolloClient.query<ProfileData>({
        query: USER_PROFILE_QUERY,
        variables: { id: userId },
      });
      setProfile(data.userProfile);
    } catch {
      addToast('Failed to load profile.', 'error');
    } finally {
      setLoading(false);
    }
  }, [userId, addToast]);

  useEffect(() => {
    if (isReady) fetchProfile();
  }, [isReady, fetchProfile]);

  const handleAddFriend = async () => {
    setSending(true);
    try {
      await apolloClient.mutate({
        mutation: SEND_REQUEST,
        variables: { addresseeId: userId },
      });
      addToast('Friend request sent!', 'success');
    } catch {
      addToast('Failed to send friend request.', 'error');
    } finally {
      setSending(false);
    }
  };

  if (!isReady || loading) return <LoadingSpinner />;
  if (!profile) {
    return (
      <div className="flex flex-col items-center justify-center py-20">
        <p className="font-body text-on-surface-variant">User not found.</p>
        <button onClick={() => router.back()} className="mt-4 text-primary font-bold hover:underline">
          Go back
        </button>
      </div>
    );
  }

  const { user } = profile;
  const isOwnProfile = user.id === currentUserId;

  return (
    <div className="max-w-4xl mx-auto py-8 space-y-10">
      {/* Back button */}
      <button
        onClick={() => router.back()}
        className="w-10 h-10 flex items-center justify-center rounded-full hover:bg-surface-container-high transition-colors"
      >
        <span className="material-symbols-outlined text-on-surface">arrow_back</span>
      </button>

      {/* Header */}
      <section className="bg-surface-container-lowest rounded-xl border border-outline-variant p-6 md:p-8 shadow-sm">
        <div className="flex flex-col md:flex-row items-center md:items-start gap-6 md:gap-8">
          <div className="w-24 h-24 md:w-[96px] md:h-[96px] rounded-full border-4 border-paper-warm overflow-hidden shadow-lg flex-shrink-0">
            <UserAvatar avatarUrl={user.avatarUrl} displayName={user.displayName} size="md" />
          </div>
          <div className="flex-1 text-center md:text-left">
            <div className="flex flex-col md:flex-row md:items-center gap-2 md:gap-4 mb-2">
              <h1 className="font-headline-h1 text-on-surface">{user.displayName}</h1>
              {user.role !== 'MEMBER' && (
                <span className="bg-primary text-white text-[10px] font-bold px-2 py-0.5 rounded tracking-widest self-center md:self-auto uppercase">
                  {user.role}
                </span>
              )}
            </div>
            {user.bio && (
              <p className="font-body italic text-on-surface-variant text-lg max-w-xl mb-6">
                {user.bio}
              </p>
            )}
            {!isOwnProfile && (
              <button
                onClick={handleAddFriend}
                disabled={sending}
                className="bg-brand-orange-dark text-on-primary font-headline-h4 px-6 h-11 rounded-md flex items-center gap-2 shadow-sm hover:translate-y-[-2px] transition-all active:scale-95 disabled:opacity-50"
              >
                <span className="material-symbols-outlined text-[20px]">person_add</span>
                {sending ? 'Sending...' : 'Add Friend'}
              </button>
            )}
          </div>
        </div>
        {/* Stats */}
        <div className="mt-6 pt-6 border-t border-outline-variant flex justify-center md:justify-start gap-6 text-on-surface-variant">
          <span><strong className="text-primary">{profile.friendCount}</strong> Friends</span>
          <span className="text-outline-variant">·</span>
          <span><strong className="text-primary">{profile.groupCount}</strong> Groups</span>
          <span className="text-outline-variant">·</span>
          <span><strong className="text-primary">{profile.bookCount}</strong> Books</span>
        </div>
      </section>

      {/* Currently Reading */}
      {profile.bookProgress.length > 0 && (
        <section>
          <h2 className="font-headline-h2 text-on-surface mb-6">Currently Reading</h2>
          <div className="flex gap-4 overflow-x-auto pb-4 -mx-4 px-4 snap-x">
            {profile.bookProgress.map((bp) => (
              <div key={bp.book.id} className="flex-shrink-0 w-[160px] snap-start">
                <BookCard
                  id={bp.book.id}
                  title={bp.book.title}
                  author={bp.book.author}
                  coverUrl={bp.book.coverUrl}
                />
              </div>
            ))}
          </div>
        </section>
      )}

      {/* Groups */}
      {profile.groups.length > 0 && (
        <section>
          <h2 className="font-headline-h2 text-on-surface mb-6">Active Groups</h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {profile.groups.map((g) => (
              <div
                key={g.id}
                onClick={() => router.push(`/groups/${g.slug}`)}
                className="p-4 bg-paper rounded-lg border border-outline-variant flex items-center gap-4 hover:shadow-md transition-shadow cursor-pointer"
              >
                <div className="w-14 h-14 rounded-lg bg-secondary-container flex items-center justify-center flex-shrink-0">
                  <span className="material-symbols-outlined text-on-secondary-container">auto_stories</span>
                </div>
                <div className="overflow-hidden">
                  <h4 className="font-headline-h4 text-sm line-clamp-1">{g.name}</h4>
                  <p className="font-micro text-xs text-on-surface-variant">{g.memberCount} members</p>
                </div>
              </div>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
```

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/app/users/
git commit -m "feat(friends): implement user profile page with activity"
```

---

### Task 14: Implement /notifications Page

**Files:**
- Create: `apps/web/src/app/notifications/page.tsx`
- Create: `apps/web/src/app/notifications/notifications-client.tsx`

- [ ] **Step 1: Create page.tsx**

```tsx
// apps/web/src/app/notifications/page.tsx
import type { Metadata } from 'next';
import { AuthenticatedLayout } from '../../components/layout/authenticated-layout';
import NotificationsClient from './notifications-client';

export const metadata: Metadata = {
  title: 'Notifications — Transformlit',
};

export default function Route() {
  return (
    <AuthenticatedLayout>
      <NotificationsClient />
    </AuthenticatedLayout>
  );
}
```

- [ ] **Step 2: Create NotificationsClient**

```tsx
// apps/web/src/app/notifications/notifications-client.tsx
'use client';

import { useState, useEffect, useCallback } from 'react';
import { gql } from '@apollo/client';
import { useRouter } from 'next/navigation';
import { apolloClient } from '../../lib/apollo-client';
import { useRequireAuth } from '../../lib/hooks/use-require-auth';
import { useToast, NotificationItem, LoadingSpinner } from '../../components/ui';

const NOTIFICATIONS_QUERY = gql`
  query AllNotifications($limit: Int!) {
    notifications(limit: $limit) {
      id
      type
      payload
      readAt
      createdAt
    }
  }
`;

const MARK_READ = gql`
  mutation MarkNotificationRead($notificationId: String!) {
    markNotificationRead(notificationId: $notificationId)
  }
`;

const MARK_ALL_READ = gql`
  mutation MarkAllNotificationsRead {
    markAllNotificationsRead
  }
`;

interface Notification {
  id: string;
  type: string;
  payload?: Record<string, unknown>;
  readAt?: string | null;
  createdAt: string;
}

function relativeTime(dateString: string): string {
  const now = Date.now();
  const then = new Date(dateString).getTime();
  const diff = now - then;
  const mins = Math.floor(diff / 60000);
  const hours = Math.floor(diff / 3600000);
  const days = Math.floor(diff / 86400000);

  if (mins < 1) return 'Just now';
  if (mins < 60) return `${mins}m ago`;
  if (hours < 24) return `${hours}h ago`;
  if (days === 1) return 'Yesterday';
  if (days < 7) return `${days}d ago`;
  return new Date(dateString).toLocaleDateString();
}

function getBody(n: Notification): string {
  switch (n.type) {
    case 'FRIEND_REQUEST': return 'sent you a friend request';
    case 'FRIEND_ACCEPTED': return 'accepted your friend request';
    case 'GROUP_INVITE': return 'invited you to join a group';
    case 'GROUP_UPDATE': return 'New discussion in your group';
    default: return 'You have a new notification';
  }
}

function groupByDate(notifications: Notification[]): Map<string, Notification[]> {
  const groups = new Map<string, Notification[]>();
  const now = new Date();

  for (const n of notifications) {
    const date = new Date(n.createdAt);
    let key: string;
    if (date.toDateString() === now.toDateString()) key = 'Today';
    else if (new Date(now.getTime() - 86400000).toDateString() === date.toDateString()) key = 'Yesterday';
    else if (now.getTime() - date.getTime() < 7 * 86400000) key = 'This Week';
    else key = 'Older';

    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(n);
  }

  return groups;
}

export default function NotificationsClient() {
  const { isReady } = useRequireAuth();
  const { addToast } = useToast();
  const router = useRouter();

  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchNotifications = useCallback(async () => {
    try {
      const { data } = await apolloClient.query({
        query: NOTIFICATIONS_QUERY,
        variables: { limit: 50 },
      });
      setNotifications(data.notifications ?? []);
    } catch {
      addToast('Failed to load notifications.', 'error');
    } finally {
      setLoading(false);
    }
  }, [addToast]);

  useEffect(() => {
    if (isReady) fetchNotifications();
  }, [isReady, fetchNotifications]);

  const handlePress = async (notification: Notification) => {
    try {
      await apolloClient.mutate({
        mutation: MARK_READ,
        variables: { notificationId: notification.id },
      });
      setNotifications((prev) =>
        prev.map((n) => (n.id === notification.id ? { ...n, readAt: new Date().toISOString() } : n))
      );
    } catch {
      // Silent fail
    }

    if (notification.type === 'FRIEND_REQUEST' || notification.type === 'FRIEND_ACCEPTED') {
      router.push('/friends');
    }
  };

  const handleMarkAllRead = async () => {
    try {
      await apolloClient.mutate({ mutation: MARK_ALL_READ });
      setNotifications((prev) => prev.map((n) => ({ ...n, readAt: new Date().toISOString() })));
    } catch {
      addToast('Failed to mark all as read.', 'error');
    }
  };

  if (!isReady) return <LoadingSpinner />;

  const grouped = groupByDate(notifications);

  return (
    <div className="max-w-[800px] mx-auto py-8">
      {/* Header */}
      <div className="flex justify-between items-baseline mb-8 border-b border-outline-variant pb-4">
        <h1 className="font-headline-h1 text-on-surface">Notifications</h1>
        {notifications.some((n) => !n.readAt) && (
          <button
            onClick={handleMarkAllRead}
            className="text-info font-small font-medium hover:underline transition-colors"
          >
            Mark all read
          </button>
        )}
      </div>

      {loading ? (
        <div className="space-y-3">
          {Array.from({ length: 5 }).map((_, i) => (
            <div key={i} className="h-16 bg-surface-container-high rounded-xl animate-pulse" />
          ))}
        </div>
      ) : notifications.length > 0 ? (
        <div className="space-y-10">
          {Array.from(grouped.entries()).map(([group, items]) => (
            <section key={group}>
              <h2 className="font-display text-headline-h4 text-on-surface-variant mb-4">
                {group}
              </h2>
              <div className="space-y-3">
                {items.map((n) => (
                  <NotificationItem
                    key={n.id}
                    type={n.type}
                    body={getBody(n)}
                    timestamp={relativeTime(n.createdAt)}
                    read={!!n.readAt}
                    onPress={() => handlePress(n)}
                  />
                ))}
              </div>
            </section>
          ))}
        </div>
      ) : (
        <div className="py-24 flex flex-col items-center text-center">
          <span className="material-symbols-outlined text-[120px] text-primary opacity-40 mb-4">
            notifications_off
          </span>
          <h3 className="font-headline-h3 text-on-surface mb-2">All caught up!</h3>
          <p className="font-body text-on-surface-variant max-w-xs">
            Your inbox is quiet. We&apos;ll let you know when something new happens.
          </p>
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/app/notifications/
git commit -m "feat(notifications): implement notifications page with date groupings"
```

---

### Task 15: Wire UserAvatar Tap to UserProfileSheet

**Files:**
- Modify: `apps/web/src/components/ui/user-avatar.tsx`

- [ ] **Step 1: Add optional userId and onPress props to UserAvatar**

```tsx
// apps/web/src/components/ui/user-avatar.tsx
'use client';

type UserAvatarProps = {
  avatarUrl?: string | null;
  displayName?: string;
  size?: 'sm' | 'md';
  userId?: string;
  onPress?: (userId: string) => void;
};

export function UserAvatar({ avatarUrl, displayName, size = 'md', userId, onPress }: UserAvatarProps) {
  const sizeClass = size === 'sm' ? 'w-8 h-8' : 'w-9 h-9';
  const textSize = size === 'sm' ? 'text-[10px]' : 'text-xs';
  const initial = displayName?.charAt(0)?.toUpperCase() ?? 'U';

  const content = (
    <div
      className={`${sizeClass} rounded-full bg-primary-fixed overflow-hidden border border-primary/20 flex items-center justify-center shrink-0`}
    >
      {avatarUrl ? (
        <img className="w-full h-full object-cover" src={avatarUrl} alt={displayName ?? 'User'} />
      ) : (
        <span className={`${textSize} font-bold text-on-primary-container`}>{initial}</span>
      )}
    </div>
  );

  if (userId && onPress) {
    return (
      <button
        onClick={() => onPress(userId)}
        className="cursor-pointer hover:opacity-80 transition-opacity"
        aria-label={`View ${displayName ?? 'user'}'s profile`}
      >
        {content}
      </button>
    );
  }

  return content;
}
```

- [ ] **Step 2: Wire UserProfileSheet into AppShell or individual pages**

Since the `UserProfileSheet` needs to be accessible from anywhere, the simplest approach is to add it to `AppShell` with a global context. However, for simplicity and to match existing patterns, add it to each page that needs it via a shared hook.

Create a simple context provider:

```tsx
// apps/web/src/components/friends/profile-sheet-provider.tsx
'use client';

import { createContext, useContext, useState, useCallback, ReactNode } from 'react';
import { useAuthStore } from '../../store';
import { UserProfileSheet } from './user-profile-sheet';

interface ProfileSheetContextType {
  openProfile: (userId: string) => void;
  closeProfile: () => void;
}

const ProfileSheetContext = createContext<ProfileSheetContextType | null>(null);

export function useProfileSheet() {
  const ctx = useContext(ProfileSheetContext);
  if (!ctx) throw new Error('useProfileSheet must be used within ProfileSheetProvider');
  return ctx;
}

export function ProfileSheetProvider({ children }: { children: ReactNode }) {
  const [userId, setUserId] = useState<string | null>(null);
  const currentUserId = useAuthStore((s) => s.user?.id);

  const openProfile = useCallback((id: string) => setUserId(id), []);
  const closeProfile = useCallback(() => setUserId(null), []);

  return (
    <ProfileSheetContext.Provider value={{ openProfile, closeProfile }}>
      {children}
      {userId && (
        <UserProfileSheet
          userId={userId}
          open={!!userId}
          onClose={closeProfile}
          currentUserId={currentUserId ?? ''}
        />
      )}
    </ProfileSheetContext.Provider>
  );
}
```

- [ ] **Step 3: Wrap AppShell with ProfileSheetProvider**

In `apps/web/src/components/layout/authenticated-layout.tsx`:

```tsx
'use client';

import { ApolloProvider } from '../providers/apollo-provider';
import { ProfileSheetProvider } from '../friends/profile-sheet-provider';
import { AppShell } from './app-shell';

export function AuthenticatedLayout({ children }: { children: React.ReactNode }) {
  return (
    <ApolloProvider>
      <ProfileSheetProvider>
        <AppShell>{children}</AppShell>
      </ProfileSheetProvider>
    </ApolloProvider>
  );
}
```

- [ ] **Step 4: Use openProfile in places where UserAvatar appears**

No other code changes needed — the `useProfileSheet()` hook is available for any component that wants to trigger the sheet. The default behavior of `UserAvatar` is unchanged unless `onPress` is provided.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/components/ui/user-avatar.tsx apps/web/src/components/friends/profile-sheet-provider.tsx apps/web/src/components/layout/authenticated-layout.tsx
git commit -m "feat(friends): add profile sheet provider and wire UserAvatar tap"
```

---

### Task 16: Integration Tests and E2E Tests

**Files:**
- Create: `apps/web/e2e/friends.spec.ts`
- Create: `apps/web/e2e/pages/friends.page.ts`

- [ ] **Step 1: Create friends e2e page object**

```typescript
// apps/web/e2e/pages/friends.page.ts
import { Page, Locator } from '@playwright/test';

export class FriendsPage {
  readonly page: Page;
  readonly searchInput: Locator;
  readonly requestsSection: Locator;
  readonly friendsSection: Locator;

  constructor(page: Page) {
    this.page = page;
    this.searchInput = page.getByPlaceholder('Search users...');
    this.requestsSection = page.getByText('Friend Requests');
    this.friendsSection = page.getByText(/Your Friends/);
  }

  async goto() {
    await this.page.goto('/friends');
  }

  async search(query: string) {
    await this.searchInput.fill(query);
  }

  async acceptRequest() {
    await this.page.getByText('Accept').first().click();
  }

  async declineRequest() {
    await this.page.getByText('Decline').first().click();
  }
}
```

- [ ] **Step 2: Create e2e test**

```typescript
// apps/web/e2e/friends.spec.ts
import { test, expect } from '@playwright/test';
import { FriendsPage } from './pages/friends.page';

test.describe('Friends Page', () => {
  test('loads friends page with auth', async ({ page }) => {
    // Note: requires a seeded test user with auth tokens
    const friendsPage = new FriendsPage(page);
    await friendsPage.goto();

    await expect(page.getByText('Your Friends')).toBeVisible();
    await expect(friendsPage.searchInput).toBeVisible();
  });

  test('friend request flow', async ({ page }) => {
    const friendsPage = new FriendsPage(page);
    await friendsPage.goto();

    // Search for a user to send request to
    await friendsPage.search('testuser');
    // ... (requires seeded data)
  });
});
```

- [ ] **Step 3: Commit**

```bash
git add apps/web/e2e/
git commit -m "test(friends): add e2e tests for friends page"
```

---

### Task 17: Run Full Test Suite and Fix Issues

**Files:**
- No specific files — this is a verification task

- [ ] **Step 1: Run backend tests**

```bash
cd apps/api && npx jest --no-coverage
```

Expected: All existing tests pass. Fix any failures introduced by module changes.

- [ ] **Step 2: Run frontend unit tests**

```bash
cd apps/web && npx jest --no-coverage
```

Expected: All unit tests pass. Fix any failures.

- [ ] **Step 3: Run e2e tests**

```bash
cd apps/web && npx playwright test
```

Expected: E2E tests pass (may require test database seeding).

- [ ] **Step 4: Build check**

```bash
cd apps/web && npx next build
```

Expected: Build succeeds with no errors.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "chore: fix test and build issues from friends feature"
```

---

## Execution Order Notes

Tasks 1-3 (Backend) should be completed first, as the frontend components depend on the API being available.

Tasks 4-8 (UI Components) can be done in any order and in parallel since they are independent.

Tasks 9-11 (Bell, Sheet, Panel) depend on Tasks 4-8 being complete.

Tasks 12-14 (Pages) depend on all component Tasks being complete.

Task 15 (Wiring) depends on Tasks 10 and 12-14.

Task 16 (E2E) should be done after all features are functional.

Task 17 (Verification) is the final step.
