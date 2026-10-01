import { BadRequestException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { ReaderMutationsService } from './reader-mutations.service';
import { UpgradeRequiredError, UPGRADE_REQUIRED_CODE } from './reader-mutation.errors';
import {
  OperationKind,
  OperationTargetKind,
  ReaderOperationInput,
} from './models/book.model';

const OPERATION_ID = '11111111-1111-4111-8111-111111111111';
const CLIENT_ID = '22222222-2222-4222-8222-222222222222';
const OTHER_CLIENT_ID = '33333333-3333-4333-8333-333333333333';
const BOOK_ID = 'book-1';
const SUBJECT = 'user-1';

interface Row { [key: string]: unknown }

/** Minimal stateful in-memory Prisma supporting the models Task 8 uses. */
function createFakePrisma() {
  const state = {
    book: {
      [BOOK_ID]: {
        id: BOOK_ID,
        createdById: 'owner-1',
        deletedAt: null,
        status: 'PUBLISHED',
        conversionStatus: 'READY',
        accessLevel: 'FREE',
        contentVersion: 2,
      } as Row,
    } as Record<string, Row>,
    bookContentVersion: [{ contentVersion: 1 }, { contentVersion: 2 }] as Row[],
    bookProgress: [] as Row[],
    bookmark: [] as Row[],
    highlight: [] as Row[],
    conflictCopy: [] as Row[],
    receipt: [] as Row[],
    tombstone: [] as Row[],
  };
  let idCounter = 0;
  const nextId = (prefix: string) => `${prefix}-${(idCounter += 1)}`;

  const api = {
    book: {
      findUnique: jest.fn(async ({ where }: { where: { id: string } }) => state.book[where.id] ?? null),
    },
    bookContentVersion: {
      findMany: jest.fn(async () => state.bookContentVersion),
    },
    bookProgress: {
      findUnique: jest.fn(async ({ where }: { where: { userId_bookId: { userId: string; bookId: string } } }) =>
        state.bookProgress.find((r) => r.userId === where.userId_bookId.userId && r.bookId === where.userId_bookId.bookId) ?? null),
      update: jest.fn(async ({ where, data }: { where: { userId_bookId: { userId: string; bookId: string } }; data: Row }) => {
        const row = state.bookProgress.find((r) => r.userId === where.userId_bookId.userId && r.bookId === where.userId_bookId.bookId);
        Object.assign(row as Row, data);
        return row;
      }),
      create: jest.fn(async ({ data }: { data: Row }) => {
        const row = { id: nextId('progress'), completedAt: null, ...data };
        state.bookProgress.push(row);
        return row;
      }),
    },
    bookmark: {
      findUnique: jest.fn(async ({ where }: { where: { userId_clientEntityId: { userId: string; clientEntityId: string } } }) =>
        state.bookmark.find((r) => r.userId === where.userId_clientEntityId.userId && r.clientEntityId === where.userId_clientEntityId.clientEntityId) ?? null),
      findFirst: jest.fn(async ({ where }: { where: { id?: string; userId?: string } }) =>
        state.bookmark.find((r) => (!where.id || r.id === where.id) && (!where.userId || r.userId === where.userId)) ?? null),
      create: jest.fn(async ({ data }: { data: Row }) => {
        const row = { id: nextId('bookmark'), deletedAt: null, createdAt: new Date(), ...data };
        state.bookmark.push(row);
        return row;
      }),
      update: jest.fn(async ({ where, data }: { where: { id: string }; data: Row }) => {
        const row = state.bookmark.find((r) => r.id === where.id);
        Object.assign(row as Row, data);
        return row;
      }),
    },
    highlight: {
      findUnique: jest.fn(async ({ where }: { where: { userId_clientEntityId: { userId: string; clientEntityId: string } } }) =>
        state.highlight.find((r) => r.userId === where.userId_clientEntityId.userId && r.clientEntityId === where.userId_clientEntityId.clientEntityId) ?? null),
      findFirst: jest.fn(async ({ where }: { where: { id?: string; userId?: string } }) =>
        state.highlight.find((r) => (!where.id || r.id === where.id) && (!where.userId || r.userId === where.userId)) ?? null),
      create: jest.fn(async ({ data }: { data: Row }) => {
        const row = { id: nextId('highlight'), deletedAt: null, createdAt: new Date(), updatedAt: new Date(), ...data };
        state.highlight.push(row);
        return row;
      }),
      update: jest.fn(async ({ where, data }: { where: { id: string }; data: Row }) => {
        const row = state.highlight.find((r) => r.id === where.id);
        Object.assign(row as Row, data, { updatedAt: new Date() });
        return row;
      }),
    },
    conflictCopy: {
      create: jest.fn(async ({ data }: { data: Row }) => {
        const row = { id: nextId('conflict'), createdAt: new Date(), ...data };
        state.conflictCopy.push(row);
        return row;
      }),
      findFirst: jest.fn(async ({ where }: { where: { id?: string; subject?: string } }) =>
        state.conflictCopy.find((r) => (!where.id || r.id === where.id) && (!where.subject || r.subject === where.subject)) ?? null),
      update: jest.fn(async ({ where, data }: { where: { id: string }; data: Row }) => {
        const row = state.conflictCopy.find((r) => r.id === where.id);
        Object.assign(row as Row, data);
        return row;
      }),
    },
    readerOperationReceipt: {
      findUnique: jest.fn(async ({ where }: { where: { subject_operationId: { subject: string; operationId: string } } }) =>
        state.receipt.find((r) => r.subject === where.subject_operationId.subject && r.operationId === where.subject_operationId.operationId) ?? null),
      create: jest.fn(async ({ data }: { data: Row }) => {
        const duplicate = state.receipt.find((r) => r.subject === data.subject && r.operationId === data.operationId);
        if (duplicate) throw new Prisma.PrismaClientKnownRequestError('duplicate', { code: 'P2002', clientVersion: 'test' });
        const row = { id: data.id, createdAt: new Date(), ...data };
        state.receipt.push(row);
        return row;
      }),
    },
    readerTombstone: {
      upsert: jest.fn(async ({ where, create, update }: { where: { subject_entityId: { subject: string; entityId: string } }; create: Row; update: Row }) => {
        const existing = state.tombstone.find((r) => r.subject === where.subject_entityId.subject && r.entityId === where.subject_entityId.entityId);
        if (existing) { Object.assign(existing, update); return existing; }
        const row = { id: nextId('tomb'), deletedAt: new Date(), ...create };
        state.tombstone.push(row);
        return row;
      }),
    },
    $transaction: jest.fn(async (callback: (tx: unknown) => Promise<unknown>) => callback(api)),
  };
  return { prisma: api, state };
}

function build() {
  const fake = createFakePrisma();
  const books = { canRead: jest.fn().mockResolvedValue(true) };
  const service = new ReaderMutationsService(fake.prisma as never, books as never);
  return { service, ...fake, books };
}

function baseInput(overrides: Partial<ReaderOperationInput>): ReaderOperationInput {
  return {
    operationId: OPERATION_ID,
    bookId: BOOK_ID,
    contentVersion: 2,
    kind: OperationKind.PROGRESS_SET,
    ...overrides,
  } as ReaderOperationInput;
}

describe('ReaderMutationsService', () => {
  describe('validation and kind field presence', () => {
    it('rejects an operation with a non-UUID operationId', async () => {
      const { service } = build();
      await expect(service.applyOperation(SUBJECT, baseInput({ operationId: 'not-a-uuid' }))).rejects.toBeInstanceOf(BadRequestException);
    });

    it('rejects a non-positive contentVersion', async () => {
      const { service } = build();
      await expect(service.applyOperation(SUBJECT, baseInput({ contentVersion: 0 }))).rejects.toBeInstanceOf(BadRequestException);
    });

    it('rejects kind-specific fields that are not allowed for the kind', async () => {
      const { service } = build();
      const input = baseInput({ kind: OperationKind.BOOKMARK_REMOVE, entityId: 'bm-1', baseRevision: 1, page: 5 } as never);
      await expect(service.applyOperation(SUBJECT, input)).rejects.toThrow(/not allowed/i);
    });

    it('rejects a missing required kind field', async () => {
      const { service } = build();
      const input = baseInput({ kind: OperationKind.PROGRESS_SET } as never);
      delete (input as unknown as Record<string, unknown>).baseRevision;
      await expect(service.applyOperation(SUBJECT, input)).rejects.toThrow(/required/i);
    });

    it('rejects an anchor whose endOffset is not greater than startOffset', async () => {
      const { service } = build();
      const input = baseInput({
        kind: OperationKind.ANNOTATION_CREATE,
        clientEntityId: CLIENT_ID,
        page: 3,
        text: 'hello',
        note: null,
        color: null,
        anchor: { version: 1, page: 3, startOffset: 5, endOffset: 5 },
      } as never);
      await expect(service.applyOperation(SUBJECT, input)).rejects.toThrow(/endOffset/i);
    });

    it('rejects an anchor whose page differs from the operation page', async () => {
      const { service } = build();
      const input = baseInput({
        kind: OperationKind.ANNOTATION_CREATE,
        clientEntityId: CLIENT_ID,
        page: 3,
        text: 'hello',
        anchor: { version: 1, page: 4, startOffset: 0, endOffset: 2 },
      } as never);
      await expect(service.applyOperation(SUBJECT, input)).rejects.toThrow(/anchor.page/i);
    });
  });

  describe('access and version classification', () => {
    it('returns ACCESS_DENIED when the subject cannot read the book', async () => {
      const { service, books } = build();
      books.canRead.mockResolvedValue(false);
      const outcome = await service.applyOperation(SUBJECT, baseInput({ kind: OperationKind.PROGRESS_SET, baseRevision: 0, currentPage: 1, scrollY: null } as never));
      expect(outcome.result.kind).toBe('ACCESS_DENIED');
    });

    it('returns INCOMPATIBLE_VERSION for an unavailable content version', async () => {
      const { service } = build();
      const outcome = await service.applyOperation(SUBJECT, baseInput({ contentVersion: 99, kind: OperationKind.PROGRESS_SET, baseRevision: 0, currentPage: 1, scrollY: null } as never));
      expect(outcome.result).toMatchObject({ kind: 'INCOMPATIBLE_VERSION', requestedContentVersion: 99 });
    });

    it('does not persist a receipt for a terminal access/version outcome', async () => {
      const { service, state, books } = build();
      books.canRead.mockResolvedValue(false);
      await service.applyOperation(SUBJECT, baseInput({ kind: OperationKind.PROGRESS_SET, baseRevision: 0, currentPage: 1, scrollY: null } as never));
      expect(state.receipt).toHaveLength(0);
    });
  });

  describe('progress', () => {
    it('starts at revision 0 when absent and applies the first write at revision 1', async () => {
      const { service } = build();
      const outcome = await service.applyOperation(SUBJECT, baseInput({ kind: OperationKind.PROGRESS_SET, baseRevision: 0, currentPage: 7, scrollY: 10 } as never));
      expect(outcome.result).toMatchObject({ kind: 'APPLIED', revision: 1 });
    });

    it('treats a stale revision as a conflict and never highest-page-wins', async () => {
      const { service } = build();
      await service.applyOperation(SUBJECT, baseInput({ kind: OperationKind.PROGRESS_SET, baseRevision: 0, currentPage: 7, scrollY: null } as never));
      const stale = await service.applyOperation(SUBJECT, {
        ...baseInput({ kind: OperationKind.PROGRESS_SET, baseRevision: 0, currentPage: 2, scrollY: null } as never),
        operationId: OTHER_CLIENT_ID,
      } as never);
      expect(stale.result.kind).toBe('CONFLICT');
      expect((stale.result as { kind: string; serverValue?: { currentPage?: number } }).serverValue?.currentPage).toBe(7);
    });
  });

  describe('idempotency and receipts', () => {
    it('returns the stored result for a replay of the same operation id and payload', async () => {
      const { service, state } = build();
      const input = baseInput({ kind: OperationKind.PROGRESS_SET, baseRevision: 0, currentPage: 4, scrollY: null } as never);
      const first = await service.applyOperation(SUBJECT, input);
      const replay = await service.applyOperation(SUBJECT, input);
      expect(replay.result).toEqual(first.result);
      expect(state.receipt).toHaveLength(1);
    });

    it('rejects reuse of an operation id with a different payload', async () => {
      const { service } = build();
      await service.applyOperation(SUBJECT, baseInput({ kind: OperationKind.PROGRESS_SET, baseRevision: 0, currentPage: 4, scrollY: null } as never));
      await expect(
        service.applyOperation(SUBJECT, baseInput({ kind: OperationKind.PROGRESS_SET, baseRevision: 1, currentPage: 9, scrollY: null } as never)),
      ).rejects.toThrow(/different payload/i);
    });

    it('scopes receipts per subject so another account cannot replay them', async () => {
      const { service } = build();
      await service.applyOperation(SUBJECT, baseInput({ kind: OperationKind.PROGRESS_SET, baseRevision: 0, currentPage: 4, scrollY: null } as never));
      const other = await service.applyOperation('user-2', baseInput({ kind: OperationKind.PROGRESS_SET, baseRevision: 0, currentPage: 1, scrollY: null } as never));
      expect(other.result.kind).toBe('APPLIED');
    });
  });

  describe('bookmarks and tombstones', () => {
    it('applies a bookmark add once and replays idempotently', async () => {
      const { service, state } = build();
      const input = baseInput({ kind: OperationKind.BOOKMARK_ADD, clientEntityId: CLIENT_ID, page: 5, label: null, color: null, anchor: null } as never);
      const first = await service.applyOperation(SUBJECT, input);
      const replay = await service.applyOperation(SUBJECT, input);
      expect(first.result.kind).toBe('APPLIED');
      expect(replay.result).toEqual(first.result);
      expect(state.bookmark).toHaveLength(1);
    });

    it('soft-deletes a bookmark, records a tombstone, and cannot be resurrected by a delayed add', async () => {
      const { service, state } = build();
      const add = await service.applyOperation(SUBJECT, baseInput({ kind: OperationKind.BOOKMARK_ADD, clientEntityId: CLIENT_ID, page: 5, label: null, color: null, anchor: null } as never));
      const entityId = (add.result as { entityId: string }).entityId;
      await service.applyOperation(SUBJECT, {
        ...baseInput({ kind: OperationKind.BOOKMARK_REMOVE, entityId, baseRevision: 1 } as never),
        operationId: '44444444-4444-4444-8444-444444444444',
      } as never);
      expect(state.tombstone).toHaveLength(1);
      expect((state.bookmark[0] as { deletedAt: Date | null }).deletedAt).not.toBeNull();

      // A delayed add with the same client identity must conflict, not resurrect.
      const delayed = await service.applyOperation(SUBJECT, {
        ...baseInput({ kind: OperationKind.BOOKMARK_ADD, clientEntityId: CLIENT_ID, page: 5, label: null, color: null, anchor: null } as never),
        operationId: '55555555-5555-4555-8555-555555555555',
      } as never);
      expect(delayed.result.kind).toBe('CONFLICT');
      expect((state.bookmark[0] as { deletedAt: Date | null }).deletedAt).not.toBeNull();
    });
  });

  describe('annotations and conflict copies', () => {
    it('creates a highlight at revision 1 and updates conditionally', async () => {
      const { service } = build();
      const created = await service.applyOperation(SUBJECT, baseInput({
        kind: OperationKind.ANNOTATION_CREATE,
        clientEntityId: CLIENT_ID,
        page: 2,
        text: 'hello',
        note: null,
        color: null,
        anchor: { version: 1, page: 2, startOffset: 0, endOffset: 3 },
      } as never));
      expect(created.result).toMatchObject({ kind: 'APPLIED', revision: 1 });
      const entityId = (created.result as { entityId: string }).entityId;
      const updated = await service.applyOperation(SUBJECT, {
        ...baseInput({ kind: OperationKind.ANNOTATION_UPDATE, entityId, targetKind: OperationTargetKind.ANNOTATION, baseRevision: 1, page: 2, text: 'hello world', note: null, color: null, anchor: { version: 1, page: 2, startOffset: 0, endOffset: 3 } } as never),
        operationId: '66666666-6666-4666-8666-666666666666',
      } as never);
      expect(updated.result).toMatchObject({ kind: 'APPLIED', revision: 2 });
    });

    it('preserves server state and creates a conflict copy on a stale edit', async () => {
      const { service, state } = build();
      const created = await service.applyOperation(SUBJECT, baseInput({ kind: OperationKind.ANNOTATION_CREATE, clientEntityId: CLIENT_ID, page: 2, text: 'v1', note: null, color: null, anchor: { version: 1, page: 2, startOffset: 0, endOffset: 2 } } as never));
      const entityId = (created.result as { entityId: string }).entityId;
      const conflict = await service.applyOperation(SUBJECT, {
        ...baseInput({ kind: OperationKind.ANNOTATION_UPDATE, entityId, targetKind: OperationTargetKind.ANNOTATION, baseRevision: 9, page: 2, text: 'offline', note: null, color: null, anchor: { version: 1, page: 2, startOffset: 0, endOffset: 2 } } as never),
        operationId: '77777777-7777-4777-8777-777777777777',
      } as never);
      expect(conflict.result.kind).toBe('CONFLICT');
      expect((conflict.result as { conflictCopy: unknown }).conflictCopy).not.toBeNull();
      expect(state.conflictCopy).toHaveLength(1);
      // Server text is unchanged.
      expect((state.highlight[0] as { text: string }).text).toBe('v1');
    });

    it('preserves both sides on edit-after-delete', async () => {
      const { service, state } = build();
      const created = await service.applyOperation(SUBJECT, baseInput({ kind: OperationKind.ANNOTATION_CREATE, clientEntityId: CLIENT_ID, page: 2, text: 'v1', note: null, color: null, anchor: { version: 1, page: 2, startOffset: 0, endOffset: 2 } } as never));
      const entityId = (created.result as { entityId: string }).entityId;
      await service.applyOperation(SUBJECT, { ...baseInput({ kind: OperationKind.ANNOTATION_DELETE, entityId, baseRevision: 1 } as never), operationId: '88888888-8888-4888-8888-888888888888' } as never);
      const editAfterDelete = await service.applyOperation(SUBJECT, {
        ...baseInput({ kind: OperationKind.ANNOTATION_UPDATE, entityId, targetKind: OperationTargetKind.ANNOTATION, baseRevision: 2, page: 2, text: 'offline', note: null, color: null, anchor: { version: 1, page: 2, startOffset: 0, endOffset: 2 } } as never),
        operationId: '99999999-9999-4999-8999-999999999999',
      } as never);
      expect(editAfterDelete.result.kind).toBe('CONFLICT');
      expect((editAfterDelete.result as { kind: string; conflictCopy?: { reason?: string } }).conflictCopy?.reason).toBe('DELETE_VS_EDIT');
      expect((state.highlight[0] as { deletedAt: Date | null }).deletedAt).not.toBeNull();
    });

    it('records the conflicting delete intent on a stale delete-after-edit', async () => {
      const { service } = build();
      const created = await service.applyOperation(SUBJECT, baseInput({ kind: OperationKind.ANNOTATION_CREATE, clientEntityId: CLIENT_ID, page: 2, text: 'v1', note: null, color: null, anchor: { version: 1, page: 2, startOffset: 0, endOffset: 2 } } as never));
      const entityId = (created.result as { entityId: string }).entityId;
      const staleDelete = await service.applyOperation(SUBJECT, {
        ...baseInput({ kind: OperationKind.ANNOTATION_DELETE, entityId, baseRevision: 9 } as never),
        operationId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      } as never);
      expect(staleDelete.result.kind).toBe('CONFLICT');
      expect((staleDelete.result as { kind: string; serverValue?: { text?: string } }).serverValue?.text).toBe('v1');
    });
  });

  describe('legacy write rejection', () => {
    it('rejects a legacy mutation with a stable UPGRADE_REQUIRED code', () => {
      const { service } = build();
      try {
        service.rejectLegacyMutation('saveProgress');
        throw new Error('expected to throw');
      } catch (error) {
        expect(error).toBeInstanceOf(UpgradeRequiredError);
        expect((error as UpgradeRequiredError).extensions.code).toBe(UPGRADE_REQUIRED_CODE);
      }
    });

    it('does not mutate or receipt a legacy rejection', async () => {
      const { service, state } = build();
      expect(() => service.rejectLegacyMutation('addBookmark')).toThrow(UpgradeRequiredError);
      expect(state.bookProgress).toHaveLength(0);
      expect(state.bookmark).toHaveLength(0);
      expect(state.receipt).toHaveLength(0);
    });
  });
});
