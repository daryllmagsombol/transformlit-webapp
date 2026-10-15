import { Injectable, Logger } from '@nestjs/common';
import type { AuditLog, Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service.js';
import { MAX_PAGE_SIZE } from '../common/pagination.js';

export interface RecordAuditInput {
  actorId: string;
  action: string;
  targetType?: string;
  targetId?: string;
  payload?: Prisma.InputJsonValue;
  ip?: string;
  userAgent?: string;
}

export interface AuditFilters {
  // GraphQL nullable inputs deliver explicit `null` for cleared fields, so the
  // service accepts `null` and normalizes it away before building the `where`.
  action?: string | null;
  actorId?: string | null;
  targetType?: string | null;
  targetId?: string | null;
  from?: Date | null;
  to?: Date | null;
}

/** Raw `audit_logs` row. `userId` is exposed to GraphQL as `actorId` by the resolver. */
export type AuditLogRow = AuditLog;
/** Alias kept for the plan's `AuditLogEntryRow` name. */
export type AuditLogEntryRow = AuditLogRow;

/**
 * Post-commit, best-effort audit append + filtered read. Always uses the root
 * `PrismaService`; callers must invoke `record` after their transaction has
 * committed, never with a transaction handle.
 */
@Injectable()
export class AuditService {
  private readonly logger = new Logger(AuditService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Append one audit row. Never throws: a failed audit write must not fail the
   * mutation that triggered it, so the error is logged and swallowed.
   */
  async record(input: RecordAuditInput): Promise<void> {
    try {
      await this.prisma.auditLog.create({
        data: {
          userId: input.actorId,
          action: input.action,
          targetType: input.targetType,
          targetId: input.targetId,
          payload: input.payload,
          ipAddress: input.ip,
          userAgent: input.userAgent,
        },
      });
    } catch (error) {
      this.logger.error(
        `Audit write failed for ${input.action}: ${(error as Error).message}`,
      );
    }
  }

  /** Newest-first page of audit rows matching `filters`; `pageSize` capped at 100. */
  async list(
    filters: AuditFilters,
    page: number,
    pageSize: number,
  ): Promise<{ items: AuditLogRow[]; total: number }> {
    const where = this.buildWhere(filters);
    const take = Math.min(Math.max(pageSize, 1), MAX_PAGE_SIZE);
    const currentPage = Math.max(page, 1);

    const [items, total] = await Promise.all([
      this.prisma.auditLog.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (currentPage - 1) * take,
        take,
      }),
      this.prisma.auditLog.count({ where }),
    ]);

    return { items, total };
  }

  private buildWhere(filters: AuditFilters): Prisma.AuditLogWhereInput {
    const where: Prisma.AuditLogWhereInput = {};
    const action = filters.action ?? undefined;
    const actorId = filters.actorId ?? undefined;
    const targetType = filters.targetType ?? undefined;
    const targetId = filters.targetId ?? undefined;
    const from = filters.from ?? undefined;
    const to = filters.to ?? undefined;

    if (action !== undefined) where.action = action;
    if (actorId !== undefined) where.userId = actorId;
    if (targetType !== undefined) where.targetType = targetType;
    if (targetId !== undefined) where.targetId = targetId;
    if (from !== undefined || to !== undefined) {
      where.createdAt = { gte: from, lte: to };
    }
    return where;
  }
}
