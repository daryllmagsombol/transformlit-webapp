import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { Request } from 'express';
import type { AuthUser, JwtPayload } from './auth.types';

@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(
    private readonly jwtService: JwtService,
    private readonly configService: ConfigService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<Request>();
    const header = request.headers.authorization ?? '';

    if (!header.startsWith('Bearer ')) {
      throw new UnauthorizedException('Missing auth token');
    }

    const token = header.slice(7);
    const secret = this.configService.get<string>('JWT_SECRET') ?? 'dev-secret';

    try {
      const payload = await this.jwtService.verifyAsync<JwtPayload>(token, {
        secret,
      });
      const user: AuthUser = {
        id: payload.sub,
        tenantId: payload.tenantId,
        role: payload.role,
        email: payload.email,
      };
      request['user'] = user;
      return true;
    } catch (error) {
      throw new UnauthorizedException('Invalid auth token');
    }
  }
}
