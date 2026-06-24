import { Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import * as argon2 from 'argon2';
import { PrismaService } from '../prisma/prisma.service.js';
import { RegisterLocalInput, LoginLocalInput } from '@transformlit/shared';
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
      include: { user: true },
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

    // Rotate: revoke old, issue new
    const { accessToken, refreshToken: newRefresh } =
      await this.generateTokens(stored.userId);

    await this.prisma.refreshToken.update({
      where: { id: stored.id },
      data: { revokedAt: new Date(), replacedById: undefined },
    });

    return { accessToken, refreshToken: newRefresh };
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

    // Create user + identity
    const user = await this.prisma.user.create({
      data: {
        email: profile.email,
        emailNormalized: profile.email.toLowerCase().trim(),
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

  private async generateTokens(userId: string) {
    const accessToken = this.jwtService.sign({ sub: userId });
    const rawRefresh = randomBytes(40).toString('hex');
    const tokenHash = this.hashToken(rawRefresh);
    const familyId = randomBytes(16).toString('hex');

    await this.prisma.refreshToken.create({
      data: {
        userId,
        tokenHash,
        familyId,
        expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000), // 7 days
      },
    });

    return { accessToken, refreshToken: rawRefresh };
  }

  private hashToken(token: string): string {
    return createHash('sha256').update(token).digest('hex');
  }
}
