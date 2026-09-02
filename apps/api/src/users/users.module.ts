import { Module } from '@nestjs/common';
import { UsersService } from './users.service.js';
import { UsersResolver } from './users.resolver.js';
import { AuthModule } from '../auth/auth.module.js';

@Module({
  imports: [AuthModule],
  providers: [UsersService, UsersResolver],
  exports: [UsersService],
})
export class UsersModule {}
