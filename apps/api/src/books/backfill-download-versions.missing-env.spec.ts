import { Logger } from '@nestjs/common';

/**
 * A separate module registry from the happy-path spec: the script throws before
 * creating a Nest context when DATABASE_URL is absent, and the rejection is
 * routed to `console.error` / `process.exitCode`.
 */
jest.mock('@nestjs/core', () => ({
  NestFactory: { createApplicationContext: jest.fn() },
}));
jest.mock('./book-download-backfill.module.js', () => ({ BookDownloadBackfillModule: class MockBackfillModule {} }));
jest.mock('./book-download.service.js', () => ({ BookDownloadService: class MockBookDownloadService {} }));

import { NestFactory } from '@nestjs/core';

async function settle(): Promise<void> {
  for (let i = 0; i < 5; i += 1) {
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
}

describe('backfill-download-versions refusal', () => {
  const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => undefined);
  const logSpy = jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);

  beforeAll(async () => {
    delete process.env.DATABASE_URL;
    process.argv = ['node', 'backfill-download-versions'];
    await import('./backfill-download-versions.js');
    await settle();
  });

  afterAll(() => {
    errorSpy.mockRestore();
    logSpy.mockRestore();
    process.exitCode = 0;
  });

  it('refuses to run without DATABASE_URL and reports failure', () => {
    expect(NestFactory.createApplicationContext).not.toHaveBeenCalled();
    expect(errorSpy).toHaveBeenCalledWith(
      'Book download version backfill failed',
      expect.objectContaining({ message: expect.stringContaining('DATABASE_URL is not set') }),
    );
    expect(process.exitCode).toBe(1);
  });
});
