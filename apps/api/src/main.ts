import { NestFactory } from '@nestjs/core';
import { NestExpressApplication } from '@nestjs/platform-express';
import { ValidationPipe } from '@nestjs/common';
import cookieParser from 'cookie-parser';
import { AppModule } from './app.module.js';

/**
 * Parse and validate a comma-separated CORS_ORIGIN list into a strict
 * allow-list. Behavior:
 * - Empty/unset input -> the default local dev origin.
 * - Entries are trimmed; blank entries are skipped.
 * - Entries without an explicit scheme (http/https), or wildcard '*', are
 *   rejected (never allowed). Wildcards are never permitted.
 * - In production only https origins are kept; http non-localhost origins are
 *   dropped. http://localhost entries are preserved in every environment so
 *   local tooling keeps working.
 */
function normalizeOrigins(raw: string | undefined): string[] {
  const fallback = ['http://localhost:3000'];
  if (!raw) return fallback;

  const isProduction = process.env.NODE_ENV === 'production';

  const allowed = raw
    .split(',')
    .map((o) => o.trim())
    .filter(Boolean)
    .filter((origin) => {
      // Never allow wildcards or scheme-less entries.
      if (origin === '*') return false;
      const match = /^(https?):\/\//.exec(origin);
      if (!match) return false;
      const scheme = match[1];
      if (scheme !== 'http' && scheme !== 'https') return false;
      // Only allow added http origins if they are localhost, and only in dev.
      if (scheme === 'http' && (isProduction || !/^http:\/\/localhost(:\d+)?$/.test(origin))) {
        return false;
      }
      return true;
    });

  return allowed.length > 0 ? allowed : fallback;
}

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule);

  // Trust the immediate proxy (nginx) so req.protocol honors X-Forwarded-Proto
  // and OAuth callback URLs are built with https in production.
  app.set('trust proxy', 1);

  // Parse httpOnly cookies (refresh token, OAuth state) so req.cookies works.
  app.use(cookieParser());

  const origins = normalizeOrigins(process.env.CORS_ORIGIN);

  app.enableCors({ origin: origins, credentials: true });
  app.enableShutdownHooks();
  app.useGlobalPipes(
    new ValidationPipe({ transform: true }),
  );

  const port = Number(process.env.PORT ?? 3005);
  await app.listen(port, '0.0.0.0');
  console.log(`API running on http://localhost:${port}/graphql`);
}

bootstrap();
