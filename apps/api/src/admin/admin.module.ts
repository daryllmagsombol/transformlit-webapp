import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module.js';
import { ReaderSessionService } from '../books/reader-session.service.js';
import { AdminAnalyticsService } from './admin-analytics.service.js';
import { AdminUsersService } from './admin-users.service.js';

/**
 * Admin console backend. `AuditModule` and `PrismaModule` are `@Global()`, so
 * only `AuthModule` (for `AuthService`) needs importing. `ReaderSessionService`
 * is stateless and shares the global `PrismaService`, so it is re-provided here
 * rather than coupling the admin module to the whole `BooksModule`.
 */
@Module({
  imports: [AuthModule],
  providers: [AdminUsersService, AdminAnalyticsService, ReaderSessionService],
  exports: [AdminUsersService, AdminAnalyticsService],
})
export class AdminModule {}
