/// <reference types="jest" />
import { NotFoundException } from '@nestjs/common';
import { UserRole, UserStatus } from '@transformlit/shared';
import { AdminUsersService } from './admin-users.service.js';

interface TxTarget {
  id: string;
  role: UserRole;
  status: UserStatus;
}

interface AdminUserRowFixture {
  id: string;
  email: string;
  displayName: string;
  avatarUrl: string | null;
  role: UserRole;
  status: UserStatus;
  lastLoginAt: Date | null;
  createdAt: Date;
}

interface TxMock {
  user: {
    count: jest.Mock;
    findUnique: jest.Mock;
    update: jest.Mock;
  };
}

function userRow(overrides: Partial<AdminUserRowFixture> = {}): AdminUserRowFixture {
  return {
    id: 'user-1',
    email: 'user@example.com',
    displayName: 'User',
    avatarUrl: null,
    role: UserRole.MEMBER,
    status: UserStatus.ACTIVE,
    lastLoginAt: null,
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    ...overrides,
  };
}

function makeTx(
  overrides: {
    activeAdmins?: number;
    target?: TxTarget | null;
    updated?: AdminUserRowFixture;
  } = {},
): TxMock {
  const target = overrides.target ?? null;
  const updated =
    overrides.updated ??
    userRow({
      id: target?.id ?? 'user-1',
      role: target?.role ?? UserRole.MEMBER,
      status: target?.status ?? UserStatus.ACTIVE,
    });
  return {
    user: {
      count: jest.fn().mockResolvedValue(overrides.activeAdmins ?? 5),
      findUnique: jest.fn().mockResolvedValue(target),
      update: jest.fn().mockResolvedValue(updated),
    },
  };
}

interface PrismaMock {
  $transaction: jest.Mock;
  user: { findMany: jest.Mock; count: jest.Mock };
  groupMember: { groupBy: jest.Mock };
}

function makePrisma(): PrismaMock {
  return {
    $transaction: jest.fn(),
    user: { findMany: jest.fn(), count: jest.fn() },
    groupMember: { groupBy: jest.fn().mockResolvedValue([]) },
  };
}

