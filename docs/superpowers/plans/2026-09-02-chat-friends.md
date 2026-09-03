# Chat + Friends Completion — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the realtime chat UI (list + thread), friends-only DM policy with full chat authorization, unread indicators, real suggested/mutual friends, and Chat in navigation — closing the last gaps of the friends feature.

**Architecture:** Backend is NestJS code-first GraphQL + Prisma 7 + Postgres LISTEN/NOTIFY pubsub. All chat/friends backend logic exists; this plan hardens it (authorization, subscription generalization, unread aggregates, suggestions) and builds the missing web UI. Chat state lives in a Zustand store driven by one `messageAdded` subscription per auth session — not the Apollo cache. Routes: `/chat` (list) + `/chat/[id]` (thread), two-pane on desktop via layout, stacked on mobile.

**Tech Stack:** NestJS 11, Apollo Server 5, Prisma 7.9, PostgreSQL 15, Next.js 16 App Router, React 19, Apollo Client 4.2, Zustand 5, Tailwind v4 (MD3 tokens), Jest (unit + integration via Testcontainers), Playwright.

**Spec:** `docs/superpowers/specs/2026-09-02-chat-friends-design.md`

## Global Constraints

- DM eligibility: `startDirectConversation` requires an ACCEPTED friendship (either direction); any BLOCKED relation rejects; self-chat rejected with a clean error (no raw P2002/P2003).
- Membership checks on `getMessages`, `sendMessage`, `markConversationRead`, `getOrCreateGroupConversation` (ACTIVE group member). Errors: `throw new Error('You don't have access to this conversation')` style, matching repo convention (plain Error).
- Message body: trimmed, non-empty, ≤ 2000 chars (service-level; also update `packages/shared` `sendMessageSchema` max from 5000 → 2000).
- `messageAdded` publish payload: `{ messageAdded, memberIds }` — slim, never embed sender user objects (pg_notify 8000-byte cap).
- `messageAdded(conversationId: ID)` → nullable arg; filter is synchronous and membership-based via `memberIds` + `context.req.user.id`.
- Unread count = messages with `createdAt > member.lastReadAt` and `senderId != me` (null lastReadAt counts all non-self); computed in ONE `$queryRaw` GROUP BY aggregate.
- `listConversations` capped `take: 50`, ordered `updatedAt desc`.
- Friendship lookups are direction-agnostic: always `OR: [{requesterId: X}, {addresseeId: X}]`.
- `suggestedFriends` clamp limit 1–20 (default 5); excludes self, ACCEPTED friends, and any PENDING/BLOCKED/REJECTED row involving me (both directions); empty-graph fallback = newest members.
- `mutualFriends` ≤ 10; empty when viewing own profile.
- Web: chat state ONLY in `store/chat-store.ts`; delete the inert `messages` typePolicy from `apps/web/src/lib/apollo-client.ts`.
- Subscription wired once per auth session (effect deps `[userId]` only); never copy the `bell-icon.tsx` isSubscribed-in-deps pattern.
- Nav badge: rendered by href in `Sidebar`/`BottomNav` (NOT in the `as const` array); count capped "9+".
- markRead: optimistic fire-and-forget; on thread open and on receive-while-at-bottom.
- Imports in `apps/api` use `.js` suffixes; in `apps/web` plain relative paths.
- New GraphQL type fields are additive except: `MessageConnection.totalCount` removed (unused, was `0 // lazy`).

---

### Task 1: ChatService membership guards + body cap

**Files:**
- Modify: `apps/api/src/chat/chat.service.ts`
- Create: `apps/api/src/chat/chat.service.spec.ts` (unit, mocked PrismaService/PubSubService)
- Modify: `packages/shared/src/schemas/index.ts:85-87`

**Interfaces:**
- Consumes: existing `PrismaService`, `PubSubService`, `SendMessageInput`.
- Produces: `ChatService.assertMember(conversationId, userId)` (private), `getMessages(conversationId, cursor?, limit?)`, `sendMessage(input, senderId)`, `markRead(conversationId, userId)`, `getOrCreateGroupConversation(groupId)` — all now enforce membership/validation.

- [ ] **Step 1: Write the failing unit spec**

Create `apps/api/src/chat/chat.service.spec.ts`:

```ts
import { Test } from '@nestjs/testing';
import { ChatService } from './chat.service.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { PubSubService } from './pubsub.service.js';

describe('ChatService authorization', () => {
  let service: ChatService;
  let prisma: {
    conversationMember: { findUnique: jest.Mock };
    message: { create: jest.Mock; findMany: jest.Mock };
    conversation: { update: jest.Mock; findMany: jest.Mock; findFirst: jest.Mock; create: jest.Mock };
    groupMember: { findFirst: jest.Mock };
  };
  const userA = 'user-a';
  const userB = 'user-b';

  beforeEach(async () => {
    prisma = {
      conversationMember: {
        findUnique: jest.fn().mockResolvedValue({ userId: userA, lastReadAt: null }),
      },
      message: {
        create: jest.fn().mockResolvedValue({ id: 'm1', body: 'hi' }),
        findMany: jest.fn().mockResolvedValue([]),
      },
      conversation: {
        update: jest.fn().mockResolvedValue({}),
        findMany: jest.fn().mockResolvedValue([]),
        findFirst: jest.fn().mockResolvedValue(null),
        create: jest.fn().mockResolvedValue({ id: 'c1', type: 'DIRECT' }),
      },
      groupMember: { findFirst: jest.fn().mockResolvedValue(null) },
    };

    const moduleRef = await Test.createTestingModule({
      providers: [
        ChatService,
        { provide: PrismaService, useValue: prisma },
        { provide: PubSubService, useValue: { publish: jest.fn() } },
      ],
    }).compile();

    service = moduleRef.get(ChatService);
  });

  it('rejects getMessages for a non-member', async () => {
    prisma.conversationMember.findUnique.mockResolvedValueOnce(null);
    await expect(service.getMessages('c1', undefined, 25)).rejects.toThrow(
      "You don't have access to this conversation",
    );
    expect(prisma.message.findMany).not.toHaveBeenCalled();
  });

  it('rejects sendMessage for a non-member', async () => {
    prisma.conversationMember.findUnique.mockResolvedValueOnce(null);
    await expect(
      service.sendMessage({ conversationId: 'c1', body: 'hi' }, userA),
    ).rejects.toThrow("You don't have access to this conversation");
  });

  it('rejects empty and over-long message bodies', async () => {
    await expect(
      service.sendMessage({ conversationId: 'c1', body: '   ' }, userA),
    ).rejects.toThrow('Message body cannot be empty');

    await expect(
      service.sendMessage({ conversationId: 'c1', body: 'x'.repeat(2001) }, userA),
    ).rejects.toThrow('Message is too long (max 2000 characters)');
  });

  it('rejects markRead for a non-member', async () => {
    prisma.conversationMember.findUnique.mockResolvedValueOnce(null);
    await expect(service.markRead('c1', userA)).rejects.toThrow(
      "You don't have access to this conversation",
    );
  });

  it('rejects getOrCreateGroupConversation for a non-active group member', async () => {
    await expect(service.getOrCreateGroupConversation('g1')).rejects.toThrow(
      'You must be an active member of this group',
    );
    expect(prisma.conversation.findFirst).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm --filter @transformlit/api test -- --testPathPattern chat.service`
Expected: FAIL — `assertMember`/body checks don't exist yet.

- [ ] **Step 3: Implement guards in ChatService**

Edit `apps/api/src/chat/chat.service.ts`. Add imports (`Injectable` already there) and a private helper, then guard every public method:

```ts
private async assertMember(conversationId: string, userId: string) {
  const member = await this.prisma.conversationMember.findUnique({
    where: { conversationId_userId: { conversationId, userId } },
  });
  if (!member) throw new Error("You don't have access to this conversation");
}
```

