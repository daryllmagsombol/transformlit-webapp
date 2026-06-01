import {
  BadRequestException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { PrismaService } from '../prisma/prisma.service';
import { RegisterDto } from './dto/register.dto';
import { LoginDto } from './dto/login.dto';
import type { AuthUser } from './auth.types';
import { UserRole, UserStatus } from '@prisma/client';
import * as argon2 from 'argon2';

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwtService: JwtService,
  ) {}

  async register(dto: RegisterDto) {
    const emailNormalized = dto.email.trim().toLowerCase();
    const tenantSlug = await this.createUniqueTenantSlug(dto.tenantName);

    const tenant = await this.prisma.tenant.create({
      data: {
        name: dto.tenantName.trim(),
        slug: tenantSlug,
        status: 'active',
      },
    });

    const existingUser = await this.prisma.user.findUnique({
      where: {
        tenantId_emailNormalized: {
          tenantId: tenant.id,
          emailNormalized,
        },
      },
    });

    if (existingUser) {
      throw new BadRequestException('Email already registered');
    }

    const passwordHash = await argon2.hash(dto.password);

    const user = await this.prisma.user.create({
      data: {
        tenantId: tenant.id,
        email: dto.email.trim(),
        emailNormalized,
        passwordHash,
        status: UserStatus.active,
        role: UserRole.tenant_admin,
      },
    });

    await this.prisma.profile.create({
      data: {
        tenantId: tenant.id,
        userId: user.id,
        displayName: dto.displayName?.trim() || 'Tenant Admin',
      },
    });

    return this.buildAuthResponse(user, tenant);
  }

  async login(dto: LoginDto) {
    const emailNormalized = dto.email.trim().toLowerCase();
    const tenant = await this.prisma.tenant.findUnique({
      where: { slug: dto.tenantSlug.trim().toLowerCase() },
    });

    if (!tenant) {
      throw new UnauthorizedException('Invalid tenant or credentials');
    }

    const user = await this.prisma.user.findUnique({
      where: {
        tenantId_emailNormalized: {
          tenantId: tenant.id,
          emailNormalized,
        },
      },
    });

    if (!user) {
      throw new UnauthorizedException('Invalid tenant or credentials');
    }

    const passwordValid = await argon2.verify(user.passwordHash, dto.password);

    if (!passwordValid) {
      throw new UnauthorizedException('Invalid tenant or credentials');
    }

    await this.prisma.user.update({
      where: { id: user.id },
      data: { lastLoginAt: new Date() },
    });

    return this.buildAuthResponse(user, tenant);
  }

  async me(user: AuthUser) {
    const record = await this.prisma.user.findUnique({
      where: { id: user.id },
      select: {
        id: true,
        tenantId: true,
        email: true,
        role: true,
        status: true,
      },
    });

    if (!record) {
      throw new UnauthorizedException('User not found');
    }

    return record;
  }

  private async createUniqueTenantSlug(tenantName: string) {
    const base = this.slugify(tenantName);
    let slug = base;
    let suffix = 1;

    while (await this.prisma.tenant.findUnique({ where: { slug } })) {
      slug = `${base}-${suffix}`;
      suffix += 1;
    }

    return slug;
  }

  private slugify(value: string) {
    return value
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/(^-|-$)+/g, '');
  }

  private buildAuthResponse(
    user: { id: string; email: string; role: string },
    tenant: { id: string; name: string; slug: string },
  ) {
    const token = this.jwtService.sign({
      sub: user.id,
      tenantId: tenant.id,
      role: user.role,
      email: user.email,
    });

    return {
      token,
      tenant: {
        id: tenant.id,
        name: tenant.name,
        slug: tenant.slug,
      },
      user: {
        id: user.id,
        email: user.email,
        role: user.role,
      },
    };
  }
}
