/// <reference types="jest" />
import { Test, TestingModule } from '@nestjs/testing';
import { GUARDS_METADATA } from '@nestjs/common/constants';
import { UserRole, UserStatus } from '@transformlit/shared';
import { AdminResolver } from './admin.resolver';
import { AdminUsersService } from './admin-users.service';
import { AdminAnalyticsService } from './admin-analytics.service';
import { AuditService } from '../audit/audit.service';
import { PrismaService } from '../prisma/prisma.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { ROLES_KEY } from '../common/decorators/roles.decorator';

const mockAdminUser = {
  id: 'user-1',
  email: 'user@example.com',
  displayName: 'User One',
  avatarUrl: null,
  role: UserRole.MEMBER,
  status: UserStatus.ACTIVE,
  lastLoginAt: null,
  createdAt: new Date('2026-01-01T00:00:00.000Z'),
  groupCount: 2,
};

const mockAuditRow = {
  id: 'audit-1',
  userId: 'user-1',
  action: 'LOGIN',
  targetType: null,
  targetId: null,
  payload: { ip: '127.0.0.1' },
  ipAddress: '127.0.0.1',
  userAgent: 'jest',
  createdAt: new Date('2026-02-01T00:00:00.000Z'),
};

const mockActor = {
  id: 'user-1',
  email: 'user@example.com',
  displayName: 'User One',
  avatarUrl: null,
  bio: null,
  role: UserRole.MEMBER,
  status: UserStatus.ACTIVE,
  lastLoginAt: null,
  createdAt: new Date('2026-01-01T00:00:00.000Z'),
};

interface MockService {
  list: jest.Mock;
  setRole: jest.Mock;
  setStatus: jest.Mock;
}

const rolesOf = (method: string) =>
  Reflect.getMetadata(ROLES_KEY, AdminResolver.prototype[method]);