`getMessages` — first line: `await this.assertMember(conversationId, userId);` (add `userId: string` param; update resolver call in Task 3's neighbor work only if needed — the resolver already passes `user.id`, see Task 8).

`sendMessage`:

```ts
async sendMessage(input: SendMessageInput, senderId: string) {
  await this.assertMember(input.conversationId, senderId);

  const body = input.body.trim();
  if (!body) throw new Error('Message body cannot be empty');
  if (body.length > 2000) throw new Error('Message is too long (max 2000 characters)');

  const msg = await this.prisma.message.create({
    data: {
      conversationId: input.conversationId,
      senderId,
      body,
    },
  });
  // ...existing update + publish (publish payload changes in Task 3)
}
```

`markRead`:

```ts
async markRead(conversationId: string, userId: string) {
  await this.assertMember(conversationId, userId);
  await this.prisma.conversationMember.updateMany({
    where: { conversationId, userId },
    data: { lastReadAt: new Date() },
  });
  return true;
}
```

`getOrCreateGroupConversation`:

```ts
async getOrCreateGroupConversation(groupId: string, userId: string) {
  const member = await this.prisma.groupMember.findFirst({
    where: { groupId, userId, status: 'ACTIVE' },
  });
  if (!member) throw new Error('You must be an active member of this group');
  // ...existing logic unchanged
}
```

- [ ] **Step 4: Update shared schema max length**

In `packages/shared/src/schemas/index.ts`, change:

```ts
export const sendMessageSchema = z.object({
  conversationId: z.string().uuid(),
  body: z.string().min(1).max(5000),
});
```

to `.max(2000)`.

- [ ] **Step 5: Run unit + integration tests**

Run: `pnpm --filter @transformlit/api test -- --testPathPattern chat.service`
Expected: PASS.

Run: `pnpm --filter @transformlit/api test:integration -- --testPathPattern chat.integration`
Expected: existing chat integration tests still PASS (users are members in all fixtures; bodies are short).

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/chat/chat.service.ts apps/api/src/chat/chat.service.spec.ts packages/shared/src/schemas/index.ts
git commit -m "feat(api): enforce chat membership guards and body limits"
```

---

### Task 2: Friends-only DM policy

**Files:**
- Modify: `apps/api/src/chat/chat.service.ts` (`getOrCreateDirectConversation`)
- Modify: `apps/api/src/chat/chat.service.spec.ts`
- Modify: `apps/api/test/chat.integration.spec.ts` (fixtures now need an ACCEPTED friendship)

**Interfaces:**
- Produces: `getOrCreateDirectConversation(userId, otherUserId)` — rejects self-chat, unknown target, BLOCKED relation, and non-friend pairs; returns existing conversation when the pair already has one.

- [ ] **Step 1: Write the failing unit tests**

Append to `apps/api/src/chat/chat.service.spec.ts` (add `friendship: { findFirst: jest.Mock }` to the mock, and `user.findUnique`):

```ts
it('rejects self-chat', async () => {
  await expect(service.getOrCreateDirectConversation(userA, userA)).rejects.toThrow(
    'You cannot message yourself',
  );
});

it('rejects unknown users', async () => {
  prisma.user = { findUnique: jest.fn().mockResolvedValue(null) };
  await expect(service.getOrCreateDirectConversation(userA, 'ghost')).rejects.toThrow(
    'User not found',
  );
});

it('rejects blocked pairs', async () => {
  prisma.user = { findUnique: jest.fn().mockResolvedValue({ id: userB }) };
  prisma.friendship.findFirst.mockResolvedValueOnce({ status: 'BLOCKED' });
  await expect(service.getOrCreateDirectConversation(userA, userB)).rejects.toThrow(
    'You cannot message this user',
  );
});

it('rejects non-friends', async () => {
  prisma.user = { findUnique: jest.fn().mockResolvedValue({ id: userB }) };
  prisma.friendship.findFirst
    .mockResolvedValueOnce(null) // no BLOCKED row
    .mockResolvedValueOnce(null); // no ACCEPTED row
  await expect(service.getOrCreateDirectConversation(userA, userB)).rejects.toThrow(
    'You can only message your friends',
  );
  expect(prisma.conversation.findFirst).not.toHaveBeenCalled();
});

it('creates a conversation for friends', async () => {
  prisma.user = { findUnique: jest.fn().mockResolvedValue({ id: userB }) };
  prisma.friendship.findFirst
    .mockResolvedValueOnce(null) // no BLOCKED row
    .mockResolvedValueOnce({ status: 'ACCEPTED' }); // accepted friendship
  const conv = await service.getOrCreateDirectConversation(userA, userB);
  expect(conv.id).toBe('c1');
});
```

- [ ] **Step 2: Run to verify failure**

Run: `pnpm --filter @transformlit/api test -- --testPathPattern chat.service`
Expected: FAIL on the new cases.

- [ ] **Step 3: Implement the policy**

Replace `getOrCreateDirectConversation` in `apps/api/src/chat/chat.service.ts`:

```ts
async getOrCreateDirectConversation(userId: string, otherUserId: string) {
  if (userId === otherUserId) throw new Error('You cannot message yourself');

  const other = await this.prisma.user.findUnique({
    where: { id: otherUserId, deletedAt: null },
  });
  if (!other) throw new Error('User not found');

  const blocked = await this.prisma.friendship.findFirst({
    where: {
      OR: [
        { requesterId: userId, addresseeId: otherUserId },
        { requesterId: otherUserId, addresseeId: userId },
      ],
      status: 'BLOCKED',
    },
  });
  if (blocked) throw new Error('You cannot message this user');

  const friendship = await this.prisma.friendship.findFirst({
    where: {
      OR: [
        { requesterId: userId, addresseeId: otherUserId },
        { requesterId: otherUserId, addresseeId: userId },
      ],
      status: 'ACCEPTED',
    },
  });
  if (!friendship) throw new Error('You can only message your friends');

  // Find existing direct conversation (unchanged)
  const existing = await this.prisma.conversation.findFirst({
    where: {
      type: 'DIRECT',
      deletedAt: null,
      AND: [
        { members: { some: { userId } } },
        { members: { some: { userId: otherUserId } } },
      ],
    },
  });
  if (existing) return existing;

  return this.prisma.conversation.create({
    data: {
      type: 'DIRECT',
      members: {
        create: [{ userId }, { userId: otherUserId }],
      },
    },
  });
}
```

- [ ] **Step 4: Update integration fixtures**

In `apps/api/test/chat.integration.spec.ts` `beforeEach`, after registering users, create an accepted friendship so existing conversation tests keep passing. Add a helper (file-level function):

```ts
async function makeFriends(a: string, b: string) {
  await prisma.friendship.create({
    data: { requesterId: a, addresseeId: b, status: 'ACCEPTED' },
  });
}
```

Call `await makeFriends(user1Id, user2Id);` at the end of `beforeEach` (after `prisma.friendship.deleteMany()` is added to the cleanup list at the top of `beforeEach`).

Also add a new integration test block:

```ts
describe('friends-only DMs', () => {
  it('rejects starting a conversation with a non-friend', async () => {
    const stranger = await authService.registerLocal({
      email: 'stranger@example.com',
      password: 'password123',
      displayName: 'Stranger',
    });
    await expect(
      chatService.getOrCreateDirectConversation(user1Id, stranger.user.id),
    ).rejects.toThrow('You can only message your friends');
  });

  it('rejects self-chat', async () => {
    await expect(
      chatService.getOrCreateDirectConversation(user1Id, user1Id),
    ).rejects.toThrow('You cannot message yourself');
  });
});
```

- [ ] **Step 5: Run tests**

Run: `pnpm --filter @transformlit/api test -- --testPathPattern chat.service`
Expected: PASS.

Run: `pnpm --filter @transformlit/api test:integration -- --testPathPattern chat.integration`
Expected: PASS (fixtures updated).

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/chat/chat.service.ts apps/api/src/chat/chat.service.spec.ts apps/api/test/chat.integration.spec.ts
git commit -m "feat(api): friends-only direct messaging policy"
```

---

### Task 3: Generalize messageAdded + pubsub error logging

**Files:**
- Create: `apps/api/src/chat/message-added.filter.ts`
- Create: `apps/api/src/chat/message-added.filter.spec.ts`
- Modify: `apps/api/src/chat/chat.service.ts` (publish payload gains `memberIds`)
- Modify: `apps/api/src/chat/chat.resolver.ts` (nullable arg + sync filter)
- Modify: `apps/api/src/chat/pubsub.service.ts` (error logging)
- Modify: `apps/api/test/chat.integration.spec.ts` (publish spy assertion)

**Interfaces:**
- Produces: `messageAddedFilter(payload: MessageAddedPayload, variables: { conversationId?: string }, context: MessageAddedContext): boolean` — pure, synchronous, unit-testable. `MessageAddedPayload = { messageAdded: Message; memberIds: string[] }`.

- [ ] **Step 1: Write the failing filter spec**

Create `apps/api/src/chat/message-added.filter.spec.ts`:

```ts
import { messageAddedFilter, MessageAddedPayload } from './message-added.filter.js';

const payload: MessageAddedPayload = {
  messageAdded: { id: 'm1', conversationId: 'c1', senderId: 'a', body: 'hi', createdAt: new Date() } as any,
  memberIds: ['a', 'b'],
};

describe('messageAddedFilter', () => {
  it('delivers to members when no conversationId is given', () => {
    expect(messageAddedFilter(payload, {}, { req: { user: { id: 'b' } } })).toBe(true);
  });

  it('drops non-members', () => {
    expect(messageAddedFilter(payload, {}, { req: { user: { id: 'c' } } })).toBe(false);
  });

  it('drops events without a resolved user', () => {
    expect(messageAddedFilter(payload, {}, {})).toBe(false);
  });

  it('delivers to members when conversationId matches', () => {
    expect(messageAddedFilter(payload, { conversationId: 'c1' }, { req: { user: { id: 'b' } } })).toBe(true);
  });

  it('drops when conversationId does not match', () => {
    expect(messageAddedFilter(payload, { conversationId: 'other' }, { req: { user: { id: 'b' } } })).toBe(false);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `pnpm --filter @transformlit/api test -- --testPathPattern message-added.filter`
Expected: FAIL — module doesn't exist.

- [ ] **Step 3: Create the filter module**

Create `apps/api/src/chat/message-added.filter.ts`:

```ts
import { Message } from './models/chat.model.js';

export interface MessageAddedPayload {
  messageAdded: Message;
  memberIds: string[];
}

export interface MessageAddedContext {
  req?: { user?: { id?: string } };
}

export function messageAddedFilter(
  payload: MessageAddedPayload,
  variables: { conversationId?: string },
  context: MessageAddedContext,
): boolean {
  const userId = context?.req?.user?.id;
  if (!userId) return false;
  if (!payload.memberIds.includes(userId)) return false;
  if (variables.conversationId && payload.messageAdded.conversationId !== variables.conversationId) {
    return false;
  }
  return true;
}
```

- [ ] **Step 4: Publish memberIds from sendMessage**

In `apps/api/src/chat/chat.service.ts`, `sendMessage`, after `conversation.update` and before `publish`:

```ts
const members = await this.prisma.conversationMember.findMany({
  where: { conversationId: input.conversationId },
  select: { userId: true },
});

await this.pubSub.publish('messageAdded', {
  messageAdded: msg,
  memberIds: members.map((m) => m.userId),
});
```

- [ ] **Step 5: Rewire the resolver**

In `apps/api/src/chat/chat.resolver.ts`, replace the subscription block:

```ts
@Subscription(() => Message, {
  name: 'messageAdded',
  resolve: (payload: MessageAddedPayload) => payload.messageAdded,
  filter: (payload, variables, context) =>
    messageAddedFilter(payload, variables, context),
})
@UseGuards(JwtAuthGuard)
messageAdded(@Args('conversationId', { nullable: true }) conversationId?: string) {
  return this.pubSub.asyncIterator('messageAdded');
}
```

Add the import: `import { messageAddedFilter, MessageAddedPayload } from './message-added.filter.js';`

- [ ] **Step 6: PubSub error logging**

In `apps/api/src/chat/pubsub.service.ts`, replace `client.on('error', () => {});` with:

```ts
// Realtime dies silently if the LISTEN connection drops; log loudly so
// operators notice (process restart restores the subscription).
client.on('error', (err) => {
  console.error('[pubsub] Postgres LISTEN connection error:', err.message);
});
```

- [ ] **Step 7: Update the integration publish assertion**

In `apps/api/test/chat.integration.spec.ts`, update the `sendMessage` test:

```ts
expect(publishSpy).toHaveBeenCalledWith('messageAdded', {
  messageAdded: expect.objectContaining({ id: msg.id }),
  memberIds: expect.arrayContaining([user1Id, user2Id]),
});
```

- [ ] **Step 8: Run tests**

Run: `pnpm --filter @transformlit/api test -- --testPathPattern "chat.service|message-added.filter"`
Expected: PASS.

Run: `pnpm --filter @transformlit/api test:integration -- --testPathPattern chat.integration`
Expected: PASS.

- [ ] **Step 9: Commit**

```bash
git add apps/api/src/chat/message-added.filter.ts apps/api/src/chat/message-added.filter.spec.ts apps/api/src/chat/chat.service.ts apps/api/src/chat/chat.resolver.ts apps/api/src/chat/pubsub.service.ts apps/api/test/chat.integration.spec.ts
git commit -m "feat(api): membership-filtered messageAdded subscription"
```

---

### Task 4: Enrich Conversation/Message types + unread aggregate

**Files:**
- Modify: `apps/api/src/chat/models/chat.model.ts`
- Modify: `apps/api/src/chat/chat.service.ts`
- Modify: `apps/api/test/chat.integration.spec.ts`

**Interfaces:**
- Produces: `Conversation` GraphQL type with `updatedAt`, `otherUser: User`, `group: ConversationGroup`, `lastMessage: Message`, `unreadCount: Int`, `myLastReadAt: DateTime`. `ConversationGroup` GraphQL type `{ id, name, slug, coverImageUrl }`. `Message` gains `sender: User` (nullable). `MessageConnection` loses `totalCount`.

- [ ] **Step 1: Write failing integration tests**

Append to `apps/api/test/chat.integration.spec.ts`:

```ts
describe('listConversations enrichment', () => {
  it('returns otherUser, lastMessage, unreadCount and myLastReadAt', async () => {
    const conv = await chatService.getOrCreateDirectConversation(user1Id, user2Id);
    await chatService.sendMessage({ conversationId: conv.id, body: 'Hello' }, user2Id);

    const [list] = await chatService.listConversations(user1Id);

    expect(list.id).toBe(conv.id);
    expect(list.otherUser!.id).toBe(user2Id);
    expect(list.lastMessage!.body).toBe('Hello');
    expect(list.unreadCount).toBe(1);
    expect(list.myLastReadAt).toBeNull();
  });

  it('unreadCount resets after markRead and excludes own messages', async () => {
    const conv = await chatService.getOrCreateDirectConversation(user1Id, user2Id);
    await chatService.sendMessage({ conversationId: conv.id, body: 'mine' }, user1Id);
    await chatService.sendMessage({ conversationId: conv.id, body: 'yours' }, user2Id);

    let [list] = await chatService.listConversations(user1Id);
    expect(list.unreadCount).toBe(1); // only user2's message

    await chatService.markRead(conv.id, user1Id);
    [list] = await chatService.listConversations(user1Id);
    expect(list.unreadCount).toBe(0);
  });
});

describe('getMessages sender', () => {
  it('includes sender user', async () => {
    const conv = await chatService.getOrCreateDirectConversation(user1Id, user2Id);
    await chatService.sendMessage({ conversationId: conv.id, body: 'hi' }, user1Id);

    const result = await chatService.getMessages(conv.id);
    expect(result.edges[0].node.sender!.id).toBe(user1Id);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `pnpm --filter @transformlit/api test:integration -- --testPathPattern chat.integration`
Expected: FAIL — `otherUser`/`unreadCount`/`sender` don't exist.

- [ ] **Step 3: Extend the GraphQL models**

`apps/api/src/chat/models/chat.model.ts` — add imports (`Int` from `@nestjs/graphql`, `User` from `../../auth/models/auth.model.js`) and:

```ts
@ObjectType()
export class ConversationGroup {
  @Field(() => ID)
  id: string;

  @Field()
  name: string;

  @Field()
  slug: string;

  @Field({ nullable: true })
  coverImageUrl?: string;
}
```

Add to `Conversation`:

```ts
@Field()
updatedAt: Date;

@Field(() => User, { nullable: true })
otherUser?: User;

@Field(() => ConversationGroup, { nullable: true })
group?: ConversationGroup;

@Field(() => Message, { nullable: true })
lastMessage?: Message;

@Field(() => Int)
unreadCount: number;

@Field({ nullable: true })
myLastReadAt?: Date;
```

Add to `Message`:

```ts
@Field(() => User, { nullable: true })
sender?: User;
```

Remove `totalCount` from `MessageConnection` (field + `@Field` decorator; drop `totalCount: 0` usage below).

- [ ] **Step 4: Enrich listConversations + sender includes**

In `apps/api/src/chat/chat.service.ts`:

```ts
async listConversations(userId: string) {
  const conversations = await this.prisma.conversation.findMany({
    where: { members: { some: { userId } }, deletedAt: null },
    include: {
      members: { include: { user: true } },
      messages: { take: 1, orderBy: { createdAt: 'desc' } },
      group: true,
    },
    orderBy: { updatedAt: 'desc' },
    take: 50,
  });

  const unread = await this.getUnreadCounts(userId);

  return conversations.map((conv) => {
    const me = conv.members.find((m) => m.userId === userId);
    const other =
      conv.type === 'DIRECT'
        ? conv.members.find((m) => m.userId !== userId)
        : undefined;
    return {
      id: conv.id,
      type: conv.type,
      groupId: conv.groupId,
      createdAt: conv.createdAt,
      updatedAt: conv.updatedAt,
      otherUser: other?.user,
      group: conv.group
        ? {
            id: conv.group.id,
            name: conv.group.name,
            slug: conv.group.slug,
            coverImageUrl: conv.group.coverImageUrl ?? undefined,
          }
        : null,
      lastMessage: conv.messages[0] ?? null,
      unreadCount: unread.get(conv.id) ?? 0,
      myLastReadAt: me?.lastReadAt ?? null,
    };
  });
}

private async getUnreadCounts(userId: string): Promise<Map<string, number>> {
  const rows = await this.prisma.$queryRaw<
    Array<{ conversationId: string; count: number }>
  >`
    SELECT cm."conversationId" AS "conversationId", COUNT(m.id)::int AS "count"
    FROM "conversation_members" cm
    LEFT JOIN "messages" m
      ON m."conversationId" = cm."conversationId"
      AND m."deletedAt" IS NULL
      AND m."senderId" <> cm."userId"
      AND (cm."lastReadAt" IS NULL OR m."createdAt" > cm."lastReadAt")
    WHERE cm."userId" = ${userId}
    GROUP BY cm."conversationId"
  `;
  return new Map(rows.map((r) => [r.conversationId, Number(r.count)]));
}
```

In `getMessages`, change the `findMany` to include sender and drop `totalCount` from the return:

```ts
const messages = await this.prisma.message.findMany({
  where,
  take: limit + 1,
  orderBy: { createdAt: 'desc' },
  include: { sender: true },
});

// ...

return {
  edges: items.map((m) => ({
    node: m,
    cursor: m.createdAt.toISOString(),
  })),
  hasNextPage,
};
```

In `sendMessage`, include sender on create:

```ts
const msg = await this.prisma.message.create({
  data: {
    conversationId: input.conversationId,
    senderId,
    body,
  },
  include: { sender: true },
});
```

- [ ] **Step 5: Run tests**

Run: `pnpm --filter @transformlit/api test -- --testPathPattern chat.service`
Expected: PASS (mocks return objects; adjust mock `message.create` to include `sender` if assertions need it — none do).

Run: `pnpm --filter @transformlit/api test:integration -- --testPathPattern chat.integration`
Expected: PASS (new tests included).

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/chat/models/chat.model.ts apps/api/src/chat/chat.service.ts apps/api/test/chat.integration.spec.ts
git commit -m "feat(api): conversation list enrichment and unread aggregates"
```

---

### Task 5: Friend request direction fix + removeFriend authorization

**Files:**
- Modify: `apps/api/src/friends/friends.service.ts`
- Modify: `apps/api/src/friends/friends.resolver.ts`
- Modify: `apps/api/test/friends.integration.spec.ts`

**Interfaces:**
- Produces: `sendRequest(requesterId, addresseeId)` — rejects any non-REJECTED friendship row in EITHER direction; `removeFriend(friendshipId, userId)` — only the friendship's parties can delete.

- [ ] **Step 1: Write failing tests**

Append to `apps/api/test/friends.integration.spec.ts`:

```ts
describe('sendRequest direction handling', () => {
  it('rejects a reverse-direction pending request', async () => {
    await friendsService.sendRequest(requesterId, addresseeId);
    await expect(
      friendsService.sendRequest(addresseeId, requesterId),
    ).rejects.toThrow('Friendship already exists');
  });

  it('allows re-request after rejection', async () => {
    const f = await friendsService.sendRequest(requesterId, addresseeId);
    await friendsService.rejectRequest(f.id, addresseeId);

    const retry = await friendsService.sendRequest(requesterId, addresseeId);
    expect(retry.status).toBe('PENDING');
  });
});

describe('removeFriend authorization', () => {
  it('rejects removal by a non-party', async () => {
    const friendship = await friendsService.sendRequest(requesterId, addresseeId);
    await friendsService.acceptRequest(friendship.id, addresseeId);

    const stranger = await authService.registerLocal({
      email: 'stranger@example.com',
      password: 'password123',
      displayName: 'Stranger',
    });

    await expect(
      friendsService.removeFriend(friendship.id, stranger.user.id),
    ).rejects.toThrow('Not authorized');
  });

  it('allows removal by a party', async () => {
    const friendship = await friendsService.sendRequest(requesterId, addresseeId);
    await friendsService.acceptRequest(friendship.id, addresseeId);

    await expect(
      friendsService.removeFriend(friendship.id, requesterId),
    ).resolves.toBeTruthy();
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `pnpm --filter @transformlit/api test:integration -- --testPathPattern friends.integration`
Expected: FAIL — reverse-direction request currently succeeds; non-party removal currently succeeds.

- [ ] **Step 3: Implement**

In `apps/api/src/friends/friends.service.ts`, replace the duplicate check in `sendRequest`:

```ts
const existing = await this.prisma.friendship.findFirst({
  where: {
    OR: [
      { requesterId, addresseeId },
      { requesterId: addresseeId, addresseeId: requesterId },
    ],
    status: { not: 'REJECTED' },
  },
});
if (existing) throw new Error('Friendship already exists');
```

Replace `removeFriend`:

```ts
async removeFriend(friendshipId: string, userId: string) {
  const friendship = await this.prisma.friendship.findUnique({
    where: { id: friendshipId },
  });
  if (!friendship) throw new Error('Not authorized');
  if (friendship.requesterId !== userId && friendship.addresseeId !== userId) {
    throw new Error('Not authorized');
  }
  return this.prisma.friendship.delete({ where: { id: friendshipId } });
}
```

In `apps/api/src/friends/friends.resolver.ts`, pass the caller:

```ts
@Mutation(() => Boolean, { name: 'removeFriend' })
@UseGuards(JwtAuthGuard)
async removeFriend(
  @CurrentUser() user: { id: string },
  @Args('friendshipId') friendshipId: string,
) {
  return this.friendsService.removeFriend(friendshipId, user.id);
}
```

- [ ] **Step 4: Run tests**

Run: `pnpm --filter @transformlit/api test:integration -- --testPathPattern friends.integration`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/friends/friends.service.ts apps/api/src/friends/friends.resolver.ts apps/api/test/friends.integration.spec.ts
git commit -m "fix(api): direction-agnostic friend requests and removeFriend authorization"
```

---

### Task 6: suggestedFriends query

**Files:**
- Modify: `apps/api/src/friends/friends.service.ts`
- Modify: `apps/api/src/friends/friends.resolver.ts`
- Modify: `apps/api/test/friends.integration.spec.ts`

**Interfaces:**
- Produces: `suggestedFriends(userId, limit = 5): Promise<User[]>` — mutual-friend ranked, exclusions both directions, empty-graph fallback to newest members, clamp 1–20.

- [ ] **Step 1: Write failing tests**

Append to `apps/api/test/friends.integration.spec.ts` (register two extra users in these tests):

```ts
describe('suggestedFriends', () => {
  it('ranks by mutual friends and excludes self, friends, pending', async () => {
    const [alice, bob, carol, dave] = await Promise.all([
      authService.registerLocal({ email: 'alice@example.com', password: 'password123', displayName: 'Alice' }),
      authService.registerLocal({ email: 'bob@example.com', password: 'password123', displayName: 'Bob' }),
      authService.registerLocal({ email: 'carol@example.com', password: 'password123', displayName: 'Carol' }),
      authService.registerLocal({ email: 'dave@example.com', password: 'password123', displayName: 'Dave' }),
    ]);

    // requester -friends-> bob and carol; bob -friends-> dave (1 mutual with dave)
    await friendsService.sendRequest(requesterId, bob.user.id);
    await friendsService.acceptRequest(
      (await friendsService.sendRequest(requesterId, bob.user.id)).id, bob.user.id,
    );
    // carol is pending, not accepted
    await friendsService.sendRequest(requesterId, carol.user.id);
    // bob and dave are friends
    await friendsService.sendRequest(bob.user.id, dave.user.id);
    await friendsService.acceptRequest(
      (await friendsService.sendRequest(bob.user.id, dave.user.id)).id, dave.user.id,
    );

    const suggestions = await friendsService.suggestedFriends(requesterId, 10);
    const ids = suggestions.map((u) => u.id);

    expect(ids).toContain(dave.user.id); // mutual friend
    expect(ids).not.toContain(requesterId);
    expect(ids).not.toContain(bob.user.id); // existing friend
    expect(ids).not.toContain(carol.user.id); // pending request exists
  });

  it('falls back to newest members when no mutual friends exist', async () => {
    const [alice] = [await authService.registerLocal({
      email: 'fresh@example.com', password: 'password123', displayName: 'Fresh',
    })];

    const suggestions = await friendsService.suggestedFriends(requesterId, 5);
    expect(suggestions.some((u) => u.id === alice.user.id)).toBe(true);
  });

  it('clamps limit', async () => {
    const suggestions = await friendsService.suggestedFriends(requesterId, 999);
    expect(suggestions.length).toBeLessThanOrEqual(20);
  });
});
```

Note: the first test's accept flow is awkward (sendRequest called twice). Simplify by creating friendships directly via prisma instead:

```ts
const mkFriend = (a: string, b: string) =>
  prisma.friendship.create({ data: { requesterId: a, addresseeId: b, status: 'ACCEPTED' } });
const mkPending = (a: string, b: string) =>
  prisma.friendship.create({ data: { requesterId: a, addresseeId: b, status: 'PENDING' } });

// requester -friends-> bob; requester has pending to carol; bob -friends-> dave
await mkFriend(requesterId, bob.user.id);
await mkPending(requesterId, carol.user.id);
await mkFriend(bob.user.id, dave.user.id);
```

(Use `prisma` from the spec's `beforeAll` scope — it's already available.)

- [ ] **Step 2: Run to verify failure**

Run: `pnpm --filter @transformlit/api test:integration -- --testPathPattern friends.integration`
Expected: FAIL — method doesn't exist.

- [ ] **Step 3: Implement**

In `apps/api/src/friends/friends.service.ts`:

```ts
async suggestedFriends(userId: string, limit = 5) {
  const clamped = Math.min(Math.max(limit, 1), 20);

  const myRows = await this.prisma.friendship.findMany({
    where: { OR: [{ requesterId: userId }, { addresseeId: userId }] },
  });
  const myFriendIds = new Set<string>();
  const excludedIds = new Set<string>([userId]);
  for (const f of myRows) {
    const other = f.requesterId === userId ? f.addresseeId : f.requesterId;
    if (f.status === 'ACCEPTED') myFriendIds.add(other);
    else excludedIds.add(other); // PENDING, REJECTED, BLOCKED
  }

  const scores = new Map<string, number>();
  if (myFriendIds.size > 0) {
    const rows = await this.prisma.friendship.findMany({
      where: {
        OR: [
          { requesterId: { in: [...myFriendIds] } },
          { addresseeId: { in: [...myFriendIds] } },
        ],
        status: 'ACCEPTED',
      },
    });
    for (const f of rows) {
      const other = myFriendIds.has(f.requesterId) ? f.addresseeId : f.requesterId;
      if (excludedIds.has(other) || myFriendIds.has(other)) continue;
      scores.set(other, (scores.get(other) ?? 0) + 1);
    }
  }

  const ranked = [...scores.entries()].sort((a, b) => b[1] - a[1]).slice(0, clamped);

  if (ranked.length === 0) {
    return this.prisma.user.findMany({
      where: {
        id: { notIn: [...excludedIds, ...myFriendIds] },
        deletedAt: null,
      },
      orderBy: { createdAt: 'desc' },
      take: clamped,
    });
  }

  const users = await this.prisma.user.findMany({
    where: { id: { in: ranked.map(([id]) => id) }, deletedAt: null },
  });
  const byId = new Map(users.map((u) => [u.id, u]));
  return ranked.map(([id]) => byId.get(id)).filter(Boolean) as any;
}
```

In `apps/api/src/friends/friends.resolver.ts`:

```ts
@Query(() => [User], { name: 'suggestedFriends' })
@UseGuards(JwtAuthGuard)
async suggestedFriends(
  @CurrentUser() user: { id: string },
  @Args('limit', { type: () => Int, defaultValue: 5 }) limit: number,
) {
  return this.friendsService.suggestedFriends(user.id, limit);
}
```

Add imports: `Int` from `@nestjs/graphql`, `User` from `../auth/models/auth.model.js`.

- [ ] **Step 4: Run tests**

Run: `pnpm --filter @transformlit/api test:integration -- --testPathPattern friends.integration`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/friends/friends.service.ts apps/api/src/friends/friends.resolver.ts apps/api/test/friends.integration.spec.ts
git commit -m "feat(api): mutual-friend ranked suggested friends"
```

---

### Task 7: mutualFriends on userProfile

**Files:**
- Modify: `apps/api/src/users/users.service.ts`
- Modify: `apps/api/src/users/users.resolver.ts`
- Modify: `apps/api/src/users/models/user-profile.model.ts`
- Modify: `apps/api/test/friends.integration.spec.ts` (or a new users block)

**Interfaces:**
- Produces: `getProfile(userId, currentUserId)` returning `mutualFriends: User[]` (≤ 10, empty for own profile); `userProfile(id)` resolver passes `@CurrentUser()`.

- [ ] **Step 1: Write failing tests**

Append to `apps/api/test/friends.integration.spec.ts`:

```ts
describe('mutualFriends', () => {
  it('lists users who are friends with both parties', async () => {
    const [alice, bridge] = await Promise.all([
      authService.registerLocal({ email: 'alice@example.com', password: 'password123', displayName: 'Alice' }),
      authService.registerLocal({ email: 'bridge@example.com', password: 'password123', displayName: 'Bridge' }),
    ]);
    await prisma.friendship.create({ data: { requesterId: requesterId, addresseeId: bridge.user.id, status: 'ACCEPTED' } });
    await prisma.friendship.create({ data: { requesterId: alice.user.id, addresseeId: bridge.user.id, status: 'ACCEPTED' } });

    const usersService = moduleFixture.get<UsersService>(UsersService);
    const profile = await usersService.getProfile(alice.user.id, requesterId);

    expect(profile.mutualFriends.map((u: any) => u.id)).toContain(bridge.user.id);
    expect(profile.mutualFriends.map((u: any) => u.id)).not.toContain(requesterId);
  });

  it('returns empty for own profile', async () => {
    const usersService = moduleFixture.get<UsersService>(UsersService);
    const profile = await usersService.getProfile(requesterId, requesterId);
    expect(profile.mutualFriends).toEqual([]);
  });
});
```

Add imports at the top of the spec: `UsersService` from `../src/users/users.service` and `moduleFixture` needs to be hoisted to a `let` (it already is in `beforeAll` — add `let moduleFixture: TestingModule;` and assign in `beforeAll`).

- [ ] **Step 2: Run to verify failure**

Run: `pnpm --filter @transformlit/api test:integration -- --testPathPattern friends.integration`
Expected: FAIL — `mutualFriends` missing.

- [ ] **Step 3: Implement**

In `apps/api/src/users/models/user-profile.model.ts`, add:

```ts
@Field(() => [User])
mutualFriends: User[];
```

In `apps/api/src/users/users.service.ts`, extend `getProfile` — change signature to `getProfile(userId: string, currentUserId: string)` and add before the `return`:

```ts
let mutualFriends: any[] = [];
if (currentUserId !== userId) {
  const [myRows, theirRows] = await Promise.all([
    this.prisma.friendship.findMany({
      where: { OR: [{ requesterId: currentUserId }, { addresseeId: currentUserId }], status: 'ACCEPTED' },
      select: { requesterId: true, addresseeId: true },
    }),
    this.prisma.friendship.findMany({
      where: { OR: [{ requesterId: userId }, { addresseeId: userId }], status: 'ACCEPTED' },
      select: { requesterId: true, addresseeId: true },
    }),
  ]);
  const myIds = new Set(
    myRows.map((f) => (f.requesterId === currentUserId ? f.addresseeId : f.requesterId)),
  );
  const theirIds = new Set(
    theirRows.map((f) => (f.requesterId === userId ? f.addresseeId : f.requesterId)),
  );
  const mutual = [...theirIds].filter((id) => id !== userId && myIds.has(id)).slice(0, 10);
  if (mutual.length > 0) {
    mutualFriends = await this.prisma.user.findMany({
      where: { id: { in: mutual }, deletedAt: null },
    });
  }
}
```

Add `mutualFriends` to the returned object.

In `apps/api/src/users/users.resolver.ts`, pass the caller:

```ts
@Query(() => UserProfile, { name: 'userProfile' })
@UseGuards(JwtAuthGuard)
async userProfile(
  @CurrentUser() user: { id: string },
  @Args('id') id: string,
) {
  return this.usersService.getProfile(id, user.id);
}
```

- [ ] **Step 4: Run tests**

Run: `pnpm --filter @transformlit/api test:integration -- --testPathPattern "friends.integration|users"`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/users/users.service.ts apps/api/src/users/users.resolver.ts apps/api/src/users/models/user-profile.model.ts apps/api/test/friends.integration.spec.ts
git commit -m "feat(api): mutual friends on user profiles"
```

---

### Task 8: GraphQL-boundary authorization suite

**Files:**
- Create: `apps/api/test/chat-graphql.integration.spec.ts`

**Interfaces:**
- Consumes: everything from Tasks 1–4. Uses `supertest` (devDep present) against `app.getHttpServer()` with JWT from `AuthService`.

- [ ] **Step 1: Write the failing suite**

Create `apps/api/test/chat-graphql.integration.spec.ts`, copying the container/migration/bootstrap scaffolding from `apps/api/test/chat.integration.spec.ts` (same `isDockerAvailable`, `runMigrations`, env vars, `beforeAll`/`afterAll`), then:

```ts
import request from 'supertest';
// ...existing imports (AppModule, PrismaService, AuthService, ChatService, containers, fs, path, execSync, Pool)

describe('Chat GraphQL boundary', () => {
  // ...app/prisma/authService/chatService/container/pool setup identical to chat.integration.spec.ts
  let user1Token: string;
  let user1Id: string;
  let user2Id: string;
  let user3Id: string;

  beforeEach(async () => {
    await prisma.friendship.deleteMany();
    await prisma.message.deleteMany();
    await prisma.conversationMember.deleteMany();
    await prisma.conversation.deleteMany();
    await prisma.refreshToken.deleteMany();
    await prisma.identity.deleteMany();
    await prisma.user.deleteMany();

    const u1 = await authService.registerLocal({ email: 'u1@example.com', password: 'password123', displayName: 'U1' });
    const u2 = await authService.registerLocal({ email: 'u2@example.com', password: 'password123', displayName: 'U2' });
    const u3 = await authService.registerLocal({ email: 'u3@example.com', password: 'password123', displayName: 'U3' });
    user1Token = u1.accessToken;
    user1Id = u1.user.id;
    user2Id = u2.user.id;
    user3Id = u3.user.id;

    await prisma.friendship.create({ data: { requesterId: user1Id, addresseeId: user2Id, status: 'ACCEPTED' } });
  });

  const gql = (query: string, variables: Record<string, unknown> = {}, token = user1Token) =>
    request(app.getHttpServer())
      .post('/graphql')
      .set('Authorization', `Bearer ${token}`)
      .send({ query, variables });

  it('rejects a non-member reading a conversation', async () => {
    const conv = await chatService.getOrCreateDirectConversation(user1Id, user2Id);
    const res = await gql(
      `query M($conversationId: String!) { messages(conversationId: $conversationId, limit: 10) { edges { node { id } } hasNextPage } }`,
      { conversationId: conv.id },
      user3Token(),
    );
    expect(res.status).toBe(200);
    expect(res.body.errors).toBeDefined();
  });

  it('rejects a non-member sending a message', async () => {
    const conv = await chatService.getOrCreateDirectConversation(user1Id, user2Id);
    const res = await gql(
      `mutation S($input: SendMessageInput!) { sendMessage(input: $input) { id } }`,
      { input: { conversationId: conv.id, body: 'hello' } },
      user3Token(),
    );
    expect(res.status).toBe(200);
    expect(res.body.errors).toBeDefined();
  });

  it('rejects a non-friend starting a DM', async () => {
    const res = await gql(
      `mutation D($otherUserId: String!) { startDirectConversation(otherUserId: $otherUserId) { id } }`,
      { otherUserId: user3Id },
    );
    expect(res.status).toBe(200);
    expect(res.body.errors).toBeDefined();
    expect(res.body.errors[0].message).toContain('friends');
  });

  it('rejects self-chat', async () => {
    const res = await gql(
      `mutation D($otherUserId: String!) { startDirectConversation(otherUserId: $otherUserId) { id } }`,
      { otherUserId: user1Id },
    );
    expect(res.status).toBe(200);
    expect(res.body.errors).toBeDefined();
    expect(res.body.errors[0].message).toContain('yourself');
  });

  it('rejects over-long message bodies', async () => {
    const conv = await chatService.getOrCreateDirectConversation(user1Id, user2Id);
    const res = await gql(
      `mutation S($input: SendMessageInput!) { sendMessage(input: $input) { id } }`,
      { input: { conversationId: conv.id, body: 'x'.repeat(2001) } },
    );
    expect(res.body.errors).toBeDefined();
    expect(res.body.errors[0].message).toContain('too long');
  });

  it('allows a friend to start a DM', async () => {
    const res = await gql(
      `mutation D($otherUserId: String!) { startDirectConversation(otherUserId: $otherUserId) { id } }`,
      { otherUserId: user2Id },
    );
    expect(res.body.errors).toBeUndefined();
    expect(res.body.data.startDirectConversation.id).toBeTruthy();
  });
});
```

Where `user3Token()` is defined in the spec as a helper that registers u3 again or stores `u3.accessToken` from `beforeEach` (add `let user3Token: string;` and assign in `beforeEach`).

Note: verify arg types against the generated `schema.gql` after Task 4 (arg scalars are `String!` for `conversationId`/`otherUserId`, `SendMessageInput!` for input). If `conversationId` is `ID!` instead, adjust the query types accordingly — the schema file is regenerated on API start; check `apps/api/src/schema.gql` for the exact arg types before running.

- [ ] **Step 2: Run to verify**

Run: `pnpm --filter @transformlit/api test:integration -- --testPathPattern chat-graphql`
Expected: PASS (all five rejection cases + the happy path).

- [ ] **Step 3: Commit**

```bash
git add apps/api/test/chat-graphql.integration.spec.ts
git commit -m "test(api): GraphQL-boundary chat authorization suite"
```

---

### Task 9: Extract relativeTime to lib

**Files:**
- Create: `apps/web/src/lib/time.ts`
- Modify: `apps/web/src/app/(app)/notifications/notifications-client.tsx:60-74`
- Modify: `apps/web/src/components/notifications/notification-panel.tsx:75-89`
- Create: `apps/web/src/lib/time.spec.ts`

**Interfaces:**
- Produces: `relativeTime(dateString: string): string` exported from `apps/web/src/lib/time.ts` — identical behavior to the current copy in notifications-client.

- [ ] **Step 1: Write the failing spec**

Create `apps/web/src/lib/time.spec.ts`:

```ts
import { relativeTime } from './time';

describe('relativeTime', () => {
  const now = Date.now();
  const at = (msAgo: number) => new Date(now - msAgo).toISOString();

  it('returns Just now under a minute', () => {
    expect(relativeTime(at(30_000))).toBe('Just now');
  });
  it('returns minutes', () => {
    expect(relativeTime(at(5 * 60_000))).toBe('5m ago');
  });
  it('returns hours', () => {
    expect(relativeTime(at(3 * 3_600_000))).toBe('3h ago');
  });
  it('returns Yesterday for ~1 day', () => {
    expect(relativeTime(at(26 * 3_600_000))).toBe('Yesterday');
  });
  it('returns days under a week', () => {
    expect(relativeTime(at(3 * 86_400_000))).toBe('3d ago');
  });
  it('returns a locale date for older', () => {
    expect(relativeTime(at(30 * 86_400_000))).toBe(new Date(at(30 * 86_400_000)).toLocaleDateString());
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `pnpm --filter @transformlit/web test -- --testPathPattern lib/time`
Expected: FAIL — module missing.

- [ ] **Step 3: Create the util + refactor both consumers**

Create `apps/web/src/lib/time.ts` with the exact function body copied from `notifications-client.tsx:60-74`.

In `notifications-client.tsx`: delete the local `relativeTime` definition and add `import { relativeTime } from '../../../lib/time';`.

In `notification-panel.tsx`: delete the local `relativeTime` definition (lines ~75–89) and add `import { relativeTime } from '../../lib/time';`.

- [ ] **Step 4: Run tests**

Run: `pnpm --filter @transformlit/web test -- --testPathPattern "lib/time|notifications|notification-panel"`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/lib/time.ts apps/web/src/lib/time.spec.ts apps/web/src/app/\(app\)/notifications/notifications-client.tsx apps/web/src/components/notifications/notification-panel.tsx
git commit -m "refactor(web): extract shared relativeTime util"
```

---

### Task 10: Apollo cleanup + chat GraphQL client module

**Files:**
- Modify: `apps/web/src/lib/apollo-client.ts:266-279` (delete `messages` typePolicy)
- Create: `apps/web/src/lib/chat-queries.ts`

**Interfaces:**
- Produces: `ChatMessage`, `ChatConversation`, `ChatConversationGroup` types; `fetchConversations(): Promise<ChatConversation[]>`, `fetchMessages(conversationId, cursor?, limit?): Promise<{ messages, hasMore, cursor? }>`, `sendChatMessage(conversationId, body): Promise<ChatMessage>`, `markConversationRead(conversationId): Promise<void>`, `startDirectConversation(otherUserId): Promise<string>`; `MESSAGE_ADDED` subscription document.

- [ ] **Step 1: Delete the inert typePolicy**

In `apps/web/src/lib/apollo-client.ts`, replace:

```ts
cache: new InMemoryCache({
  typePolicies: {
    Query: {
      fields: {
        messages: {
          keyArgs: ['conversationId'],
          merge(existing, incoming) {
            return incoming;
          },
        },
      },
    },
  },
}),
```

with:

```ts
cache: new InMemoryCache(),
```

- [ ] **Step 2: Create the client module**

Create `apps/web/src/lib/chat-queries.ts`:

```ts
import { gql } from '@apollo/client';
import { apolloClient } from './apollo-client';

export interface ChatMessage {
  id: string;
  conversationId: string;
  senderId: string;
  body: string;
  createdAt: string;
}

export interface ChatConversationGroup {
  id: string;
  name: string;
  slug: string;
  coverImageUrl?: string | null;
}

export interface ChatConversation {
  id: string;
  type: 'DIRECT' | 'GROUP';
  updatedAt: string;
  otherUser?: { id: string; displayName: string; avatarUrl?: string | null } | null;
  group?: ChatConversationGroup | null;
  lastMessage?: Pick<ChatMessage, 'id' | 'body' | 'senderId' | 'createdAt'> | null;
  unreadCount: number;
  myLastReadAt?: string | null;
}

export const CONVERSATIONS_QUERY = gql`
  query Conversations {
    conversations {
      id
      type
      updatedAt
      otherUser { id displayName avatarUrl }
      group { id name slug coverImageUrl }
      lastMessage { id body senderId createdAt }
      unreadCount
      myLastReadAt
    }
  }
`;

export const MESSAGES_QUERY = gql`
  query Messages($conversationId: String!, $cursor: String, $limit: Int) {
    messages(conversationId: $conversationId, cursor: $cursor, limit: $limit) {
      edges { node { id conversationId senderId body createdAt } cursor }
      hasNextPage
    }
  }
`;

export const SEND_MESSAGE = gql`
  mutation SendMessage($input: SendMessageInput!) {
    sendMessage(input: $input) {
      id conversationId senderId body createdAt
    }
  }
`;

export const MARK_CONVERSATION_READ = gql`
  mutation MarkConversationRead($conversationId: String!) {
    markConversationRead(conversationId: $conversationId)
  }
`;

export const START_DIRECT_CONVERSATION = gql`
  mutation StartDirectConversation($otherUserId: String!) {
    startDirectConversation(otherUserId: $otherUserId) { id }
  }
`;

export const MESSAGE_ADDED = gql`
  subscription MessageAdded {
    messageAdded {
      id conversationId senderId body createdAt
    }
  }
`;

export async function fetchConversations(): Promise<ChatConversation[]> {
  const { data } = await apolloClient.query<{ conversations: ChatConversation[] }>({
    query: CONVERSATIONS_QUERY,
  });
  return data?.conversations ?? [];
}

export async function fetchMessages(
  conversationId: string,
  cursor?: string,
  limit = 25,
): Promise<{ messages: ChatMessage[]; hasMore: boolean; cursor?: string }> {
  const { data } = await apolloClient.query<{
    messages: { edges: Array<{ node: ChatMessage; cursor: string }>; hasNextPage: boolean };
  }>({
    query: MESSAGES_QUERY,
    variables: { conversationId, cursor, limit },
  });
  const conn = data?.messages;
  const messages = (conn?.edges ?? []).map((e) => e.node);
  return {
    messages,
    hasMore: conn?.hasNextPage ?? false,
    cursor: conn?.edges.at(-1)?.cursor,
  };
}

export async function sendChatMessage(conversationId: string, body: string): Promise<ChatMessage> {
  const { data } = await apolloClient.mutate<{ sendMessage: ChatMessage }>({
    mutation: SEND_MESSAGE,
    variables: { input: { conversationId, body } },
  });
  if (!data?.sendMessage) throw new Error('sendMessage returned no message');
  return data.sendMessage;
}

export async function markConversationRead(conversationId: string): Promise<void> {
  await apolloClient.mutate({
    mutation: MARK_CONVERSATION_READ,
    variables: { conversationId },
  });
}

export async function startDirectConversation(otherUserId: string): Promise<string> {
  const { data } = await apolloClient.mutate<{ startDirectConversation: { id: string } }>({
    mutation: START_DIRECT_CONVERSATION,
    variables: { otherUserId },
  });
  if (!data?.startDirectConversation) throw new Error('startDirectConversation returned no conversation');
  return data.startDirectConversation.id;
}
```

- [ ] **Step 3: Verify build**

Run: `pnpm --filter @transformlit/web build` (typecheck)
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/lib/apollo-client.ts apps/web/src/lib/chat-queries.ts
git commit -m "feat(web): chat GraphQL client module; drop inert messages cache policy"
```

---

### Task 11: Chat Zustand store

**Files:**
- Create: `apps/web/src/store/chat-store.ts`
- Create: `apps/web/src/store/chat-store.spec.ts`

**Interfaces:**
- Produces: `useChatStore` with `conversations: ChatConversation[]`, `totalUnread: number`, `viewingConversationId: string | null`, `messagesByConversation: Record<string, ChatMessage[]>`, `hasMoreByConversation`, `cursorByConversation`, and actions `setConversations`, `upsertConversation`, `setViewingConversationId`, `setMessages`, `prependMessages`, `appendMessage`, `removeMessage`, `clearUnread`, `reset`.

- [ ] **Step 1: Write failing store specs**

Create `apps/web/src/store/chat-store.spec.ts`:

```ts
import { useChatStore } from './chat-store';

const conv = (id: string, unread = 0, updatedAt = '2026-09-02T10:00:00Z') => ({
  id,
  type: 'DIRECT' as const,
  updatedAt,
  otherUser: { id: 'u2', displayName: 'Bob', avatarUrl: null },
  group: null,
  lastMessage: null,
  unreadCount: unread,
  myLastReadAt: null,
});

const msg = (id: string, conversationId: string) => ({
  id,
  conversationId,
  senderId: 'u2',
  body: 'hi',
  createdAt: '2026-09-02T10:00:00Z',
});

beforeEach(() => useChatStore.getState().reset());

describe('chat store', () => {
  it('computes totalUnread on setConversations', () => {
    useChatStore.getState().setConversations([conv('c1', 2), conv('c2', 1)]);
    expect(useChatStore.getState().totalUnread).toBe(3);
  });

  it('sorts conversations by updatedAt desc', () => {
    useChatStore.getState().setConversations([
      conv('old', 0, '2026-09-01T10:00:00Z'),
      conv('new', 0, '2026-09-03T10:00:00Z'),
    ]);
    expect(useChatStore.getState().conversations.map((c) => c.id)).toEqual(['new', 'old']);
  });

  it('appendMessage dedupes by id', () => {
    useChatStore.getState().setConversations([conv('c1')]);
    useChatStore.getState().setMessages('c1', [msg('m1', 'c1')], false);
    useChatStore.getState().appendMessage(msg('m1', 'c1'));
    useChatStore.getState().appendMessage(msg('m2', 'c1'));
    expect(useChatStore.getState().messagesByConversation.c1.map((m) => m.id)).toEqual(['m1', 'm2']);
  });

  it('increments unread for a non-viewed conversation', () => {
    useChatStore.getState().setConversations([conv('c1', 0)]);
    useChatStore.getState().setViewingConversationId('c2');
    useChatStore.getState().appendMessage(msg('m1', 'c1'));
    expect(useChatStore.getState().conversations[0].unreadCount).toBe(1);
    expect(useChatStore.getState().totalUnread).toBe(1);
  });

  it('does not increment unread for the viewed conversation', () => {
    useChatStore.getState().setConversations([conv('c1', 0)]);
    useChatStore.getState().setViewingConversationId('c1');
    useChatStore.getState().appendMessage(msg('m1', 'c1'));
    expect(useChatStore.getState().conversations[0].unreadCount).toBe(0);
  });

  it('clearUnread zeroes one conversation and recomputes total', () => {
    useChatStore.getState().setConversations([conv('c1', 3), conv('c2', 2)]);
    useChatStore.getState().clearUnread('c1');
    expect(useChatStore.getState().conversations[0].unreadCount).toBe(0);
    expect(useChatStore.getState().totalUnread).toBe(2);
  });

  it('prependMessages keeps chronological order and pages', () => {
    useChatStore.getState().setMessages('c1', [msg('m3', 'c1'), msg('m4', 'c1')], false);
    useChatStore.getState().prependMessages('c1', [msg('m1', 'c1'), msg('m2', 'c1')], true, 'cursor-1');
    const ids = useChatStore.getState().messagesByConversation.c1.map((m) => m.id);
    expect(ids).toEqual(['m1', 'm2', 'm3', 'm4']);
    expect(useChatStore.getState().hasMoreByConversation.c1).toBe(true);
    expect(useChatStore.getState().cursorByConversation.c1).toBe('cursor-1');
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `pnpm --filter @transformlit/web test -- --testPathPattern store/chat-store`
Expected: FAIL — module missing.

- [ ] **Step 3: Create the store**

Create `apps/web/src/store/chat-store.ts`:

```ts
import { create } from 'zustand';
import type { ChatConversation, ChatMessage } from '../lib/chat-queries';

interface ChatStore {
  conversations: ChatConversation[];
  totalUnread: number;
  viewingConversationId: string | null;
  messagesByConversation: Record<string, ChatMessage[]>;
  hasMoreByConversation: Record<string, boolean>;
  cursorByConversation: Record<string, string | undefined>;
  setConversations: (conversations: ChatConversation[]) => void;
  upsertConversation: (conversation: ChatConversation) => void;
  setViewingConversationId: (id: string | null) => void;
  setMessages: (conversationId: string, messages: ChatMessage[], hasMore: boolean, cursor?: string) => void;
  prependMessages: (conversationId: string, messages: ChatMessage[], hasMore: boolean, cursor?: string) => void;
  appendMessage: (message: ChatMessage) => void;
  removeMessage: (conversationId: string, messageId: string) => void;
  clearUnread: (conversationId: string) => void;
  reset: () => void;
}

function sumUnread(conversations: ChatConversation[]): number {
  return conversations.reduce((sum, c) => sum + c.unreadCount, 0);
}

function sortByUpdatedAt(conversations: ChatConversation[]): ChatConversation[] {
  return [...conversations].sort(
    (a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime(),
  );
}

export const useChatStore = create<ChatStore>((set) => ({
  conversations: [],
  totalUnread: 0,
  viewingConversationId: null,
  messagesByConversation: {},
  hasMoreByConversation: {},
  cursorByConversation: {},

  setConversations: (conversations) =>
    set((state) => {
      const sorted = sortByUpdatedAt(conversations);
      return { ...state, conversations: sorted, totalUnread: sumUnread(sorted) };
    }),

  upsertConversation: (conversation) =>
    set((state) => {
      const exists = state.conversations.some((c) => c.id === conversation.id);
      const conversations = exists
        ? state.conversations.map((c) => (c.id === conversation.id ? conversation : c))
        : [...state.conversations, conversation];
      const sorted = sortByUpdatedAt(conversations);
      return { ...state, conversations: sorted, totalUnread: sumUnread(sorted) };
    }),

  setViewingConversationId: (id) => set({ viewingConversationId: id }),

  setMessages: (conversationId, messages, hasMore, cursor) =>
    set((state) => ({
      ...state,
      messagesByConversation: { ...state.messagesByConversation, [conversationId]: messages },
      hasMoreByConversation: { ...state.hasMoreByConversation, [conversationId]: hasMore },
      cursorByConversation: { ...state.cursorByConversation, [conversationId]: cursor },
    })),

  prependMessages: (conversationId, messages, hasMore, cursor) =>
    set((state) => {
      const existing = state.messagesByConversation[conversationId] ?? [];
      const ids = new Set(existing.map((m) => m.id));
      const merged = [...messages.filter((m) => !ids.has(m.id)), ...existing];
      return {
        ...state,
        messagesByConversation: { ...state.messagesByConversation, [conversationId]: merged },
        hasMoreByConversation: { ...state.hasMoreByConversation, [conversationId]: hasMore },
        cursorByConversation: { ...state.cursorByConversation, [conversationId]: cursor },
      };
    }),

  appendMessage: (message) =>
    set((state) => {
      const list = state.messagesByConversation[message.conversationId] ?? [];
      if (list.some((m) => m.id === message.id)) return state;

      const messagesByConversation = {
        ...state.messagesByConversation,
        [message.conversationId]: [...list, message],
      };

      const conversation = state.conversations.find((c) => c.id === message.conversationId);
      if (!conversation) return { ...state, messagesByConversation };

      const viewing = state.viewingConversationId === message.conversationId;
      const updated: ChatConversation = {
        ...conversation,
        updatedAt: message.createdAt,
        lastMessage: { id: message.id, body: message.body, senderId: message.senderId, createdAt: message.createdAt },
        unreadCount: viewing ? conversation.unreadCount : conversation.unreadCount + 1,
      };
      const conversations = sortByUpdatedAt(
        state.conversations.map((c) => (c.id === updated.id ? updated : c)),
      );
      return {
        ...state,
        messagesByConversation,
        conversations,
        totalUnread: sumUnread(conversations),
      };
    }),

  removeMessage: (conversationId, messageId) =>
    set((state) => ({
      ...state,
      messagesByConversation: {
        ...state.messagesByConversation,
        [conversationId]: (state.messagesByConversation[conversationId] ?? []).filter(
          (m) => m.id !== messageId,
        ),
      },
    })),

  clearUnread: (conversationId) =>
    set((state) => {
      const conversations = state.conversations.map((c) =>
        c.id === conversationId ? { ...c, unreadCount: 0 } : c,
      );
      return { ...state, conversations, totalUnread: sumUnread(conversations) };
    }),

  reset: () =>
    set({
      conversations: [],
      totalUnread: 0,
      viewingConversationId: null,
      messagesByConversation: {},
      hasMoreByConversation: {},
      cursorByConversation: {},
    }),
}));
```

- [ ] **Step 4: Run tests**

Run: `pnpm --filter @transformlit/web test -- --testPathPattern store/chat-store`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/store/chat-store.ts apps/web/src/store/chat-store.spec.ts
git commit -m "feat(web): chat store with unread tracking"
```

---

### Task 12: ChatProvider realtime subscription

**Files:**
- Create: `apps/web/src/components/chat/chat-provider.tsx`
- Modify: `apps/web/src/components/layout/app-shell.tsx`
- Create: `apps/web/src/components/chat/chat-provider.spec.tsx`

**Interfaces:**
- Consumes: `MESSAGE_ADDED`, `fetchConversations` (Task 10), `useChatStore` (Task 11), `useAuthStore`.
- Produces: `<ChatProvider />` (renders null) — subscribes once per auth session; unknown-conversation messages trigger a conversations refetch.

- [ ] **Step 1: Write failing component spec**

Create `apps/web/src/components/chat/chat-provider.spec.tsx`:

```tsx
import { render } from '@testing-library/react';
import { ChatProvider } from './chat-provider';
import { useChatStore } from '../../store/chat-store';
import { useAuthStore } from '../../store';
import * as chatQueries from '../../lib/chat-queries';

jest.mock('../../lib/chat-queries', () => ({
  MESSAGE_ADDED: { kind: 'Document' },
  fetchConversations: jest.fn(),
}));

describe('ChatProvider', () => {
  const subscribeMock = jest.fn();
  let unsub: () => void;

  beforeEach(() => {
    useChatStore.getState().reset();
    useAuthStore.setState({ user: { id: 'u1' } as any, token: 't', isHydrated: true });
    unsub = jest.fn();
    subscribeMock.mockReturnValue({
      subscribe: jest.fn(({ next }) => {
        next({ data: { messageAdded: { id: 'm1', conversationId: 'c1', senderId: 'u2', body: 'hi', createdAt: '2026-09-02T10:00:00Z' } } } });
        return { unsubscribe: unsub };
      }),
    });
    jest.spyOn(require('../../lib/apollo-client'), 'apolloClient').mockImplementation(
      () => ({ subscribe: subscribeMock }),
    );
  });

  afterEach(() => jest.restoreAllMocks());

  it('subscribes once per user and appends known-conversation messages', () => {
    useChatStore.getState().setConversations([
      { id: 'c1', type: 'DIRECT', updatedAt: '2026-09-02T10:00:00Z', otherUser: { id: 'u2', displayName: 'Bob', avatarUrl: null }, group: null, lastMessage: null, unreadCount: 0, myLastReadAt: null },
    ]);
    render(<ChatProvider />);
    expect(subscribeMock).toHaveBeenCalledTimes(1);
    expect(useChatStore.getState().messagesByConversation.c1).toHaveLength(1);
    expect(useChatStore.getState().conversations[0].unreadCount).toBe(1);
  });

  it('refetches conversations for unknown conversations', async () => {
    (chatQueries.fetchConversations as jest.Mock).mockResolvedValue([]);
    render(<ChatProvider />);
    await Promise.resolve();
    expect(chatQueries.fetchConversations).toHaveBeenCalled();
  });

  it('unsubscribes on unmount', () => {
    const { unmount } = render(<ChatProvider />);
    unmount();
    expect(unsub).toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `pnpm --filter @transformlit/web test -- --testPathPattern chat-provider`
Expected: FAIL — module missing.

- [ ] **Step 3: Create the provider**

Create `apps/web/src/components/chat/chat-provider.tsx`:

```tsx
'use client';

import { useEffect } from 'react';
import { apolloClient } from '../../lib/apollo-client';
import { MESSAGE_ADDED, fetchConversations } from '../../lib/chat-queries';
import { useAuthStore } from '../../store';
import { useChatStore } from '../../store/chat-store';

export function ChatProvider() {
  const userId = useAuthStore((s) => s.user?.id);

  useEffect(() => {
    if (!userId) return;

    let active = true;

    const refreshConversations = () => {
      fetchConversations()
        .then((conversations) => {
          if (active) useChatStore.getState().setConversations(conversations);
        })
        .catch(() => {
          // ignore — next mount/event retries
        });
    };

    const subscription = apolloClient.subscribe({ query: MESSAGE_ADDED }).subscribe({
      next: ({ data }) => {
        if (!active || !data?.messageAdded) return;
        const message = data.messageAdded as {
          id: string;
          conversationId: string;
          senderId: string;
          body: string;
          createdAt: string;
        };
        const state = useChatStore.getState();
        const known = state.conversations.some((c) => c.id === message.conversationId);
        if (known) {
          state.appendMessage(message);
        } else {
          // New conversation (e.g. started by the other side) — refresh the list.
          refreshConversations();
        }
      },
    });

    return () => {
      active = false;
      subscription.unsubscribe();
    };
  }, [userId]);

  return null;
}
```

- [ ] **Step 4: Mount in AppShell**

In `apps/web/src/components/layout/app-shell.tsx`, import `ChatProvider` and render it inside `ProfileSheetProvider`:

```tsx
<ProfileSheetProvider>
  <ChatProvider />
  <div className="min-h-dvh bg-surface dark:bg-surface-dark paper-texture">
  ...
```

- [ ] **Step 5: Run tests + build**

Run: `pnpm --filter @transformlit/web test -- --testPathPattern chat-provider`
Expected: PASS (adjust the apollo-client mock as needed — if `apolloClient` is a plain object export, use `jest.spyOn(chatQueriesModule, ...)` style; simplest is mocking `../../lib/apollo-client` with `jest.mock` and a `subscribe` returning the fake observable).

Run: `pnpm --filter @transformlit/web build`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/components/chat/chat-provider.tsx apps/web/src/components/chat/chat-provider.spec.tsx apps/web/src/components/layout/app-shell.tsx
git commit -m "feat(web): realtime chat provider in app shell"
```

---

### Task 13: NavItem badge + navigation updates

**Files:**
- Modify: `apps/web/src/components/ui/nav-item.tsx`
- Modify: `apps/web/src/components/layout/sidebar.tsx`
- Modify: `apps/web/src/components/layout/bottom-nav.tsx`
- Modify: `apps/web/src/lib/constants.ts:79-85`
- Modify: `apps/web/src/components/ui/nav-item.spec.tsx`
- Modify: `apps/web/src/components/layout/sidebar.spec.tsx` and `bottom-nav.spec.tsx` (add badge assertions)

**Interfaces:**
- Produces: `NavItem` prop `badge?: number` (renders count pill, "9+" cap); `SIDEBAR_NAV_ITEMS` gains `{ label: 'Chat', href: '/chat', icon: 'chat_bubble' }`; Sidebar/BottomNav pass `totalUnread` for the `/chat` item.

- [ ] **Step 1: Write failing spec additions**

In `apps/web/src/components/ui/nav-item.spec.tsx`, add:

```tsx
it('renders a badge when provided', () => {
  render(<NavItem label="Chat" href="/chat" icon="chat_bubble" badge={3} />);
  expect(screen.getByText('3')).toBeInTheDocument();
});

it('caps the badge at 9+', () => {
  render(<NavItem label="Chat" href="/chat" icon="chat_bubble" badge={12} />);
  expect(screen.getByText('9+')).toBeInTheDocument();
});

it('renders no badge when zero', () => {
  render(<NavItem label="Chat" href="/chat" icon="chat_bubble" badge={0} />);
  expect(screen.queryByText('0')).not.toBeInTheDocument();
});
```

- [ ] **Step 2: Run to verify failure**

Run: `pnpm --filter @transformlit/web test -- --testPathPattern nav-item`
Expected: FAIL — no badge prop.

- [ ] **Step 3: Add badge to NavItem**

In `apps/web/src/components/ui/nav-item.tsx`:

```tsx
type NavItemProps = {
  label: string;
  href: string;
  icon: string;
  active?: boolean;
  variant?: 'sidebar' | 'bottom';
  badge?: number;
  className?: string;
};

export function NavItem({ label, href, icon, active = false, variant = 'sidebar', badge, className = '' }: NavItemProps) {
```

Add `relative` to the Link className (`${baseClass} relative ...`) and before the closing `</Link>`:

```tsx
{badge !== undefined && badge > 0 && (
  <span
    className={`absolute flex items-center justify-center rounded-full bg-brand-orange-dark text-white font-bold ${
      isSidebar
        ? 'right-3 top-1/2 -translate-y-1/2 h-5 min-w-5 px-1 text-[10px]'
        : 'top-0.5 right-3 h-4 min-w-4 px-1 text-[9px]'
    }`}
  >
    {badge > 9 ? '9+' : badge}
  </span>
)}
```

- [ ] **Step 4: Add Chat to nav constants**

In `apps/web/src/lib/constants.ts`:

```ts
export const SIDEBAR_NAV_ITEMS = [
  { label: 'Feed', href: '/feed', icon: 'dynamic_feed' },
  { label: 'Bible', href: '/bible', icon: 'auto_stories' },
  { label: 'Friends', href: '/friends', icon: 'group' },
  { label: 'Chat', href: '/chat', icon: 'chat_bubble' },
  { label: 'Groups', href: '/groups', icon: 'diversity_3' },
  { label: 'Books', href: '/books', icon: 'menu_book' },
] as const;
```

- [ ] **Step 5: Wire badges into nav components**

`sidebar.tsx` — add `const totalUnread = useChatStore((s) => s.totalUnread);` (import from `../../store/chat-store`) and pass to the Chat item:

```tsx
{SIDEBAR_NAV_ITEMS.map((item) => (
  <NavItem
    key={item.href}
    {...item}
    active={pathname.startsWith(item.href)}
    variant="sidebar"
    badge={item.href === '/chat' ? totalUnread : undefined}
  />
))}
```

`bottom-nav.tsx` — same pattern with `useChatStore` and `variant="bottom"`.

Update `sidebar.spec.tsx`/`bottom-nav.spec.tsx`: assert the Chat item renders and shows the badge after `useChatStore.setState({ totalUnread: 2 })`.

- [ ] **Step 6: Run tests**

Run: `pnpm --filter @transformlit/web test -- --testPathPattern "nav-item|sidebar|bottom-nav"`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add apps/web/src/components/ui/nav-item.tsx apps/web/src/components/ui/nav-item.spec.tsx apps/web/src/components/layout/sidebar.tsx apps/web/src/components/layout/sidebar.spec.tsx apps/web/src/components/layout/bottom-nav.tsx apps/web/src/components/layout/bottom-nav.spec.tsx apps/web/src/lib/constants.ts
git commit -m "feat(web): Chat nav item with live unread badge"
```

---

### Task 14: Conversation list + /chat routes

**Files:**
- Create: `apps/web/src/components/chat/conversation-list.tsx`
- Create: `apps/web/src/app/(app)/chat/layout.tsx`
- Modify: `apps/web/src/app/(app)/chat/page.tsx` (and its `chat-client.tsx` — replaced by inline composition)
- Create: `apps/web/src/components/chat/conversation-list.spec.tsx`

**Interfaces:**
- Consumes: `fetchConversations`, `useChatStore`, `relativeTime`, `UserAvatar`, `LoadingSpinner`.
- Produces: `<ConversationList />` (self-fetching, store-backed row list); `chat/layout.tsx` desktop two-pane (aside list + children thread); `/chat` page = mobile list + desktop empty state.

- [ ] **Step 1: Write failing spec**

Create `apps/web/src/components/chat/conversation-list.spec.tsx`:

```tsx
import { render, screen } from '@testing-library/react';
import { ConversationList } from './conversation-list';
import { useChatStore } from '../../store/chat-store';
import { useAuthStore } from '../../store';
import * as chatQueries from '../../lib/chat-queries';

jest.mock('../../lib/chat-queries', () => ({
  fetchConversations: jest.fn(),
}));

jest.mock('next/navigation', () => ({
  usePathname: () => '/chat',
}));

const conv = (id: string, unread = 0, name = 'Bob') => ({
  id,
  type: 'DIRECT' as const,
  updatedAt: '2026-09-02T10:00:00Z',
  otherUser: { id: 'u2', displayName: name, avatarUrl: null },
  group: null,
  lastMessage: { id: 'm1', body: 'Hello there', senderId: 'u2', createdAt: '2026-09-02T09:00:00Z' },
  unreadCount: unread,
  myLastReadAt: null,
});

beforeEach(() => {
  useChatStore.getState().reset();
  useAuthStore.setState({ user: { id: 'u1' } as any, token: 't', isHydrated: true });
});

it('renders conversations with names, previews and unread chips', async () => {
  (chatQueries.fetchConversations as jest.Mock).mockResolvedValue([conv('c1', 3), conv('c2', 0, 'Alice')]);
  render(<ConversationList />);
  expect(await screen.findByText('Bob')).toBeInTheDocument();
  expect(screen.getByText('Alice')).toBeInTheDocument();
  expect(screen.getByText('Hello there')).toBeInTheDocument();
  expect(screen.getByText('3')).toBeInTheDocument();
});

it('renders the empty state', async () => {
  (chatQueries.fetchConversations as jest.Mock).mockResolvedValue([]);
  render(<ConversationList />);
  expect(await screen.findByText(/No conversations yet/i)).toBeInTheDocument();
});

it('renders group conversations with group name', async () => {
  (chatQueries.fetchConversations as jest.Mock).mockResolvedValue([
    { ...conv('g1'), type: 'GROUP' as const, otherUser: null, group: { id: 'g1', name: 'Book Club', slug: 'book-club', coverImageUrl: null } },
  ]);
  render(<ConversationList />);
  expect(await screen.findByText('Book Club')).toBeInTheDocument();
});
```

- [ ] **Step 2: Run to verify failure**

Run: `pnpm --filter @transformlit/web test -- --testPathPattern conversation-list`
Expected: FAIL — module missing.

- [ ] **Step 3: Create ConversationList**

Create `apps/web/src/components/chat/conversation-list.tsx`:

```tsx
'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useChatStore } from '../../store/chat-store';
import { fetchConversations, ChatConversation } from '../../lib/chat-queries';
import { useRequireAuth } from '../../lib/hooks/use-require-auth';
import { UserAvatar, LoadingSpinner } from '../ui';
import { relativeTime } from '../../lib/time';

export function ConversationList() {
  const { isReady } = useRequireAuth();
  const pathname = usePathname();
  const conversations = useChatStore((s) => s.conversations);
  const setConversations = useChatStore((s) => s.setConversations);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!isReady) return;
    fetchConversations()
      .then(setConversations)
      .catch(() => {
        // toast-free: list page shows empty state; provider refetch recovers
      })
      .finally(() => setLoading(false));
  }, [isReady, setConversations]);

  const title = (c: ChatConversation) =>
    c.type === 'GROUP' ? c.group?.name ?? 'Group' : c.otherUser?.displayName ?? 'User';

  if (!isReady || loading) {
    return (
      <div className="space-y-3">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="h-16 bg-surface-container-high rounded-xl animate-pulse" />
        ))}
      </div>
    );
  }

  if (conversations.length === 0) {
    return (
      <div className="py-16 flex flex-col items-center text-center">
        <span className="material-symbols-outlined text-[64px] text-primary opacity-40 mb-4">forum</span>
        <h3 className="font-display font-headline-h3 text-on-surface mb-2">No conversations yet</h3>
        <p className="font-body text-on-surface-variant max-w-xs mb-4">
          Message a friend from their profile to start chatting.
        </p>
        <Link
          href="/friends"
          className="font-display font-headline-h4 px-6 h-11 rounded-md bg-brand-orange-dark text-on-primary flex items-center gap-2 shadow-sm hover:brightness-110 active:scale-95 transition-all"
        >
          <span className="material-symbols-outlined text-[20px]">group</span>
          Find friends
        </Link>
      </div>
    );
  }

  return (
    <ul className="space-y-2" aria-label="Conversations">
      {conversations.map((c) => {
        const active = pathname === `/chat/${c.id}`;
        return (
          <li key={c.id}>
            <Link
              href={`/chat/${c.id}`}
              className={`flex items-center gap-3 p-3 rounded-xl border transition-all ${
                active
                  ? 'bg-primary-container/60 border-primary'
                  : 'bg-surface-container-lowest border-outline-variant hover:border-primary'
              }`}
            >
              {c.type === 'GROUP' ? (
                <div className="w-9 h-9 rounded-full bg-primary-fixed flex items-center justify-center overflow-hidden shrink-0">
                  <span className="material-symbols-outlined text-base text-on-primary-container">diversity_3</span>
                </div>
              ) : (
                <UserAvatar
                  avatarUrl={c.otherUser?.avatarUrl}
                  displayName={c.otherUser?.displayName}
                  size="md"
                />
              )}
              <div className="flex-1 min-w-0">
                <div className="flex items-center justify-between gap-2">
                  <p className="font-display font-headline-h4 text-on-surface truncate">{title(c)}</p>
                  {c.lastMessage && (
                    <span className="font-micro text-[10px] text-on-surface-variant shrink-0">
                      {relativeTime(c.lastMessage.createdAt)}
                    </span>
                  )}
                </div>
                <div className="flex items-center justify-between gap-2">
                  <p className="font-body-mobile text-sm text-on-surface-variant line-clamp-1 flex-1">
                    {c.lastMessage ? c.lastMessage.body : 'Say hello!'}
                  </p>
                  {c.unreadCount > 0 && (
                    <span className="inline-flex items-center justify-center h-5 min-w-5 px-1 rounded-full bg-brand-orange-dark text-white font-bold text-[10px] shrink-0">
                      {c.unreadCount > 9 ? '9+' : c.unreadCount}
                    </span>
                  )}
                </div>
              </div>
            </Link>
          </li>
        );
      })}
    </ul>
  );
}
```

- [ ] **Step 4: Create chat layout + page**

Create `apps/web/src/app/(app)/chat/layout.tsx`:

```tsx
import { ConversationList } from '../../../components/chat/conversation-list';

export default function ChatLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="py-6 md:py-8">
      <div className="md:grid md:grid-cols-[320px_1fr] md:gap-6 md:items-start">
        <aside className="hidden md:block md:sticky md:top-20">
          <ConversationList />
        </aside>
        <section className="md:min-h-[70vh]">{children}</section>
      </div>
    </div>
  );
}
```

Replace `apps/web/src/app/(app)/chat/page.tsx`:

```tsx
import type { Metadata } from 'next';
import { ConversationList } from '../../../components/chat/conversation-list';

export const metadata: Metadata = {
  title: 'Chat — Transformlit',
};

export default function Route() {
  return (
    <>
      <div className="md:hidden">
        <h1 className="font-display font-headline-h1 text-on-surface mb-6">Chat</h1>
        <ConversationList />
      </div>
      <div className="hidden md:flex flex-col items-center justify-center py-24 text-center">
        <span className="material-symbols-outlined text-[80px] text-primary opacity-40 mb-4">chat_bubble</span>
        <h2 className="font-display font-headline-h3 text-on-surface mb-2">Select a conversation</h2>
        <p className="font-body text-on-surface-variant max-w-xs">
          Choose a conversation from the list to start chatting.
        </p>
      </div>
    </>
  );
}
```

Delete `apps/web/src/app/(app)/chat/chat-client.tsx` (replaced; `chat.spec.tsx` is rewritten in Task 15).

- [ ] **Step 5: Run tests + build**

Run: `pnpm --filter @transformlit/web test -- --testPathPattern conversation-list`
Expected: PASS.

Run: `pnpm --filter @transformlit/web build`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/components/chat/conversation-list.tsx apps/web/src/components/chat/conversation-list.spec.tsx apps/web/src/app/\(app\)/chat/layout.tsx apps/web/src/app/\(app\)/chat/page.tsx
git rm apps/web/src/app/\(app\)/chat/chat-client.tsx
git commit -m "feat(web): conversation list and chat routes"
```

---

### Task 15: Chat thread + composer + pagination + New divider

**Files:**
- Create: `apps/web/src/app/(app)/chat/[id]/page.tsx`
- Create: `apps/web/src/components/chat/chat-thread.tsx`
- Create: `apps/web/src/components/chat/chat-thread.spec.tsx`
- Replace: `apps/web/src/app/(app)/chat/chat.spec.tsx` (placeholder assertions removed)

**Interfaces:**
- Consumes: `fetchMessages`, `sendChatMessage`, `markConversationRead`, `useChatStore`, `useAuthStore`, `relativeTime`, `useToast`.
- Produces: `<ChatThread conversationId />` — loads last page, marks read, scroll-up pagination, optimistic send with temp-id reconcile, New divider positioned by `myLastReadAt`/unread, mobile back button.

- [ ] **Step 1: Write failing spec**

Create `apps/web/src/components/chat/chat-thread.spec.tsx`:

```tsx
import { render, screen, fireEvent } from '@testing-library/react';
import { ChatThread } from './chat-thread';
import { useChatStore } from '../../store/chat-store';
import { useAuthStore } from '../../store';
import * as chatQueries from '../../lib/chat-queries';

jest.mock('../../lib/chat-queries', () => ({
  fetchMessages: jest.fn(),
  sendChatMessage: jest.fn(),
  markConversationRead: jest.fn(),
}));

jest.mock('next/navigation', () => ({
  useRouter: () => ({ back: jest.fn() }),
  useParams: () => ({ id: 'c1' }),
}));

const msg = (id: string, senderId: string, body: string, createdAt = '2026-09-02T09:00:00Z') => ({
  id,
  conversationId: 'c1',
  senderId,
  body,
  createdAt,
});

beforeEach(() => {
  useChatStore.getState().reset();
  useAuthStore.setState({ user: { id: 'u1' } as any, token: 't', isHydrated: true });
  useChatStore.getState().setConversations([
    { id: 'c1', type: 'DIRECT', updatedAt: '2026-09-02T10:00:00Z', otherUser: { id: 'u2', displayName: 'Bob', avatarUrl: null }, group: null, lastMessage: null, unreadCount: 0, myLastReadAt: '2026-09-02T08:00:00Z' },
  ]);
});

it('renders messages from the store', async () => {
  (chatQueries.fetchMessages as jest.Mock).mockResolvedValue({
    messages: [msg('m1', 'u1', 'Hello'), msg('m2', 'u2', 'Hi there')],
    hasMore: false,
  });
  render(<ChatThread conversationId="c1" />);
  expect(await screen.findByText('Hello')).toBeInTheDocument();
  expect(screen.getByText('Hi there')).toBeInTheDocument();
  expect(chatQueries.markConversationRead).toHaveBeenCalledWith('c1');
});

it('sends a message on Enter and reconciles the temp message', async () => {
  (chatQueries.fetchMessages as jest.Mock).mockResolvedValue({ messages: [], hasMore: false });
  (chatQueries.sendChatMessage as jest.Mock).mockResolvedValue(msg('m-server', 'u1', 'New message'));

  render(<ChatThread conversationId="c1" />);
  const composer = await screen.findByPlaceholderText('Type a message…');
  fireEvent.change(composer, { target: { value: 'New message' } });
  fireEvent.keyDown(composer, { key: 'Enter', shiftKey: false });

  expect(chatQueries.sendChatMessage).toHaveBeenCalledWith('c1', 'New message');
  // temp removed, server message appended
  const list = useChatStore.getState().messagesByConversation.c1.map((m) => m.id);
  expect(list).toEqual(['m-server']);
});

it('renders the New divider when there are unread messages', async () => {
  useChatStore.getState().setConversations([
    { id: 'c1', type: 'DIRECT', updatedAt: '2026-09-02T10:00:00Z', otherUser: { id: 'u2', displayName: 'Bob', avatarUrl: null }, group: null, lastMessage: null, unreadCount: 2, myLastReadAt: '2026-09-02T08:00:00Z' },
  ]);
  (chatQueries.fetchMessages as jest.Mock).mockResolvedValue({
    messages: [msg('m1', 'u2', 'old', '2026-09-02T07:00:00Z'), msg('m2', 'u2', 'new', '2026-09-02T09:30:00Z')],
    hasMore: false,
  });
  render(<ChatThread conversationId="c1" />);
  expect(await screen.findByText('New')).toBeInTheDocument();
});
```

- [ ] **Step 2: Run to verify failure**

Run: `pnpm --filter @transformlit/web test -- --testPathPattern chat-thread`
Expected: FAIL — module missing.

- [ ] **Step 3: Create the thread component**

Create `apps/web/src/components/chat/chat-thread.tsx`:

```tsx
'use client';

import { useEffect, useRef, useState, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { useChatStore } from '../../store/chat-store';
import { useAuthStore } from '../../store';
import { useRequireAuth } from '../../lib/hooks/use-require-auth';
import {
  fetchMessages,
  sendChatMessage,
  markConversationRead,
  ChatMessage,
} from '../../lib/chat-queries';
import { UserAvatar, useToast, LoadingSpinner } from '../ui';
import { relativeTime } from '../../lib/time';

export function ChatThread({ conversationId }: { conversationId: string }) {
  const { isReady } = useRequireAuth();
  const router = useRouter();
  const { addToast } = useToast();
  const currentUserId = useAuthStore((s) => s.user?.id);
  const messages = useChatStore((s) => s.messagesByConversation[conversationId] ?? []);
  const conversation = useChatStore((s) =>
    s.conversations.find((c) => c.id === conversationId),
  );
  const hasMore = useChatStore((s) => s.hasMoreByConversation[conversationId] ?? false);
  const cursor = useChatStore((s) => s.cursorByConversation[conversationId]);

  const [loadingOlder, setLoadingOlder] = useState(false);
  const [draft, setDraft] = useState('');
  const scrollRef = useRef<HTMLDivElement>(null);
  const atBottomRef = useRef(true);
  const initialLoadRef = useRef(false);

  const scrollToBottom = useCallback(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, []);

  const handleScroll = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    atBottomRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 60;

    if (el.scrollTop < 40 && !loadingOlder && hasMore && cursor) {
      setLoadingOlder(true);
      fetchMessages(conversationId, cursor)
        .then(({ messages: older, hasMore: more, cursor: next }) => {
          useChatStore.getState().prependMessages(conversationId, older, more, next);
        })
        .catch(() => addToast('Failed to load older messages.', 'error'))
        .finally(() => setLoadingOlder(false));
    }
  }, [conversationId, cursor, hasMore, loadingOlder, addToast]);

  useEffect(() => {
    if (!isReady || !conversationId) return;
    useChatStore.getState().setViewingConversationId(conversationId);

    let active = true;
    fetchMessages(conversationId)
      .then(({ messages, hasMore: more, cursor: next }) => {
        if (!active) return;
        useChatStore.getState().setMessages(conversationId, messages, more, next);
        initialLoadRef.current = true;
        requestAnimationFrame(() => {
          const el = scrollRef.current;
          if (el) el.scrollTop = el.scrollHeight;
        });
      })
      .catch(() => addToast('Failed to load messages.', 'error'));

    // Mark read on open (optimistic clear + background mutation)
    useChatStore.getState().clearUnread(conversationId);
    markConversationRead(conversationId).catch(() => {
      // non-fatal; next open retries
    });

    return () => {
      active = false;
      useChatStore.getState().setViewingConversationId(null);
    };
  }, [isReady, conversationId, addToast]);

  // When a message arrives while at the bottom, mark read again.
  useEffect(() => {
    if (!initialLoadRef.current) return;
    if (atBottomRef.current) {
      useChatStore.getState().clearUnread(conversationId);
      markConversationRead(conversationId).catch(() => {});
    }
  }, [messages.length, conversationId]);

  useEffect(() => {
    if (initialLoadRef.current && atBottomRef.current) scrollToBottom();
  }, [messages.length, scrollToBottom]);

  const handleSend = async () => {
    const body = draft.trim();
    if (!body) return;
    setDraft('');

    const tempId = `temp-${crypto.randomUUID()}`;
    const temp: ChatMessage = {
      id: tempId,
      conversationId,
      senderId: currentUserId ?? '',
      body,
      createdAt: new Date().toISOString(),
    };
    useChatStore.getState().appendMessage(temp);

    try {
      const saved = await sendChatMessage(conversationId, body);
      useChatStore.getState().removeMessage(conversationId, tempId);
      useChatStore.getState().appendMessage(saved);
      scrollToBottom();
    } catch {
      useChatStore.getState().removeMessage(conversationId, tempId);
      addToast('Failed to send message.', 'error');
    }
  };

  if (!isReady) return <LoadingSpinner />;

  const otherUser = conversation?.otherUser;
  const title = conversation?.type === 'GROUP' ? conversation.group?.name : otherUser?.displayName;
  const myLastReadAt = conversation?.myLastReadAt
    ? new Date(conversation.myLastReadAt).getTime()
    : null;
  const unreadCount = conversation?.unreadCount ?? 0;
  const newStartIndex =
    unreadCount > 0 && myLastReadAt !== null
      ? messages.findIndex(
          (m) =>
            new Date(m.createdAt).getTime() > myLastReadAt && m.senderId !== currentUserId,
        )
      : -1;

  return (
    <div className="flex flex-col h-[calc(100dvh-13rem)] md:h-[calc(100dvh-11rem)]">
      {/* Header */}
      <div className="flex items-center gap-3 pb-3 border-b border-outline-variant mb-3">
        <button
          onClick={() => router.back()}
          className="md:hidden w-10 h-10 flex items-center justify-center rounded-full hover:bg-surface-container-high transition-colors"
          aria-label="Back"
        >
          <span className="material-symbols-outlined text-on-surface">arrow_back</span>
        </button>
        <UserAvatar
          avatarUrl={otherUser?.avatarUrl}
          displayName={otherUser?.displayName}
          size="md"
        />
        <h1 className="font-display font-headline-h3 text-on-surface truncate">
          {title ?? 'Chat'}
        </h1>
      </div>

      {/* Messages */}
      <div
        ref={scrollRef}
        onScroll={handleScroll}
        className="flex-1 overflow-y-auto pr-2 space-y-3"
      >
        {loadingOlder && (
          <div className="flex justify-center py-2">
            <LoadingSpinner />
          </div>
        )}
        {messages.map((m, i) => {
          const mine = m.senderId === currentUserId;
          return (
            <div key={m.id}>
              {i === newStartIndex && (
                <div className="flex items-center gap-3 my-3" aria-hidden="true">
                  <div className="flex-1 h-px bg-primary/40" />
                  <span className="font-micro text-[10px] uppercase tracking-widest text-primary font-bold">
                    New
                  </span>
                  <div className="flex-1 h-px bg-primary/40" />
                </div>
              )}
              <div className={`flex ${mine ? 'justify-end' : 'justify-start'} gap-2`}>
                {!mine && (
                  <UserAvatar
                    avatarUrl={otherUser?.avatarUrl}
                    displayName={otherUser?.displayName}
                    size="sm"
                  />
                )}
                <div
                  className={`max-w-[75%] px-4 py-2 rounded-2xl shadow-sm ${
                    mine
                      ? 'bg-brand-orange-dark text-on-primary rounded-br-sm'
                      : 'bg-surface-container-high text-on-surface rounded-bl-sm'
                  }`}
                >
                  <p className="font-body text-body whitespace-pre-wrap break-words">{m.body}</p>
                  <p
                    className={`font-micro text-[10px] mt-1 ${
                      mine ? 'text-on-primary/70' : 'text-on-surface-variant'
                    }`}
                  >
                    {relativeTime(m.createdAt)}
                  </p>
                </div>
              </div>
            </div>
          );
        })}
        {messages.length === 0 && (
          <div className="py-16 text-center">
            <p className="font-body text-on-surface-variant">
              No messages yet — say hello!
            </p>
          </div>
        )}
      </div>

      {/* Composer */}
      <div className="pt-3 border-t border-outline-variant mt-3 flex items-end gap-2">
        <textarea
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              void handleSend();
            }
          }}
          placeholder="Type a message…"
          rows={1}
          className="flex-1 resize-none bg-surface-container-lowest border border-outline-variant rounded-xl px-4 py-3 font-body text-body text-on-surface placeholder:text-on-surface-variant focus:outline-none focus:border-primary transition-colors min-h-[48px]"
        />
        <button
          onClick={() => void handleSend()}
          disabled={!draft.trim()}
          className="h-11 w-11 flex items-center justify-center rounded-full bg-brand-orange-dark text-on-primary disabled:opacity-40 hover:brightness-110 active:scale-95 transition-all shrink-0"
          aria-label="Send message"
        >
          <span className="material-symbols-outlined text-[20px]">send</span>
        </button>
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Create the route page**

Create `apps/web/src/app/(app)/chat/[id]/page.tsx`:

```tsx
import type { Metadata } from 'next';
import { ChatThread } from '../../../../components/chat/chat-thread';

export const metadata: Metadata = {
  title: 'Chat — Transformlit',
};

export default function Route({ params }: { params: Promise<{ id: string }> }) {
  return (
    <ChatThread conversationIdPromise={params} />
  );
}
```

Note: Next 16 `params` is a Promise. Resolve it in a client wrapper — instead, make the page resolve it server-side and pass the id:

```tsx
export default async function Route({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <ChatThread conversationId={id} />;
}
```

(Use this async version — `ChatThread` takes `conversationId: string`.)

- [ ] **Step 5: Replace chat.spec.tsx**

Rewrite `apps/web/src/app/(app)/chat/chat.spec.tsx` as a thin smoke spec of the page route (server component) — or delete it, since `conversation-list.spec.tsx` + `chat-thread.spec.tsx` cover the feature. Delete the file and its "coming soon" assertions (they reference deleted code).

- [ ] **Step 6: Run tests + build**

Run: `pnpm --filter @transformlit/web test -- --testPathPattern "chat-thread|conversation-list"`
Expected: PASS.

Run: `pnpm --filter @transformlit/web build`
Expected: PASS (fix any param typing per Next 16 conventions).

- [ ] **Step 7: Commit**

```bash
git add apps/web/src/components/chat/chat-thread.tsx apps/web/src/components/chat/chat-thread.spec.tsx apps/web/src/app/\(app\)/chat/\[id\]/page.tsx
git rm apps/web/src/app/\(app\)/chat/chat.spec.tsx
git commit -m "feat(web): realtime chat thread with composer and pagination"
```

---

### Task 16: Message buttons on profile + sheet

**Files:**
- Modify: `apps/web/src/app/(app)/users/[id]/user-profile-client.tsx` (Message button visibility + wiring, lines ~232-243)
- Modify: `apps/web/src/components/friends/user-profile-sheet.tsx` (add Message button for ACCEPTED friends)

**Interfaces:**
- Consumes: `startDirectConversation` (Task 10), `useRouter`.
- Produces: Message button only for ACCEPTED friendships; tap → `startDirectConversation(otherUserId)` → `router.push(/chat/${id})`; loading state while mutating.

- [ ] **Step 1: Wire the profile page Message button**

In `apps/web/src/app/(app)/users/[id]/user-profile-client.tsx`:

Add near the other mutations:

```ts
const START_DM = gql`
  mutation StartDirectConversation($otherUserId: String!) {
    startDirectConversation(otherUserId: $otherUserId) { id }
  }
`;
```

Add a handler:

```ts
const handleMessage = async () => {
  if (!friendship || friendship.status !== 'ACCEPTED') return;
  setActionLoading(true);
  try {
    const { data } = await apolloClient.mutate<{ startDirectConversation: { id: string } }>({
      mutation: START_DM,
      variables: { otherUserId: userId },
    });
    if (data?.startDirectConversation) {
      router.push(`/chat/${data.startDirectConversation.id}`);
    }
  } catch {
    addToast('You can only message your friends.', 'error');
  } finally {
    setActionLoading(false);
  }
};
```

Replace the Message button block (lines ~232-243):

```tsx
{friendship?.status === 'ACCEPTED' && (
  <button
    onClick={() => void handleMessage()}
    disabled={actionLoading}
    className="font-display font-headline-h4 px-6 h-11 rounded-md border border-outline-variant text-on-surface flex items-center gap-2 shadow-sm transition-all active:scale-95 hover:bg-surface-container-high disabled:opacity-50"
  >
    <span className="material-symbols-outlined text-[20px]">chat_bubble</span>
    {actionLoading ? 'Loading...' : 'Message'}
  </button>
)}
```

- [ ] **Step 2: Add Message button to the sheet**

In `apps/web/src/components/friends/user-profile-sheet.tsx`, add `START_DM` mutation document (same as Step 1) and a handler `handleMessage` that calls the mutation, then `onClose()` + `router.push('/chat/' + id)`.

Render it in the action column, after the friend-action button, only when `friendship?.status === 'ACCEPTED'`:

```tsx
{friendship?.status === 'ACCEPTED' && (
  <button
    onClick={() => void handleMessage()}
    disabled={actionLoading}
    className="w-full py-3 rounded-lg font-bold shadow-sm flex items-center justify-center gap-2 active:scale-[0.98] transition-all border border-outline-variant text-on-surface hover:bg-surface-container-high disabled:opacity-50"
  >
    <span className="material-symbols-outlined">chat_bubble</span>
    {actionLoading ? 'Loading...' : 'Message'}
  </button>
)}
```

- [ ] **Step 3: Update/extend specs**

Add to `apps/web/src/app/(app)/users/[id]/` (or `user-profile-client.spec.tsx` if one exists — if not, add component-level coverage via the sheet): a small spec asserting the Message button renders only for ACCEPTED friendship. Mock `apolloClient.mutate` to resolve `{ startDirectConversation: { id: 'c1' } }` and assert `router.push` was called with `/chat/c1`. If no spec file exists for this page, create `apps/web/src/components/friends/user-profile-sheet.spec.tsx` with `jest.mock('../../lib/apollo-client')` returning a fake `mutate`.

- [ ] **Step 4: Run tests + build**

Run: `pnpm --filter @transformlit/web test -- --testPathPattern "user-profile|profile-sheet"`
Expected: PASS.

Run: `pnpm --filter @transformlit/web build`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/app/\(app\)/users/\[id\]/user-profile-client.tsx apps/web/src/components/friends/user-profile-sheet.tsx apps/web/src/components/friends/user-profile-sheet.spec.tsx
git commit -m "feat(web): wire Message buttons to start direct conversations"
```

---

### Task 17: Real suggestions + real mutual friends

**Files:**
- Modify: `apps/web/src/app/(app)/friends/friends-client.tsx` (suggested section, lines ~195-220)
- Modify: `apps/web/src/app/(app)/users/[id]/user-profile-client.tsx` (mutual friends section, lines ~162-273)
- Modify: `apps/web/src/components/ui/suggested-friend-card.tsx` (add optional `avatarUrl` prop if not present — check the file; the card currently renders name + tag only per usage)

**Interfaces:**
- Consumes: `suggestedFriends(limit)` GraphQL query, `userProfile.mutualFriends` (Task 7).
- Produces: suggested section renders real users (hide when empty); mutual friends renders real avatars/names (hide when empty or own profile).

- [ ] **Step 1: Real suggested friends**

In `apps/web/src/app/(app)/friends/friends-client.tsx`:

Add:

```ts
const SUGGESTED_QUERY = gql`
  query SuggestedFriends($limit: Int!) {
    suggestedFriends(limit: $limit) {
      id
      displayName
      avatarUrl
      bio
    }
  }
`;
```

Add state: `const [suggestions, setSuggestions] = useState<Array<{ id: string; displayName: string; avatarUrl?: string | null; bio?: string | null }>>([]);`

In `loadData`, extend the `Promise.all` with `apolloClient.query<{ suggestedFriends: typeof suggestions }>({ query: SUGGESTED_QUERY, variables: { limit: 5 } })` and `setSuggestions(...)`.

Replace the mock card block with:

```tsx
{suggestions.length > 0 ? (
  <div className="flex gap-4 overflow-x-auto pb-4 -mx-4 px-4 md:mx-0 md:px-0 snap-x">
    {suggestions.map((s) => (
      <SuggestedFriendCard
        key={s.id}
        name={s.displayName}
        tag={s.bio || 'Community member'}
        onAdd={() => handleSuggest(s.id)}
      />
    ))}
  </div>
) : (
  <p className="font-body text-on-surface-variant">No suggestions right now — check back soon.</p>
)}
```

Add handler:

```ts
const handleSuggest = async (userId: string) => {
  try {
    await apolloClient.mutate({
      mutation: SEND_REQUEST,
      variables: { addresseeId: userId },
    });
    addToast('Friend request sent!', 'success');
    setSuggestions((prev) => prev.filter((s) => s.id !== userId));
  } catch {
    addToast('Failed to send friend request.', 'error');
  }
};
```

- [ ] **Step 2: Real mutual friends**

In `apps/web/src/app/(app)/users/[id]/user-profile-client.tsx`:

Extend `USER_PROFILE_QUERY` with `mutualFriends { id displayName avatarUrl }` and the `ProfileData` type with `mutualFriends: Array<{ id: string; displayName: string; avatarUrl?: string | null }>`.

Delete the `MUTUAL_FRIENDS` mock constant. Replace the Mutual Friends section body:

```tsx
{profile.mutualFriends.length > 0 ? (
  <div className="flex gap-5 overflow-x-auto pb-2 -mx-4 px-4">
    {profile.mutualFriends.map((friend) => (
      <div key={friend.id} className="flex flex-col items-center gap-2 min-w-[64px]">
        <UserAvatar avatarUrl={friend.avatarUrl} displayName={friend.displayName} size="md" />
        <span className="font-micro text-[10px] text-on-surface-variant text-center line-clamp-1">
          {friend.displayName}
        </span>
      </div>
    ))}
  </div>
) : null}
```

(The section wrapper already renders only when `!isOwnProfile`; now it also self-hides when empty.)

- [ ] **Step 3: Run tests + build**

Run: `pnpm --filter @transformlit/web test -- --testPathPattern "friends|user-profile"`
Expected: PASS (existing specs may need mock updates for the new query shapes).

Run: `pnpm --filter @transformlit/web build`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/app/\(app\)/friends/friends-client.tsx apps/web/src/app/\(app\)/users/\[id\]/user-profile-client.tsx
git commit -m "feat(web): real suggested friends and mutual friends"
```

---

### Task 18: E2E — two-user realtime chat flow

**Files:**
- Create: `apps/web/e2e/chat.spec.ts`

**Prereqs:** `apps/web/playwright.config.ts` boots API + web against the dev database; seed admin `admin@transformlit.com` / `Transformlit123!` exists (per `friends.spec.ts`). Registration page exists (`/register`).

- [ ] **Step 1: Read the register page to confirm field labels**

Read `apps/web/src/app/register/register-client.tsx` (or the login spec labels pattern in `apps/web/e2e/auth.spec.ts`) and confirm the label strings for email/password/displayName. Adjust selectors below if they differ (expected: "Email Address", "Password", "Display Name", submit "Create account"/"Register").

- [ ] **Step 2: Write the spec**

Create `apps/web/e2e/chat.spec.ts`:

```ts
import { test, expect, Page, BrowserContext } from '@playwright/test';

const ADMIN_EMAIL = 'admin@transformlit.com';
const ADMIN_PASSWORD = 'Transformlit123!';

async function login(page: Page, email: string, password: string) {
  await page.goto('/login');
  await page.getByLabel('Email Address').fill(email);
  await page.getByLabel('Password', { exact: true }).fill(password);
  await page.getByRole('button', { name: /log in/i }).click();
  await expect(page).toHaveURL(/.*\/feed/);
}

async function registerFriend(context: BrowserContext, email: string): Promise<Page> {
  const page = await context.newPage();
  await page.goto('/register');
  await page.getByLabel('Email Address').fill(email);
  await page.getByLabel('Password', { exact: true }).fill('Password123!');
  await page.getByLabel(/Display Name/i).fill('Chat Buddy');
  await page.getByRole('button', { name: /create account|register|sign up/i }).click();
  await expect(page).toHaveURL(/.*\/feed/);
  return page;
}

test.describe('Chat flow', () => {
  test('friend request → accept → DM both ways with unread badge', async ({ browser }) => {
    const email = `buddy${Date.now()}@example.com`;

    const adminCtx = await browser.newContext();
    const buddyCtx = await browser.newContext();
    const adminPage = await adminCtx.newPage();
    await login(adminPage, ADMIN_EMAIL, ADMIN_PASSWORD);

    // Buddy registers and sends admin a friend request
    const buddyPage = await registerFriend(buddyCtx, email);
    await buddyPage.goto('/friends');
    await buddyPage.getByPlaceholder('Search users...').fill('admin@transformlit.com');
    await buddyPage.getByRole('button', { name: /add friend/i }).first().click();
    await expect(buddyPage.getByText(/friend request sent/i)).toBeVisible({ timeout: 10000 });

    // Admin accepts
    await adminPage.goto('/friends');
    await adminPage.getByRole('button', { name: 'Accept' }).first().click({ timeout: 10000 });

    // Admin opens buddy's profile from the friends list and starts a DM
    await adminPage.getByText('Chat Buddy').first().click();
    await adminPage.getByRole('button', { name: /view full profile/i }).click();
    await expect(adminPage).toHaveURL(/\/users\//);
    await adminPage.getByRole('button', { name: /message/i }).click();
    await expect(adminPage).toHaveURL(/\/chat\//);
    await adminPage.getByPlaceholder('Type a message…').fill('Hello from admin!');
    await adminPage.getByPlaceholder('Type a message…').press('Enter');
    await expect(adminPage.getByText('Hello from admin!')).toBeVisible();

    // Buddy sees unread badge in nav, opens the conversation, replies
    await buddyPage.goto('/chat');
    await expect(buddyPage.getByText('admin@transformlit.com').or(buddyPage.getByText('Admin'))).toBeVisible({ timeout: 10000 });
    await buddyPage.getByText('Hello from admin!').click();
    await buddyPage.getByPlaceholder('Type a message…').fill('Hello back!');
    await buddyPage.getByPlaceholder('Type a message…').press('Enter');
    await expect(buddyPage.getByText('Hello back!')).toBeVisible();

    // Admin sees the reply in realtime (no reload)
    await expect(adminPage.getByText('Hello back!')).toBeVisible({ timeout: 10000 });

    await adminCtx.close();
    await buddyCtx.close();
  });

  test('bottom nav fits six items at 320px', async ({ page }) => {
    await page.setViewportSize({ width: 320, height: 700 });
    await login(page, ADMIN_EMAIL, ADMIN_PASSWORD);
    await page.goto('/chat');
    const nav = page.getByRole('navigation', { name: 'Mobile navigation' });
    await expect(nav).toBeVisible();
    const links = nav.locator('a');
    await expect(links).toHaveCount(6);
    // no horizontal overflow
    const overflow = await nav.evaluate((el) => el.scrollWidth > el.clientWidth);
    expect(overflow).toBe(false);
  });
});
```

Note: the admin's display name may not be "Admin" — the conversation title uses the buddy's display name on the buddy side, so assert on the message preview text instead of the name (as written). Adjust the admin accept step if `FriendRequestItem` uses different button text (read `apps/web/src/components/ui/friend-request-item.tsx` if the selector fails).

- [ ] **Step 3: Run the suite**

Run: `pnpm --filter @transformlit/web test:e2e -- chat.spec.ts`
Expected: PASS (both tests; requires local Docker/dev DB reachable per the config's webServer).

- [ ] **Step 4: Commit**

```bash
git add apps/web/e2e/chat.spec.ts
git commit -m "test(e2e): two-user realtime chat flow"
```

---

### Task 19: Final verification pass

**Files:** none (verification only).

- [ ] **Step 1: Full test suite**

Run: `pnpm test`
Expected: API unit + integration (Docker required for Testcontainers), web jest, all PASS.

- [ ] **Step 2: Lint**

Run: `pnpm lint`
Expected: PASS.

- [ ] **Step 3: Build**

Run: `pnpm build`
Expected: PASS (typechecks API + web; confirms the generated schema.gql matches the new types).

- [ ] **Step 4: Schema sanity check**

Run: `pnpm --filter @transformlit/api graphql:schema` (if the script regenerates schema.gql) or start the API once and confirm `apps/api/src/schema.gql` contains `messageAdded(conversationId: ID)`, `suggestedFriends(limit: Int = 5)`, `Conversation.unreadCount`, `Message.sender`, and no `MessageConnection.totalCount`. Commit any schema.gql diff.

- [ ] **Step 5: Runtime smoke (manual, optional)**

Start API + web, log in as two users, and confirm: friend request → accept → Message button opens `/chat/[id]` → realtime messages both ways → unread chips + nav badge → mark-read clears.

---

## Self-Review Notes (resolved)

- **Spec coverage:** every spec section maps to tasks — authorization (T1, T2, T8), subscription generalization + pubsub logging (T3), type enrichment + unread aggregate (T4), friends fixes (T5), suggestions (T6), mutual friends (T7), chat UI + routes (T10–T15), nav + badge (T13), message wiring (T16), friends UI (T17), e2e + 320px nav (T18), verification (T19). Stitch screens are generated by the orchestrator as a design lane before Task 14 (see handoff notes).
- **Type consistency:** `ChatMessage`/`ChatConversation` defined in `chat-queries.ts` (T10) and consumed by store (T11), provider (T12), list (T14), thread (T15). Store action names are used identically across T11–T15. `markConversationRead`/`startDirectConversation` names match between T10 and T16.
- **Placeholder scan:** no TBDs; the only conditional is Task 16/18 selectors, with explicit "read the file and adjust" steps and expected values.
- **Known pre-existing test note:** `apps/api` jest coverage thresholds (70%) — new code ships with tests in every task, so thresholds remain satisfiable.