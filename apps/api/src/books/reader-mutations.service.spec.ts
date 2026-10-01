import { BadRequestException, ConflictException, ForbiddenException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { ReaderMutationsService, CONCURRENT_OPERATION_CODE } from './reader-mutations.service';
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

function uniqueViolation(): Prisma.PrismaClientKnownRequestError {
  return new Prisma.PrismaClientKnownRequestError('duplicate', { code: 'P2002', clientVersion: 'test' });
}

/** Prisma-like `where` matching: equality, `{ not }`, `{ in }`, `{ increment }` on data. */
function matches(row: Row, where: Row): boolean {
  return Object.entries(where).every(([key, value]) => {
    if (value === undefined) return true;
    if (value && typeof value === 'object') {
      const operator = value as { not?: unknown; in?: unknown[] };
      if ('not' in operator) return row[key] !== operator.not;
      if ('in' in operator) return (operator.in ?? []).includes(row[key]);
    }
    return row[key] === value;
  });
}

/** Applies `{ increment: n }` operators the way Prisma's updateMany does. */
function applyIncrements(row: Row, data: Row): void {
  for (const [key, value] of Object.entries(data)) {
    if (value && typeof value === 'object' && 'increment' in (value as Row)) {
      const increment = (value as { increment: number }).increment;
      row[key] = ((row[key] as number) ?? 0) + increment;
    } else {
      row[key] = value;
    }
  }
}

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
      create: jest.fn(async ({ data }: { data: Row }) => {
        const duplicate = state.bookProgress.find((r) => r.userId === data.userId && r.bookId === data.bookId);
        if (duplicate) throw uniqueViolation();
        const row = { id: nextId('progress'), completedAt: null, ...data };
        state.bookProgress.push(row);
        return row;
      }),
      updateMany: jest.fn(async ({ where, data }: { where: Row; data: Row }) => {
        const rows = state.bookProgress.filter((r) => matches(r, where));
        for (const row of rows) applyIncrements(row, data);
        return { count: rows.length };
      }),
    },
    bookmark: {
      findUnique: jest.fn(async ({ where }: { where: { userId_clientEntityId: { userId: string; clientEntityId: string } } }) =>
        state.bookmark.find((r) => r.userId === where.userId_clientEntityId.userId && r.clientEntityId === where.userId_clientEntityId.clientEntityId) ?? null),
      findFirst: jest.fn(async ({ where }: { where: Row }) =>
        state.bookmark.find((r) => matches(r, where)) ?? null),
      findMany: jest.fn(async ({ where }: { where: Row }) =>
        state.bookmark.filter((r) => matches(r, where))),
      create: jest.fn(async ({ data }: { data: Row }) => {
        const duplicate = state.bookmark.find((r) => r.userId === data.userId && r.clientEntityId === data.clientEntityId);
        if (duplicate) throw uniqueViolation();
        const row = { id: nextId('bookmark'), deletedAt: null, createdAt: new Date(), ...data };
        state.bookmark.push(row);
        return row;
      }),
      updateMany: jest.fn(async ({ where, data }: { where: Row; data: Row }) => {
        const rows = state.bookmark.filter((r) => matches(r, where));
        for (const row of rows) applyIncrements(row, data);
        return { count: rows.length };
      }),
    },
    highlight: {
      findUnique: jest.fn(async ({ where }: { where: { userId_clientEntityId: { userId: string; clientEntityId: string } } }) =>
        state.highlight.find((r) => r.userId === where.userId_clientEntityId.userId && r.clientEntityId === where.userId_clientEntityId.clientEntityId) ?? null),
      findFirst: jest.fn(async ({ where }: { where: Row }) =>
        state.highlight.find((r) => matches(r, where)) ?? null),
      findMany: jest.fn(async ({ where }: { where: Row }) =>
        state.highlight.filter((r) => matches(r, where))),
      create: jest.fn(async ({ data }: { data: Row }) => {
        const duplicate = state.highlight.find((r) => r.userId === data.userId && r.clientEntityId === data.clientEntityId);
        if (duplicate) throw uniqueViolation();
        const row = { id: nextId('highlight'), deletedAt: null, createdAt: new Date(), updatedAt: new Date(), ...data };
        state.highlight.push(row);
        return row;
      }),
      updateMany: jest.fn(async ({ where, data }: { where: Row; data: Row }) => {
        const rows = state.highlight.filter((r) => matches(r, where));
        for (const row of rows) applyIncrements(row, { ...data, updatedAt: new Date() });
        return { count: rows.length };
      }),
    },
    conflictCopy: {
      create: jest.fn(async ({ data }: { data: Row }) => {
        const row = { id: nextId('conflict'), createdAt: new Date(), ...data };
        state.conflictCopy.push(row);
        return row;
      }),
      findFirst: jest.fn(async ({ where }: { where: Row }) =>
        state.conflictCopy.find((r) => matches(r, where)) ?? null),
      findMany: jest.fn(async ({ where }: { where: Row }) =>
        state.conflictCopy.filter((r) => matches(r, where))),
      updateMany: jest.fn(async ({ where, data }: { where: Row; data: Row }) => {
        const rows = state.conflictCopy.filter((r) => matches(r, where));
        for (const row of rows) applyIncrements(row, data);
        return { count: rows.length };
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
      findMany: jest.fn(async ({ where }: { where: Row }) =>
        state.tombstone.filter((r) => matches(r, where))),
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

  describe('migrated legacy rows (null provenance)', () => {
    it('serializes a conflict on a bookmark with null clientEntityId without inventing an id', async () => {
      const { service, state } = build();
      state.bookmark.push({
        id: 'legacy-bm',
        userId: SUBJECT,
        bookId: BOOK_ID,
        clientEntityId: null,
        page: 3,
        label: null,
        color: null,
        anchor: null,
        contentVersion: 1,
        revision: 4,
        deletedAt: null,
        createdAt: new Date(),
      });
      const outcome = await service.applyOperation(SUBJECT, {
        ...baseInput({ kind: OperationKind.BOOKMARK_REMOVE, entityId: 'legacy-bm', baseRevision: 1 } as never),
        operationId: '15151515-1515-4151-8151-151515151515',
      } as never);
      expect(outcome.result.kind).toBe('CONFLICT');
      const value = (outcome.result as { serverValue?: { clientEntityId?: string | null } }).serverValue;
      expect(value?.clientEntityId ?? null).toBeNull();
    });

    it('serializes a conflict on a legacy highlight with a null anchor without fabricating one', async () => {
      const { service, state } = build();
      state.highlight.push({
        id: 'legacy-hl',
        userId: SUBJECT,
        bookId: BOOK_ID,
        clientEntityId: null,
        page: 2,
        text: 'legacy text',
        note: null,
        color: null,
        anchor: null,
        contentVersion: 1,
        revision: 3,
        deletedAt: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      });
      const outcome = await service.applyOperation(SUBJECT, {
        ...baseInput({ kind: OperationKind.ANNOTATION_UPDATE, entityId: 'legacy-hl', targetKind: OperationTargetKind.ANNOTATION, baseRevision: 1, page: 2, text: 'offline', note: null, color: null, anchor: { version: 1, page: 2, startOffset: 0, endOffset: 2 } } as never),
        operationId: '18181818-1818-4181-8181-181818181818',
      } as never);
      expect(outcome.result.kind).toBe('CONFLICT');
      const value = (outcome.result as { serverValue?: { anchor?: unknown } }).serverValue;
      expect(value?.anchor ?? null).toBeNull();
    });

    it('records an honest delete-vs-edit conflict copy from current server content', async () => {
      const { service, state } = build();
      const created = await service.applyOperation(SUBJECT, baseInput({ kind: OperationKind.ANNOTATION_CREATE, clientEntityId: CLIENT_ID, page: 2, text: 'v1', note: null, color: null, anchor: { version: 1, page: 2, startOffset: 0, endOffset: 2 } } as never));
      const entityId = (created.result as { entityId: string }).entityId;
      // A newer edit advances the row to revision 2.
      await service.applyOperation(SUBJECT, {
        ...baseInput({ kind: OperationKind.ANNOTATION_UPDATE, entityId, targetKind: OperationTargetKind.ANNOTATION, baseRevision: 1, page: 2, text: 'v2', note: null, color: null, anchor: { version: 1, page: 2, startOffset: 0, endOffset: 2 } } as never),
        operationId: '16161616-1616-4161-8161-161616161616',
      } as never);
      // A stale delete (base 1) must preserve the newer edit and record the
      // delete intent as a copy of the honest server annotation, not a blank one.
      const staleDelete = await service.applyOperation(SUBJECT, {
        ...baseInput({ kind: OperationKind.ANNOTATION_DELETE, entityId, baseRevision: 1 } as never),
        operationId: '17171717-1717-4171-8171-171717171717',
      } as never);
      expect(staleDelete.result.kind).toBe('CONFLICT');
      const copy = state.conflictCopy[0];
      expect(copy.reason).toBe('DELETE_VS_EDIT');
      expect(copy.text).toBe('v2');
      expect(copy.page).toBe(2);
      expect((staleDelete.result as { serverValue?: { text?: string } }).serverValue?.text).toBe('v2');
    });
  });

  describe('concurrency (lost-update prevention)', () => {
    it('serializes two same-base progress writes: one APPLIED, one CONFLICT, no lost update', async () => {
      const { service, state, prisma } = build();
      // Winner: revision 0 -> 1 at page 5.
      const winner = await service.applyOperation(SUBJECT, baseInput({ kind: OperationKind.PROGRESS_SET, baseRevision: 0, currentPage: 5, scrollY: null } as never));
      expect(winner.result).toMatchObject({ kind: 'APPLIED', revision: 1 });

      // Loser reads the row as revision 0 (its stale snapshot), but another
      // writer has already advanced the real row to revision 1. The DB-conditional
      // updateMany must match 0 rows -> CONFLICT, never a silent overwrite.
      const staleSnapshot = { id: state.bookProgress[0].id, userId: SUBJECT, bookId: BOOK_ID, currentPage: 5, scrollY: null, revision: 0, lastReadAt: new Date() };
      prisma.bookProgress.findUnique.mockResolvedValueOnce(staleSnapshot);
      const loser = await service.applyOperation(SUBJECT, {
        ...baseInput({ kind: OperationKind.PROGRESS_SET, baseRevision: 0, currentPage: 99, scrollY: null } as never),
        operationId: '13131313-1313-4131-8131-131313131313',
      } as never);
      expect(loser.result.kind).toBe('CONFLICT');
      expect((loser.result as { serverRevision?: number }).serverRevision).toBe(1);
      // The loser's page was never written and the winner's revision is intact.
      expect(state.bookProgress[0].currentPage).toBe(5);
      expect(state.bookProgress[0].revision).toBe(1);
    });

    it('does not overwrite a highlight whose revision advanced between read and write', async () => {
      const { service, state, prisma } = build();
      const created = await service.applyOperation(SUBJECT, baseInput({ kind: OperationKind.ANNOTATION_CREATE, clientEntityId: CLIENT_ID, page: 2, text: 'v1', note: null, color: null, anchor: { version: 1, page: 2, startOffset: 0, endOffset: 2 } } as never));
      const entityId = (created.result as { entityId: string }).entityId;

      // Another writer advanced the row to revision 2 after our read of revision 1.
      state.highlight[0].revision = 2;
      const staleSnapshot = { ...state.highlight[0], revision: 1, text: 'v1' };
      prisma.highlight.findFirst.mockResolvedValueOnce(staleSnapshot);
      const loser = await service.applyOperation(SUBJECT, {
        ...baseInput({ kind: OperationKind.ANNOTATION_UPDATE, entityId, targetKind: OperationTargetKind.ANNOTATION, baseRevision: 1, page: 2, text: 'offline', note: null, color: null, anchor: { version: 1, page: 2, startOffset: 0, endOffset: 2 } } as never),
        operationId: '12121212-1212-4121-8121-121212121212',
      } as never);
      expect(loser.result.kind).toBe('CONFLICT');
      expect(state.highlight[0].text).toBe('v1');
      expect(state.highlight[0].revision).toBe(2);
    });
  });

  describe('concurrent duplicate operation (receipt race)', () => {
    it('adopts the winner stored result when our receipt insert loses the unique race', async () => {
      const { service, state, prisma } = build();
      const input = baseInput({ kind: OperationKind.PROGRESS_SET, baseRevision: 0, currentPage: 4, scrollY: null } as never);
      const winner = await service.applyOperation(SUBJECT, input);
      expect(winner.result.kind).toBe('APPLIED');

      // Simulate READ COMMITTED: our transaction's initial receipt read misses the
      // winner, then our receipt create hits the unique constraint. The loser must
      // re-read the winner and return its stored result, not a recomputed value.
      prisma.readerOperationReceipt.findUnique.mockResolvedValueOnce(null);
      const loser = await service.applyOperation(SUBJECT, input);
      expect(loser.result).toEqual(winner.result);
      expect(state.receipt).toHaveLength(1);
      expect(state.bookProgress).toHaveLength(1);
    });

    it('translates a concurrent entity-create unique violation into a replay/conflict, not a 500', async () => {
      const { service, prisma } = build();
      const first = baseInput({ kind: OperationKind.BOOKMARK_ADD, clientEntityId: CLIENT_ID, page: 5, label: null, color: null, anchor: null } as never);
      await service.applyOperation(SUBJECT, first);
      // A different operationId for the same client identity: our candidate read
      // misses the concurrently-created bookmark, then the create violates
      // (userId, clientEntityId). This must not surface as an opaque 500 and must
      // not fabricate a divergent second row.
      prisma.bookmark.findUnique.mockResolvedValueOnce(null);
      const second = { ...first, operationId: '14141414-1414-4141-8141-141414141414' } as never;
      const error = await service.applyOperation(SUBJECT, second).catch((caught: unknown) => caught);
      expect(error).toBeInstanceOf(ConflictException);
      // A clearly retryable, stable code so clients retry rather than discard.
      expect((error as ConflictException).getResponse()).toMatchObject({ code: CONCURRENT_OPERATION_CODE });
    });
  });

  describe('authoritative annotation snapshot', () => {
    it('returns only present annotations, tombstones, and conflict copies for one book', async () => {
      const { service, state } = build();
      // A present bookmark, a present highlight, a soft-deleted bookmark with a
      // tombstone, and a linked conflict copy — all in the same snapshotted book.
      state.bookmark.push({ id: 'bm-present', userId: SUBJECT, bookId: BOOK_ID, page: 1, revision: 3, deletedAt: null, createdAt: new Date(), clientEntityId: CLIENT_ID, contentVersion: 2 });
      state.highlight.push({ id: 'hl-present', userId: SUBJECT, bookId: BOOK_ID, page: 2, text: 'kept', revision: 4, deletedAt: null, createdAt: new Date(), updatedAt: new Date(), clientEntityId: OTHER_CLIENT_ID, contentVersion: 2 });
      state.bookmark.push({ id: 'bm-deleted', userId: SUBJECT, bookId: BOOK_ID, page: 3, revision: 2, deletedAt: new Date(), createdAt: new Date(), clientEntityId: 'deadbeef-0000-4000-8000-000000000000', contentVersion: 2 });
      state.tombstone.push({ id: 't1', subject: SUBJECT, entityId: 'bm-deleted', kind: 'BOOKMARK', revision: 2, deletedAt: new Date() });
      state.conflictCopy.push({ id: 'cc-1', subject: SUBJECT, bookId: BOOK_ID, operationId: OPERATION_ID, sourceEntityId: 'hl-present', page: 2, text: 'offline', revision: 5, reason: 'STALE_REVISION', contentVersion: 2, createdAt: new Date() });
      // A row in a different book must not leak into this book's snapshot.
      state.bookmark.push({ id: 'bm-other', userId: SUBJECT, bookId: 'other-book', page: 1, revision: 9, deletedAt: null, createdAt: new Date(), clientEntityId: 'aaaaaaaa-0000-4000-8000-000000000000', contentVersion: 2 });

      const snapshot = await service.getSnapshot(SUBJECT, BOOK_ID);

      expect(snapshot.bookId).toBe(BOOK_ID);
      const annotationIds = snapshot.annotations.map((row) => row.id);
      expect(annotationIds).toEqual(expect.arrayContaining(['bm-present', 'hl-present']));
      expect(annotationIds).not.toContain('bm-deleted');
      expect(annotationIds).not.toContain('bm-other');
      expect(snapshot.tombstones.map((row) => row.entityId)).toEqual(['bm-deleted']);
      expect(snapshot.conflictCopies.map((row) => row.id)).toEqual(['cc-1']);
      // The snapshot revision is the annotation-only watermark (max revision).
      expect(snapshot.snapshotRevision).toBe(5);
    });

    it('never includes reading progress in the annotation snapshot', async () => {
      const { service, state } = build();
      state.bookProgress.push({ id: 'p1', userId: SUBJECT, bookId: BOOK_ID, currentPage: 42, revision: 99, lastReadAt: new Date() });
      const snapshot = await service.getSnapshot(SUBJECT, BOOK_ID);
      expect(snapshot.snapshotRevision).toBe(0);
      expect(JSON.stringify(snapshot.annotations)).not.toContain('ProgressRecord');
    });

    it('rejects a subject without read access and never returns another account data', async () => {
      const { service, books } = build();
      books.canRead.mockResolvedValue(false);
      await expect(service.getSnapshot(SUBJECT, BOOK_ID)).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('reports an empty snapshot with revision 0 when nothing is stored', async () => {
      const { service } = build();
      const snapshot = await service.getSnapshot(SUBJECT, BOOK_ID);
      expect(snapshot).toMatchObject({ bookId: BOOK_ID, snapshotRevision: 0 });
      expect(snapshot.annotations).toEqual([]);
      expect(snapshot.tombstones).toEqual([]);
      expect(snapshot.conflictCopies).toEqual([]);
    });
  });
});