describe('AdminUsersService', () => {
  let prisma: PrismaMock;
  let audit: { record: jest.Mock };
  let authService: { revokeAllSessionsForUser: jest.Mock };
  let readerSession: { revokeAllForUser: jest.Mock };
  let service: AdminUsersService;

  const runTxWith = (tx: TxMock): void => {
    prisma.$transaction.mockImplementation((fn: (client: TxMock) => unknown) =>
      fn(tx),
    );
  };

  beforeEach(() => {
    prisma = makePrisma();
    audit = { record: jest.fn().mockResolvedValue(undefined) };
    authService = { revokeAllSessionsForUser: jest.fn().mockResolvedValue(1) };
    readerSession = { revokeAllForUser: jest.fn().mockResolvedValue(1) };
    service = new AdminUsersService(
      prisma as never,
      audit as never,
      authService as never,
      readerSession as never,
    );
  });

  describe('setRole', () => {
    it('refuses to demote the last active admin inside the transaction', async () => {
      const tx = makeTx({
        activeAdmins: 1,
        target: { id: 'admin-1', role: UserRole.ADMIN, status: UserStatus.ACTIVE },
      });
      runTxWith(tx);

      await expect(
        service.setRole('admin-1', UserRole.MEMBER, 'actor-1'),
      ).rejects.toThrow(/last active admin/i);

      expect(tx.user.count).toHaveBeenCalledWith({
        where: {
          role: UserRole.ADMIN,
          status: UserStatus.ACTIVE,
          deletedAt: null,
        },
      });
      expect(tx.user.update).not.toHaveBeenCalled();
      expect(audit.record).not.toHaveBeenCalled();
    });

    it('demotes when another active admin remains', async () => {
      const tx = makeTx({
        activeAdmins: 2,
        target: { id: 'admin-1', role: UserRole.ADMIN, status: UserStatus.ACTIVE },
      });
      runTxWith(tx);

      await service.setRole('admin-1', UserRole.MEMBER, 'actor-1');

      expect(prisma.$transaction).toHaveBeenCalledWith(expect.any(Function), {
        isolationLevel: 'Serializable',
      });
      expect(tx.user.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'admin-1' },
          data: { role: UserRole.MEMBER },
        }),
      );
    });

    it('does not consult the last-admin predicate when promoting to ADMIN', async () => {
      const tx = makeTx({
        activeAdmins: 1,
        target: { id: 'user-1', role: UserRole.MEMBER, status: UserStatus.ACTIVE },
      });
      runTxWith(tx);

      await service.setRole('user-1', UserRole.ADMIN, 'actor-1');

      expect(tx.user.count).not.toHaveBeenCalled();
      expect(tx.user.update).toHaveBeenCalled();
    });

    it('does not consult the predicate when demoting a non-admin', async () => {
      const tx = makeTx({
        activeAdmins: 1,
        target: { id: 'user-1', role: UserRole.MEMBER, status: UserStatus.ACTIVE },
      });
      runTxWith(tx);

      await service.setRole('user-1', UserRole.MEMBER, 'actor-1');

      expect(tx.user.count).not.toHaveBeenCalled();
      expect(tx.user.update).toHaveBeenCalled();
    });

    it('retries once when the transaction aborts with P2034', async () => {
      const serialization = Object.assign(new Error('serialization'), {
        code: 'P2034',
      });
      const tx = makeTx({
        activeAdmins: 2,
        target: { id: 'user-1', role: UserRole.MEMBER, status: UserStatus.ACTIVE },
        updated: userRow({ id: 'user-1', role: UserRole.ADMIN }),
      });
      prisma.$transaction
        .mockRejectedValueOnce(serialization)
        .mockImplementationOnce((fn: (client: TxMock) => unknown) => fn(tx));

      const result = await service.setRole('user-1', UserRole.ADMIN, 'actor-1');

      expect(prisma.$transaction).toHaveBeenCalledTimes(2);
      expect(result.role).toBe(UserRole.ADMIN);
    });

    it('gives up after the bounded retry budget is exhausted', async () => {
      const serialization = Object.assign(new Error('serialization'), {
        code: 'P2034',
      });
      prisma.$transaction.mockRejectedValue(serialization);

      await expect(
        service.setRole('user-1', UserRole.ADMIN, 'actor-1'),
      ).rejects.toThrow('serialization');

      expect(prisma.$transaction).toHaveBeenCalledTimes(2);
    });

    it('does not retry non-serialization failures', async () => {
      prisma.$transaction.mockRejectedValue(
        Object.assign(new Error('boom'), { code: 'P2002' }),
      );

      await expect(
        service.setRole('user-1', UserRole.ADMIN, 'actor-1'),
      ).rejects.toThrow('boom');

      expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    });

    it('throws NotFoundException for a missing or soft-deleted user', async () => {
      const tx = makeTx({ target: null });
      runTxWith(tx);

      await expect(
        service.setRole('missing', UserRole.MEMBER, 'actor-1'),
      ).rejects.toBeInstanceOf(NotFoundException);
      expect(tx.user.update).not.toHaveBeenCalled();
    });

    it('records USER_ROLE_CHANGED after the transaction commits', async () => {
      const tx = makeTx({
        activeAdmins: 2,
        target: { id: 'admin-1', role: UserRole.ADMIN, status: UserStatus.ACTIVE },
      });
      runTxWith(tx);

      await service.setRole('admin-1', UserRole.MEMBER, 'actor-1');

      expect(audit.record).toHaveBeenCalledWith(
        expect.objectContaining({
          actorId: 'actor-1',
          action: 'USER_ROLE_CHANGED',
          targetType: 'USER',
          targetId: 'admin-1',
        }),
      );
    });
  });

  describe('setStatus', () => {
    it('revokes refresh families and reading sessions when suspending', async () => {
      const tx = makeTx({
        activeAdmins: 3,
        target: { id: 'user-1', role: UserRole.MEMBER, status: UserStatus.ACTIVE },
        updated: userRow({ id: 'user-1', status: UserStatus.SUSPENDED }),
      });
      runTxWith(tx);

      await service.setStatus('user-1', UserStatus.SUSPENDED, 'actor-1');

      expect(prisma.$transaction).toHaveBeenCalledWith(expect.any(Function), {
        isolationLevel: 'Serializable',
      });
      expect(authService.revokeAllSessionsForUser).toHaveBeenCalledWith('user-1');
      expect(readerSession.revokeAllForUser).toHaveBeenCalledWith('user-1');
      expect(audit.record).toHaveBeenCalledWith(
        expect.objectContaining({
          actorId: 'actor-1',
          action: 'USER_STATUS_CHANGED',
          targetType: 'USER',
          targetId: 'user-1',
        }),
      );
      // The committed status change is audited before any side effect runs.
      expect(audit.record.mock.invocationCallOrder[0]).toBeLessThan(
        authService.revokeAllSessionsForUser.mock.invocationCallOrder[0],
      );
    });

    it('still records USER_STATUS_CHANGED when revocation fails, then rejects', async () => {
      const tx = makeTx({
        activeAdmins: 3,
        target: { id: 'user-1', role: UserRole.MEMBER, status: UserStatus.ACTIVE },
        updated: userRow({ id: 'user-1', status: UserStatus.SUSPENDED }),
      });
      runTxWith(tx);
      authService.revokeAllSessionsForUser.mockRejectedValue(
        new Error('session store down'),
      );

      await expect(
        service.setStatus('user-1', UserStatus.SUSPENDED, 'actor-1'),
      ).rejects.toThrow('session store down');

      expect(audit.record).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'USER_STATUS_CHANGED',
          targetId: 'user-1',
        }),
      );
      expect(audit.record.mock.invocationCallOrder[0]).toBeLessThan(
        authService.revokeAllSessionsForUser.mock.invocationCallOrder[0],
      );
    });

    it('refuses to suspend the last active admin', async () => {
      const tx = makeTx({
        activeAdmins: 1,
        target: { id: 'admin-1', role: UserRole.ADMIN, status: UserStatus.ACTIVE },
      });
      runTxWith(tx);

      await expect(
        service.setStatus('admin-1', UserStatus.SUSPENDED, 'actor-1'),
      ).rejects.toThrow(/last active admin/i);

      expect(tx.user.update).not.toHaveBeenCalled();
      expect(authService.revokeAllSessionsForUser).not.toHaveBeenCalled();
      expect(readerSession.revokeAllForUser).not.toHaveBeenCalled();
      expect(audit.record).not.toHaveBeenCalled();
    });

    it('does not consult the predicate or revoke when reactivating', async () => {
      const tx = makeTx({
        activeAdmins: 1,
        target: { id: 'admin-1', role: UserRole.ADMIN, status: UserStatus.SUSPENDED },
        updated: userRow({
          id: 'admin-1',
          role: UserRole.ADMIN,
          status: UserStatus.ACTIVE,
        }),
      });
      runTxWith(tx);

      await service.setStatus('admin-1', UserStatus.ACTIVE, 'actor-1');

      expect(tx.user.count).not.toHaveBeenCalled();
      expect(authService.revokeAllSessionsForUser).not.toHaveBeenCalled();
      expect(readerSession.revokeAllForUser).not.toHaveBeenCalled();
      expect(tx.user.update).toHaveBeenCalled();
    });
  });

  describe('list', () => {
    it('builds filters and batches group counts for the page', async () => {
      const rows = [
        userRow({ id: 'u1', role: UserRole.ADMIN }),
        userRow({ id: 'u2' }),
      ];
      prisma.user.findMany.mockResolvedValue(rows);
      prisma.user.count.mockResolvedValue(2);
      prisma.groupMember.groupBy.mockResolvedValue([
        { userId: 'u1', _count: { _all: 2 } },
      ]);

      const result = await service.list(
        { role: UserRole.ADMIN, status: UserStatus.ACTIVE, query: 'Ann' },
        2,
        25,
      );

      expect(prisma.user.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            deletedAt: null,
            role: UserRole.ADMIN,
            status: UserStatus.ACTIVE,
            OR: [
              { displayName: { contains: 'Ann', mode: 'insensitive' } },
              { emailNormalized: { contains: 'ann', mode: 'insensitive' } },
            ],
          },
          orderBy: { createdAt: 'desc' },
          skip: 25,
          take: 25,
        }),
      );
      expect(prisma.groupMember.groupBy).toHaveBeenCalledWith({
        by: ['userId'],
        where: { userId: { in: ['u1', 'u2'] }, status: 'ACTIVE' },
        _count: { _all: true },
      });
      expect(result.total).toBe(2);
      expect(result.items.map((item) => item.id)).toEqual(['u1', 'u2']);
      expect(result.items[0]?.groupCount).toBe(2);
      expect(result.items[1]?.groupCount).toBe(0);
    });

    it('floors the page and caps the page size', async () => {
      prisma.user.findMany.mockResolvedValue([]);
      prisma.user.count.mockResolvedValue(0);

      await service.list({}, 0, 5000);

      expect(prisma.user.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ skip: 0, take: 100 }),
      );
    });

    it('skips the group-count query for an empty page', async () => {
      prisma.user.findMany.mockResolvedValue([]);
      prisma.user.count.mockResolvedValue(0);

      const result = await service.list({}, 1, 25);

      expect(prisma.groupMember.groupBy).not.toHaveBeenCalled();
      expect(result).toEqual({ items: [], total: 0 });
    });
  });
});
