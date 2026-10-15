import {
  Injectable,
  UnauthorizedException,
  BadRequestException,
  ConflictException,
  ForbiddenException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import * as argon2 from 'argon2';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service.js';
import { RegisterLocalInput, LoginLocalInput } from './models/auth.model.js';
import { AuditService } from '../audit/audit.service.js';
import { AuditAction } from '../audit/audit-actions.js';
import { randomBytes, createHash } from 'node:crypto';

const PASSWORD_MIN_LENGTH = 8;
const PASSWORD_MAX_LENGTH = 128;

/** Request metadata threaded from a controller into best-effort audit rows. */
export interface AuditRequestContext {
  ip?: string;
  userAgent?: string;
}

/**
 * Public user projection. Auth responses (login/register/refresh/OAuth) are
 * serialized straight to clients, so they must never include credential or
 * internal columns (passwordHash, emailNormalized, deletedAt, updatedAt).
 *
 * The select keeps those columns out of the database read entirely, and
 * `toPublicUser` guarantees the returned object has exactly this shape even if
 * the query projection is ever widened. Mirrors AuthResponse.user and the
 * GraphQL User model.
 */
export const PUBLIC_USER_SELECT = {
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

type PublicUserRow = Prisma.UserGetPayload<{ select: typeof PUBLIC_USER_SELECT }>;

function toPublicUser(user: PublicUserRow): PublicUserRow {
  return {
    id: user.id,
    email: user.email,
    displayName: user.displayName,
    avatarUrl: user.avatarUrl,
    bio: user.bio,
    role: user.role,
    status: user.status,
    lastLoginAt: user.lastLoginAt,
    createdAt: user.createdAt,
  };
}

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwtService: JwtService,
    private readonly audit: AuditService,
  ) {}

  async registerLocal(input: RegisterLocalInput) {
    // Server-side password policy consistent with the shared register schema
    // (packages/shared enforces min 8 / max 128).
    if (
      input.password.length < PASSWORD_MIN_LENGTH ||
      input.password.length > PASSWORD_MAX_LENGTH
    ) {
      throw new BadRequestException(
        `Password must be between ${PASSWORD_MIN_LENGTH} and ${PASSWORD_MAX_LENGTH} characters`,
      );
    }

    const passwordHash = await argon2.hash(input.password);
    const emailNormalized = input.email.toLowerCase().trim();

    let user: { id: string };
    try {
      user = await this.prisma.user.create({
        data: {
          email: input.email,
          emailNormalized,
          passwordHash,
          displayName: input.displayName,
        },
      });
    } catch (error) {
      // P2002 = unique constraint violation (e.g. duplicate emailNormalized).
      // Re-throw as a generic conflict so callers cannot tell whether the email
      // is already registered. Never leak the underlying Prisma error.
      const prismaError = error as { code?: string };
      if (prismaError?.code === 'P2002') {
        throw new ConflictException('Unable to register');
      }
      throw error;
    }

    return this.generateTokens(user.id);
  }

  async loginLocal(input: LoginLocalInput, context?: AuditRequestContext) {
    const emailNormalized = input.email.toLowerCase().trim();
    const user = await this.prisma.user.findUnique({
      where: { emailNormalized },
    });

    if (!user?.passwordHash) {
      throw new UnauthorizedException('Invalid credentials');
    }

    const valid = await argon2.verify(user.passwordHash, input.password);
    if (!valid) {
      throw new UnauthorizedException('Invalid credentials');
    }

    await this.prisma.user.update({
      where: { id: user.id },
      data: { lastLoginAt: new Date() },
    });

    return this.mintLoginTokens(user.id, context);
  }

  async refreshTokens(refreshToken: string, context?: AuditRequestContext) {
    const tokenHash = this.hashToken(refreshToken);
    const stored = await this.prisma.refreshToken.findUnique({
      where: { tokenHash },
    });

    if (!stored || stored.revokedAt || stored.expiresAt < new Date()) {
      // Possible token reuse — revoke family
      if (stored) {
        await this.prisma.refreshToken.updateMany({
          where: { familyId: stored.familyId, revokedAt: null },
          data: { revokedAt: new Date() },
        });
        // A token that was already revoked is genuine reuse. A plain expiry is
        // not, so only emit the audit row when `revokedAt` is actually set.
        if (stored.revokedAt) {
          await this.audit.record({
            actorId: stored.userId,
            action: AuditAction.REFRESH_REUSE_DETECTED,
            targetType: 'USER',
            targetId: stored.userId,
            ip: context?.ip,
            userAgent: context?.userAgent,
          });
        }
      }
      throw new UnauthorizedException('Invalid refresh token');
    }

    // Rotate: guard-revoke old + issue new in a single transaction (same family).
    // The conditional update is the concurrency gate: two concurrent requests
    // holding the same still-valid token cannot both win — the second one's
    // guarded update matches 0 rows (already revoked) and the whole transaction
    // is rolled back, so no extra token is minted and reuse is detected.
    const { accessToken, refreshToken: newRefresh, user } =
      await this.prisma.$transaction(async (tx) => {
        const now = new Date();
        const revoked = await tx.refreshToken.updateMany({
          where: { id: stored.id, revokedAt: null },
          data: { revokedAt: now },
        });

        if (revoked.count === 0) {
          throw new UnauthorizedException('Invalid refresh token');
        }

        return this.generateTokens(stored.userId, stored.familyId, tx);
      });

    return { accessToken, refreshToken: newRefresh, user };
  }

  /**
   * Invalidates the refresh-token family for a presented refresh cookie.
   *
   * Idempotent and safe to retry: an absent, unknown, or already-revoked token
   * is a successful no-op (there is nothing left to invalidate). Used by logout
   * so a captured refresh token cannot be rotated after the user signs out.
   */
  async logout(refreshToken: string, context?: AuditRequestContext): Promise<void> {
    if (!refreshToken) return;
    const tokenHash = this.hashToken(refreshToken);
    const stored = await this.prisma.refreshToken.findUnique({ where: { tokenHash } });
    if (!stored) return;
    await this.prisma.refreshToken.updateMany({
      where: { familyId: stored.familyId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    // The controller route is @Public, so the actor must come from the stored
    // token row (never from a request user, which may not exist).
    await this.audit.record({
      actorId: stored.userId,
      action: AuditAction.LOGOUT,
      targetType: 'USER',
      targetId: stored.userId,
      ip: context?.ip,
      userAgent: context?.userAgent,
    });
  }

  async findOrCreateOAuthUser(
    profile: {
      provider: string;
      providerId: string;
      email: string;
      displayName: string;
      emailVerified?: boolean;
    },
    context?: AuditRequestContext,
  ) {
    let identity = await this.prisma.identity.findUnique({
      where: {
        provider_providerId: {
          provider: profile.provider,
          providerId: profile.providerId,
        },
      },
      include: { user: true },
    });

    if (identity) {
      await this.prisma.user.update({
        where: { id: identity.userId },
        data: { lastLoginAt: new Date() },
      });
      return this.mintLoginTokens(identity.userId, context);
    }

    const emailNormalized = profile.email.toLowerCase().trim();

    // Cross-provider account linking: a user with the same email may already
    // exist (e.g. signed up via Google/Facebook/Microsoft). Bind the new
    // provider identity to that account instead of creating a duplicate user.
    const existingUser = await this.prisma.user.findUnique({
      where: { emailNormalized },
    });
    if (existingUser) {
      // Only auto-link to an existing LOCAL account (one with a password) when
      // the provider has verified this email. Otherwise an attacker who can
      // create a provider profile for someone else's address would silently
      // take over their account. When no verified flag is available we default
      // to rejecting the link so a real user must log in with their password
      // and link manually.
      if (
        existingUser.passwordHash &&
        profile.emailVerified !== true
      ) {
        throw new ForbiddenException(
          'Verify your email or log in with your password first',
        );
      }
      await this.prisma.identity.create({
        data: {
          userId: existingUser.id,
          provider: profile.provider,
          providerId: profile.providerId,
          email: profile.email,
        },
      });
      await this.prisma.user.update({
        where: { id: existingUser.id },
        data: { lastLoginAt: new Date() },
      });
      return this.mintLoginTokens(existingUser.id, context);
    }

    // Create user + identity
    const user = await this.prisma.user.create({
      data: {
        email: profile.email,
        emailNormalized,
        displayName: profile.displayName,
      },
    });

    await this.prisma.identity.create({
      data: {
        userId: user.id,
        provider: profile.provider,
        providerId: profile.providerId,
        email: profile.email,
      },
    });

    return this.mintLoginTokens(user.id, context);
  }

  async validateUser(userId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId, deletedAt: null },
      select: PUBLIC_USER_SELECT,
    });
    return user ? toPublicUser(user) : user;
  }

  /**
   * Mint tokens, then append a best-effort LOGIN audit row post-commit. Shared
   * by local login and both OAuth branches so the audit call site cannot drift.
   */
  private async mintLoginTokens(userId: string, context?: AuditRequestContext) {
    const tokens = await this.generateTokens(userId);
    await this.audit.record({
      actorId: userId,
      action: AuditAction.LOGIN,
      targetType: 'USER',
      targetId: userId,
      ip: context?.ip,
      userAgent: context?.userAgent,
    });
    return tokens;
  }

  private async generateTokens(
    userId: string,
    familyId?: string,
    tx?: Prisma.TransactionClient,
  ) {
    const db = tx ?? this.prisma;
    const accessToken = this.jwtService.sign({ sub: userId });
    const rawRefresh = randomBytes(40).toString('hex');
    const tokenHash = this.hashToken(rawRefresh);
    const famId = familyId ?? randomBytes(16).toString('hex');

    await db.refreshToken.create({
      data: {
        userId,
        tokenHash,
        familyId: famId,
        expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000), // 7 days
      },
    });

    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: PUBLIC_USER_SELECT,
    });
    return {
      accessToken,
      refreshToken: rawRefresh,
      user: user ? toPublicUser(user) : user,
    };
  }

  private hashToken(token: string): string {
    return createHash('sha256').update(token).digest('hex');
  }
}
