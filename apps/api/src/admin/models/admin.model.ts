import { Field, ObjectType, InputType, ID, Int } from '@nestjs/graphql';
import { UserRole, UserStatus } from '@transformlit/shared';
import { GraphQLJSON } from 'graphql-type-json';
import { User } from '../../auth/models/auth.model.js';

/**
 * Admin-facing user projection. Unlike the public `User` type this includes the
 * user's email and account status, which the console needs to manage accounts.
 */
@ObjectType()
export class AdminUser {
  @Field(() => ID)
  id: string;

  @Field()
  email: string;

  @Field()
  displayName: string;

  @Field({ nullable: true })
  avatarUrl?: string;

  @Field(() => UserRole)
  role: UserRole;

  @Field(() => UserStatus)
  status: UserStatus;

  @Field({ nullable: true })
  lastLoginAt?: Date;

  @Field()
  createdAt: Date;

  @Field(() => Int)
  groupCount: number;
}

/**
 * One audit row. `actorId` is the raw stored actor (`AuditLog.userId`) and
 * `actor` is the resolved user, batch-loaded per page by the resolver.
 */
@ObjectType()
export class AuditLogEntry {
  @Field(() => ID)
  id: string;

  @Field(() => ID, { nullable: true })
  actorId?: string;

  @Field(() => User, { nullable: true })
  actor?: User;

  @Field()
  action: string;

  @Field({ nullable: true })
  targetType?: string;

  @Field({ nullable: true })
  targetId?: string;

  @Field(() => GraphQLJSON, { nullable: true })
  payload?: Record<string, unknown>;

  @Field({ nullable: true })
  ipAddress?: string;

  @Field({ nullable: true })
  userAgent?: string;

  @Field()
  createdAt: Date;
}

/** Platform-wide counters for the admin dashboard. */
@ObjectType()
export class AdminPlatformOverview {
  @Field(() => Int)
  totalUsers: number;

  @Field(() => Int)
  activeUsers: number;

  @Field(() => Int)
  suspendedUsers: number;

  @Field(() => Int)
  totalBooks: number;

  @Field(() => Int)
  publishedBooks: number;

  @Field(() => Int)
  publishedAnnouncements: number;

  @Field(() => Int)
  totalGroups: number;
}

/** Per-book engagement aggregates. */
@ObjectType()
export class AdminBookStats {
  @Field(() => ID)
  bookId: string;

  @Field()
  title: string;

  @Field(() => Int)
  readers: number;

  @Field(() => Int)
  completed: number;

  @Field(() => Int)
  completionRate: number;

  @Field(() => Int)
  totalPageViews: number;

  @Field(() => Int)
  avgPagesPerReader: number;
}

@ObjectType()
export class AdminUserPage {
  @Field(() => [AdminUser])
  items: AdminUser[];

  @Field(() => Int)
  total: number;

  @Field(() => Int)
  page: number;

  @Field(() => Int)
  pageSize: number;
}

@ObjectType()
export class AuditLogPage {
  @Field(() => [AuditLogEntry])
  items: AuditLogEntry[];

  @Field(() => Int)
  total: number;

  @Field(() => Int)
  page: number;

  @Field(() => Int)
  pageSize: number;
}

@InputType()
export class AdminUsersFilter {
  @Field(() => UserRole, { nullable: true })
  role?: UserRole;

  @Field(() => UserStatus, { nullable: true })
  status?: UserStatus;

  @Field({ nullable: true })
  query?: string;
}

@InputType()
export class AuditLogFilter {
  @Field({ nullable: true })
  action?: string;

  @Field(() => ID, { nullable: true })
  actorId?: string;

  @Field({ nullable: true })
  targetType?: string;

  @Field({ nullable: true })
  targetId?: string;

  @Field({ nullable: true })
  from?: Date;

  @Field({ nullable: true })
  to?: Date;
}

@InputType()
export class AdminSetUserRoleInput {
  @Field(() => ID)
  userId: string;

  @Field(() => UserRole)
  role: UserRole;
}

@InputType()
export class AdminSetUserStatusInput {
  @Field(() => ID)
  userId: string;

  @Field(() => UserStatus)
  status: UserStatus;
}
