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
import { randomBytes, createHash } from 'node:crypto';

const PASSWORD_MIN_LENGTH = 8;
const PASSWORD_MAX_LENGTH = 128;

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwtService: JwtService,
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

  async loginLocal(input: LoginLocalInput) {
    const emailNormalized = input.email.toLowerCase().trim();
    const user = await this.prisma.user.findUnique({
      where: { emailNormalized },
    });

    if (!user || !user.passwordHash) {
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

    return this.generateTokens(user.id);
  }

  async refreshTokens(refreshToken: string) {
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

  async findOrCreateOAuthUser(profile: {
    provider: string;
    providerId: string;
    email: string;
    displayName: string;
    emailVerified?: boolean;
  }) {
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
      return this.generateTokens(identity.userId);
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
      return this.generateTokens(existingUser.id);
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

    return this.generateTokens(user.id);
  }

  async validateUser(userId: string) {
    return this.prisma.user.findUnique({
      where: { id: userId, deletedAt: null },
    });
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

    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    return { accessToken, refreshToken: rawRefresh, user };
  }

  private hashToken(token: string): string {
    return createHash('sha256').update(token).digest('hex');
  }
}
