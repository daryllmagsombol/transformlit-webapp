import { Test, TestingModule } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import { Pool } from 'pg';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { execSync } from 'node:child_process';
import request from 'supertest';
import type { StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { AppModule } from '../src/app.module.js';
import { PrismaService } from '../src/prisma/prisma.service.js';
import { AuthService } from '../src/auth/auth.service.js';
import { assertOwnedDisposableDatabaseUrl, startOwnedDisposableDatabase } from './helpers/pwa-disposable-db.js';

const RECORD_ACTIVITY = `
  mutation RecordActivity($input: RecordActivityInput!) {
    recordActivity(input: $input) {
      dayKey
      counted
    }
  }
`;

const MY_PROGRESS = `
  query MyProgress($year: Int!) {
    myProgress(year: $year) {
      year
      daysRead
      pagesRead
      currentStreak
      longestStreak
      lastActiveDayKey
      goal {
        year
        targetKind
        targetValue
      }
    }
  }
`;

/** Mirrors the server's UTC+8 day-key computation so assertions match the write path. */
function todayDayKey(): string {
  const shifted = new Date(Date.now() + 8 * 60 * 60 * 1000);
  const year = shifted.getUTCFullYear();
  const month = String(shifted.getUTCMonth() + 1).padStart(2, '0');
  const day = String(shifted.getUTCDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function isDockerAvailable(): boolean {
  try {
    execSync('docker info', { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

async function runMigrations(pool: Pool): Promise<void> {
  await pool.query(`
    DO $$ DECLARE
      r RECORD;
    BEGIN
      FOR r IN (SELECT tablename FROM pg_tables WHERE schemaname = 'public') LOOP
        EXECUTE 'DROP TABLE IF EXISTS ' || quote_ident(r.tablename) || ' CASCADE';
      END LOOP;
      FOR r IN (SELECT typname FROM pg_type WHERE typnamespace = (SELECT oid FROM pg_namespace WHERE nspname = 'public')) LOOP
        EXECUTE 'DROP TYPE IF EXISTS ' || quote_ident(r.typname) || ' CASCADE';
      END LOOP;
    END $$;
  `);

  const migrationsDir = resolve(__dirname, '../prisma/migrations');
  for (const directory of readdirSync(migrationsDir).sort()) {
    const migrationPath = join(migrationsDir, directory, 'migration.sql');
    if (existsSync(migrationPath)) await pool.query(readFileSync(migrationPath, 'utf8'));
  }
}

describe('Progress integration (record activity → rollup → myProgress)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let container: StartedPostgreSqlContainer;
  let pool: Pool;
  let accessToken: string;
  let userId: string;
  let dayKey: string;
  let year: number;

  beforeAll(async () => {
    if (!isDockerAvailable()) {
      throw new Error(
        'Docker is required for Progress integration tests (Testcontainers); no shared-database fallback is supported',
      );
    }

    container = await startOwnedDisposableDatabase();
    const databaseUrl = container.getConnectionUri();
    assertOwnedDisposableDatabaseUrl(databaseUrl, container);
    process.env.DATABASE_URL = databaseUrl;
    process.env.JWT_SECRET = 'progress-integration-secret';
    process.env.GOOGLE_CLIENT_ID = 'test';
    process.env.GOOGLE_CLIENT_SECRET = 'test';
    process.env.GOOGLE_CALLBACK_URL = 'http://localhost:3005/auth/google/callback';
    process.env.FRONTEND_URL = 'http://localhost:3000';
    process.env.AZURE_STORAGE_CONNECTION_STRING = '';
    process.env.AZURE_STORAGE_CONTAINER = 'test';
    process.env.AZURE_COMMUNICATION_CONNECTION_STRING = '';
    process.env.AZURE_EMAIL_SENDER = 'test@example.com';

    pool = new Pool({ connectionString: databaseUrl });
    await runMigrations(pool);

    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    await app.init();

    prisma = moduleFixture.get<PrismaService>(PrismaService);
    const authService = moduleFixture.get<AuthService>(AuthService);
    const registered = await authService.registerLocal({
      email: 'progress@example.com',
      password: 'password123',
      displayName: 'Progress Reader',
    });
    if (!registered.user) throw new Error('Registration returned no user');
    userId = registered.user.id;
    accessToken = registered.accessToken;
    dayKey = todayDayKey();
    year = Number.parseInt(dayKey.slice(0, 4), 10);
  }, 120000);

  afterAll(async () => {
    const closeTimeout = new Promise<void>((_, reject) =>
      setTimeout(() => reject(new Error('close timeout')), 15000),
    );
    try {
      await Promise.race([app?.close(), closeTimeout]);
    } catch {
      // ignore close errors or timeout
    }
    await pool?.end();
    await container?.stop();
  }, 30000);

  beforeEach(async () => {
    await prisma.activityEventReceipt.deleteMany();
    await prisma.dailyActivityType.deleteMany();
    await prisma.dailyActivity.deleteMany();
    await prisma.userStreak.deleteMany();
    await prisma.readingGoal.deleteMany();
    await prisma.activityEvent.deleteMany();
  });

  const gql = (query: string, variables: Record<string, unknown>) =>
    request(app.getHttpServer())
      .post('/graphql')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ query, variables });

  it('records activity, reflects it in DailyActivity, and reports it from myProgress', async () => {
    const recorded = await gql(RECORD_ACTIVITY, {
      input: { type: 'BOOK_READ', pagesDelta: 1, operationId: 'op-single' },
    });
    expect(recorded.body.errors).toBeUndefined();
    expect(recorded.body.data.recordActivity.dayKey).toBe(dayKey);
    expect(recorded.body.data.recordActivity.counted).toBe(true);

    const daily = await prisma.dailyActivity.findUnique({
      where: { userId_dayKey: { userId, dayKey } },
    });
    expect(daily).not.toBeNull();
    expect(daily?.activityCount).toBe(1);
    expect(daily?.pagesRead).toBe(1);

    const progress = await gql(MY_PROGRESS, { year });
    expect(progress.body.errors).toBeUndefined();
    const result = progress.body.data.myProgress;
    expect(result.year).toBe(year);
    expect(result.daysRead).toBe(1);
    expect(result.pagesRead).toBe(1);
    expect(result.currentStreak).toBe(1);
    expect(result.longestStreak).toBe(1);
    expect(result.lastActiveDayKey).toBe(dayKey);
  });

  it('does not inflate pagesRead when the same operationId is replayed', async () => {
    const first = await gql(RECORD_ACTIVITY, {
      input: { type: 'BOOK_READ', pagesDelta: 1, operationId: 'op-replay' },
    });
    expect(first.body.errors).toBeUndefined();
    expect(first.body.data.recordActivity.counted).toBe(true);

    // Exact duplicate: same type, same operationId. The receipt gate must
    // suppress the second pagesDelta and the daily type gate must report it
    // as already counted.
    const replay = await gql(RECORD_ACTIVITY, {
      input: { type: 'BOOK_READ', pagesDelta: 1, operationId: 'op-replay' },
    });
    expect(replay.body.errors).toBeUndefined();
    expect(replay.body.data.recordActivity.counted).toBe(false);

    const daily = await prisma.dailyActivity.findUnique({
      where: { userId_dayKey: { userId, dayKey } },
    });
    expect(daily?.activityCount).toBe(1);
    expect(daily?.pagesRead).toBe(1);

    const progress = await gql(MY_PROGRESS, { year });
    expect(progress.body.data.myProgress.daysRead).toBe(1);
    expect(progress.body.data.myProgress.pagesRead).toBe(1);
  });

  it('returns counted:false for a second same-day same-type event', async () => {
    const first = await gql(RECORD_ACTIVITY, {
      input: { type: 'BOOK_READ', pagesDelta: 1, operationId: 'op-type-a' },
    });
    expect(first.body.data.recordActivity.counted).toBe(true);

    const second = await gql(RECORD_ACTIVITY, {
      input: { type: 'BOOK_READ', pagesDelta: 1, operationId: 'op-type-b' },
    });
    expect(second.body.errors).toBeUndefined();
    expect(second.body.data.recordActivity.counted).toBe(false);
    expect(second.body.data.recordActivity.dayKey).toBe(dayKey);

    // The type is deduped (activityCount stays 1) while its pages still accrue.
    const daily = await prisma.dailyActivity.findUnique({
      where: { userId_dayKey: { userId, dayKey } },
    });
    expect(daily?.activityCount).toBe(1);
    expect(daily?.pagesRead).toBe(2);

    const progress = await gql(MY_PROGRESS, { year });
    expect(progress.body.data.myProgress.daysRead).toBe(1);
    expect(progress.body.data.myProgress.pagesRead).toBe(2);
  });
});
