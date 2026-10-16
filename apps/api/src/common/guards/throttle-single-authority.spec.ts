import { Controller, Get, type INestApplication } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import { Throttle, ThrottlerModule } from '@nestjs/throttler';
import request from 'supertest';
import { ContextThrottlerGuard } from './context-throttler.guard.js';

/**
 * Focussed proof that the strict download budget is enforced once, not twice.
 *
 * The API used to stack the global `ContextThrottlerGuard` with a route-level
 * `ThrottlerGuard` on the same handlers. Both iterate the same named throttlers
 * and increment the *same* storage key (`generateKey` uses class + handler +
 * throttler name + tracker), so a `@Throttle({ download: { limit: 30 } })` route
 * was effectively halved to ~15 requests/minute. `books.controller.ts` no longer
 * registers the route-level guard; the global guard is the single authority.
 *
 * These tests pin both the production configuration (30 allowed) and the defect
 * mechanism (two guards → 15), so a regression that reintroduces the duplicate
 * guard fails here rather than silently halving every download budget.
 */
const DOWNLOAD_RATE_LIMIT = { download: { limit: 30, ttl: 60000 } };

@Controller('probe')
class ProbeController {
  @Get()
  @Throttle(DOWNLOAD_RATE_LIMIT)
  ping(): { ok: boolean } {
    return { ok: true };
  }
}

async function bootstrap(globalGuardCount: number): Promise<INestApplication> {
  const guards = Array.from({ length: globalGuardCount }, () => ({
    provide: APP_GUARD,
    useClass: ContextThrottlerGuard,
  }));
  const moduleRef = await Test.createTestingModule({
    imports: [
      ThrottlerModule.forRoot([
        { ttl: 60000, limit: 120 },
        { name: 'download', ttl: 60000, limit: 120 },
      ]),
    ],
    controllers: [ProbeController],
    providers: guards,
  }).compile();
  const app = moduleRef.createNestApplication();
  await app.init();
  return app;
}

async function close(app: INestApplication | undefined): Promise<void> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<void>((_, reject) => {
    timer = setTimeout(() => reject(new Error('close timeout')), 10000);
  });
  try {
    await Promise.race([app?.close(), timeout]);
  } catch {
    // A throttler handle can keep the close promise open; never fail teardown on it.
  } finally {
    clearTimeout(timer);
  }
}

describe('Single-authority download throttling', () => {
  describe('global guard only (production configuration)', () => {
    let app: INestApplication;

    beforeAll(async () => {
      app = await bootstrap(1);
    });

    afterAll(async () => {
      await close(app);
    });

    it('allows 30 requests and rejects the 31st, not a halved 15', async () => {
      const server = app.getHttpServer();
      for (let i = 0; i < 30; i++) {
        const response = await request(server).get('/probe').expect(200);
        // One guard → one increment per request; the budget must track the
        // route's declared limit exactly.
        expect(response.headers['x-ratelimit-limit-download']).toBe('30');
        expect(response.headers['x-ratelimit-remaining-download']).toBe(String(29 - i));
      }
      await request(server).get('/probe').expect(429);
    });
  });

  describe('duplicated guard (the defect mechanism)', () => {
    let app: INestApplication;

    beforeAll(async () => {
      app = await bootstrap(2);
    });

    afterAll(async () => {
      await close(app);
    });

    it('halves the same budget to 15, proving the test distinguishes 30 from 15', async () => {
      const server = app.getHttpServer();
      for (let i = 0; i < 15; i++) {
        await request(server).get('/probe').expect(200);
      }
      // The 16th request is the 31st increment into the same bucket.
      await request(server).get('/probe').expect(429);
    });
  });
});
