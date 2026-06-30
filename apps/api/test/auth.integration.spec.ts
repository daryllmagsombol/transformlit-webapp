import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';
import { AuthService } from '../src/auth/auth.service';
import { PostgreSqlContainer, StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { Pool } from 'pg';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { createHash } from 'node:crypto';
import { execSync } from 'node:child_process';

function isDockerAvailable(): boolean {
  try {
    execSync('docker info', { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

async function runMigrations(pool: Pool) {
  const migrationsDir = path.resolve(__dirname, '../prisma/migrations');
  const dirs = fs.readdirSync(migrationsDir).sort();
  for (const dir of dirs) {
    const sqlFile = path.join(migrationsDir, dir, 'migration.sql');
    if (fs.existsSync(sqlFile)) {
      const sql = fs.readFileSync(sqlFile, 'utf-8');
      await pool.query(sql);
    }
  }
}

describe('Auth Integration', () => {
  let app: INestApplication;
  let authService: AuthService;
  let prisma: PrismaService;
  let container: StartedPostgreSqlContainer | null = null;
  let pool: Pool;

  beforeAll(async () => {
    let databaseUrl: string;

    if (isDockerAvailable()) {
      container = await new PostgreSqlContainer('postgres:15-alpine')
        .withDatabase('testdb')
        .withUsername('test')
        .withPassword('test')
        .start();
      databaseUrl = container.getConnectionUri();
    } else {
      databaseUrl =
        process.env.TEST_DATABASE_URL ||
        'postgresql://localhost:5432/transformlit_test';
    }

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

    await runMigrations(pool);

    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    await app.init();

    authService = moduleFixture.get<AuthService>(AuthService);
    prisma = moduleFixture.get<PrismaService>(PrismaService);
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
    if (container) {
      await container.stop();
    }
  }, 30000);

  beforeEach(async () => {
    await prisma.refreshToken.deleteMany();
    await prisma.identity.deleteMany();
    await prisma.user.deleteMany();
  });

  describe('registerLocal', () => {
    it('should register a new user and return tokens', async () => {
      const input = {
        email: 'test@example.com',
        password: 'password123',
        displayName: 'Test User',
      };

      const result = await authService.registerLocal(input);

      expect(result).toHaveProperty('accessToken');
      expect(result).toHaveProperty('refreshToken');
      expect(result.user).toHaveProperty('id');
      expect(result.user.email).toBe('test@example.com');
      expect(result.user.displayName).toBe('Test User');

      const dbUser = await prisma.user.findUnique({
        where: { emailNormalized: 'test@example.com' },
      });
      expect(dbUser).toBeTruthy();
      expect(dbUser?.passwordHash).not.toBe('password123');
    });

    it('should fail to register with duplicate email', async () => {
      const input = {
        email: 'duplicate@example.com',
        password: 'password123',
        displayName: 'Test User',
      };

      await authService.registerLocal(input);

      await expect(authService.registerLocal(input)).rejects.toThrow();
    });
  });

  describe('loginLocal', () => {
    it('should login with valid credentials', async () => {
      await authService.registerLocal({
        email: 'login@example.com',
        password: 'password123',
        displayName: 'Login User',
      });

      const result = await authService.loginLocal({
        email: 'login@example.com',
        password: 'password123',
      });

      expect(result).toHaveProperty('accessToken');
      expect(result).toHaveProperty('refreshToken');
      expect(result.user.email).toBe('login@example.com');
    });

    it('should fail login with wrong password', async () => {
      await authService.registerLocal({
        email: 'wrong@example.com',
        password: 'password123',
        displayName: 'Wrong User',
      });

      await expect(
        authService.loginLocal({
          email: 'wrong@example.com',
          password: 'wrongpassword',
        }),
      ).rejects.toThrow('Invalid credentials');
    });

    it('should fail login with non-existent user', async () => {
      await expect(
        authService.loginLocal({
          email: 'nonexistent@example.com',
          password: 'password123',
        }),
      ).rejects.toThrow('Invalid credentials');
    });
  });

  describe('refreshTokens', () => {
    it('should refresh tokens and rotate', async () => {
      const { refreshToken } = await authService.registerLocal({
        email: 'refresh@example.com',
        password: 'password123',
        displayName: 'Refresh User',
      });

      const result = await authService.refreshTokens(refreshToken);

      expect(result).toHaveProperty('accessToken');
      expect(result).toHaveProperty('refreshToken');
      expect(result.refreshToken).not.toBe(refreshToken);

      const oldTokenHash = createHash('sha256')
        .update(refreshToken)
        .digest('hex');
      const oldToken = await prisma.refreshToken.findUnique({
        where: { tokenHash: oldTokenHash },
      });
      expect(oldToken?.revokedAt).toBeTruthy();
    });

    it('should fail refresh with invalid token', async () => {
      await expect(authService.refreshTokens('invalid-token')).rejects.toThrow();
    });
  });

  describe('validateUser', () => {
    it('should validate existing user', async () => {
      const { user } = await authService.registerLocal({
        email: 'validate@example.com',
        password: 'password123',
        displayName: 'Validate User',
      });

      const validated = await authService.validateUser(user.id);
      expect(validated).toBeTruthy();
      expect(validated?.id).toBe(user.id);
    });

    it('should return null for non-existent user', async () => {
      const validated = await authService.validateUser('non-existent-id');
      expect(validated).toBeNull();
    });
  });
});
