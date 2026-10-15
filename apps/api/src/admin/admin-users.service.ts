import {
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { GroupMemberStatus, UserRole, UserStatus } from '@transformlit/shared';
import { PrismaService } from '../prisma/prisma.service.js';
import { AuditService } from '../audit/audit.service.js';
import { AuditAction } from '../audit/audit-actions.js';
import { AuthService } from '../auth/auth.service.js';
import { ReaderSessionService } from '../books/reader-session.service.js';

const MAX_PAGE_SIZE = 100;
/** Retries after the first serialization abort (2 attempts total). */
const MAX_SERIALIZABLE_RETRIES = 1;

/** Admin user list filter; GraphQL nullable inputs deliver explicit `null`. */
export interface AdminUsersFilter {
  role?: UserRole | null;
  status?: UserStatus | null;
  query?: string | null;
}

/** Admin-facing user projection — includes PII the public list strips. */
export interface AdminUser {
  id: string;
  email: string;
  displayName: string;
  avatarUrl: string | null;
  role: UserRole;
  status: UserStatus;
  lastLoginAt: Date | null;
  createdAt: Date;
  groupCount: number;
}

export interface AdminUserPage {
  items: AdminUser[];
  total: number;
}

const ADMIN_USER_SELECT = {
  id: true,
  email: true,
  displayName: true,
  avatarUrl: true,
  role: true,
  status: true,
  lastLoginAt: true,
  createdAt: true,
} as const;

type AdminUserRow = Prisma.UserGetPayload<{ select: typeof ADMIN_USER_SELECT }>;

interface StatusTarget {
  id: string;
  role: UserRole;
  status: UserStatus;
}

/**
 * Staff-only user administration: paginated directory reads, role changes, and
 * suspend/reactivate. Role/status writes run a check-and-write inside one
 * Serializable transaction so the "last active admin" predicate and the write
 * cannot interleave; Prisma `P2034` aborts are retried by a bounded helper.
 * Audit rows and session revocations happen post-commit.
 */
@Injectable()
export class AdminUsersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly authService: AuthService,
    private readonly readerSession: ReaderSessionService,
  ) {}

  private readonly logger = new Logger(AdminUsersService.name);

  /** Page of admin users (email + status included), newest first. */
  async list(
    filter: AdminUsersFilter,
    page: number,
    pageSize: number,
  ): Promise<AdminUserPage> {
    const currentPage = Math.max(page, 1);
    const take = Math.min(Math.max(pageSize, 1), MAX_PAGE_SIZE);
    const where = this.buildWhere(filter);

    const [rows, total] = await Promise.all([
      this.prisma.user.findMany({
        where,
        select: ADMIN_USER_SELECT,
        orderBy: { createdAt: 'desc' },
        skip: (currentPage - 1) * take,
        take,
      }),
      this.prisma.user.count({ where }),
    ]);

    return { items: await this.buildAdminUsers(rows), total };
  }

  /** Change a user's global role, refusing to demote the last active admin. */
  async setRole(
    userId: string,
    role: UserRole,
    actorId: string,
  ): Promise<AdminUser> {
    const updated = await this.withSerializableRetry((tx) =>
      this.applyRoleChange(tx, userId, role),
    );

    await this.audit.record({
      actorId,
      action: AuditAction.USER_ROLE_CHANGED,
      targetType: 'USER',
      targetId: userId,
      payload: { role },
    });

    const [adminUser] = await this.buildAdminUsers([updated]);
    return adminUser;
  }

  /**
   * Suspend or reactivate a user. Suspension ends *all* access: it revokes every
   * refresh family and every reading session for the user, post-commit. Refuses
   * to suspend the last active admin.
   */
  async setStatus(
    userId: string,
    status: UserStatus,
    actorId: string,
  ): Promise<AdminUser> {
    const updated = await this.withSerializableRetry((tx) =>
      this.applyStatusChange(tx, userId, status),
    );

    // The status change is committed, so its audit row must always be written
    // *before* any side effect that can fail (ADM-8, ADM-28). Revocation is
    // security-critical, so a failure is logged and rethrown — never silently
    // swallowed, which would leave a suspended user with live sessions while
    // reporting success.
    await this.audit.record({
      actorId,
      action: AuditAction.USER_STATUS_CHANGED,
      targetType: 'USER',
      targetId: userId,
      payload: { status },
    });

    if (status === UserStatus.SUSPENDED) {
      await this.revokeUserSessions(userId);
    }

    const [adminUser] = await this.buildAdminUsers([updated]);
    return adminUser;
  }

  /** Revokes all refresh families and reading sessions for a suspended user. */
  private async revokeUserSessions(userId: string): Promise<void> {
    try {
      await this.authService.revokeAllSessionsForUser(userId);
      await this.readerSession.revokeAllForUser(userId);
    } catch (error) {
      this.logger.error(
        `Failed to revoke sessions for suspended user ${userId}: ${(error as Error).message}`,
      );
      throw error;
    }
  }

  private async applyRoleChange(
    tx: Prisma.TransactionClient,
    userId: string,
    role: UserRole,
  ): Promise<AdminUserRow> {
    const target = await this.loadTarget(tx, userId);
    if (role !== UserRole.ADMIN) {
      await this.assertNotLastActiveAdmin(
        tx,
        target,
        'Cannot demote the last active admin',
      );
    }
    return tx.user.update({
      where: { id: userId },
      data: { role },
      select: ADMIN_USER_SELECT,
    });
  }

  private async applyStatusChange(
    tx: Prisma.TransactionClient,
    userId: string,
    status: UserStatus,
  ): Promise<AdminUserRow> {
    const target = await this.loadTarget(tx, userId);
    if (status === UserStatus.SUSPENDED) {
      await this.assertNotLastActiveAdmin(
        tx,
        target,
        'Cannot suspend the last active admin',
      );
    }
    return tx.user.update({
      where: { id: userId },
      data: { status },
      select: ADMIN_USER_SELECT,
    });
  }

  private async loadTarget(
    tx: Prisma.TransactionClient,
    userId: string,
  ): Promise<StatusTarget> {
    const target = await tx.user.findUnique({
      where: { id: userId, deletedAt: null },
      select: { id: true, role: true, status: true },
    });
    if (!target) throw new NotFoundException('User not found');
    return target as StatusTarget;
  }

  /**
   * Throws when `target` is the only remaining `ADMIN` + `ACTIVE` account, so
   * the platform can never lose its final administrator. Must run inside the
   * same transaction as the write it guards.
   */
  private async assertNotLastActiveAdmin(
    tx: Prisma.TransactionClient,
    target: Pick<StatusTarget, 'role' | 'status'>,
    message: string,
  ): Promise<void> {
    if (
      target.role !== UserRole.ADMIN ||
      target.status !== UserStatus.ACTIVE
    ) {
      return;
    }
    const activeAdmins = await tx.user.count({
      where: {
        role: UserRole.ADMIN,
        status: UserStatus.ACTIVE,
        deletedAt: null,
      },
    });
    if (activeAdmins <= 1) throw new ConflictException(message);
  }

  /** Runs `operation` in a Serializable transaction, retrying P2034 aborts. */
  private async withSerializableRetry<T>(
    operation: (tx: Prisma.TransactionClient) => Promise<T>,
  ): Promise<T> {
    let attempt = 0;
    while (true) {
      try {
        return await this.prisma.$transaction(operation, {
          isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
        });
      } catch (error) {
        const canRetry =
          this.isSerializationAbort(error) &&
          attempt < MAX_SERIALIZABLE_RETRIES;
        if (!canRetry) throw error;
        attempt += 1;
      }
    }
  }

  private isSerializationAbort(error: unknown): boolean {
    const prismaError = error as { code?: string } | null;
    return prismaError?.code === 'P2034';
  }

  private buildWhere(filter: AdminUsersFilter): Prisma.UserWhereInput {
    const where: Prisma.UserWhereInput = { deletedAt: null };
    const role = filter.role ?? undefined;
    const status = filter.status ?? undefined;
    const query = filter.query?.trim();

    if (role !== undefined) where.role = role;
    if (status !== undefined) where.status = status;
    if (query) {
      where.OR = [
        { displayName: { contains: query, mode: 'insensitive' } },
        {
          emailNormalized: {
            contains: query.toLowerCase(),
            mode: 'insensitive',
          },
        },
      ];
    }
    return where;
  }

  private async buildAdminUsers(rows: AdminUserRow[]): Promise<AdminUser[]> {
    const counts = await this.groupCountsFor(rows.map((row) => row.id));
    return rows.map((row) => ({
      ...row,
      role: row.role as UserRole,
      status: row.status as UserStatus,
      groupCount: counts.get(row.id) ?? 0,
    }));
  }

  /** Active-membership counts for the page, in one `groupBy` round trip. */
  private async groupCountsFor(
    userIds: string[],
  ): Promise<Map<string, number>> {
    const counts = new Map<string, number>();
    if (userIds.length === 0) return counts;
    const rows = await this.prisma.groupMember.groupBy({
      by: ['userId'],
      where: { userId: { in: userIds }, status: GroupMemberStatus.ACTIVE },
      _count: { _all: true },
    });
    for (const row of rows) {
      counts.set(row.userId, row._count._all);
    }
    return counts;
  }
}
