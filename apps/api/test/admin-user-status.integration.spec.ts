import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';
import { PostgreSqlContainer, StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { Pool } from 'pg';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { execSync } from 'node:child_process';
import { UserStatus } from '@transformlit/shared';
import { assertOwnedDisposableDatabaseUrl } from './helpers/pwa-disposable-db.js';

// The migration that flips users.status from TEXT to the UserStatus enum.
const STATUS_MIGRATION = '20261007065256_admin_user_status';

const LEGACY_LOWER_ID = '11111111-1111-4111-8111-111111111111';
const LEGACY_UPPER_ID = '22222222-2222-4222-8222-222222222222';
const LEGACY_UNKNOWN_ID = '33333333-3333-4333-8333-333333333333';

function isDockerAvailable(): boolean {
  try {
    execSync('docker info', { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

function migrationsRoot(): string {
  return path.resolve(__dirname, '../prisma/migrations');
}

async function applyMigration(pool: Pool, directory: string): Promise<void> {
  const sqlFile = path.join(migrationsRoot(), directory, 'migration.sql');
  if (fs.existsSync(sqlFile)) {
    await pool.query(fs.readFileSync(sqlFile, 'utf-8'));
  }
}

describe('Admin UserStatus migration', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let container: StartedPostgreSqlContainer | null = null;
  let pool: Pool;

  beforeAll(async () => {
    if (!isDockerAvailable()) {
      // No shared-database fallback: this test resets the schema, so pointing it
      // at an arbitrary TEST_DATABASE_URL would be unsafe. Fail loudly.
      throw new Error('Docker is required for Admin UserStatus Integration tests (Testcontainers)');
    }
    container = await new PostgreSqlContainer('postgres:15-alpine')
      .withDatabase('testdb')
      .withUsername('test')
      .withPassword('test')
      .start();
    const databaseUrl = container.getConnectionUri();

    assertOwnedDisposableDatabaseUrl(databaseUrl, container);
    process.env.DATABASE_URL = databaseUrl;
    process.env.JWT_SECRET = 'test-jwt-secret';
    process.env.GOOGLE_CLIENT_ID = 'test';
    process.env.GOOGLE_CLIENT_SECRET = 'test';
    process.env.GOOGLE_CALLBACK_URL = 'http://localhost:3005/auth/google/callback';
    process.env.FRONTEND_URL = 'http://localhost:3000';
    process.env.AZURE_STORAGE_CONNECTION_STRING = '';
    process.env.AZURE_STORAGE_CONTAINER = 'test';
    process.env.AZURE_COMMUNICATION_CONNECTION_STRING = '';
    process.env.AZURE_EMAIL_SENDER = 'test@example.com';

    pool = new Pool({ connectionString: databaseUrl });

    // Apply every migration BEFORE the enum conversion, then seed legacy rows
    // with the old TEXT status (both 'active' and 'ACTIVE' appear in the repo),
    // then apply the enum migration to prove the case-tolerant cast.
    for (const directory of fs.readdirSync(migrationsRoot()).sort()) {
      if (directory === STATUS_MIGRATION) break;
      await applyMigration(pool, directory);
    }

    await pool.query(
      `INSERT INTO users (id, email, "emailNormalized", "displayName", "status", "createdAt", "updatedAt")
       VALUES ($1, $2, $2, 'Legacy Lower', 'active', now(), now()),
              ($3, $4, $4, 'Legacy Upper', 'ACTIVE', now(), now()),
              ($5, $6, $6, 'Legacy Unknown', 'banned', now(), now())`,
      [
        LEGACY_LOWER_ID,
        'legacy-lower@example.com',
        LEGACY_UPPER_ID,
        'legacy-upper@example.com',
        LEGACY_UNKNOWN_ID,
        'legacy-unknown@example.com',
      ],
    );

    await applyMigration(pool, STATUS_MIGRATION);

    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    await app.init();

    prisma = moduleFixture.get<PrismaService>(PrismaService);
  }, 180000);

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
    if (container) {
      await container.stop();
    }
  }, 30000);

  it('converts users.status to the UserStatus enum type', async () => {
    const { rows } = await pool.query<{ data_type: string; udt_name: string; column_default: string | null }>(
      `SELECT data_type, udt_name, column_default
         FROM information_schema.columns
        WHERE table_name = 'users' AND column_name = 'status'`,
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].udt_name).toBe('UserStatus');
    expect(rows[0].data_type).toBe('USER-DEFINED');
    expect(rows[0].column_default).toContain('ACTIVE');
  });

  it('is case-tolerant and maps unknown legacy values to SUSPENDED', async () => {
    const { rows } = await pool.query<{ id: string; status: string }>(
      'SELECT id, status FROM users ORDER BY id',
    );
    const byId = new Map(rows.map((row) => [row.id, row.status]));
    expect(byId.get(LEGACY_LOWER_ID)).toBe('ACTIVE');
    expect(byId.get(LEGACY_UPPER_ID)).toBe('ACTIVE');
    expect(byId.get(LEGACY_UNKNOWN_ID)).toBe('SUSPENDED');
  });

  it('round-trips a seeded user row as ACTIVE through the Prisma client', async () => {
    const user = await prisma.user.findUnique({ where: { id: LEGACY_LOWER_ID } });
    expect(user?.status).toBe(UserStatus.ACTIVE);
    expect(UserStatus.SUSPENDED).toBe('SUSPENDED');
  });

  it('exposes status: UserStatus! in the canonical SDL', () => {
    const sdl = fs.readFileSync(path.resolve(__dirname, '../src/schema.gql'), 'utf8');
    expect(sdl).toContain('status: UserStatus!');
    expect(sdl).toMatch(/enum UserStatus \{[\s\S]*ACTIVE[\s\S]*SUSPENDED[\s\S]*\}/);
  });
});
