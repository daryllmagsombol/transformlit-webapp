import { Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import * as argon2 from 'argon2';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service.js';
import { RegisterLocalInput, LoginLocalInput } from './models/auth.model.js';
import { randomBytes, createHash } from 'node:crypto';

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwtService: JwtService,
  ) {}

  async registerLocal(input: RegisterLocalInput) {
    const passwordHash = await argon2.hash(input.password);
    const emailNormalized = input.email.toLowerCase().trim();

    const user = await this.prisma.user.create({
      data: {
        email: input.email,
        emailNormalized,
        passwordHash,
        displayName: input.displayName,
      },
    });

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

    // Rotate: revoke old + issue new in a single transaction (same family)
    const { accessToken, refreshToken: newRefresh, user } =
      await this.prisma.$transaction(async (tx) => {
        await tx.refreshToken.update({
          where: { id: stored.id },
          data: { revokedAt: new Date() },
        });
        return this.generateTokens(stored.userId, stored.familyId, tx);
      });

    return { accessToken, refreshToken: newRefresh, user };
  }

  async findOrCreateOAuthUser(profile: {
    provider: string;
    providerId: string;
    email: string;
    displayName: string;
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
