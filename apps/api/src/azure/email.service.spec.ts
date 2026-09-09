/// <reference types="jest" />
import { ConfigService } from '@nestjs/config';
import { EmailService } from './email.service';

/**
 * Focused security regression spec (M5 — token leakage in logs):
 * (a) no token string appears in logger output,
 * (b) unconfigured + production throws instead of silently no-op'ing,
 * (c) dev/test resolves without sending.
 */
describe('EmailService (token/recipient privacy & config guard)', () => {
  const originalEnv = { ...process.env };
  let service: EmailService;
  let stdoutSpy: jest.SpyInstance;

  function makeService(connString: string | undefined, nodeEnv: string) {
    process.env.NODE_ENV = nodeEnv;
    const config = { get: jest.fn().mockReturnValue(connString) } as unknown as ConfigService;
    return new EmailService(config);
  }

  function capturedLogOutput(): string {
    // NestJS ConsoleLogger writes formatted lines via process.stdout.write.
    return stdoutSpy.mock.calls.map((c) => String(c[0])).join('\n');
  }

  beforeEach(() => {
    jest.restoreAllMocks();
    stdoutSpy = jest.spyOn(process.stdout, 'write').mockImplementation(() => true);
  });

  afterEach(() => {
    jest.restoreAllMocks();
    // Restore the original env so tests never leak NODE_ENV changes.
    process.env = { ...originalEnv };
  });

  describe('no token or recipient leakage in logs', () => {
    it('sendVerificationEmail never logs the token or recipient', async () => {
      service = makeService('unused-conn', 'development');
      await service.sendVerificationEmail('victim@example.com', 'super-secret-token-abc');
      const calls = capturedLogOutput();
      expect(calls).not.toContain('super-secret-token-abc');
      expect(calls).not.toContain('victim@example.com');
      expect(calls).toContain('recipient redacted');
    });

    it('sendPasswordReset never logs the token or recipient', async () => {
      service = makeService('unused-conn', 'development');
      await service.sendPasswordReset('victim@example.com', 'super-secret-token-abc');
      const calls = capturedLogOutput();
      expect(calls).not.toContain('super-secret-token-abc');
      expect(calls).not.toContain('victim@example.com');
      expect(calls).toContain('recipient redacted');
    });
  });

  describe('production configuration guard', () => {
    it('sendVerificationEmail throws when unconfigured in production', async () => {
      service = makeService(undefined, 'production');
      await expect(service.sendVerificationEmail('a@b.com', 'tok')).rejects.toThrow(
        'Email delivery is not configured',
      );
      // The stub must not silently succeed in prod.
      expect(stdoutSpy).not.toHaveBeenCalled();
    });

    it('sendPasswordReset throws when unconfigured in production', async () => {
      service = makeService(undefined, 'production');
      await expect(service.sendPasswordReset('a@b.com', 'tok')).rejects.toThrow(
        'Email delivery is not configured',
      );
      expect(stdoutSpy).not.toHaveBeenCalled();
    });
  });

  describe('dev/test behavior', () => {
    it('sendVerificationEmail resolves without sending in dev', async () => {
      service = makeService(undefined, 'development');
      await expect(service.sendVerificationEmail('a@b.com', 'tok')).resolves.toBeUndefined();
      expect(stdoutSpy).toHaveBeenCalled();
    });

    it('sendPasswordReset resolves without sending in test env', async () => {
      service = makeService(undefined, 'test');
      await expect(service.sendPasswordReset('a@b.com', 'tok')).resolves.toBeUndefined();
      expect(stdoutSpy).toHaveBeenCalled();
    });
  });
});
