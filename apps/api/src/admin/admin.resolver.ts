import { Resolver, Query, Mutation, Args, Int, ID } from '@nestjs/graphql';
import { UseGuards } from '@nestjs/common';
import { UserRole, UserStatus } from '@transformlit/shared';
import { AdminUsersService } from './admin-users.service.js';
import { AdminAnalyticsService } from './admin-analytics.service.js';
import { AuditService, type AuditLogRow } from '../audit/audit.service.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard.js';
import { RolesGuard } from '../auth/guards/roles.guard.js';
import { Roles } from '../common/decorators/roles.decorator.js';
import { CurrentUser } from '../common/decorators/current-user.decorator.js';
import { clampPageWindow } from '../common/pagination.js';
import {
  AdminUser,
  AdminUserPage,
  AuditLogPage,
  AdminPlatformOverview,
  AdminBookStats,
  AdminUsersFilter,
  AuditLogFilter,
  AdminSetUserRoleInput,
  AdminSetUserStatusInput,
} from './models/admin.model.js';

/** Actor projection for an audit page; matches the GraphQL `User` type. */
const ACTOR_SELECT = {
  id: true,
  email: true,
  displayName: true,
  avatarUrl: true,
  bio: true,
  role: true,
  status: true,
  lastLoginAt: true,
  createdAt: true,
} as const;

/**
 * Staff-only admin console surface. `@Roles` is inert metadata on its own
 * (ADM-1), so the class applies `@UseGuards(JwtAuthGuard, RolesGuard)` once and
 * each method narrows the required role: reads are staff, mutations are ADMIN.
 * `AdminGroups` live on `GroupsResolver` (the groups domain owns that model).
 */
@Resolver()
@UseGuards(JwtAuthGuard, RolesGuard)
export class AdminResolver {
  constructor(
    private readonly adminUsersService: AdminUsersService,
    private readonly analytics: AdminAnalyticsService,
    private readonly audit: AuditService,
    private readonly prisma: PrismaService,
  ) {}

  @Query(() => AdminUserPage, { name: 'adminUsers' })
  @Roles(UserRole.ADMIN, UserRole.MODERATOR)
  async adminUsers(
    @Args('filter', { type: () => AdminUsersFilter, nullable: true })
    filter?: AdminUsersFilter,
    @Args('page', { type: () => Int, defaultValue: 1 }) page = 1,
    @Args('pageSize', { type: () => Int, defaultValue: 25 }) pageSize = 25,
  ) {
    const window = clampPageWindow(page, pageSize);
    const pageResult = await this.adminUsersService.list(
      filter ?? {},
      window.page,
      window.pageSize,
    );
    // Echo the *effective* window (the services clamp page >= 1, pageSize <=
    // 100), never the raw request — otherwise a `pageSize: 500` response would
    // claim 500 while at most 100 items come back (ADM-30b).
    return { ...pageResult, ...window };
  }

  @Query(() => AuditLogPage, { name: 'auditLogs' })
  @Roles(UserRole.ADMIN, UserRole.MODERATOR)
  async auditLogs(
    @Args('filter', { type: () => AuditLogFilter, nullable: true })
    filter?: AuditLogFilter,
    @Args('page', { type: () => Int, defaultValue: 1 }) page = 1,
    @Args('pageSize', { type: () => Int, defaultValue: 25 }) pageSize = 25,
  ) {
    const window = clampPageWindow(page, pageSize);
    const { items, total } = await this.audit.list(filter ?? {}, window.page, window.pageSize);
    return {
      items: await this.attachActors(items),
      total,
      ...window,
    };
  }

  @Query(() => AdminPlatformOverview, { name: 'adminPlatformOverview' })
  @Roles(UserRole.ADMIN, UserRole.MODERATOR)
  async adminPlatformOverview() {
    return this.analytics.platformOverview();
  }

  @Query(() => AdminBookStats, { name: 'adminBookStats' })
  @Roles(UserRole.ADMIN, UserRole.MODERATOR)
  async adminBookStats(@Args('bookId', { type: () => ID }) bookId: string) {
    return this.analytics.bookStats(bookId);
  }

  @Mutation(() => AdminUser, { name: 'adminSetUserRole' })
  @Roles(UserRole.ADMIN)
  async adminSetUserRole(
    @CurrentUser() user: { id: string },
    @Args('input') input: AdminSetUserRoleInput,
  ) {
    return this.adminUsersService.setRole(input.userId, input.role, user.id);
  }

  @Mutation(() => AdminUser, { name: 'adminSetUserStatus' })
  @Roles(UserRole.ADMIN)
  async adminSetUserStatus(
    @CurrentUser() user: { id: string },
    @Args('input') input: AdminSetUserStatusInput,
  ) {
    return this.adminUsersService.setStatus(input.userId, input.status, user.id);
  }

  /**
   * Batch-resolves the actor for an audit page in one `findMany` (not per row).
   * `actorId` mirrors the raw `AuditLog.userId`; `actor` is null for rows with no
   * actor or an actor that no longer exists.
   */
  private async attachActors(rows: AuditLogRow[]) {
    const actorIds = [
      ...new Set(
        rows.map((row) => row.userId).filter((id): id is string => id !== null),
      ),
    ];
    if (actorIds.length === 0) {
      return rows.map((row) => ({ ...row, actorId: row.userId, actor: null }));
    }
    const actors = await this.prisma.user.findMany({
      where: { id: { in: actorIds } },
      select: ACTOR_SELECT,
    });
    const byId = new Map(actors.map((actor) => [actor.id, actor]));
    return rows.map((row) => ({
      ...row,
      actorId: row.userId,
      actor: row.userId ? byId.get(row.userId) ?? null : null,
    }));
  }
}