describe('AdminResolver', () => {
  let resolver: AdminResolver;
  let adminUsers: MockService;
  let analytics: { platformOverview: jest.Mock; bookStats: jest.Mock };
  let audit: { list: jest.Mock };
  let prisma: { user: { findMany: jest.Mock } };

  beforeEach(async () => {
    adminUsers = {
      list: jest.fn().mockResolvedValue({ items: [mockAdminUser], total: 1 }),
      setRole: jest.fn().mockResolvedValue(mockAdminUser),
      setStatus: jest.fn().mockResolvedValue(mockAdminUser),
    };
    analytics = {
      platformOverview: jest.fn().mockResolvedValue({
        totalUsers: 1,
        activeUsers: 1,
        suspendedUsers: 0,
        totalBooks: 2,
        publishedBooks: 1,
        publishedAnnouncements: 0,
        totalGroups: 3,
      }),
      bookStats: jest.fn().mockResolvedValue({
        bookId: 'book-1',
        title: 'Book',
        readers: 4,
        completed: 2,
        completionRate: 50,
        totalPageViews: 20,
        avgPagesPerReader: 5,
      }),
    };
    audit = {
      list: jest.fn().mockResolvedValue({ items: [mockAuditRow], total: 1 }),
    };
    prisma = {
      user: { findMany: jest.fn().mockResolvedValue([mockActor]) },
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AdminResolver,
        { provide: AdminUsersService, useValue: adminUsers },
        { provide: AdminAnalyticsService, useValue: analytics },
        { provide: AuditService, useValue: audit },
        { provide: PrismaService, useValue: prisma },
      ],
    }).compile();

    resolver = module.get<AdminResolver>(AdminResolver);
    jest.clearAllMocks();
  });

  // ── class-level guard wiring ────────────────────────────────────────────────

  describe('guard wiring', () => {
    it('applies JwtAuthGuard + RolesGuard at the class level', () => {
      const guards = Reflect.getMetadata(GUARDS_METADATA, AdminResolver) ?? [];
      expect(guards).toEqual(expect.arrayContaining([JwtAuthGuard, RolesGuard]));
    });

    it.each([
      'adminUsers',
      'auditLogs',
      'adminPlatformOverview',
      'adminBookStats',
    ])('restricts %s to ADMIN + MODERATOR', (method) => {
      expect(rolesOf(method)).toEqual([UserRole.ADMIN, UserRole.MODERATOR]);
    });

    it.each(['adminSetUserRole', 'adminSetUserStatus'])(
      'restricts %s to ADMIN only',
      (method) => {
        expect(rolesOf(method)).toEqual([UserRole.ADMIN]);
      },
    );
  });

  // ── queries ─────────────────────────────────────────────────────────────────

  describe('adminUsers', () => {
    it('delegates to AdminUsersService.list and echoes pagination', async () => {
      const result = await resolver.adminUsers(
        { role: UserRole.ADMIN, status: UserStatus.ACTIVE, query: 'a' },
        2,
        10,
      );
      expect(adminUsers.list).toHaveBeenCalledWith(
        { role: UserRole.ADMIN, status: UserStatus.ACTIVE, query: 'a' },
        2,
        10,
      );
      expect(result).toEqual({
        items: [mockAdminUser],
        total: 1,
        page: 2,
        pageSize: 10,
      });
    });

    it('defaults the filter to an empty object', async () => {
      await resolver.adminUsers(undefined, 1, 25);
      expect(adminUsers.list).toHaveBeenCalledWith({}, 1, 25);
    });
  });

  describe('auditLogs', () => {
    it('delegates to AuditService.list, echoes pagination, and batch-loads actors', async () => {
      const result = await resolver.auditLogs({ action: 'LOGIN' }, 3, 5);

      expect(audit.list).toHaveBeenCalledWith({ action: 'LOGIN' }, 3, 5);
      expect(prisma.user.findMany).toHaveBeenCalledTimes(1);
      expect(result).toEqual({
        items: [
          expect.objectContaining({
            id: 'audit-1',
            actorId: 'user-1',
            actor: expect.objectContaining({ id: 'user-1' }),
          }),
        ],
        total: 1,
        page: 3,
        pageSize: 5,
      });
    });

    it('shows a null actor for system/unknown actors without querying users', async () => {
      audit.list.mockResolvedValue({
        items: [{ ...mockAuditRow, userId: null }],
        total: 1,
      });
      const result = await resolver.auditLogs(undefined, 1, 25);

      expect(prisma.user.findMany).not.toHaveBeenCalled();
      expect(result.items[0].actor).toBeNull();
    });
  });

  describe('adminPlatformOverview', () => {
    it('delegates to AdminAnalyticsService.platformOverview', async () => {
      const result = await resolver.adminPlatformOverview();
      expect(analytics.platformOverview).toHaveBeenCalledTimes(1);
      expect(result).toEqual(expect.objectContaining({ totalUsers: 1 }));
    });
  });

  describe('adminBookStats', () => {
    it('delegates to AdminAnalyticsService.bookStats with the book id', async () => {
      const result = await resolver.adminBookStats('book-1');
      expect(analytics.bookStats).toHaveBeenCalledWith('book-1');
      expect(result).toEqual(expect.objectContaining({ bookId: 'book-1' }));
    });
  });

  // ── mutations ───────────────────────────────────────────────────────────────

  describe('adminSetUserRole', () => {
    it('delegates to AdminUsersService.setRole with the actor id', async () => {
      const actor = { id: 'actor-1', role: UserRole.ADMIN };
      const input = { userId: 'target-1', role: UserRole.MODERATOR };

      const result = await resolver.adminSetUserRole(actor, input);

      expect(adminUsers.setRole).toHaveBeenCalledWith(
        'target-1',
        UserRole.MODERATOR,
        'actor-1',
      );
      expect(result).toEqual(mockAdminUser);
    });
  });

  describe('adminSetUserStatus', () => {
    it('delegates to AdminUsersService.setStatus with the actor id', async () => {
      const actor = { id: 'actor-1', role: UserRole.ADMIN };
      const input = { userId: 'target-1', status: UserStatus.SUSPENDED };

      const result = await resolver.adminSetUserStatus(actor, input);

      expect(adminUsers.setStatus).toHaveBeenCalledWith(
        'target-1',
        UserStatus.SUSPENDED,
        'actor-1',
      );
      expect(result).toEqual(mockAdminUser);
    });
  });
});
